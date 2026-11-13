import request from 'supertest';
import type { App } from 'supertest/types';
import {
  OrderDeadlinesService,
  UNPAID_DEPOSIT_EXPIRED_REASON,
} from '../src/orders/order-deadlines.service';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';
import {
  OrderSeed,
  type DraftOrder,
  type OrderActor,
  type OrderProvider,
} from './orders/order-seed';

const API = '/api/v1';
const DAY_MS = 24 * 60 * 60 * 1000;

type Auth = { Authorization: string };

/**
 * Bộ quét ba hạn tự chạy, trên Postgres thật. Bộ hẹn giờ KHÔNG chạy trong e2e (NODE_ENV=test không nạp
 * ScheduleModule) — test tua giờ bằng cách UPDATE cột hạn về quá khứ rồi gọi thẳng hàm công khai.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 → khách trả 484.000 (sổ đơn).
 * Cây A khách khai 3.000.000, cây B không khai (mức đền 2 × 200.000) → tiền bảo đảm 3.400.000 (sổ bảo đảm).
 */
describe('Bộ quét ba hạn tự chạy (e2e)', () => {
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

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
    plantA: string;
    plantB: string;
  }

  // Đơn mẫu tới lúc khách đồng ý biên bản nhận cây: phiên AWAITING_DEPOSIT, khoản bảo đảm PENDING (hạn 2 giờ).
  const toAwaitingDeposit = async (): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    const [plantA, plantB] = order.plantIds;
    await sql(
      `UPDATE plants SET is_value_declared = true, declared_value = 3000000 WHERE id = $1`,
      [plantA],
    );
    // Khách khai sẵn tài khoản ngân hàng (mở tranh chấp cần; lệnh hoàn chụp lại).
    await sql(
      `UPDATE customer_profiles
          SET bank_name = 'Vietcombank', bank_account = '9876543210', bank_holder = 'NGUYEN VAN MINH'
        WHERE id = $1`,
      [customer.profileId],
    );
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    await seed.webhook(order.orderCode, order.amountDue).expect(200);
    await post(`${id}/handover/start`, provider.auth).expect(201);
    for (const plantId of order.plantIds) {
      await post(`${id}/handover/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, provider.auth).expect(200);
    await post(`${id}/handover/confirm`, customer.auth).expect(200);
    return { customer, provider, order, plantA, plantB };
  };

  // Đi tiếp tới lúc vườn chốt trả cây: RETURN_AWAITING_CONFIRM, phiên OUT AWAITING_CUSTOMER còn 48 giờ.
  const toReturnAwaiting = async (): Promise<Ctx> => {
    const c = await toAwaitingDeposit();
    const id = c.order.orderId;
    await seed.paySecurityDeposit(id);
    await sql(
      `UPDATE service_orders
          SET care_started_at = care_started_at - interval '40 days',
              care_due_at = now() - interval '1 hour'
        WHERE id = $1`,
      [id],
    );
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'héo' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    return c;
  };

  const openDispute = async (c: Ctx) => {
    const res = await post(`${c.order.orderId}/dispute`, c.customer.auth, {
      reason: 'Cây chết sau kỳ chăm',
      description: 'Nhận lại cây thì toàn bộ lá đã héo, rễ thối.',
      plantIds: [c.plantA],
      evidence: [
        { photoUrl: 'https://example.com/cay-heo.jpg', plantId: c.plantA },
      ],
    }).expect(201);
    return res.body.disputeId as string;
  };

  // Các bút toán SAU dòng tiền vào (DEPOSIT / SECURITY_IN) của một sổ.
  const moves = async (orderId: string, book: 'ORDER' | 'SECURITY') =>
    (
      await sql(
        `SELECT entry_type, amount FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2
          ORDER BY created_at, CASE entry_type
            WHEN 'DEPOSIT' THEN 0 WHEN 'SECURITY_IN' THEN 0 WHEN 'REFUND' THEN 1
            WHEN 'COMPENSATION' THEN 1 WHEN 'PLATFORM_FEE' THEN 2 ELSE 3 END`,
        [orderId, book],
      )
    )
      .slice(1)
      .map((row) => [row.entry_type, row.amount] as [string, string]);

  const balance = async (orderId: string, book: 'ORDER' | 'SECURITY') =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2`,
        [orderId, book],
      )
    )[0].sum as string;

  const disbursements = async (orderId: string) =>
    (
      await sql(
        `SELECT type, amount FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
        [orderId],
      )
    ).map((row) => [row.type, row.amount] as [string, string]);

  const orderRow = async (orderId: string) =>
    (
      await sql(
        `SELECT status, cancelled_by, cancelled_at, cancel_reason FROM service_orders WHERE id = $1`,
        [orderId],
      )
    )[0];

  const depositStatus = async (orderId: string) =>
    (
      await sql(
        `SELECT status FROM security_deposits WHERE service_order_id = $1`,
        [orderId],
      )
    )[0].status as string;

  const handover = async (orderId: string, type: 'IN' | 'OUT') =>
    (
      await sql(
        `SELECT status, note, confirmed_at, locked_at FROM handovers
          WHERE service_order_id = $1 AND handover_type = $2`,
        [orderId, type],
      )
    )[0];

  it('vườn không nộp tiền bảo đảm quá 2 giờ → đơn CANCELLED, khách hoàn đủ 484.000; chưa tới hạn / đã nộp thì không đụng; quét lần 2 không đổi gì', async () => {
    const late = await toAwaitingDeposit();
    const onTime = await toAwaitingDeposit();
    const paid = await toAwaitingDeposit();
    await seed.paySecurityDeposit(paid.order.orderId);
    const beforeStatus = (await orderRow(late.order.orderId)).status as string;

    // Chưa ai quá hạn: bộ quét không làm gì.
    expect(await deadlines.expireUnpaidDeposits()).toBe(0);
    expect((await orderRow(late.order.orderId)).status).toBe(beforeStatus);
    expect(await depositStatus(late.order.orderId)).toBe('PENDING');

    // Tua giờ: khoản của đơn `late` quá hạn 1 phút; khoản ĐÃ NỘP cũng bị đẩy hạn về quá khứ để chắc
    // bộ quét chỉ nhìn khoản còn PENDING.
    await sql(
      `UPDATE security_deposits SET due_at = now() - interval '1 minute'
        WHERE service_order_id = ANY($1)`,
      [[late.order.orderId, paid.order.orderId]],
    );
    expect(await deadlines.expireUnpaidDeposits()).toBe(1);

    const id = late.order.orderId;
    const order = await orderRow(id);
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelled_by: 'PROVIDER',
      cancel_reason: UNPAID_DEPOSIT_EXPIRED_REASON,
    });
    expect(order.cancelled_at).not.toBeNull();
    expect(await depositStatus(id)).toBe('CANCELLED');
    expect(await handover(id, 'IN')).toMatchObject({
      status: 'CANCELLED',
      note: UNPAID_DEPOSIT_EXPIRED_REASON,
    });
    // Lỗi của vườn → khách nhận lại 100%, kể cả phí lấy cây 60.000. Sổ đơn về 0, sổ bảo đảm chưa từng có tiền.
    expect(await moves(id, 'ORDER')).toEqual([['REFUND', '-484000']]);
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(await balance(id, 'SECURITY')).toBe('0');
    expect(await disbursements(id)).toEqual([['REFUND', '484000']]);
    expect(
      await sql(
        `SELECT component_type, status FROM payment_components
          WHERE service_order_id = $1 ORDER BY component_type`,
        [id],
      ),
    ).toEqual([
      { component_type: 'PACKAGE_PRICE', status: 'REFUNDED' },
      { component_type: 'PICKUP_FEE', status: 'REFUNDED' },
    ]);

    // Đơn chưa tới hạn và đơn đã nộp không bị đụng.
    expect((await orderRow(onTime.order.orderId)).status).toBe(beforeStatus);
    expect(await depositStatus(onTime.order.orderId)).toBe('PENDING');
    expect((await orderRow(paid.order.orderId)).status).toBe('IN_CARE');
    expect(await depositStatus(paid.order.orderId)).toBe('PAID');
    expect(await balance(paid.order.orderId, 'SECURITY')).toBe('3400000');

    // Quét lần 2 (hai lượt chồng nhau): không đổi gì, không sinh thêm lệnh hoàn.
    expect(await deadlines.expireUnpaidDeposits()).toBe(0);
    expect(await disbursements(id)).toEqual([['REFUND', '484000']]);
    expect((await orderRow(id)).cancelled_at).toEqual(order.cancelled_at);
    // Vườn bấm huỷ sau khi bộ quét đã huỷ → 409, cũng không đổi gì.
    const again = await post(`${id}/handover/cancel`, late.provider.auth, {
      reason: 'bấm trễ',
    }).expect(409);
    expect(again.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
  });

  it('khách im lặng quá 48 giờ → COMPLETED, phiên AUTO_CONFIRMED, sổ đơn 0 / 412.000 / 72.000, bảo đảm trả vườn 3.400.000; đơn đang DISPUTED không bị tự hoàn tất', async () => {
    const silent = await toReturnAwaiting();
    const disputed = await toReturnAwaiting();
    const waiting = await toReturnAwaiting();
    const id = silent.order.orderId;
    await openDispute(disputed);

    // Chưa tới 48 giờ: không đơn nào bị đụng.
    expect(await deadlines.autoConfirmReturns()).toBe(0);
    expect((await orderRow(id)).status).toBe('RETURN_AWAITING_CONFIRM');

    // Tua giờ cho đơn im lặng VÀ đơn đang tranh chấp (đồng hồ 48 giờ của đơn tranh chấp đã dừng lúc mở).
    await sql(
      `UPDATE handovers SET customer_confirm_due_at = now() - interval '1 minute'
        WHERE handover_type = 'OUT' AND service_order_id = ANY($1)`,
      [[id, disputed.order.orderId]],
    );
    expect(await deadlines.autoConfirmReturns()).toBe(1);

    expect((await orderRow(id)).status).toBe('COMPLETED');
    const out = await handover(id, 'OUT');
    expect(out.status).toBe('AUTO_CONFIRMED');
    expect(out.confirmed_at).not.toBeNull();
    expect(out.locked_at).not.toBeNull();
    // Không tranh chấp → không hoàn công (R = 0), không đền (C = 0); hai sổ đều về 0.
    expect(await moves(id, 'ORDER')).toEqual([
      ['PLATFORM_FEE', '-72000'],
      ['PAYOUT', '-412000'],
    ]);
    expect(await moves(id, 'SECURITY')).toEqual([
      ['SECURITY_RETURN', '-3400000'],
    ]);
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(await balance(id, 'SECURITY')).toBe('0');
    expect(await disbursements(id)).toEqual([
      ['PAYOUT', '412000'],
      ['SECURITY_RETURN', '3400000'],
    ]);

    // Đơn đang tranh chấp: vẫn DISPUTED, phiên vẫn DISPUTED, tiền còn nguyên hai sổ.
    expect((await orderRow(disputed.order.orderId)).status).toBe('DISPUTED');
    expect((await handover(disputed.order.orderId, 'OUT')).status).toBe(
      'DISPUTED',
    );
    expect(await balance(disputed.order.orderId, 'ORDER')).toBe('484000');
    expect(await balance(disputed.order.orderId, 'SECURITY')).toBe('3400000');
    expect(await disbursements(disputed.order.orderId)).toEqual([]);
    // Đơn chưa tới hạn vẫn chờ khách.
    expect((await orderRow(waiting.order.orderId)).status).toBe(
      'RETURN_AWAITING_CONFIRM',
    );

    // Quét lần 2 không đổi gì; khách bấm xác nhận / mở tranh chấp sau khi đơn đã tự hoàn tất → 409.
    expect(await deadlines.autoConfirmReturns()).toBe(0);
    expect(await disbursements(id)).toHaveLength(2);
    const lateConfirm = await post(
      `${id}/return/confirm`,
      silent.customer.auth,
    ).expect(409);
    expect(lateConfirm.body.message).toBe('INVALID_STATE_TRANSITION');
    await post(`${id}/dispute`, silent.customer.auth, {
      reason: 'Mở trễ',
      description: 'Đã quá 48 giờ nên không mở được nữa.',
      plantIds: [silent.plantA],
      evidence: [{ photoUrl: 'https://example.com/tre.jpg' }],
    }).expect(409);
    expect((await orderRow(id)).status).toBe('COMPLETED');
  });

  it('hết 3 ngày thương lượng → ADMIN_REVIEW, admin_due_at = +5 ngày, đề nghị PENDING → SUPERSEDED; chưa tới hạn thì không đổi', async () => {
    const due = await toReturnAwaiting();
    const fresh = await toReturnAwaiting();
    const dueId = await openDispute(due);
    const freshId = await openDispute(fresh);
    await post(`${due.order.orderId}/dispute/offers`, due.provider.auth, {
      refundAmount: '50000',
      compensationAmount: '0',
    }).expect(201);
    await post(`${fresh.order.orderId}/dispute/offers`, fresh.provider.auth, {
      refundAmount: '50000',
      compensationAmount: '0',
    }).expect(201);

    const disputeRow = async (disputeId: string) =>
      (
        await sql(
          `SELECT status, escalated_at, admin_due_at FROM disputes WHERE id = $1`,
          [disputeId],
        )
      )[0];
    const offerStatuses = async (disputeId: string) =>
      (
        await sql(`SELECT status FROM dispute_offers WHERE dispute_id = $1`, [
          disputeId,
        ])
      ).map((row) => row.status as string);

    // Chưa tới hạn: cả lượt quét (đủ ba hạn) không làm gì.
    expect(await deadlines.sweep()).toEqual({
      expiredDeposits: 0,
      autoConfirmedReturns: 0,
      escalatedDisputes: 0,
    });
    expect((await disputeRow(dueId)).status).toBe('NEGOTIATING');

    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [dueId],
    );
    const now = new Date();
    expect(await deadlines.escalateDisputes(now)).toBe(1);

    const row = await disputeRow(dueId);
    expect(row.status).toBe('ADMIN_REVIEW');
    expect(new Date(row.escalated_at).getTime()).toBe(now.getTime());
    expect(new Date(row.admin_due_at).getTime()).toBe(
      now.getTime() + 5 * DAY_MS,
    );
    expect(await offerStatuses(dueId)).toEqual(['SUPERSEDED']);
    // Chuyển admin không đụng đơn, không đụng tiền.
    expect((await orderRow(due.order.orderId)).status).toBe('DISPUTED');
    expect(await balance(due.order.orderId, 'ORDER')).toBe('484000');
    expect(await balance(due.order.orderId, 'SECURITY')).toBe('3400000');

    // Tranh chấp chưa tới hạn giữ nguyên, đề nghị vẫn chờ.
    expect(await disputeRow(freshId)).toMatchObject({
      status: 'NEGOTIATING',
      escalated_at: null,
      admin_due_at: null,
    });
    expect(await offerStatuses(freshId)).toEqual(['PENDING']);

    // Quét lần 2: không chuyển lại, hạn admin không bị dời.
    expect(await deadlines.escalateDisputes()).toBe(0);
    expect(new Date((await disputeRow(dueId)).admin_due_at).getTime()).toBe(
      now.getTime() + 5 * DAY_MS,
    );
  });
});
