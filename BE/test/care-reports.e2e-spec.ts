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
 * Báo cáo chăm sóc 2 tầng (phần chung của đơn + từng cây) trên Postgres thật.
 * Gói seed: 30 ngày, 7 ngày/lần → 5 kỳ (kỳ 5 dài 2 ngày); đơn 2 cây.
 * Đơn đi tới IN_CARE bằng API thật; lùi mốc chăm bằng SQL để giả lập thời gian trôi.
 */
describe('Care reports (e2e)', () => {
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

  type Auth = { Authorization: string };

  const postOrder = (path: string, auth: Auth, body: object = {}) =>
    request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const submit = (auth: Auth, body: object) =>
    request(http).post(`${API}/care-reports`).set(auth).send(body);

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  // Đi hết luồng nhận cây bằng API thật → đơn IN_CARE (giống order-return.e2e-spec).
  const toInCare = async (): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    await postOrder(`${id}/submit`, customer.auth).expect(200);
    await postOrder(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await postOrder(`${id}/agreement/sign`, customer.auth).expect(200);
    await postOrder(`${id}/agreement/sign`, provider.auth).expect(200);
    await seed.webhook(order.orderCode, order.amountDue).expect(200);
    await postOrder(`${id}/handover/start`, provider.auth).expect(201);
    for (const plantId of order.plantIds) {
      await postOrder(`${id}/handover/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await postOrder(`${id}/handover/complete`, provider.auth).expect(200);
    await postOrder(`${id}/handover/confirm`, customer.auth).expect(200);
    await seed.paySecurityDeposit(id);
    return { customer, provider, order };
  };

  // Giả lập đã chăm được `days` ngày: lùi cả ngày bắt đầu lẫn hạn chăm.
  const shiftCare = (orderId: string, days: number) =>
    ctx.dataSource.query(
      `UPDATE service_orders
         SET care_started_at = care_started_at - make_interval(days => $2),
             care_due_at = care_due_at - make_interval(days => $2)
       WHERE id = $1`,
      [orderId, days],
    );

  const plantEntry = (plantId: string, overrides: object = {}) => ({
    plantId,
    substrateMoisture: 'MEDIUM',
    leafCondition: 'GOOD',
    rootCondition: 'NORMAL',
    stemCondition: 'GOOD',
    hasPestDisease: false,
    overallHealth: 'GOOD',
    leafLengthCm: 18.5,
    leafCount: 6,
    budCount: 3,
    photos: [
      {
        evidenceType: 'OVERVIEW',
        photoUrl: 'https://example.com/overview.jpg',
        caption: 'Toàn cảnh',
      },
    ],
    ...overrides,
  });

  const reportBody = (c: Ctx, plants?: object[]) => ({
    serviceOrderId: c.order.orderId,
    airTemperature: 27.5,
    airHumidity: 72,
    lightIntensity: 18000,
    watered: true,
    waterAmountMl: 500,
    fertilized: false,
    otherCareNote: 'Cắt tỉa lá già',
    waterPh: 6.2,
    waterEc: 0.8,
    plants: plants ?? c.order.plantIds.map((id) => plantEntry(id)),
  });

  const adminAuth = async (): Promise<Auth> => {
    await request(http)
      .post(`${API}/auth/register`)
      .send({
        email: 'admin-care@example.com',
        password: 'matkhau123',
        fullName: 'Admin',
        role: 'CUSTOMER',
      })
      .expect(201);
    await ctx.dataSource.query(
      `UPDATE accounts SET role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin-care@example.com'`,
    );
    const res = await request(http)
      .post(`${API}/auth/login`)
      .send({ email: 'admin-care@example.com', password: 'matkhau123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken as string}` };
  };

  it('nộp kỳ 1 hợp lệ → server tự gán kỳ; chi tiết đơn đếm 1/5; khách xem thấy tên cây + ảnh', async () => {
    const c = await toInCare();

    const res = await submit(c.provider.auth, reportBody(c)).expect(201);
    expect(res.body).toMatchObject({
      serviceOrderId: c.order.orderId,
      periodIndex: 1,
      isLate: false,
    });
    const period = res.body as { periodStart: string; periodEnd: string };
    expect(
      new Date(period.periodEnd).getTime() - new Date(period.periodStart).getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);

    const detail = await request(http)
      .get(`${API}/orders/${c.order.orderId}`)
      .set(c.provider.auth)
      .expect(200);
    expect(detail.body.careReportSchedule).toMatchObject({
      submittedCount: 1,
      totalPeriods: 5,
    });

    const list = await request(http)
      .get(`${API}/care-reports`)
      .query({ serviceOrderId: c.order.orderId })
      .set(c.customer.auth)
      .expect(200);
    const reports = list.body as Array<Record<string, any>>;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      periodIndex: 1,
      airTemperature: 27.5,
      lightIntensity: 18000,
      watered: true,
      waterAmountMl: 500,
    });
    const plants = reports[0].plants as Array<Record<string, any>>;
    expect(plants).toHaveLength(2);
    expect(plants.map((p) => p.plant.name).sort()).toEqual(['Lan 1', 'Lan 2']);
    expect(plants[0].leafLengthCm).toBe(18.5);
    expect(plants[0].photos[0]).toMatchObject({ evidenceType: 'OVERVIEW' });
    expect(JSON.stringify(reports)).not.toContain('passwordHash');
  });

  it('nộp tiếp ngay khi kỳ 2 chưa bắt đầu → 409 REPORT_PERIOD_NOT_STARTED', async () => {
    const c = await toInCare();
    await submit(c.provider.auth, reportBody(c)).expect(201);
    const res = await submit(c.provider.auth, reportBody(c)).expect(409);
    expect(res.body.message).toBe('REPORT_PERIOD_NOT_STARTED');
  });

  it('chăm được 10 ngày mới nộp: kỳ 1 trễ (isLate), kỳ 2 đúng hạn; danh sách theo thứ tự kỳ', async () => {
    const c = await toInCare();
    await shiftCare(c.order.orderId, 10);

    const first = await submit(c.provider.auth, reportBody(c)).expect(201);
    expect(first.body).toMatchObject({ periodIndex: 1, isLate: true });
    const second = await submit(c.provider.auth, reportBody(c)).expect(201);
    expect(second.body).toMatchObject({ periodIndex: 2, isLate: false });

    const list = await request(http)
      .get(`${API}/care-reports`)
      .query({ serviceOrderId: c.order.orderId })
      .set(c.provider.auth)
      .expect(200);
    expect((list.body as Array<{ periodIndex: number }>).map((r) => r.periodIndex)).toEqual([1, 2]);
  });

  it('hết gói: nộp đủ 5 kỳ (kỳ 5 ngắn) rồi nộp thêm → 409 ALL_PERIODS_SUBMITTED', async () => {
    const c = await toInCare();
    await shiftCare(c.order.orderId, 31);

    for (let i = 1; i <= 5; i++) {
      const res = await submit(c.provider.auth, reportBody(c)).expect(201);
      expect(res.body.periodIndex).toBe(i);
    }
    const res = await submit(c.provider.auth, reportBody(c)).expect(409);
    expect(res.body.message).toBe('ALL_PERIODS_SUBMITTED');
  });

  it('2 yêu cầu nộp cùng lúc → đúng 1 báo cáo được lưu', async () => {
    const c = await toInCare();
    const [a, b] = await Promise.all([
      submit(c.provider.auth, reportBody(c)),
      submit(c.provider.auth, reportBody(c)),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const [{ count }] = (await ctx.dataSource.query(
      'SELECT count(*)::int AS count FROM care_reports WHERE service_order_id = $1',
      [c.order.orderId],
    )) as { count: number }[];
    expect(count).toBe(1);
  });

  it('thiếu một cây đang chăm → 400 REPORT_PLANTS_MISMATCH', async () => {
    const c = await toInCare();
    const res = await submit(
      c.provider.auth,
      reportBody(c, [plantEntry(c.order.plantIds[0])]),
    ).expect(400);
    expect(res.body.message).toBe('REPORT_PLANTS_MISMATCH');
  });

  it('lá chấm Xấu mà không có ảnh lá → 400 PLANT_PHOTO_REQUIRED', async () => {
    const c = await toInCare();
    const [p1, p2] = c.order.plantIds;
    const res = await submit(
      c.provider.auth,
      reportBody(c, [plantEntry(p1, { leafCondition: 'POOR' }), plantEntry(p2)]),
    ).expect(400);
    expect(res.body.message).toBe('PLANT_PHOTO_REQUIRED');
  });

  it('tưới mà không ghi lượng nước → 400 CARE_ACTIVITY_INVALID', async () => {
    const c = await toInCare();
    const body = { ...reportBody(c), waterAmountMl: undefined };
    const res = await submit(c.provider.auth, body).expect(400);
    expect(res.body.message).toBe('CARE_ACTIVITY_INVALID');
  });

  it('đơn chưa IN_CARE → 400; vườn khác → 404; khách gọi nộp → 403', async () => {
    const c = await toInCare();

    const draft = await seed.draftOrder(c.customer, c.provider);
    const notInCare = await submit(c.provider.auth, {
      ...reportBody(c),
      serviceOrderId: draft.orderId,
      plants: draft.plantIds.map((id) => plantEntry(id)),
    }).expect(400);
    expect(notInCare.body.message).toBe('ORDER_NOT_IN_CARE');

    const other = await seed.provider();
    const notMine = await submit(other.auth, reportBody(c)).expect(404);
    expect(notMine.body.message).toBe('SERVICE_ORDER_NOT_FOUND');

    await submit(c.customer.auth, reportBody(c)).expect(403);
  });

  it('quyền xem: khách khác không thấy (404 / danh sách rỗng); admin xem được', async () => {
    const c = await toInCare();
    const created = await submit(c.provider.auth, reportBody(c)).expect(201);
    const reportId = (created.body as { id: string }).id;

    const stranger = await seed.customer();
    await request(http)
      .get(`${API}/care-reports/${reportId}`)
      .set(stranger.auth)
      .expect(404);
    const strangerList = await request(http)
      .get(`${API}/care-reports`)
      .query({ serviceOrderId: c.order.orderId })
      .set(stranger.auth)
      .expect(200);
    expect(strangerList.body).toEqual([]);

    const admin = await adminAuth();
    const viewed = await request(http)
      .get(`${API}/care-reports/${reportId}`)
      .set(admin)
      .expect(200);
    expect(viewed.body).toMatchObject({ id: reportId, periodIndex: 1 });
    expect(viewed.body.plants).toHaveLength(2);
  });
});
