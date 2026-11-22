import request from 'supertest';
import type { App } from 'supertest/types';
import { OrderDeadlinesService } from '../src/orders/order-deadlines.service';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';
import {
  OrderSeed,
  type DraftOrder,
  type OrderActor,
  type OrderProvider,
} from './orders/order-seed';

const API = '/api/v1';
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Auth = { Authorization: string };

/**
 * Huỷ đơn trước khi vào kỳ chăm + năm hạn tự chạy, trên Postgres thật.
 * Đơn mẫu: 2 cây × 200.000, phí 6% = 24.000, phí lấy cây 60.000 → khách trả 484.000 (sổ đơn);
 * có khai giá thì thêm 300.000 tiền bảo đảm khai giá (sổ riêng) → 784.000.
 * "Hoàn 100%" = khách 484.000. "Vườn giữ phí lấy cây" = khách 424.000, vườn 60.000 (chờ 3 ngày).
 * Seed đặt giờ hẹn = lúc tạo + 1 ngày; test tua giờ bằng cách UPDATE giờ hẹn / cột hạn rồi gọi route
 * hoặc gọi thẳng hàm của bộ quét (bộ hẹn giờ không chạy trong e2e).
 */
describe('Huỷ đơn trước khi nhận cây + các hạn tự chạy (e2e)', () => {
  let ctx: AuthTestApp;
  let http: App;
  let seed: OrderSeed;
  let deadlines: OrderDeadlinesService;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
    http = ctx.app.getHttpServer() as App;
    seed = new OrderSeed(ctx);
    deadlines = ctx.app.get(OrderDeadlinesService);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  const post = (path: string, auth: Auth, body: object = {}) =>
    request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const detail = async (orderId: string, auth: Auth) =>
    (await request(http).get(`${API}/orders/${orderId}`).set(auth).expect(200))
      .body as Record<string, any>;

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
    id: string;
  }

  type Stage =
    | 'PENDING_PROVIDER'
    | 'AGREEMENT_PENDING'
    | 'AWAITING_PAYMENT'
    | 'PAID'
    | 'HANDOVER_IN_PROGRESS'
    | 'HANDOVER_AWAITING_CONFIRM';

  // Đưa đơn mẫu tới đúng chặng bằng API thật. `declared` = cây A khai 3.000.000 → tiền bảo đảm khai giá 300.000.
  const to = async (stage: Stage, { declared = false } = {}): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    const c = { customer, provider, order, id };
    if (declared) {
      await sql(
        `UPDATE plants SET is_value_declared = true, declared_value = 3000000,
                declared_deposit = 300000 WHERE id = $1`,
        [order.plantIds[0]],
      );
    }
    await post(`${id}/submit`, customer.auth).expect(200);
    if (stage === 'PENDING_PROVIDER') return c;
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    if (stage === 'AGREEMENT_PENDING') return c;
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    if (stage === 'AWAITING_PAYMENT') return c;
    await seed
      .webhook(order.orderCode, declared ? '784000' : order.amountDue)
      .expect(200);
    if (stage === 'PAID') return c;
    await post(`${id}/handover/start`, provider.auth).expect(201);
    if (stage === 'HANDOVER_IN_PROGRESS') return c;
    for (const plantId of order.plantIds) {
      await post(`${id}/handover/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, provider.auth).expect(200);
    return c;
  };

  // Tua giờ: đặt giờ hẹn lấy cây cách hiện tại `offsetMs` (âm = đã qua).
  const setPickup = (orderId: string, offsetMs: number) =>
    sql(`UPDATE service_orders SET scheduled_pickup_at = $2 WHERE id = $1`, [
      orderId,
      new Date(Date.now() + offsetMs),
    ]);

  const orderRow = async (orderId: string) =>
    (
      await sql(
        `SELECT status, cancelled_by, cancel_code, cancel_reason, cancelled_at,
                provider_respond_due_at, agreement_due_at, payment_due_at, scheduled_pickup_at
           FROM service_orders WHERE id = $1`,
        [orderId],
      )
    )[0];

  const balance = async (orderId: string, book: 'ORDER' | 'DECLARED') =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS balance FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2`,
        [orderId, book],
      )
    )[0].balance as string;

  const ledgerCount = async (orderId: string) =>
    Number(
      (
        await sql(
          `SELECT COUNT(*) AS n FROM escrow_ledger WHERE service_order_id = $1`,
          [orderId],
        )
      )[0].n,
    );

  const disbursements = (orderId: string) =>
    sql(
      `SELECT type, amount, status, customer_id, provider_id, eligible_at
         FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [orderId],
    );

  const components = (orderId: string) =>
    sql(
      `SELECT component_type, status FROM payment_components
        WHERE service_order_id = $1 ORDER BY component_type`,
      [orderId],
    );

  const agreementStatus = async (orderId: string) =>
    (
      await sql(
        `SELECT status FROM service_agreements WHERE service_order_id = $1`,
        [orderId],
      )
    )[0]?.status as string | undefined;

  const handoverRow = async (orderId: string) =>
    (
      await sql(
        `SELECT id, status, note, customer_confirm_due_at, created_at
           FROM handovers WHERE service_order_id = $1 AND handover_type = 'IN'`,
        [orderId],
      )
    )[0];

  const cancelCount = async (provider: OrderProvider) =>
    (
      await sql(
        `SELECT cancelled_order_count FROM provider_profiles WHERE id = $1`,
        [provider.profileId],
      )
    )[0].cancelled_order_count as number;

  // Sau mọi nhánh có tiền: hai sổ về đúng 0 (không còn đồng nào treo).
  const expectBooksEmpty = async (orderId: string) => {
    expect(await balance(orderId, 'ORDER')).toBe('0');
    expect(await balance(orderId, 'DECLARED')).toBe('0');
  };

  // Hoàn 100%: một lệnh REFUND cho khách, chi được ngay; không có lệnh nào cho vườn.
  const expectFullRefund = async (c: Ctx, declared = false) => {
    await expectBooksEmpty(c.id);
    const rows = await disbursements(c.id);
    expect(rows.map((row) => [row.type, row.amount])).toEqual(
      declared
        ? [
            ['DECLARED_RETURN', '300000'],
            ['REFUND', '484000'],
          ]
        : [['REFUND', '484000']],
    );
    for (const row of rows) {
      expect(row.customer_id).toBe(c.customer.profileId);
      expect(row.provider_id).toBeNull();
      expect(new Date(row.eligible_at).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    }
    expect((await components(c.id)).map((row) => row.status)).toEqual(
      (declared ? [1, 2, 3] : [1, 2]).map(() => 'REFUNDED'),
    );
  };

  // Vườn giữ phí lấy cây: khách 424.000 chi ngay, vườn 60.000 chờ 3 ngày.
  const expectPickupFeeKept = async (c: Ctx) => {
    await expectBooksEmpty(c.id);
    const rows = await disbursements(c.id);
    expect(rows.map((row) => [row.type, row.amount])).toEqual([
      ['PAYOUT', '60000'],
      ['REFUND', '424000'],
    ]);
    const [payout, refund] = rows;
    expect(payout.provider_id).toBe(c.provider.profileId);
    expect(refund.customer_id).toBe(c.customer.profileId);
    const wait = new Date(payout.eligible_at).getTime() - Date.now();
    expect(Math.abs(wait - 3 * DAY_MS)).toBeLessThan(60_000);
    expect(await components(c.id)).toEqual([
      { component_type: 'PACKAGE_PRICE', status: 'REFUNDED' },
      { component_type: 'PICKUP_FEE', status: 'RELEASED' },
    ]);
  };

  describe('hạn chờ và gửi đơn', () => {
    it('giờ hẹn còn không quá 3 giờ → gửi đơn bị chặn PICKUP_TOO_SOON; còn hơn 3 giờ thì gửi được', async () => {
      const customer = await seed.customer();
      const provider = await seed.provider();
      const order = await seed.draftOrder(customer, provider);
      await setPickup(order.orderId, 2 * HOUR_MS);
      const tooSoon = await post(
        `${order.orderId}/submit`,
        customer.auth,
      ).expect(400);
      expect(tooSoon.body.message).toBe('PICKUP_TOO_SOON');
      expect((await orderRow(order.orderId)).status).toBe('DRAFT');

      await setPickup(order.orderId, 3 * HOUR_MS + 5 * MINUTE_MS);
      await post(`${order.orderId}/submit`, customer.auth).expect(200);
    });

    it('giờ hẹn gần (1 ngày): cả ba hạn dừng ở giờ hẹn − 3 giờ; chi tiết đơn trả đủ các mốc', async () => {
      const c = await to('AWAITING_PAYMENT');
      const row = await orderRow(c.id);
      const closeAt = new Date(row.scheduled_pickup_at).getTime() - 3 * HOUR_MS;
      for (const column of [
        'provider_respond_due_at',
        'agreement_due_at',
        'payment_due_at',
      ]) {
        expect(new Date(row[column]).getTime()).toBe(closeAt);
      }
      const view = await detail(c.id, c.customer.auth);
      const pickup = new Date(row.scheduled_pickup_at).getTime();
      expect(new Date(view.deadlines.paymentDueAt).getTime()).toBe(closeAt);
      expect(new Date(view.deadlines.freeCancelUntil).getTime()).toBe(closeAt);
      expect(new Date(view.deadlines.noShowFrom).getTime()).toBe(
        pickup + 30 * MINUTE_MS,
      );
      // Chưa thanh toán thì chưa có gì để xem trước.
      expect(view.cancelPreview).toBeNull();
      // Vườn không thấy phần xem trước tiền của khách.
      expect(await detail(c.id, c.provider.auth)).not.toHaveProperty(
        'cancelPreview',
      );
    });

    it('giờ hẹn xa (5 ngày): mỗi hạn là 24 giờ kể từ lúc đơn vào trạng thái chờ đó', async () => {
      const customer = await seed.customer();
      const provider = await seed.provider();
      const order = await seed.draftOrder(customer, provider);
      const id = order.orderId;
      await setPickup(id, 5 * DAY_MS);
      await post(`${id}/submit`, customer.auth).expect(200);
      await post(`${id}/negotiation/respond`, provider.auth, {
        response: 'ACCEPT',
      }).expect(200);
      await post(`${id}/agreement/sign`, customer.auth).expect(200);
      await post(`${id}/agreement/sign`, provider.auth).expect(200);
      const row = await orderRow(id);
      for (const column of [
        'provider_respond_due_at',
        'agreement_due_at',
        'payment_due_at',
      ]) {
        const left = new Date(row[column]).getTime() - Date.now();
        expect(Math.abs(left - DAY_MS)).toBeLessThan(60_000);
      }
    });
  });

  describe('khách rút đơn khi chưa thanh toán', () => {
    it.each([
      'PENDING_PROVIDER',
      'AGREEMENT_PENDING',
      'AWAITING_PAYMENT',
    ] as const)(
      'đơn %s → CANCELLED, CUSTOMER_WITHDREW, không có tiền di chuyển',
      async (stage) => {
        const c = await to(stage);
        const res = await post(`${c.id}/cancel`, c.customer.auth, {
          reason: 'Đổi kế hoạch',
        }).expect(200);
        expect(res.body).toEqual({
          status: 'CANCELLED',
          cancelCode: 'CUSTOMER_WITHDREW',
          refundAmount: '0',
          declaredDepositReturned: '0',
        });
        const row = await orderRow(c.id);
        expect(row).toMatchObject({
          status: 'CANCELLED',
          cancelled_by: 'CUSTOMER',
          cancel_code: 'CUSTOMER_WITHDREW',
          cancel_reason: 'Đổi kế hoạch',
        });
        expect(row.cancelled_at).not.toBeNull();
        // Chưa từng trả tiền → paidAt rỗng (settlement vẫn còn số phải trả cũ, app đọc paidAt).
        expect((await detail(c.id, c.customer.auth)).paidAt).toBeNull();
        expect(await ledgerCount(c.id)).toBe(0);
        expect(await disbursements(c.id)).toEqual([]);
        expect(await cancelCount(c.provider)).toBe(0);
        if (stage !== 'PENDING_PROVIDER') {
          expect(await agreementStatus(c.id)).toBe('CANCELLED');
        }
        if (stage === 'AWAITING_PAYMENT') {
          // Dòng hoá đơn chờ trả không còn là khoản "chờ trả".
          expect((await components(c.id)).map((r) => r.status)).toEqual([
            'CANCELLED',
            'CANCELLED',
          ]);
          // Tiền về sau khi đơn đã huỷ không được ghi nhận.
          const late = await seed
            .webhook(c.order.orderCode, c.order.amountDue)
            .expect(200);
          expect(late.body.ignored).toBe('ORDER_NOT_AWAITING_PAYMENT');
          expect(await ledgerCount(c.id)).toBe(0);
        }
        // Huỷ lần hai → 409.
        const again = await post(`${c.id}/cancel`, c.customer.auth, {
          reason: 'Lần hai',
        }).expect(409);
        expect(again.body.message).toBe('INVALID_STATE_TRANSITION');
      },
    );

    it('đơn Nháp → 409; đơn của khách khác → 404; thiếu lý do → 400', async () => {
      const customer = await seed.customer();
      const provider = await seed.provider();
      const draft = await seed.draftOrder(customer, provider);
      const res = await post(`${draft.orderId}/cancel`, customer.auth, {
        reason: 'Thử',
      }).expect(409);
      expect(res.body.message).toBe('INVALID_STATE_TRANSITION');
      // Vườn không được biết đơn nháp tồn tại.
      await post(`${draft.orderId}/cancel`, provider.auth, {
        reason: 'Thử',
      }).expect(404);

      const c = await to('PENDING_PROVIDER');
      const stranger = await seed.customer();
      const notMine = await post(`${c.id}/cancel`, stranger.auth, {
        reason: 'Thử',
      }).expect(404);
      expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
      await post(`${c.id}/cancel`, c.customer.auth, {}).expect(400);
      expect((await orderRow(c.id)).status).toBe('PENDING_PROVIDER');
    });
  });

  describe('khách huỷ đơn đã thanh toán', () => {
    it('sớm hơn 3 giờ trước giờ hẹn → hoàn 100% kể cả tiền bảo đảm khai giá; xem trước khớp số thật', async () => {
      const c = await to('PAID', { declared: true });
      const paidView = await detail(c.id, c.customer.auth);
      expect(paidView.paidAt).not.toBeNull();
      const preview = paidView.cancelPreview;
      expect(preview).toEqual({
        cancelCode: 'CUSTOMER_CANCELLED_FREE',
        refundAmount: '484000',
        declaredDepositReturned: '300000',
        pickupFeeKept: '0',
      });
      const res = await post(`${c.id}/cancel`, c.customer.auth, {
        reason: 'Đổi kế hoạch',
      }).expect(200);
      expect(res.body).toEqual({
        status: 'CANCELLED',
        cancelCode: 'CUSTOMER_CANCELLED_FREE',
        refundAmount: preview.refundAmount,
        declaredDepositReturned: preview.declaredDepositReturned,
      });
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'CUSTOMER',
        cancel_code: 'CUSTOMER_CANCELLED_FREE',
      });
      await expectFullRefund(c, true);
      expect(await agreementStatus(c.id)).toBe('CANCELLED');
      expect(await cancelCount(c.provider)).toBe(0);
      // Đơn đã huỷ thì không còn gì để xem trước.
      expect((await detail(c.id, c.customer.auth)).cancelPreview).toBeNull();
    });

    it('trong 3 giờ cuối (còn 1 giờ tới giờ hẹn) → vườn giữ phí lấy cây 60.000, khách nhận 424.000', async () => {
      const c = await to('PAID');
      await setPickup(c.id, HOUR_MS);
      const preview = (await detail(c.id, c.customer.auth)).cancelPreview;
      expect(preview).toEqual({
        cancelCode: 'CUSTOMER_CANCELLED_LATE',
        refundAmount: '424000',
        declaredDepositReturned: '0',
        pickupFeeKept: '60000',
      });
      const res = await post(`${c.id}/cancel`, c.customer.auth, {
        reason: 'Bận đột xuất',
      }).expect(200);
      expect(res.body).toMatchObject({
        cancelCode: 'CUSTOMER_CANCELLED_LATE',
        refundAmount: '424000',
      });
      await expectPickupFeeKept(c);
      expect(await cancelCount(c.provider)).toBe(0);
    });

    it('vừa qua giờ hẹn nhưng còn trong ân hạn 30 phút → vẫn là huỷ muộn, vườn giữ phí lấy cây', async () => {
      const c = await to('PAID');
      await setPickup(c.id, -10 * MINUTE_MS);
      const res = await post(`${c.id}/cancel`, c.customer.auth, {
        reason: 'Không chờ nữa',
      }).expect(200);
      expect(res.body.cancelCode).toBe('CUSTOMER_CANCELLED_LATE');
      await expectPickupFeeKept(c);
    });

    it('sau giờ hẹn 31 phút mà vườn chưa mở phiên → vườn không tới: hoàn 100%, vườn +1 lần huỷ', async () => {
      const c = await to('PAID');
      await setPickup(c.id, -31 * MINUTE_MS);
      const res = await post(`${c.id}/cancel`, c.customer.auth, {
        reason: 'Vườn không tới',
      }).expect(200);
      expect(res.body).toMatchObject({
        cancelCode: 'PROVIDER_NO_SHOW',
        refundAmount: '484000',
      });
      // Khách là người bấm; lỗi của vườn đọc ở mã lý do.
      expect(await orderRow(c.id)).toMatchObject({
        cancelled_by: 'CUSTOMER',
        cancel_code: 'PROVIDER_NO_SHOW',
      });
      await expectFullRefund(c);
      expect(await cancelCount(c.provider)).toBe(1);
    });

    it('vườn đã mở phiên nhận cây → khách không huỷ bằng route này được nữa (409), tiền giữ nguyên', async () => {
      const c = await to('HANDOVER_IN_PROGRESS');
      const res = await post(`${c.id}/cancel`, c.customer.auth, {
        reason: 'Thử',
      }).expect(409);
      expect(res.body.message).toBe('INVALID_STATE_TRANSITION');
      expect(await balance(c.id, 'ORDER')).toBe('484000');
    });
  });

  describe('vườn huỷ đơn đã nhận', () => {
    it.each(['AGREEMENT_PENDING', 'AWAITING_PAYMENT'] as const)(
      'đơn %s → CANCELLED, PROVIDER_CANCELLED, không tiền, vườn +1 lần huỷ',
      async (stage) => {
        const c = await to(stage);
        const res = await post(`${c.id}/cancel`, c.provider.auth, {
          reason: 'Vườn hết chỗ',
        }).expect(200);
        // Vườn không thấy số tiền của khách.
        expect(res.body).toEqual({
          status: 'CANCELLED',
          cancelCode: 'PROVIDER_CANCELLED',
        });
        expect(await orderRow(c.id)).toMatchObject({
          status: 'CANCELLED',
          cancelled_by: 'PROVIDER',
          cancel_code: 'PROVIDER_CANCELLED',
          cancel_reason: 'Vườn hết chỗ',
        });
        expect(await ledgerCount(c.id)).toBe(0);
        expect(await cancelCount(c.provider)).toBe(1);
      },
    );

    it('đơn đã thanh toán → khách nhận lại 100% kể cả phí lấy cây, vườn +1 lần huỷ; admin thấy số lần huỷ', async () => {
      const c = await to('PAID', { declared: true });
      const res = await post(`${c.id}/cancel`, c.provider.auth, {
        reason: 'Vườn bận',
      }).expect(200);
      expect(res.body).toEqual({
        status: 'CANCELLED',
        cancelCode: 'PROVIDER_CANCELLED',
      });
      await expectFullRefund(c, true);
      expect(await cancelCount(c.provider)).toBe(1);

      const admin = await seed.admin();
      const adminView = await request(http)
        .get(`${API}/admin/providers/${c.provider.profileId}`)
        .set(admin.auth)
        .expect(200);
      expect(adminView.body.provider.cancelledOrderCount).toBe(1);
      // Vườn không tự thấy số này trong hồ sơ của mình; trang công khai cũng không.
      const mine = await request(http)
        .get(`${API}/providers/me`)
        .set(c.provider.auth)
        .expect(200);
      expect(mine.body).not.toHaveProperty('cancelledOrderCount');
      const pub = await request(http)
        .get(`${API}/providers/${c.provider.profileId}`)
        .expect(200);
      expect(pub.body).not.toHaveProperty('cancelledOrderCount');
    });

    it('đơn chưa nhận → 409 (dùng nút Từ chối); vườn khác → 404; vườn bị tước duyệt → 403; khách gọi route huỷ nhận cây → 403', async () => {
      const c = await to('PENDING_PROVIDER');
      const notAccepted = await post(`${c.id}/cancel`, c.provider.auth, {
        reason: 'Thử',
      }).expect(409);
      expect(notAccepted.body.message).toBe('INVALID_STATE_TRANSITION');

      const other = await seed.provider();
      await post(`${c.id}/cancel`, other.auth, { reason: 'Thử' }).expect(404);

      // Sai vai: route huỷ ở chặng nhận cây chỉ dành cho vườn.
      await post(`${c.id}/handover/cancel`, c.customer.auth, {
        reason: 'Thử',
      }).expect(403);

      await sql(
        `UPDATE provider_profiles SET verification_status = 'PENDING' WHERE id = $1`,
        [c.provider.profileId],
      );
      const unapproved = await post(`${c.id}/cancel`, c.provider.auth, {
        reason: 'Thử',
      }).expect(403);
      expect(unapproved.body.message).toBe('PROFILE_NOT_APPROVED');
      expect((await orderRow(c.id)).status).toBe('PENDING_PROVIDER');
    });
  });

  describe('vườn huỷ tại cửa', () => {
    it('khách vắng nhà: sau giờ hẹn 31 phút, có ảnh → vườn giữ phí lấy cây; ảnh lưu toạ độ + khoảng cách', async () => {
      const c = await to('HANDOVER_IN_PROGRESS');
      await setPickup(c.id, -31 * MINUTE_MS);
      const res = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Gọi 3 lần không ai ra',
        reasonCode: 'CUSTOMER_ABSENT',
        photos: [
          // Seed đặt điểm lấy cây ở (10.77, 106.70); ảnh này lệch 0,001 độ vĩ ≈ 111 m.
          {
            photoUrl: 'https://example.com/cong.jpg',
            gpsLat: 10.771,
            gpsLng: 106.7,
          },
          // Vườn tắt định vị: vẫn nhận ảnh, không có khoảng cách.
          { photoUrl: 'https://example.com/hem.jpg' },
        ],
      }).expect(200);
      expect(res.body).toEqual({
        status: 'CANCELLED',
        cancelCode: 'CUSTOMER_ABSENT',
      });
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'PROVIDER',
        cancel_code: 'CUSTOMER_ABSENT',
        cancel_reason: 'Gọi 3 lần không ai ra',
      });
      const handover = await handoverRow(c.id);
      expect(handover).toMatchObject({
        status: 'CANCELLED',
        note: 'Gọi 3 lần không ai ra',
      });
      const photos = await sql(
        `SELECT photo_url, gps_lat, gps_lng, distance_m FROM handover_cancel_photos
          WHERE handover_id = $1 ORDER BY photo_url`,
        [handover.id],
      );
      expect(photos).toEqual([
        {
          photo_url: 'https://example.com/cong.jpg',
          gps_lat: '10.771000',
          gps_lng: '106.700000',
          distance_m: 111,
        },
        {
          photo_url: 'https://example.com/hem.jpg',
          gps_lat: null,
          gps_lng: null,
          distance_m: null,
        },
      ]);
      await expectPickupFeeKept(c);
      // Khách vắng không phải lỗi của vườn.
      expect(await cancelCount(c.provider)).toBe(0);
    });

    it('khách vắng: chưa qua ân hạn → 409; thiếu ảnh → 400; quá 5 ảnh → 400; thiếu mã lý do → 400; đơn không đổi', async () => {
      const c = await to('HANDOVER_IN_PROGRESS');
      const photo = { photoUrl: 'https://example.com/cong.jpg' };

      const noCode = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
      }).expect(400);
      expect(noCode.body.message).toBe('REASON_CODE_REQUIRED');

      // Giờ hẹn còn ở tương lai (seed +1 ngày) → chưa thể là "khách vắng".
      const early = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'CUSTOMER_ABSENT',
        photos: [photo],
      }).expect(409);
      expect(early.body.message).toBe('CUSTOMER_ABSENT_TOO_EARLY');

      await setPickup(c.id, -29 * MINUTE_MS);
      await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'CUSTOMER_ABSENT',
        photos: [photo],
      }).expect(409);

      await setPickup(c.id, -31 * MINUTE_MS);
      const noPhoto = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'CUSTOMER_ABSENT',
      }).expect(400);
      expect(noPhoto.body.message).toBe('ABSENCE_PHOTO_REQUIRED');
      await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'CUSTOMER_ABSENT',
        photos: Array.from({ length: 6 }, () => photo),
      }).expect(400);
      await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'KHONG_CO_MA_NAY',
      }).expect(400);

      expect((await orderRow(c.id)).status).toBe('HANDOVER_IN_PROGRESS');
      expect(await balance(c.id, 'ORDER')).toBe('484000');
      expect(await sql(`SELECT 1 FROM handover_cancel_photos`)).toHaveLength(0);
    });

    it('vườn từ chối hết cây (complete báo ALL_PLANTS_REJECTED) → huỷ PROVIDER_CANNOT_SERVE: hoàn 100%, vườn +1', async () => {
      const c = await to('HANDOVER_IN_PROGRESS', { declared: true });
      for (const plantId of c.order.plantIds) {
        await post(
          `${c.id}/handover/plants/${plantId}/assess`,
          c.provider.auth,
          {
            checklist: { leaf: 'thối rễ' },
            decision: 'REJECT',
            isHighRisk: false,
            photos: [{ photoUrl: 'https://example.com/reject.jpg' }],
          },
        ).expect(201);
      }
      const stuck = await post(
        `${c.id}/handover/complete`,
        c.provider.auth,
      ).expect(400);
      expect(stuck.body.message).toBe('ALL_PLANTS_REJECTED');

      const res = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Cả hai cây đều thối rễ, không nhận chăm được',
        reasonCode: 'PROVIDER_CANNOT_SERVE',
      }).expect(200);
      expect(res.body).toEqual({
        status: 'CANCELLED',
        cancelCode: 'PROVIDER_CANNOT_SERVE',
      });
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'PROVIDER',
        cancel_code: 'PROVIDER_CANNOT_SERVE',
      });
      expect((await handoverRow(c.id)).status).toBe('CANCELLED');
      await expectFullRefund(c, true);
      expect(await cancelCount(c.provider)).toBe(1);
    });

    it('đã chốt biên bản, khách chưa trả lời: vườn đổi ý → hoàn 100%; còn "khách vắng" thì không dùng được nữa', async () => {
      const c = await to('HANDOVER_AWAITING_CONFIRM');
      await setPickup(c.id, -31 * MINUTE_MS);
      // Đã chốt biên bản nghĩa là hai bên đã gặp nhau.
      const absent = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Thử',
        reasonCode: 'CUSTOMER_ABSENT',
        photos: [{ photoUrl: 'https://example.com/cong.jpg' }],
      }).expect(409);
      expect(absent.body.message).toBe('INVALID_STATE_TRANSITION');

      await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Vườn không đủ chỗ',
        reasonCode: 'PROVIDER_CANNOT_SERVE',
      }).expect(200);
      await expectFullRefund(c);
      expect(await cancelCount(c.provider)).toBe(1);
      // Khách không còn gì để đồng ý.
      await post(`${c.id}/handover/confirm`, c.customer.auth).expect(409);
    });

    it('nhánh cũ: vườn không nộp tiền bảo đảm → mã DEPOSIT_UNPAID, vườn bấm thì cancelled_by = PROVIDER, vườn +1', async () => {
      const c = await to('HANDOVER_AWAITING_CONFIRM');
      await post(`${c.id}/handover/confirm`, c.customer.auth).expect(200);
      const res = await post(`${c.id}/handover/cancel`, c.provider.auth, {
        reason: 'Không đủ tiền bảo đảm',
      }).expect(200);
      expect(res.body).toEqual({
        status: 'CANCELLED',
        cancelCode: 'DEPOSIT_UNPAID',
      });
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'PROVIDER',
        cancel_code: 'DEPOSIT_UNPAID',
      });
      await expectFullRefund(c);
      expect(await cancelCount(c.provider)).toBe(1);
    });

    it('nhánh cũ: khách không giao cây → mã CUSTOMER_DECLINED, tiền như cũ', async () => {
      const c = await to('HANDOVER_AWAITING_CONFIRM');
      const preview = (await detail(c.id, c.customer.auth)).declinePreview;
      expect(preview).toMatchObject({ declaredDepositReturned: '0' });
      const res = await post(`${c.id}/handover/decline`, c.customer.auth, {
        reason: 'Không đồng ý biên bản',
      }).expect(200);
      expect(res.body.refundAmount).toBe(preview.refundAmount);
      // Hợp đồng huỷ theo đơn, giống khi bộ quét huỷ.
      expect(await agreementStatus(c.id)).toBe('CANCELLED');
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'CUSTOMER',
        cancel_code: 'CUSTOMER_DECLINED',
      });
      await expectPickupFeeKept(c);
      expect(await cancelCount(c.provider)).toBe(0);
    });
  });

  describe('bộ quét: ba hạn trước thanh toán', () => {
    const expire = (column: string, orderId: string) =>
      sql(
        `UPDATE service_orders SET ${column} = now() - interval '1 minute' WHERE id = $1`,
        [orderId],
      );

    it('vườn không trả lời: chưa tới hạn thì bỏ qua; quá hạn → EXPIRED, không ghi ai huỷ, không tính lần huỷ', async () => {
      const c = await to('PENDING_PROVIDER');
      expect(await deadlines.expireUnansweredOrders()).toBe(0);
      expect((await orderRow(c.id)).status).toBe('PENDING_PROVIDER');

      await expire('provider_respond_due_at', c.id);
      // Route tự kiểm hạn: bộ quét chưa chạy mà vườn bấm nhận / từ chối → 409.
      for (const response of ['ACCEPT', 'REJECT']) {
        const late = await post(
          `${c.id}/negotiation/respond`,
          c.provider.auth,
          { response },
        ).expect(409);
        expect(late.body.message).toBe('ORDER_DEADLINE_PASSED');
      }

      expect(await deadlines.expireUnansweredOrders()).toBe(1);
      expect(await orderRow(c.id)).toMatchObject({
        status: 'EXPIRED',
        cancelled_by: null,
        cancel_code: null,
        cancelled_at: null,
      });
      expect(await cancelCount(c.provider)).toBe(0);
      // Chạy lại không xử dòng nào.
      expect(await deadlines.expireUnansweredOrders()).toBe(0);
    });

    it('quá hạn ký → CANCELLED (SYSTEM, SIGN_TIMEOUT), hợp đồng CANCELLED; ký sau hạn bị chặn', async () => {
      const c = await to('AGREEMENT_PENDING');
      await post(`${c.id}/agreement/sign`, c.customer.auth).expect(200);
      expect(await deadlines.cancelUnsignedOrders()).toBe(0);

      await expire('agreement_due_at', c.id);
      const late = await post(`${c.id}/agreement/sign`, c.provider.auth).expect(
        409,
      );
      expect(late.body.message).toBe('ORDER_DEADLINE_PASSED');

      expect(await deadlines.cancelUnsignedOrders()).toBe(1);
      const row = await orderRow(c.id);
      expect(row).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'SYSTEM',
        cancel_code: 'SIGN_TIMEOUT',
      });
      expect(row.cancel_reason).toContain('Quá hạn ký');
      expect(await agreementStatus(c.id)).toBe('CANCELLED');
      expect(await cancelCount(c.provider)).toBe(0);
      expect(await deadlines.cancelUnsignedOrders()).toBe(0);
    });

    it('quá hạn thanh toán → CANCELLED (SYSTEM, PAYMENT_TIMEOUT); QR và tiền về sau hạn đều không được nhận', async () => {
      const c = await to('AWAITING_PAYMENT');
      expect(await deadlines.cancelUnpaidOrders()).toBe(0);

      await expire('payment_due_at', c.id);
      const qr = await post(`${c.id}/payment/qr`, c.customer.auth).expect(409);
      expect(qr.body.message).toBe('ORDER_DEADLINE_PASSED');
      // Tiền về trong lúc bộ quét chưa kịp chạy: không ghi nhận, đơn vẫn chờ, sổ không đổi.
      const late = await seed
        .webhook(c.order.orderCode, c.order.amountDue)
        .expect(200);
      expect(late.body.ignored).toBe('PAYMENT_DEADLINE_PASSED');
      expect((await orderRow(c.id)).status).toBe('AWAITING_PAYMENT');
      expect(await ledgerCount(c.id)).toBe(0);

      expect(await deadlines.cancelUnpaidOrders()).toBe(1);
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'SYSTEM',
        cancel_code: 'PAYMENT_TIMEOUT',
      });
      expect((await detail(c.id, c.customer.auth)).paidAt).toBeNull();
      expect((await components(c.id)).map((r) => r.status)).toEqual([
        'CANCELLED',
        'CANCELLED',
      ]);
      expect(await disbursements(c.id)).toEqual([]);
      expect(await deadlines.cancelUnpaidOrders()).toBe(0);
    });
  });

  describe('bộ quét: vườn không tới và khách im lặng với biên bản', () => {
    it.each(['PAID', 'HANDOVER_IN_PROGRESS'] as const)(
      'đơn %s quá giờ hẹn 24 giờ → huỷ (SYSTEM, PROVIDER_NO_SHOW), hoàn 100%, vườn +1',
      async (stage) => {
        const c = await to(stage, { declared: true });
        // Mới quá giờ hẹn 23 giờ: chưa tới hạn.
        await setPickup(c.id, -23 * HOUR_MS);
        expect(await deadlines.cancelProviderNoShows()).toBe(0);
        expect((await orderRow(c.id)).status).toBe(stage);

        await setPickup(c.id, -25 * HOUR_MS);
        expect(await deadlines.cancelProviderNoShows()).toBe(1);
        const row = await orderRow(c.id);
        expect(row).toMatchObject({
          status: 'CANCELLED',
          cancelled_by: 'SYSTEM',
          cancel_code: 'PROVIDER_NO_SHOW',
        });
        expect(row.cancel_reason).toContain('24 giờ');
        if (stage === 'HANDOVER_IN_PROGRESS') {
          expect((await handoverRow(c.id)).status).toBe('CANCELLED');
        }
        await expectFullRefund(c, true);
        expect(await cancelCount(c.provider)).toBe(1);
        expect(await deadlines.cancelProviderNoShows()).toBe(0);
      },
    );

    it('đơn cũ (thanh toán trước khi có luật hạn, không có hạn thanh toán) không bị tự huỷ', async () => {
      const c = await to('PAID');
      await sql(
        `UPDATE service_orders SET payment_due_at = NULL WHERE id = $1`,
        [c.id],
      );
      await setPickup(c.id, -10 * DAY_MS);
      expect(await deadlines.cancelProviderNoShows()).toBe(0);
      expect((await orderRow(c.id)).status).toBe('PAID');
      expect(await balance(c.id, 'ORDER')).toBe('484000');
    });

    it('vườn chốt biên bản: khách có đúng 2 giờ; quá hạn → huỷ như khách không giao cây (SYSTEM, CONFIRM_TIMEOUT)', async () => {
      const c = await to('HANDOVER_AWAITING_CONFIRM');
      const handover = await handoverRow(c.id);
      const window =
        new Date(handover.customer_confirm_due_at).getTime() - Date.now();
      expect(Math.abs(window - 2 * HOUR_MS)).toBeLessThan(60_000);
      expect(await deadlines.cancelUnconfirmedHandovers()).toBe(0);

      expect(
        (await detail(c.id, c.customer.auth)).declinePreview,
      ).not.toBeNull();
      await sql(
        `UPDATE handovers SET customer_confirm_due_at = now() - interval '1 minute' WHERE id = $1`,
        [handover.id],
      );
      // Quá hạn mà bộ quét chưa chạy: bấm sẽ 409 nên không hiện số xem trước.
      expect((await detail(c.id, c.customer.auth)).declinePreview).toBeNull();
      // Route tự kiểm hạn: quá 2 giờ thì khách không đồng ý / không từ chối được nữa.
      const lateConfirm = await post(
        `${c.id}/handover/confirm`,
        c.customer.auth,
      ).expect(409);
      expect(lateConfirm.body.message).toBe('ORDER_DEADLINE_PASSED');
      const lateDecline = await post(
        `${c.id}/handover/decline`,
        c.customer.auth,
        { reason: 'Trễ' },
      ).expect(409);
      expect(lateDecline.body.message).toBe('ORDER_DEADLINE_PASSED');
      expect((await orderRow(c.id)).status).toBe('HANDOVER_AWAITING_CONFIRM');

      expect(await deadlines.cancelUnconfirmedHandovers()).toBe(1);
      expect(await orderRow(c.id)).toMatchObject({
        status: 'CANCELLED',
        cancelled_by: 'SYSTEM',
        cancel_code: 'CONFIRM_TIMEOUT',
      });
      expect((await handoverRow(c.id)).status).toBe('CANCELLED');
      await expectPickupFeeKept(c);
      expect(await cancelCount(c.provider)).toBe(0);
      expect(await deadlines.cancelUnconfirmedHandovers()).toBe(0);
    });

    it('một lượt quét đủ tám hạn: mỗi đơn quá hạn được xử đúng một lần', async () => {
      const unanswered = await to('PENDING_PROVIDER');
      const unpaid = await to('AWAITING_PAYMENT');
      const noShow = await to('PAID');
      await sql(
        `UPDATE service_orders SET provider_respond_due_at = now() - interval '1 minute' WHERE id = $1`,
        [unanswered.id],
      );
      await sql(
        `UPDATE service_orders SET payment_due_at = now() - interval '1 minute' WHERE id = $1`,
        [unpaid.id],
      );
      await setPickup(noShow.id, -25 * HOUR_MS);

      expect(await deadlines.sweep()).toEqual({
        expiredDeposits: 0,
        autoConfirmedReturns: 0,
        escalatedDisputes: 0,
        expiredOrders: 1,
        cancelledUnsigned: 0,
        cancelledUnpaid: 1,
        cancelledNoShows: 1,
        cancelledUnconfirmed: 0,
      });
      expect(await deadlines.sweep()).toMatchObject({
        expiredOrders: 0,
        cancelledUnpaid: 0,
        cancelledNoShows: 0,
      });
    });
  });

  describe('chạy đua', () => {
    it('khách huỷ và vườn mở phiên cùng lúc → đúng một bên thắng, sổ không bị chia hai lần', async () => {
      const c = await to('PAID');
      const [cancel, start] = await Promise.all([
        post(`${c.id}/cancel`, c.customer.auth, { reason: 'Đổi kế hoạch' }),
        post(`${c.id}/handover/start`, c.provider.auth),
      ]);
      const cancelled = cancel.status === 200;
      const started = start.status === 201;
      expect([cancelled, started].filter(Boolean)).toHaveLength(1);
      if (cancelled) {
        expect(start.status).toBe(409);
        await expectFullRefund(c);
      } else {
        expect(cancel.status).toBe(409);
        expect((await orderRow(c.id)).status).toBe('HANDOVER_IN_PROGRESS');
        expect(await balance(c.id, 'ORDER')).toBe('484000');
        expect(await disbursements(c.id)).toEqual([]);
      }
    });

    it('khách báo vườn không tới và bộ quét 24 giờ cùng chạm một đơn → chỉ một bộ bút toán, vườn chỉ +1', async () => {
      const c = await to('PAID');
      await setPickup(c.id, -25 * HOUR_MS);
      const [cancel, swept] = await Promise.all([
        post(`${c.id}/cancel`, c.customer.auth, { reason: 'Vườn không tới' }),
        deadlines.cancelProviderNoShows(),
      ]);
      // Hoặc khách thắng (200, bộ quét bỏ qua), hoặc bộ quét thắng (khách nhận 409).
      expect([cancel.status === 200, swept === 1].filter(Boolean)).toHaveLength(
        1,
      );
      expect((await orderRow(c.id)).cancel_code).toBe('PROVIDER_NO_SHOW');
      await expectFullRefund(c);
      expect(await cancelCount(c.provider)).toBe(1);
    });
  });
});
