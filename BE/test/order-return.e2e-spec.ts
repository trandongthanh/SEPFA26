import request from 'supertest';
import type { App } from 'supertest/types';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';
import {
  OrderSeed,
  type DraftOrder,
  type OrderActor,
  type OrderProvider,
} from './orders/order-seed';

const API = '/api/v1';

/**
 * Chặng trả cây (IN_CARE → COMPLETED) trên Postgres thật — luồng thành công cho demo
 * + huỷ phiên trả rồi trả lại. Đơn đi tới IN_CARE bằng API thật, rồi lùi hạn chăm bằng SQL.
 */
describe('Order return IN_CARE → COMPLETED (e2e)', () => {
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

  const post = (
    path: string,
    auth: { Authorization: string },
    body: object = {},
  ) => request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const detail = async (orderId: string, auth: { Authorization: string }) =>
    (
      await request(http)
        .get(`${API}/orders/${orderId}`)
        .set(auth)
        .expect(200)
    ).body as Record<string, any>;

  const photos = [{ photoUrl: 'https://example.com/out.jpg', caption: 'Toàn cây' }];

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  // Đi hết luồng nhận cây bằng API thật → đơn IN_CARE. rejectFirst: vườn từ chối cây đầu tiên lúc nhận.
  const toInCare = async ({ rejectFirst = false } = {}): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const c = { customer, provider, order };
    const id = order.orderId;
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    await seed.webhook(order.orderCode, order.amountDue).expect(200);
    await post(`${id}/handover/start`, provider.auth).expect(201);
    for (const [i, plantId] of order.plantIds.entries()) {
      await post(`${id}/handover/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: rejectFirst && i === 0 ? 'REJECT' : 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, provider.auth).expect(200);
    await post(`${id}/handover/confirm`, customer.auth).expect(200);
    return c;
  };

  // Giả lập đã hết hạn chăm: lùi cả ngày bắt đầu lẫn hạn chăm.
  const makeCareDue = (orderId: string) =>
    ctx.dataSource.query(
      `UPDATE service_orders
         SET care_started_at = care_started_at - interval '40 days',
             care_due_at = now() - interval '1 hour'
       WHERE id = $1`,
      [orderId],
    );

  // IN_CARE → tới hạn → bắt đầu trả → kiểm mọi cây đang chăm → chốt → RETURN_AWAITING_CONFIRM.
  const toReturnAwaitingConfirm = async (c: Ctx, keptPlantIds: string[]) => {
    const id = c.order.orderId;
    await makeCareDue(id);
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of keptPlantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos,
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
  };

  // Tiền của đơn trong DB: sổ ký quỹ (theo thứ tự ghi), tổng sổ, hoá đơn, lệnh chi.
  const money = async (orderId: string) => {
    const q = (sql: string) =>
      ctx.dataSource.query(sql, [orderId]) as Promise<Record<string, any>[]>;
    const ledger = await q(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1
        ORDER BY created_at, CASE entry_type WHEN 'PLATFORM_FEE' THEN 1 WHEN 'PAYOUT' THEN 2 ELSE 0 END`,
    );
    const [{ sum }] = await q(
      `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger WHERE service_order_id = $1`,
    );
    const components = await q(
      `SELECT component_type, provider_fee, status FROM payment_components
        WHERE service_order_id = $1 ORDER BY component_type`,
    );
    const disbursements = await q(
      `SELECT type, amount, status, eligible_at FROM disbursements WHERE service_order_id = $1`,
    );
    return { ledger, sum, components, disbursements };
  };

  it('luồng chính: chưa tới hạn → 409; tới hạn → bắt đầu → kiểm từng cây → chốt → khách xác nhận → COMPLETED', async () => {
    const c = await toInCare();
    const id = c.order.orderId;

    const early = await post(`${id}/return/start`, c.provider.auth).expect(409);
    expect(early.body.message).toBe('CARE_NOT_DUE');

    await makeCareDue(id);
    const started = await post(`${id}/return/start`, c.provider.auth).expect(
      200,
    );
    expect(started.body).toMatchObject({ status: 'RETURN_IN_PROGRESS' });

    const notYet = await post(`${id}/return/complete`, c.provider.auth).expect(
      400,
    );
    expect(notYet.body.message).toBe('UNASSESSED_PLANTS');

    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh', root: 'chắc' },
        note: 'Hồi phục tốt',
        photos,
      }).expect(201);
    }
    const completed = await post(
      `${id}/return/complete`,
      c.provider.auth,
    ).expect(200);
    expect(completed.body.status).toBe('RETURN_AWAITING_CONFIRM');
    expect(completed.body.customerConfirmDueAt).toEqual(expect.any(String));

    // Vườn không xác nhận thay khách được.
    await post(`${id}/return/confirm`, c.provider.auth).expect(403);

    const done = await post(`${id}/return/confirm`, c.customer.auth).expect(
      200,
    );
    expect(done.body).toMatchObject({ status: 'COMPLETED' });
    expect(done.body.completedAt).toEqual(expect.any(String));

    // Route của khách: response chỉ có phần khách được thấy, KHÔNG có phí 12% / số vườn nhận.
    expect(done.body.settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '0',
    });
    // CP3: chia tiền trong cùng transaction — 484.000 = nền tảng 72.000 + vườn 412.000 (kiểm trong DB).
    const m = await money(id);
    expect(m.ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'PLATFORM_FEE', amount: '-72000', balance_after: '412000' },
      { entry_type: 'PAYOUT', amount: '-412000', balance_after: '0' },
    ]);
    expect(m.sum).toBe('0');
    expect(m.components).toEqual([
      { component_type: 'PACKAGE_PRICE', provider_fee: '48000', status: 'RELEASED' },
      { component_type: 'PICKUP_FEE', provider_fee: '0', status: 'RELEASED' },
    ]);
    expect(m.disbursements).toHaveLength(1);
    expect(m.disbursements[0]).toMatchObject({
      type: 'PAYOUT',
      amount: '412000',
      status: 'PENDING',
    });
    const holdMs =
      new Date(m.disbursements[0].eligible_at).getTime() -
      new Date(done.body.completedAt).getTime();
    expect(holdMs).toBe(3 * 24 * 60 * 60 * 1000);

    // Bấm lại → 409, không đổi gì (vẫn đúng 1 lệnh chi, sổ vẫn 0).
    await post(`${id}/return/confirm`, c.customer.auth).expect(409);
    const again = await money(id);
    expect(again.disbursements).toHaveLength(1);
    expect(again.sum).toBe('0');

    const body = await detail(id, c.customer.auth);
    expect(body.status).toBe('COMPLETED');
    expect(body.handover.status).toBe('CONFIRMED');
    expect(body.handover.assessments).toHaveLength(c.order.plantIds.length);
    expect(body.returnHandover).toMatchObject({ status: 'CONFIRMED' });
    expect(body.returnHandover.assessments).toHaveLength(
      c.order.plantIds.length,
    );
    expect(body.returnHandover.assessments[0].photos).toEqual(photos);
    expect(body.isReturnOverdue).toBe(false);
    expect(body.careReportSchedule).toMatchObject({
      submittedCount: 0,
      isReportOverdue: false,
      nextReportDueAt: null,
    });
  });

  it('B19: danh sách đơn của vườn (không lọc trạng thái) vẫn thấy đơn đang trả cây và đơn COMPLETED', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    const providerList = async () =>
      (
        await request(http)
          .get(`${API}/orders`)
          .set(c.provider.auth)
          .expect(200)
      ).body as { data: { id: string; status: string }[] };

    await makeCareDue(id);
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    expect((await providerList()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'RETURN_IN_PROGRESS' }),
      ]),
    );

    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos,
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);
    expect((await providerList()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'COMPLETED' }),
      ]),
    );
  });

  it('CP3: vườn từ chối 1 cây lúc nhận → chia theo 1 cây, sổ còn 12.000 (6% cây bị từ chối, chờ mentor)', async () => {
    const c = await toInCare({ rejectFirst: true });
    const id = c.order.orderId;
    await toReturnAwaitingConfirm(c, c.order.plantIds.slice(1));

    const done = await post(`${id}/return/confirm`, c.customer.auth).expect(
      200,
    );
    // Khách chỉ thấy số đã trả + tiền hoàn cây bị từ chối.
    expect(done.body.settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '200000',
    });
    // S = 200.000: phí khách 12.000 + phí vườn 24.000 = 36.000; vườn 200.000 − 24.000 + 60.000 (kiểm trong DB).
    const m = await money(id);
    expect(m.ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-200000', balance_after: '284000' },
      { entry_type: 'PLATFORM_FEE', amount: '-36000', balance_after: '248000' },
      { entry_type: 'PAYOUT', amount: '-236000', balance_after: '12000' },
    ]);
    expect(m.sum).toBe('12000');
    expect(m.disbursements).toEqual([
      expect.objectContaining({ amount: '236000', status: 'PENDING' }),
    ]);
  });

  it('CP3: sổ không đủ tiền để chia → 500, rollback cả bước xác nhận (đơn vẫn chờ khách)', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    await toReturnAwaitingConfirm(c, c.order.plantIds);
    // Giả lập sổ lệch: bớt 100.000 → còn 384.000 < 72.000 + 412.000.
    await ctx.dataSource.query(
      `INSERT INTO escrow_ledger (service_order_id, entry_type, amount, balance_after, note)
       VALUES ($1, 'REFUND', -100000, 384000, 'e2e: làm lệch sổ')`,
      [id],
    );

    const res = await post(`${id}/return/confirm`, c.customer.auth).expect(500);
    expect(res.body.message).toBe('ESCROW_BALANCE_INSUFFICIENT');

    expect((await detail(id, c.customer.auth)).status).toBe(
      'RETURN_AWAITING_CONFIRM',
    );
    const [out] = (await ctx.dataSource.query(
      `SELECT status FROM handovers WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    )) as { status: string }[];
    expect(out.status).toBe('AWAITING_CUSTOMER');
    const m = await money(id);
    expect(m.ledger.map((r) => r.entry_type)).toEqual(['DEPOSIT', 'REFUND']);
    expect(m.components.map((r) => r.status)).toEqual(['PAID', 'PAID']);
    expect(m.disbursements).toHaveLength(0);
  });

  it('khách vắng nhà: vườn huỷ phiên trả → về IN_CARE → bắt đầu trả lại được', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    await makeCareDue(id);

    const inCare = await detail(id, c.provider.auth);
    expect(inCare.isReturnOverdue).toBe(true);

    await post(`${id}/return/start`, c.provider.auth).expect(200);
    const cancelled = await post(`${id}/return/cancel`, c.provider.auth, {
      reason: '  Khách vắng nhà, hẹn chiều mai  ',
    }).expect(200);
    expect(cancelled.body).toEqual({ status: 'IN_CARE' });

    const [row] = (await ctx.dataSource.query(
      `SELECT status, note FROM handovers WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    )) as { status: string; note: string }[];
    expect(row).toEqual({
      status: 'CANCELLED',
      note: 'Khách vắng nhà, hẹn chiều mai',
    });

    // Phiên CANCELLED không chặn unique → mở phiên trả mới được.
    const again = await post(`${id}/return/start`, c.provider.auth).expect(
      200,
    );
    expect(again.body.status).toBe('RETURN_IN_PROGRESS');
    await post(`${id}/return/start`, c.provider.auth).expect(409);
  });
});
