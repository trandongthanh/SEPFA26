import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DisputesService } from '../src/orders/disputes.service';
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
 * Tranh chấp lúc trả cây, trên Postgres thật.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 → khách trả 484.000 (sổ đơn).
 * Cây A khách khai 3.000.000, cây B không khai (mức đền 2 × 200.000 = 400.000) → tiền bảo đảm 3.400.000.
 */
describe('Tranh chấp lúc trả cây (e2e)', () => {
  let ctx: AuthTestApp;
  let http: App;
  let seed: OrderSeed;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
    http = ctx.app.getHttpServer() as App;
    seed = new OrderSeed(ctx);
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  const post = (path: string, auth: Auth, body: object = {}) =>
    request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const get = (path: string, auth: Auth) =>
    request(http).get(`${API}/${path}`).set(auth);

  const detail = async (orderId: string, auth: Auth) =>
    (await get(`orders/${orderId}`, auth).expect(200)).body as Record<
      string,
      any
    >;

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
    plantA: string;
    plantB: string;
  }

  const CUSTOMER_BANK = {
    bank_name: 'Vietcombank',
    bank_account: '9876543210',
    bank_holder: 'NGUYEN VAN MINH',
  };

  const setCustomerBank = (customerProfileId: string) =>
    sql(
      `UPDATE customer_profiles
          SET bank_name = $2, bank_account = $3, bank_holder = $4 WHERE id = $1`,
      [
        customerProfileId,
        CUSTOMER_BANK.bank_name,
        CUSTOMER_BANK.bank_account,
        CUSTOMER_BANK.bank_holder,
      ],
    );

  /**
   * Đơn mẫu đi hết tới lúc vườn chốt trả cây (RETURN_AWAITING_CONFIRM, phiên OUT AWAITING_CUSTOMER còn 48 giờ).
   * `rejectB`: vườn từ chối cây B lúc nhận (bảo đảm chỉ 3.000.000). `bank=false`: khách chưa khai ngân hàng.
   */
  const toReturnAwaiting = async ({
    rejectB = false,
    bank = true,
  } = {}): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    const [plantA, plantB] = order.plantIds;
    await sql(
      `UPDATE plants SET is_value_declared = true, declared_value = 3000000 WHERE id = $1`,
      [plantA],
    );
    if (bank) await setCustomerBank(customer.profileId);

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
        decision: rejectB && plantId === plantB ? 'REJECT' : 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, provider.auth).expect(200);
    await post(`${id}/handover/confirm`, customer.auth, {
      objectionNote: 'Vườn ghi lá vàng sẵn, thực tế lá còn xanh',
      objectionPhotos: [{ photoUrl: 'https://example.com/la-xanh.jpg' }],
    }).expect(200);
    await seed.paySecurityDeposit(id);
    await sql(
      `UPDATE service_orders
          SET care_started_at = care_started_at - interval '40 days',
              care_due_at = now() - interval '1 hour'
        WHERE id = $1`,
      [id],
    );
    await post(`${id}/return/start`, provider.auth).expect(200);
    for (const plantId of rejectB ? [plantA] : order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'héo' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, provider.auth).expect(200);
    return { customer, provider, order, plantA, plantB };
  };

  const openBody = (plantIds: string[]) => ({
    reason: 'Cây chết sau kỳ chăm',
    description: 'Nhận lại cây thì toàn bộ lá đã héo, rễ thối.',
    plantIds,
    evidence: [
      {
        photoUrl: 'https://example.com/cay-heo.jpg',
        caption: 'Lá héo',
        plantId: plantIds[0],
      },
    ],
  });

  // Khách mở tranh chấp trên các cây truyền vào (mặc định chỉ cây A) → trả disputeId.
  const openDispute = async (c: Ctx, plantIds: string[] = [c.plantA]) => {
    const res = await post(
      `${c.order.orderId}/dispute`,
      c.customer.auth,
      openBody(plantIds),
    ).expect(201);
    return res.body.disputeId as string;
  };

  // Tua hạn thương lượng rồi gọi đúng hàm bộ quét sẽ gọi (mỗi tranh chấp một transaction).
  const escalate = (disputeId: string) =>
    ctx.dataSource.transaction((manager) =>
      ctx.app
        .get(DisputesService)
        .escalateDispute(manager, disputeId, new Date()),
    );

  const toAdminReview = async (c: Ctx, plantIds?: string[]) => {
    const disputeId = await openDispute(c, plantIds);
    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [disputeId],
    );
    expect(await escalate(disputeId)).toBe(true);
    return disputeId;
  };

  const ledger = (orderId: string, book: 'ORDER' | 'SECURITY') =>
    sql(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = $2
        ORDER BY created_at, CASE entry_type
          WHEN 'DEPOSIT' THEN 0 WHEN 'SECURITY_IN' THEN 0 WHEN 'REFUND' THEN 1
          WHEN 'COMPENSATION' THEN 1 WHEN 'PLATFORM_FEE' THEN 2 ELSE 3 END`,
      [orderId, book],
    );

  const balance = async (orderId: string, book: 'ORDER' | 'SECURITY') =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2`,
        [orderId, book],
      )
    )[0].sum as string;

  const disbursements = (orderId: string) =>
    sql(
      `SELECT type, amount, status, customer_id, provider_id, bank_account
         FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [orderId],
    );

  const disputeRow = async (disputeId: string) =>
    (
      await sql(
        `SELECT status, outcome, refund_amount, compensation_amount, resolved_at,
                resolved_by_account_id, resolution_note, negotiation_due_at,
                escalated_at, admin_due_at, created_at
           FROM disputes WHERE id = $1`,
        [disputeId],
      )
    )[0];

  const orderStatus = async (orderId: string) =>
    (await sql(`SELECT status FROM service_orders WHERE id = $1`, [orderId]))[0]
      .status as string;

  const outHandover = async (orderId: string) =>
    (
      await sql(
        `SELECT status, confirmed_at, locked_at FROM handovers
          WHERE service_order_id = $1 AND handover_type = 'OUT'`,
        [orderId],
      )
    )[0];

  const lostCount = async (customerProfileId: string) =>
    (
      await sql(
        `SELECT lost_dispute_count FROM customer_profiles WHERE id = $1`,
        [customerProfileId],
      )
    )[0].lost_dispute_count as number;

  const offers = (disputeId: string) =>
    sql(
      `SELECT proposed_by, refund_amount, compensation_amount, status, responded_at
         FROM dispute_offers WHERE dispute_id = $1 ORDER BY created_at`,
      [disputeId],
    );

  it('mở tranh chấp: vườn → 403, người ngoài → 404, thiếu ngân hàng → 409, cây lạ / body sai → 400, hết 48 giờ → 409; mở được → DISPUTED, lần 2 → 409', async () => {
    const c = await toReturnAwaiting({ bank: false });
    const id = c.order.orderId;
    const body = openBody([c.plantA]);

    // Chưa có tranh chấp.
    const none = await get(`orders/${id}/dispute`, c.customer.auth).expect(404);
    expect(none.body.message).toBe('DISPUTE_NOT_FOUND');
    expect((await detail(id, c.customer.auth)).dispute).toBeNull();

    // Chỉ khách mở được: vườn bị chặn ở tầng vai trò.
    await post(`${id}/dispute`, c.provider.auth, body).expect(403);
    const stranger = await seed.customer();
    await setCustomerBank(stranger.profileId);
    const notMine = await post(`${id}/dispute`, stranger.auth, body).expect(
      404,
    );
    expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
    await request(http).post(`${API}/orders/${id}/dispute`).expect(401);

    // Khách chưa khai đủ 3 field ngân hàng → chưa có chỗ nhận tiền hoàn.
    const noBank = await post(`${id}/dispute`, c.customer.auth, body).expect(
      409,
    );
    expect(noBank.body.message).toBe('REFUND_BANK_ACCOUNT_REQUIRED');
    await sql(
      `UPDATE customer_profiles SET bank_name = 'Vietcombank', bank_account = '9876543210' WHERE id = $1`,
      [c.customer.profileId],
    );
    const halfBank = await post(`${id}/dispute`, c.customer.auth, body).expect(
      409,
    );
    expect(halfBank.body.message).toBe('REFUND_BANK_ACCOUNT_REQUIRED');
    await setCustomerBank(c.customer.profileId);

    // Cây không thuộc đơn (kể cả khi chỉ gắn ở ảnh bằng chứng).
    const alien = await post(
      `${id}/dispute`,
      c.customer.auth,
      openBody([randomUUID()]),
    ).expect(400);
    expect(alien.body.message).toBe('PLANT_NOT_IN_CARE');
    const alienPhoto = await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      evidence: [
        { photoUrl: 'https://example.com/x.jpg', plantId: randomUUID() },
      ],
    }).expect(400);
    expect(alienPhoto.body.message).toBe('PLANT_NOT_IN_CARE');
    // Body sai: không cây nào, cây trùng, không ảnh, quá 10 ảnh, thiếu mô tả.
    await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      plantIds: [],
    }).expect(400);
    await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      plantIds: [c.plantA, c.plantA],
    }).expect(400);
    await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      evidence: [],
    }).expect(400);
    await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      evidence: Array.from({ length: 11 }, () => ({
        photoUrl: 'https://example.com/x.jpg',
      })),
    }).expect(400);
    await post(`${id}/dispute`, c.customer.auth, {
      ...body,
      description: '   ',
    }).expect(400);

    // Hết 48 giờ mà bộ quét chưa kịp tự hoàn tất → 409, đơn giữ nguyên chặng (transaction huỷ).
    await sql(
      `UPDATE handovers SET customer_confirm_due_at = now() - interval '1 minute'
        WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    );
    const late = await post(`${id}/dispute`, c.customer.auth, body).expect(409);
    expect(late.body.message).toBe('DISPUTE_WINDOW_CLOSED');
    expect(await orderStatus(id)).toBe('RETURN_AWAITING_CONFIRM');
    expect(await sql(`SELECT 1 FROM disputes`)).toHaveLength(0);
    await sql(
      `UPDATE handovers SET customer_confirm_due_at = now() + interval '47 hours'
        WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    );

    // Mở được.
    const opened = await post(`${id}/dispute`, c.customer.auth, body).expect(
      201,
    );
    expect(opened.body).toEqual({
      disputeId: expect.any(String),
      status: 'NEGOTIATING',
      negotiationDueAt: expect.any(String),
    });
    const disputeId = opened.body.disputeId as string;
    const row = await disputeRow(disputeId);
    expect(row).toMatchObject({
      status: 'NEGOTIATING',
      outcome: null,
      refund_amount: null,
      compensation_amount: null,
      admin_due_at: null,
    });
    // Hạn thương lượng = lúc mở + 3 ngày (lệch vài giây giữa đồng hồ app và DB).
    const window =
      new Date(row.negotiation_due_at).getTime() -
      new Date(row.created_at).getTime();
    expect(Math.abs(window - 3 * DAY_MS)).toBeLessThan(5000);
    expect(new Date(opened.body.negotiationDueAt).getTime()).toBe(
      new Date(row.negotiation_due_at).getTime(),
    );
    expect(await orderStatus(id)).toBe('DISPUTED');
    // Đồng hồ 48 giờ của phiên trả cây dừng lại.
    expect((await outHandover(id)).status).toBe('DISPUTED');
    expect(
      await sql(
        `SELECT plant_id, verdict FROM dispute_plants WHERE dispute_id = $1`,
        [disputeId],
      ),
    ).toEqual([{ plant_id: c.plantA, verdict: null }]);
    expect(
      await sql(
        `SELECT party, plant_id, photo_url, caption, uploaded_by_account_id
           FROM dispute_evidences WHERE dispute_id = $1`,
        [disputeId],
      ),
    ).toEqual([
      {
        party: 'CUSTOMER',
        plant_id: c.plantA,
        photo_url: 'https://example.com/cay-heo.jpg',
        caption: 'Lá héo',
        uploaded_by_account_id: c.customer.accountId,
      },
    ]);
    // Chưa đụng đồng nào: cả hai sổ còn nguyên.
    expect(await balance(id, 'ORDER')).toBe('484000');
    expect(await balance(id, 'SECURITY')).toBe('3400000');

    // Mỗi đơn một tranh chấp; đang tranh chấp thì khách không bấm "đã nhận cây" được nữa.
    const again = await post(`${id}/dispute`, c.customer.auth, body).expect(
      409,
    );
    expect(again.body.message).toBe('INVALID_STATE_TRANSITION');
    const confirm = await post(`${id}/return/confirm`, c.customer.auth).expect(
      409,
    );
    expect(confirm.body.message).toBe('INVALID_STATE_TRANSITION');

    // Chi tiết đơn: cả hai bên thấy tranh chấp + hạn.
    for (const auth of [c.customer.auth, c.provider.auth]) {
      const view = await detail(id, auth);
      expect(view.status).toBe('DISPUTED');
      expect(view.dispute).toEqual({
        id: disputeId,
        status: 'NEGOTIATING',
        outcome: null,
        negotiationDueAt: opened.body.negotiationDueAt,
        adminDueAt: null,
      });
    }

    // Hồ sơ tranh chấp: khách và vườn của đơn xem được, người ngoài → 404.
    const forCustomer = await get(
      `orders/${id}/dispute`,
      c.customer.auth,
    ).expect(200);
    expect(forCustomer.body).toMatchObject({
      id: disputeId,
      orderId: id,
      status: 'NEGOTIATING',
      outcome: null,
      reason: 'Cây chết sau kỳ chăm',
      description: 'Nhận lại cây thì toàn bộ lá đã héo, rễ thối.',
      negotiationDueAt: opened.body.negotiationDueAt,
      adminDueAt: null,
      plants: [
        {
          plantId: c.plantA,
          name: 'Lan 1',
          compensationCap: '3000000',
          verdict: null,
        },
      ],
      evidence: {
        customer: [
          {
            plantId: c.plantA,
            photoUrl: 'https://example.com/cay-heo.jpg',
            caption: 'Lá héo',
            note: null,
          },
        ],
        provider: [],
      },
      // Ý kiến phản đối khách ghi lúc đồng ý biên bản nhận cây.
      handoverObjection: {
        note: 'Vườn ghi lá vàng sẵn, thực tế lá còn xanh',
        photos: [{ photoUrl: 'https://example.com/la-xanh.jpg' }],
      },
      offers: [],
      // Chỉ khiếu nại cây A: hoàn công ≤ 400.000, đền ≤ 3.000.000.
      caps: { refundCap: '400000', compensationCap: '3000000' },
      refundAmount: null,
      compensationAmount: null,
      customerReceives: null,
    });
    const forProvider = await get(
      `orders/${id}/dispute`,
      c.provider.auth,
    ).expect(200);
    expect(forProvider.body).toEqual(forCustomer.body);
    const outsider = await seed.provider();
    const hidden = await get(`orders/${id}/dispute`, outsider.auth).expect(404);
    expect(hidden.body.message).toBe('ORDER_NOT_FOUND');
  });

  it('cây bị từ chối lúc nhận không khiếu nại được (400 PLANT_NOT_IN_CARE); khiếu nại cả hai cây → trần đền 3.400.000', async () => {
    const rejected = await toReturnAwaiting({ rejectB: true });
    const bad = await post(
      `${rejected.order.orderId}/dispute`,
      rejected.customer.auth,
      openBody([rejected.plantA, rejected.plantB]),
    ).expect(400);
    expect(bad.body.message).toBe('PLANT_NOT_IN_CARE');
    expect(await orderStatus(rejected.order.orderId)).toBe(
      'RETURN_AWAITING_CONFIRM',
    );

    const c = await toReturnAwaiting();
    await openDispute(c, [c.plantA, c.plantB]);
    const view = await get(
      `orders/${c.order.orderId}/dispute`,
      c.customer.auth,
    ).expect(200);
    expect(view.body.caps).toEqual({
      refundCap: '400000',
      compensationCap: '3400000',
    });
    expect(
      (view.body.plants as Record<string, any>[])
        .map((plant) => plant.compensationCap as string)
        .sort(),
    ).toEqual(['3000000', '400000']);
  });

  it('thương lượng: vườn nộp bằng chứng, đề nghị vượt trần → 400, đề nghị mới thay đề nghị cũ, tự đồng ý → 403; đồng ý hoàn công 100.000 + đền 1.000.000 → sổ đơn 106/324/54, sổ bảo đảm 1.000/2.400', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await openDispute(c);
    const offer = (auth: Auth, body: object) =>
      post(`${id}/dispute/offers`, auth, body);

    // Vườn phản hồi bằng chứng; bên nộp suy từ vai trò, không nhận từ body.
    const evidence = await post(`${id}/dispute/evidence`, c.provider.auth, {
      note: '  Cây đã yếu từ lúc nhận  ',
      photos: [
        { photoUrl: 'https://example.com/ky-3.jpg', plantId: c.plantA },
        { photoUrl: 'https://example.com/ky-4.jpg', caption: 'Kỳ 4' },
      ],
    }).expect(201);
    expect(evidence.body).toMatchObject({
      disputeId,
      party: 'PROVIDER',
      evidence: [
        {
          plantId: c.plantA,
          photoUrl: 'https://example.com/ky-3.jpg',
          caption: null,
          note: 'Cây đã yếu từ lúc nhận',
        },
        {
          plantId: null,
          photoUrl: 'https://example.com/ky-4.jpg',
          caption: 'Kỳ 4',
          note: 'Cây đã yếu từ lúc nhận',
        },
      ],
    });
    await post(`${id}/dispute/evidence`, c.provider.auth, {
      photos: [],
    }).expect(400);
    await post(`${id}/dispute/evidence`, c.provider.auth, {
      photos: Array.from({ length: 11 }, () => ({
        photoUrl: 'https://example.com/x.jpg',
      })),
    }).expect(400);
    const alien = await post(`${id}/dispute/evidence`, c.provider.auth, {
      photos: [
        { photoUrl: 'https://example.com/x.jpg', plantId: randomUUID() },
      ],
    }).expect(400);
    expect(alien.body.message).toBe('PLANT_NOT_IN_CARE');
    const outsider = await seed.provider();
    await post(`${id}/dispute/evidence`, outsider.auth, {
      photos: [{ photoUrl: 'https://example.com/x.jpg' }],
    }).expect(404);

    // Vượt trần: hoàn công > 400.000, hoặc đền > 3.000.000 (chỉ khiếu nại cây A).
    for (const body of [
      { refundAmount: '400001', compensationAmount: '0' },
      { refundAmount: '0', compensationAmount: '3000001' },
    ]) {
      const over = await offer(c.provider.auth, body).expect(400);
      expect(over.body.message).toBe('OFFER_EXCEEDS_CAP');
    }
    // Hai số cùng bằng 0 (muốn thôi thì khách rút), số âm / số lẻ / không phải chuỗi số.
    const empty = await offer(c.customer.auth, {
      refundAmount: '0',
      compensationAmount: '0',
    }).expect(400);
    expect(empty.body.message).toBe('OFFER_EMPTY');
    await offer(c.customer.auth, {
      refundAmount: '-1',
      compensationAmount: '5',
    }).expect(400);
    await offer(c.customer.auth, {
      refundAmount: '1000.5',
      compensationAmount: '5',
    }).expect(400);
    await offer(c.customer.auth, { refundAmount: '1000' }).expect(400);
    await offer(outsider.auth, {
      refundAmount: '1',
      compensationAmount: '1',
    }).expect(404);
    expect(await offers(disputeId)).toEqual([]);

    // Khách đòi đúng trần: 200.000 + 6% + 3.000.000.
    const first = await offer(c.customer.auth, {
      refundAmount: '200000',
      compensationAmount: '3000000',
      message: 'Cây chết, đề nghị đền đủ',
    }).expect(201);
    expect(first.body).toEqual({
      offerId: expect.any(String),
      customerReceives: '3212000',
    });
    // Vườn trả giá → đề nghị của khách bị thay.
    const second = await offer(c.provider.auth, {
      refundAmount: '100000',
      compensationAmount: '1000000',
    }).expect(201);
    expect(second.body).toEqual({
      offerId: expect.any(String),
      customerReceives: '1106000',
    });
    expect(await offers(disputeId)).toEqual([
      {
        proposed_by: 'CUSTOMER',
        refund_amount: '200000',
        compensation_amount: '3000000',
        status: 'SUPERSEDED',
        responded_at: null,
      },
      {
        proposed_by: 'PROVIDER',
        refund_amount: '100000',
        compensation_amount: '1000000',
        status: 'PENDING',
        responded_at: null,
      },
    ]);
    const listed = await get(`orders/${id}/dispute`, c.customer.auth).expect(
      200,
    );
    expect(listed.body.offers).toMatchObject([
      {
        id: first.body.offerId,
        status: 'SUPERSEDED',
        customerReceives: '3212000',
      },
      {
        id: second.body.offerId,
        status: 'PENDING',
        customerReceives: '1106000',
      },
    ]);
    expect(listed.body.evidence.provider).toHaveLength(2);

    // Không tự đồng ý đề nghị của mình; đề nghị đã bị thay thì không đồng ý được; đề nghị lạ → 404.
    const own = await post(
      `${id}/dispute/offers/${second.body.offerId}/accept`,
      c.provider.auth,
    ).expect(403);
    expect(own.body.message).toBe('OFFER_OWN');
    const stale = await post(
      `${id}/dispute/offers/${first.body.offerId}/accept`,
      c.provider.auth,
    ).expect(409);
    expect(stale.body.message).toBe('OFFER_NOT_PENDING');
    const unknown = await post(
      `${id}/dispute/offers/${randomUUID()}/accept`,
      c.customer.auth,
    ).expect(404);
    expect(unknown.body.message).toBe('OFFER_NOT_FOUND');
    expect(await orderStatus(id)).toBe('DISPUTED');

    // Khách đồng ý đề nghị của vườn → xong.
    const accepted = await post(
      `${id}/dispute/offers/${second.body.offerId}/accept`,
      c.customer.auth,
    ).expect(200);
    // Route do KHÁCH gọi: settlement chỉ có phần khách, không có phí 12% / số vườn nhận.
    expect(accepted.body).toEqual({
      status: 'RESOLVED',
      outcome: 'AGREED',
      settlement: {
        packageAmount: '400000',
        customerFee: '24000',
        pickupFee: '60000',
        addonAmount: '0',
        customerTotal: '484000',
        refundAmount: '106000',
        compensationAmount: '1000000',
      },
    });

    expect(await disputeRow(disputeId)).toMatchObject({
      status: 'RESOLVED',
      outcome: 'AGREED',
      refund_amount: '100000',
      compensation_amount: '1000000',
      resolved_by_account_id: null,
      resolution_note: null,
    });
    expect((await disputeRow(disputeId)).resolved_at).not.toBeNull();
    expect((await offers(disputeId))[1]).toMatchObject({ status: 'ACCEPTED' });
    expect((await offers(disputeId))[1].responded_at).not.toBeNull();
    expect(await orderStatus(id)).toBe('COMPLETED');
    const out = await outHandover(id);
    expect(out.status).toBe('CONFIRMED');
    expect(out.confirmed_at).not.toBeNull();
    expect(out.locked_at).not.toBeNull();

    // Sổ đơn 484.000 = khách 106.000 + nền tảng 54.000 + vườn 324.000 → 0.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-106000', balance_after: '378000' },
      { entry_type: 'PLATFORM_FEE', amount: '-54000', balance_after: '324000' },
      { entry_type: 'PAYOUT', amount: '-324000', balance_after: '0' },
    ]);
    // Sổ bảo đảm 3.400.000 = khách 1.000.000 + vườn 2.400.000 → 0.
    expect(await ledger(id, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3400000',
        balance_after: '3400000',
      },
      {
        entry_type: 'COMPENSATION',
        amount: '-1000000',
        balance_after: '2400000',
      },
      {
        entry_type: 'SECURITY_RETURN',
        amount: '-2400000',
        balance_after: '0',
      },
    ]);
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(await balance(id, 'SECURITY')).toBe('0');
    // 4 lệnh chi, mỗi sổ một dòng cho mỗi người; lệnh của khách chụp tài khoản ngân hàng của khách.
    expect(await disbursements(id)).toEqual([
      {
        type: 'COMPENSATION',
        amount: '1000000',
        status: 'PENDING',
        customer_id: c.customer.profileId,
        provider_id: null,
        bank_account: CUSTOMER_BANK.bank_account,
      },
      {
        type: 'PAYOUT',
        amount: '324000',
        status: 'PENDING',
        customer_id: null,
        provider_id: c.provider.profileId,
        bank_account: null,
      },
      {
        type: 'REFUND',
        amount: '106000',
        status: 'PENDING',
        customer_id: c.customer.profileId,
        provider_id: null,
        bank_account: CUSTOMER_BANK.bank_account,
      },
      {
        type: 'SECURITY_RETURN',
        amount: '2400000',
        status: 'PENDING',
        customer_id: null,
        provider_id: c.provider.profileId,
        bank_account: null,
      },
    ]);
    // Thoả thuận không tính là khách thua.
    expect(await lostCount(c.customer.profileId)).toBe(0);

    // Khách không thấy phần của vườn — ở hồ sơ tranh chấp lẫn chi tiết đơn.
    const done = await get(`orders/${id}/dispute`, c.customer.auth).expect(200);
    expect(done.body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'AGREED',
      refundAmount: '100000',
      compensationAmount: '1000000',
      customerReceives: '1106000',
      caps: null,
    });
    const leaked = JSON.stringify(done.body);
    for (const key of ['providerFee', 'providerReceives', 'platformFee']) {
      expect(leaked).not.toContain(key);
    }
    const customerDetail = await detail(id, c.customer.auth);
    expect(customerDetail.dispute).toMatchObject({
      status: 'RESOLVED',
      outcome: 'AGREED',
    });
    expect(customerDetail.settlement).toEqual(accepted.body.settlement);
    // Vườn thấy phần mình: tiền công còn giữ 300.000, trừ 12% = 36.000, nhận 324.000 (gồm phí lấy cây).
    expect((await detail(id, c.provider.auth)).settlement).toMatchObject({
      refundAmount: '106000',
      compensationAmount: '1000000',
      providerFee: '36000',
      providerReceives: '324000',
    });

    // Xong rồi thì đóng: không nộp bằng chứng, không đề nghị, không rút, không đồng ý lại.
    const closed = await post(`${id}/dispute/evidence`, c.customer.auth, {
      photos: [{ photoUrl: 'https://example.com/x.jpg' }],
    }).expect(409);
    expect(closed.body.message).toBe('DISPUTE_CLOSED');
    const noMore = await offer(c.customer.auth, {
      refundAmount: '1',
      compensationAmount: '1',
    }).expect(409);
    expect(noMore.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
    const reAccept = await post(
      `${id}/dispute/offers/${second.body.offerId}/accept`,
      c.customer.auth,
    ).expect(409);
    expect(reAccept.body.message).toBe('OFFER_NOT_PENDING');
    const lateWithdraw = await post(
      `${id}/dispute/withdraw`,
      c.customer.auth,
    ).expect(409);
    expect(lateWithdraw.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
  });

  it('vườn đồng ý đề nghị của khách → settlement trả về là phần của vườn', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    await openDispute(c);
    const offered = await post(`${id}/dispute/offers`, c.customer.auth, {
      refundAmount: '200000',
      compensationAmount: '0',
    }).expect(201);
    expect(offered.body.customerReceives).toBe('212000');
    const own = await post(
      `${id}/dispute/offers/${offered.body.offerId}/accept`,
      c.customer.auth,
    ).expect(403);
    expect(own.body.message).toBe('OFFER_OWN');

    const accepted = await post(
      `${id}/dispute/offers/${offered.body.offerId}/accept`,
      c.provider.auth,
    ).expect(200);
    // Hoàn công 200.000: khách 212.000 · vườn (400.000 − 200.000) − 12% + 60.000 = 236.000 · nền tảng 36.000.
    expect(accepted.body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'AGREED',
      settlement: {
        refundAmount: '212000',
        compensationAmount: '0',
        serviceAmount: '400000',
        providerFee: '24000',
        providerReceives: '236000',
        payout: { status: 'PENDING', paidAt: null },
      },
    });
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(await balance(id, 'SECURITY')).toBe('0');
    expect(
      (await disbursements(id)).map((row) => [row.type, row.amount]),
    ).toEqual([
      ['PAYOUT', '236000'],
      ['REFUND', '212000'],
      ['SECURITY_RETURN', '3400000'],
    ]);
  });

  it('khách rút khiếu nại → chia như đơn bình thường (0 / 412.000 / 72.000; bảo đảm về vườn 3.400.000), không tăng số lần thua', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await openDispute(c);
    await post(`${id}/dispute/offers`, c.provider.auth, {
      refundAmount: '50000',
      compensationAmount: '0',
    }).expect(201);

    // Chỉ khách rút được.
    await post(`${id}/dispute/withdraw`, c.provider.auth).expect(403);
    const stranger = await seed.customer();
    await post(`${id}/dispute/withdraw`, stranger.auth).expect(404);

    const withdrawn = await post(
      `${id}/dispute/withdraw`,
      c.customer.auth,
    ).expect(200);
    expect(withdrawn.body).toEqual({
      status: 'RESOLVED',
      outcome: 'WITHDRAWN',
    });
    expect(await disputeRow(disputeId)).toMatchObject({
      status: 'RESOLVED',
      outcome: 'WITHDRAWN',
      refund_amount: '0',
      compensation_amount: '0',
    });
    // Đề nghị còn treo đóng lại.
    expect((await offers(disputeId))[0].status).toBe('SUPERSEDED');
    expect(await orderStatus(id)).toBe('COMPLETED');
    expect((await outHandover(id)).status).toBe('CONFIRMED');

    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'PLATFORM_FEE', amount: '-72000', balance_after: '412000' },
      { entry_type: 'PAYOUT', amount: '-412000', balance_after: '0' },
    ]);
    expect(await ledger(id, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3400000',
        balance_after: '3400000',
      },
      {
        entry_type: 'SECURITY_RETURN',
        amount: '-3400000',
        balance_after: '0',
      },
    ]);
    expect(
      (await disbursements(id)).map((row) => [row.type, row.amount]),
    ).toEqual([
      ['PAYOUT', '412000'],
      ['SECURITY_RETURN', '3400000'],
    ]);
    // Rút không tính là một lần thua.
    expect(await lostCount(c.customer.profileId)).toBe(0);

    const view = await get(`orders/${id}/dispute`, c.customer.auth).expect(200);
    expect(view.body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'WITHDRAWN',
      refundAmount: '0',
      compensationAmount: '0',
      customerReceives: '0',
    });
    const again = await post(`${id}/dispute/withdraw`, c.customer.auth).expect(
      409,
    );
    expect(again.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
  });

  it('hết 3 ngày: route tự chặn đề nghị / đồng ý; bộ quét chuyển ADMIN_REVIEW (hạn mềm +5 ngày), đóng đề nghị treo; vẫn nộp bằng chứng được', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await openDispute(c);
    const pending = await post(`${id}/dispute/offers`, c.provider.auth, {
      refundAmount: '50000',
      compensationAmount: '0',
    }).expect(201);

    // Chưa tới hạn: bộ quét không làm gì.
    expect(await escalate(disputeId)).toBe(false);
    expect((await disputeRow(disputeId)).status).toBe('NEGOTIATING');

    // Quá hạn mà bộ quét chưa chạy: route tự kiểm hạn.
    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [disputeId],
    );
    const lateOffer = await post(`${id}/dispute/offers`, c.customer.auth, {
      refundAmount: '1',
      compensationAmount: '1',
    }).expect(409);
    expect(lateOffer.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
    const lateAccept = await post(
      `${id}/dispute/offers/${pending.body.offerId}/accept`,
      c.customer.auth,
    ).expect(409);
    expect(lateAccept.body.message).toBe('OFFER_NOT_PENDING');

    expect(await escalate(disputeId)).toBe(true);
    const row = await disputeRow(disputeId);
    expect(row.status).toBe('ADMIN_REVIEW');
    expect(row.escalated_at).not.toBeNull();
    expect(
      new Date(row.admin_due_at).getTime() -
        new Date(row.escalated_at).getTime(),
    ).toBe(5 * DAY_MS);
    expect((await offers(disputeId))[0].status).toBe('SUPERSEDED');
    // Gọi lại không đổi gì (bộ quét chạy chồng).
    expect(await escalate(disputeId)).toBe(false);
    expect(new Date((await disputeRow(disputeId)).admin_due_at).getTime()).toBe(
      new Date(row.admin_due_at).getTime(),
    );
    // Đơn vẫn DISPUTED, tiền chưa đụng.
    expect(await orderStatus(id)).toBe('DISPUTED');
    expect(await balance(id, 'ORDER')).toBe('484000');

    // Ở ADMIN_REVIEW: không đề nghị, không đồng ý, không rút; vẫn nộp bằng chứng được.
    const noOffer = await post(`${id}/dispute/offers`, c.customer.auth, {
      refundAmount: '1',
      compensationAmount: '1',
    }).expect(409);
    expect(noOffer.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
    const noAccept = await post(
      `${id}/dispute/offers/${pending.body.offerId}/accept`,
      c.customer.auth,
    ).expect(409);
    expect(noAccept.body.message).toBe('OFFER_NOT_PENDING');
    const noWithdraw = await post(
      `${id}/dispute/withdraw`,
      c.customer.auth,
    ).expect(409);
    expect(noWithdraw.body.message).toBe('DISPUTE_NOT_NEGOTIATING');
    await post(`${id}/dispute/evidence`, c.customer.auth, {
      photos: [{ photoUrl: 'https://example.com/them.jpg' }],
    }).expect(201);
    // Hai bên thấy ngày dự kiến có kết quả.
    const view = await get(`orders/${id}/dispute`, c.provider.auth).expect(200);
    expect(view.body.status).toBe('ADMIN_REVIEW');
    expect(new Date(view.body.adminDueAt).getTime()).toBe(
      new Date(row.admin_due_at).getTime(),
    );
    expect((await detail(id, c.customer.auth)).dispute).toMatchObject({
      status: 'ADMIN_REVIEW',
      adminDueAt: view.body.adminDueAt,
    });
  });

  it('admin: danh sách có isOverdue (quá hạn mềm nổi lên đầu), hồ sơ đầy đủ; chưa ADMIN_REVIEW → 409; thiếu / dư / trùng verdict → 400', async () => {
    const admin = await seed.admin();
    const adminGet = (path: string) => get(`admin/disputes${path}`, admin.auth);
    const resolve = (
      disputeId: string,
      body: object,
      auth: Auth = admin.auth,
    ) =>
      request(http)
        .post(`${API}/admin/disputes/${disputeId}/resolve`)
        .set(auth)
        .send(body);

    // Tranh chấp 1 mở trước, còn thương lượng; tranh chấp 2 mở sau, đã sang admin (khiếu nại cả hai cây).
    const first = await toReturnAwaiting();
    const firstId = await openDispute(first);
    const second = await toReturnAwaiting();
    const secondId = await toAdminReview(second, [
      second.plantA,
      second.plantB,
    ]);

    // Chỉ admin.
    await get('admin/disputes', first.customer.auth).expect(403);
    await get(`admin/disputes/${secondId}`, first.provider.auth).expect(403);
    await resolve(
      secondId,
      { plants: [], note: 'x' },
      first.provider.auth,
    ).expect(403);

    // Chưa quá hạn mềm: không dòng nào trễ, theo hạn admin gần nhất (chưa có hạn thì xếp sau).
    const fresh = await adminGet('').expect(200);
    expect(fresh.body).toMatchObject({ total: 2, page: 1, limit: 10 });
    expect(
      (fresh.body.data as Record<string, any>[]).map((row) => [
        row.id,
        row.status,
        row.isOverdue,
      ]),
    ).toEqual([
      [secondId, 'ADMIN_REVIEW', false],
      [firstId, 'NEGOTIATING', false],
    ]);
    expect(fresh.body.data[0]).toMatchObject({
      orderId: second.order.orderId,
      orderCode: second.order.orderCode,
      reason: 'Cây chết sau kỳ chăm',
      outcome: null,
      refundAmount: null,
      compensationAmount: null,
    });

    // Tranh chấp 1 cũng sang admin và hạn gần hơn; rồi tranh chấp 2 quá hạn mềm → vẫn nổi lên đầu.
    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [firstId],
    );
    expect(await escalate(firstId)).toBe(true);
    await sql(
      `UPDATE disputes SET admin_due_at = now() + interval '1 day' WHERE id = $1`,
      [firstId],
    );
    await sql(
      `UPDATE disputes SET admin_due_at = now() - interval '1 hour' WHERE id = $1`,
      [secondId],
    );
    const overdue = await adminGet('?status=ADMIN_REVIEW').expect(200);
    expect(
      (overdue.body.data as Record<string, any>[]).map((row) => [
        row.id,
        row.isOverdue,
      ]),
    ).toEqual([
      [secondId, true],
      [firstId, false],
    ]);
    expect((await adminGet('?status=NEGOTIATING').expect(200)).body.total).toBe(
      0,
    );
    const paged = await adminGet('?page=2&limit=1').expect(200);
    expect(paged.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.data[0].id).toBe(firstId);
    await adminGet('?status=OPEN').expect(400);
    await adminGet('?limit=51').expect(400);

    // Hồ sơ đầy đủ cho admin.
    const missing = await adminGet(`/${randomUUID()}`).expect(404);
    expect(missing.body.message).toBe('DISPUTE_NOT_FOUND');
    const file = await adminGet(`/${secondId}`).expect(200);
    expect(file.body).toMatchObject({
      id: secondId,
      status: 'ADMIN_REVIEW',
      isOverdue: true,
      resolutionNote: null,
      order: {
        id: second.order.orderId,
        orderCode: second.order.orderCode,
        status: 'DISPUTED',
        basePrice: '200000',
        finalTotal: '400000',
      },
      customer: { id: second.customer.profileId, lostDisputeCount: 0 },
      provider: { id: second.provider.profileId, displayName: 'Vườn Lan' },
      handoverObjection: {
        note: 'Vườn ghi lá vàng sẵn, thực tế lá còn xanh',
      },
      handoverIn: { status: 'CONFIRMED' },
      handoverOut: { status: 'DISPUTED' },
      careReports: { submittedCount: 0, reports: [] },
      caps: { refundCap: '400000', compensationCap: '3400000' },
    });
    expect(file.body.plants).toHaveLength(2);
    expect(file.body.orderPlants).toHaveLength(2);
    expect(file.body.orderPlants[0]).toMatchObject({
      handoverDecision: 'ACCEPT',
      isHighRisk: false,
    });
    // Biên bản nhận + trả: mỗi phiên 2 cây, có ảnh.
    expect(file.body.handoverIn.assessments).toHaveLength(2);
    expect(file.body.handoverOut.assessments).toHaveLength(2);
    expect(file.body.handoverOut.assessments[0]).toMatchObject({
      checklist: { leaf: 'héo' },
      photos: [{ photoUrl: 'https://example.com/out.jpg' }],
    });
    // Không lộ dữ liệu nhạy cảm của tài khoản / hồ sơ.
    const raw = JSON.stringify(file.body);
    for (const key of ['passwordHash', 'cccdNumber', 'bankAccount']) {
      expect(raw).not.toContain(key);
    }

    // Chưa sang admin thì admin chưa xử được.
    const third = await toReturnAwaiting();
    const thirdId = await openDispute(third);
    const early = await resolve(thirdId, {
      plants: [{ plantId: third.plantA, verdict: 'VALUE_LOST' }],
      note: 'Xử sớm',
    }).expect(409);
    expect(early.body.message).toBe('DISPUTE_NOT_IN_REVIEW');
    const notFound = await resolve(randomUUID(), {
      plants: [{ plantId: third.plantA, verdict: 'VALUE_LOST' }],
      note: 'Không có',
    }).expect(404);
    expect(notFound.body.message).toBe('DISPUTE_NOT_FOUND');

    // Tranh chấp 2 khiếu nại cả A và B: phải kết luận đủ đúng 2 cây.
    const { plantA, plantB } = second;
    for (const plants of [
      // thiếu cây B
      [{ plantId: plantA, verdict: 'VALUE_LOST' }],
      // trùng cây A
      [
        { plantId: plantA, verdict: 'VALUE_LOST' },
        { plantId: plantA, verdict: 'NOT_AT_FAULT' },
      ],
      // cây lạ thay cây B
      [
        { plantId: plantA, verdict: 'VALUE_LOST' },
        { plantId: randomUUID(), verdict: 'NOT_AT_FAULT' },
      ],
      // dư một cây lạ
      [
        { plantId: plantA, verdict: 'VALUE_LOST' },
        { plantId: plantB, verdict: 'NOT_AT_FAULT' },
        { plantId: randomUUID(), verdict: 'NOT_AT_FAULT' },
      ],
    ]) {
      const incomplete = await resolve(secondId, {
        plants,
        note: 'Kết luận',
      }).expect(400);
      expect(incomplete.body.message).toBe('DISPUTE_VERDICT_INCOMPLETE');
    }
    // Body sai: thiếu note, note quá dài, verdict lạ.
    const both = [
      { plantId: plantA, verdict: 'VALUE_LOST' },
      { plantId: plantB, verdict: 'VALUE_LOST' },
    ];
    await resolve(secondId, { plants: both }).expect(400);
    await resolve(secondId, { plants: both, note: 'x'.repeat(4001) }).expect(
      400,
    );
    await resolve(secondId, {
      plants: [{ plantId: plantA, verdict: 'HALF_FAULT' }],
      note: 'Kết luận',
    }).expect(400);
    // Chưa có gì bị ghi.
    expect((await disputeRow(secondId)).status).toBe('ADMIN_REVIEW');
    expect(
      await sql(
        `SELECT verdict FROM dispute_plants WHERE dispute_id = $1 AND verdict IS NOT NULL`,
        [secondId],
      ),
    ).toEqual([]);

    // Vườn lỗi cả hai cây, mất giá trị: R 400.000, C 3.400.000 → sổ đơn 424/60/0, sổ bảo đảm 3.400/0.
    const done = await resolve(secondId, {
      plants: both,
      note: '  Cả hai cây chết do vườn bỏ tưới  ',
    }).expect(200);
    expect(done.body).toEqual({
      status: 'RESOLVED',
      outcome: 'ADJUDICATED',
      refundAmount: '400000',
      compensationAmount: '3400000',
    });
    expect(await ledger(second.order.orderId, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-424000', balance_after: '60000' },
      { entry_type: 'PAYOUT', amount: '-60000', balance_after: '0' },
    ]);
    expect(await ledger(second.order.orderId, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3400000',
        balance_after: '3400000',
      },
      { entry_type: 'COMPENSATION', amount: '-3400000', balance_after: '0' },
    ]);
    expect(await disputeRow(secondId)).toMatchObject({
      resolved_by_account_id: admin.accountId,
      resolution_note: 'Cả hai cây chết do vườn bỏ tưới',
    });
    // Sau khi xong: danh sách không còn tính là trễ, hồ sơ admin có ghi chú phân xử.
    const after = await adminGet(`/${secondId}`).expect(200);
    expect(after.body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'ADJUDICATED',
      isOverdue: false,
      resolvedByAccountId: admin.accountId,
      resolutionNote: 'Cả hai cây chết do vườn bỏ tưới',
      customerReceives: '3824000',
      order: { status: 'COMPLETED' },
    });
    const again = await resolve(secondId, {
      plants: both,
      note: 'Xử lại',
    }).expect(409);
    expect(again.body.message).toBe('DISPUTE_NOT_IN_REVIEW');
  });

  // Ba mức kết luận cho cây A (đơn mẫu, chỉ khiếu nại cây A).
  it.each([
    {
      verdict: 'NOT_AT_FAULT',
      refund: '0',
      compensation: '0',
      receives: '0',
      order: [
        ['PLATFORM_FEE', '-72000'],
        ['PAYOUT', '-412000'],
      ],
      security: [['SECURITY_RETURN', '-3400000']],
      payouts: [
        ['PAYOUT', '412000'],
        ['SECURITY_RETURN', '3400000'],
      ],
      lost: 1,
    },
    {
      verdict: 'SERVICE_FAULT',
      refund: '200000',
      compensation: '0',
      receives: '212000',
      order: [
        ['REFUND', '-212000'],
        ['PLATFORM_FEE', '-36000'],
        ['PAYOUT', '-236000'],
      ],
      security: [['SECURITY_RETURN', '-3400000']],
      payouts: [
        ['PAYOUT', '236000'],
        ['REFUND', '212000'],
        ['SECURITY_RETURN', '3400000'],
      ],
      lost: 0,
    },
    {
      verdict: 'VALUE_LOST',
      refund: '200000',
      compensation: '3000000',
      receives: '3212000',
      order: [
        ['REFUND', '-212000'],
        ['PLATFORM_FEE', '-36000'],
        ['PAYOUT', '-236000'],
      ],
      security: [
        ['COMPENSATION', '-3000000'],
        ['SECURITY_RETURN', '-400000'],
      ],
      payouts: [
        ['COMPENSATION', '3000000'],
        ['PAYOUT', '236000'],
        ['REFUND', '212000'],
        ['SECURITY_RETURN', '400000'],
      ],
      lost: 0,
    },
  ])(
    'admin kết luận cây A $verdict → hoàn công $refund, đền $compensation, khách nhận $receives',
    async (expected) => {
      const admin = await seed.admin();
      const c = await toReturnAwaiting();
      const id = c.order.orderId;
      const disputeId = await toAdminReview(c);

      const done = await request(http)
        .post(`${API}/admin/disputes/${disputeId}/resolve`)
        .set(admin.auth)
        .send({
          plants: [{ plantId: c.plantA, verdict: expected.verdict }],
          note: 'Đối chiếu biên bản nhận, báo cáo chăm và biên bản trả',
        })
        .expect(200);
      expect(done.body).toEqual({
        status: 'RESOLVED',
        outcome: 'ADJUDICATED',
        refundAmount: expected.refund,
        compensationAmount: expected.compensation,
      });
      expect(
        await sql(
          `SELECT plant_id, verdict FROM dispute_plants WHERE dispute_id = $1`,
          [disputeId],
        ),
      ).toEqual([{ plant_id: c.plantA, verdict: expected.verdict }]);
      expect(await orderStatus(id)).toBe('COMPLETED');
      expect((await outHandover(id)).status).toBe('CONFIRMED');

      // Hai sổ chia đúng bảng tình huống và đều về 0.
      const moves = async (book: 'ORDER' | 'SECURITY') =>
        (await ledger(id, book))
          .slice(1)
          .map((row) => [row.entry_type, row.amount]);
      expect(await moves('ORDER')).toEqual(expected.order);
      expect(await moves('SECURITY')).toEqual(expected.security);
      expect(await balance(id, 'ORDER')).toBe('0');
      expect(await balance(id, 'SECURITY')).toBe('0');
      expect(
        (await disbursements(id)).map((row) => [row.type, row.amount]),
      ).toEqual(expected.payouts);

      // Mọi cây bị khiếu nại đều không lỗi = khách thua → ghi một lần, không phạt tiền.
      expect(await lostCount(c.customer.profileId)).toBe(expected.lost);
      // Số lần thua là ghi chú nội bộ: khách không thấy trong hồ sơ của mình, admin thấy.
      const mine = await get('customers/me/profile', c.customer.auth).expect(
        200,
      );
      expect(mine.body).not.toHaveProperty('lostDisputeCount');
      const forAdmin = await get(
        `customers/admin/${c.customer.profileId}`,
        admin.auth,
      ).expect(200);
      expect(forAdmin.body.lostDisputeCount).toBe(expected.lost);

      // Khách xem kết quả: có kết luận từng cây + tổng nhận, không có phần của vườn.
      const view = await get(`orders/${id}/dispute`, c.customer.auth).expect(
        200,
      );
      expect(view.body).toMatchObject({
        status: 'RESOLVED',
        outcome: 'ADJUDICATED',
        refundAmount: expected.refund,
        compensationAmount: expected.compensation,
        customerReceives: expected.receives,
        plants: [{ plantId: c.plantA, verdict: expected.verdict }],
      });
      const settlement = (await detail(id, c.customer.auth)).settlement;
      expect(settlement.compensationAmount).toBe(expected.compensation);
      expect(settlement).not.toHaveProperty('providerFee');
      expect(settlement).not.toHaveProperty('providerReceives');
    },
  );

  it('đơn cũ không có tiền bảo đảm (sổ bảo đảm 0): trần đền = 0, đề nghị có đền → 400; admin kết luận VALUE_LOST → chỉ hoàn công, đền 0, không lỗi 500', async () => {
    const admin = await seed.admin();
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    // Giả lập đơn tạo trước khi có tiền bảo đảm: cây vẫn có mức đền nhưng sổ bảo đảm không có đồng nào.
    await sql(
      `DELETE FROM escrow_ledger WHERE service_order_id = $1 AND book = 'SECURITY'`,
      [id],
    );
    const disputeId = await openDispute(c);

    // Trần đền = min(Σ mức đền cây bị khiếu nại 3.000.000, số dư sổ bảo đảm 0) = 0.
    const view = await get(`orders/${id}/dispute`, c.customer.auth).expect(200);
    expect(view.body.caps).toEqual({
      refundCap: '400000',
      compensationCap: '0',
    });
    const withCompensation = await post(
      `${id}/dispute/offers`,
      c.customer.auth,
      { refundAmount: '0', compensationAmount: '1' },
    ).expect(400);
    expect(withCompensation.body.message).toBe('OFFER_EXCEEDS_CAP');
    // Thoả thuận tiền công vẫn làm được.
    await post(`${id}/dispute/offers`, c.customer.auth, {
      refundAmount: '100000',
      compensationAmount: '0',
    }).expect(201);

    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [disputeId],
    );
    expect(await escalate(disputeId)).toBe(true);
    const done = await request(http)
      .post(`${API}/admin/disputes/${disputeId}/resolve`)
      .set(admin.auth)
      .send({
        plants: [{ plantId: c.plantA, verdict: 'VALUE_LOST' }],
        note: 'Cây mất giá trị nhưng đơn cũ không có tiền bảo đảm',
      })
      .expect(200);
    expect(done.body).toEqual({
      status: 'RESOLVED',
      outcome: 'ADJUDICATED',
      refundAmount: '200000',
      compensationAmount: '0',
    });
    expect(await orderStatus(id)).toBe('COMPLETED');
    expect(await ledger(id, 'SECURITY')).toEqual([]);
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(
      (await disbursements(id)).map((row) => [row.type, row.amount]),
    ).toEqual([
      ['PAYOUT', '236000'],
      ['REFUND', '212000'],
    ]);
  });
});
