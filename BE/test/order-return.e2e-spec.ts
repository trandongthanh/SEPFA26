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

  // Đi hết luồng nhận cây bằng API thật → đơn IN_CARE.
  const toInCare = async (): Promise<Ctx> => {
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

    // Bấm lại → 409, không đổi gì.
    await post(`${id}/return/confirm`, c.customer.auth).expect(409);

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
