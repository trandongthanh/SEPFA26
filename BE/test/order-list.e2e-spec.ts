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
const HOUR_MS = 60 * 60 * 1000;

type Auth = { Authorization: string };
interface ListItem {
  id: string;
  orderCode: string;
  status: string;
  plantNames: string[];
  handoverStatus: string | null;
  deadlines: Record<string, string | null>;
}
interface ListBody {
  data: ListItem[];
  total: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
}

/**
 * GET /orders — tìm kiếm (không dấu), sắp xếp, đếm theo trạng thái, thông tin thẻ đơn (Lỗi 3 review 22/11).
 * Dữ liệu mẫu: vườn A có gói "Chăm Lan Đà Lạt";
 *   đơn 1 — khách "Nguyễn Văn Minh", cây "Lan Hồ Điệp" + "Lan Kiếm", PENDING_PROVIDER, tạo trước, hẹn +5 ngày;
 *   đơn 2 — khách "Lê Thị Hoa", cây "Sen Đá", AGREEMENT_PENDING, tạo sau, hẹn +2 ngày;
 *   đơn 3 — khách Minh, DRAFT (vườn không thấy);
 *   đơn 4 — khách Minh, gửi vườn B (vườn A không thấy).
 */
describe('Danh sách đơn: tìm, sắp, đếm (e2e)', () => {
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

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  const post = (path: string, auth: Auth, body: object = {}) =>
    request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const list = async (auth: Auth, query: Record<string, string> = {}) =>
    (
      await request(http)
        .get(`${API}/orders`)
        .query(query)
        .set(auth)
        .expect(200)
    ).body as ListBody;

  const setName = (actor: OrderActor, fullName: string) =>
    sql('UPDATE accounts SET full_name = $2 WHERE id = $1', [
      actor.accountId,
      fullName,
    ]);

  const renamePlants = async (order: DraftOrder, names: string[]) => {
    for (const [index, name] of names.entries()) {
      await sql('UPDATE plants SET name = $2 WHERE id = $1', [
        order.plantIds[index],
        name,
      ]);
    }
  };

  // created_at / giờ hẹn tính theo giờ hiện tại (âm = trước).
  const setTimes = (order: DraftOrder, createdMs: number, pickupMs: number) =>
    sql(
      `UPDATE service_orders SET created_at = now() + ($2 || ' milliseconds')::interval,
              scheduled_pickup_at = now() + ($3 || ' milliseconds')::interval WHERE id = $1`,
      [order.orderId, String(createdMs), String(pickupMs)],
    );

  interface World {
    minh: OrderActor;
    hoa: OrderActor;
    gardenA: OrderProvider;
    gardenB: OrderProvider;
    o1: DraftOrder;
    o2: DraftOrder;
    o3: DraftOrder;
    o4: DraftOrder;
  }

  const build = async (): Promise<World> => {
    const minh = await seed.customer();
    const hoa = await seed.customer();
    const gardenA = await seed.provider();
    const gardenB = await seed.provider();
    await setName(minh, 'Nguyễn Văn Minh');
    await setName(hoa, 'Lê Thị Hoa');
    await sql('UPDATE service_packages SET name = $2 WHERE id = $1', [
      gardenA.packageId,
      'Chăm Lan Đà Lạt',
    ]);

    const o1 = await seed.draftOrder(minh, gardenA);
    await renamePlants(o1, ['Lan Hồ Điệp', 'Lan Kiếm']);
    await post(`${o1.orderId}/submit`, minh.auth).expect(200);

    const o2 = await seed.draftOrder(hoa, gardenA, { plantCount: 1 });
    await renamePlants(o2, ['Sen Đá']);
    await post(`${o2.orderId}/submit`, hoa.auth).expect(200);
    await post(`${o2.orderId}/negotiation/respond`, gardenA.auth, {
      response: 'ACCEPT',
    }).expect(200);

    const o3 = await seed.draftOrder(minh, gardenA);
    const o4 = await seed.draftOrder(minh, gardenB);
    await post(`${o4.orderId}/submit`, minh.auth).expect(200);

    await setTimes(o1, -3 * HOUR_MS, 5 * 24 * HOUR_MS);
    await setTimes(o2, -2 * HOUR_MS, 2 * 24 * HOUR_MS);
    await setTimes(o3, -1 * HOUR_MS, 3 * 24 * HOUR_MS);
    return { minh, hoa, gardenA, gardenB, o1, o2, o3, o4 };
  };

  const codes = (body: ListBody) => body.data.map((order) => order.orderCode);

  it('vườn: chỉ đơn của mình, không DRAFT, mới tạo trước; có tên cây, phiên nhận cây, các hạn, số theo trạng thái', async () => {
    const w = await build();
    const body = await list(w.gardenA.auth);
    expect(codes(body)).toEqual([w.o2.orderCode, w.o1.orderCode]);
    expect(body).toMatchObject({ total: 2, page: 1, limit: 10 });
    expect(body.statusCounts).toEqual({
      PENDING_PROVIDER: 1,
      AGREEMENT_PENDING: 1,
    });
    const first = body.data.find((order) => order.id === w.o1.orderId)!;
    expect(first.plantNames).toEqual(['Lan Hồ Điệp', 'Lan Kiếm']);
    expect(first.handoverStatus).toBeNull();
    expect(Object.keys(first.deadlines).sort()).toEqual([
      'agreementDueAt',
      'freeCancelUntil',
      'noShowFrom',
      'paymentDueAt',
      'providerRespondDueAt',
    ]);
    expect(first.deadlines.providerRespondDueAt).not.toBeNull();
  });

  it('q không phân biệt dấu, hoa thường: tên cây, tên khách, mã đơn, tên gói', async () => {
    const w = await build();
    expect(codes(await list(w.gardenA.auth, { q: 'lan ho' }))).toEqual([
      w.o1.orderCode,
    ]);
    expect(codes(await list(w.gardenA.auth, { q: 'HỒ ĐIỆP' }))).toEqual([
      w.o1.orderCode,
    ]);
    expect(codes(await list(w.gardenA.auth, { q: 'le thi hoa' }))).toEqual([
      w.o2.orderCode,
    ]);
    expect(
      codes(await list(w.gardenA.auth, { q: w.o2.orderCode.toLowerCase() })),
    ).toEqual([w.o2.orderCode]);
    expect((await list(w.gardenA.auth, { q: 'cham lan da lat' })).total).toBe(
      2,
    );
    // Ký tự đặc biệt của LIKE được escape: "%" không khớp mọi thứ.
    expect((await list(w.gardenA.auth, { q: '%' })).total).toBe(0);
    // Chỉ khoảng trắng = không lọc.
    expect((await list(w.gardenA.auth, { q: '   ' })).total).toBe(2);
  });

  it('statusCounts theo kết quả tìm, bỏ qua lọc status; danh sách vẫn lọc status', async () => {
    const w = await build();
    const body = await list(w.gardenA.auth, {
      q: 'cham lan',
      status: 'PENDING_PROVIDER',
    });
    expect(codes(body)).toEqual([w.o1.orderCode]);
    expect(body.total).toBe(1);
    expect(body.statusCounts).toEqual({
      PENDING_PROVIDER: 1,
      AGREEMENT_PENDING: 1,
    });
    // Vườn hỏi tab DRAFT → rỗng nhưng vẫn có số các tab khác.
    const draft = await list(w.gardenA.auth, { status: 'DRAFT' });
    expect(draft).toMatchObject({ data: [], total: 0 });
    expect(draft.statusCounts).toEqual({
      PENDING_PROVIDER: 1,
      AGREEMENT_PENDING: 1,
    });
  });

  it('sort oldest / pickupSoon và phân trang', async () => {
    const w = await build();
    expect(codes(await list(w.gardenA.auth, { sort: 'oldest' }))).toEqual([
      w.o1.orderCode,
      w.o2.orderCode,
    ]);
    expect(codes(await list(w.gardenA.auth, { sort: 'pickupSoon' }))).toEqual([
      w.o2.orderCode,
      w.o1.orderCode,
    ]);
    const second = await list(w.gardenA.auth, { limit: '1', page: '2' });
    expect(codes(second)).toEqual([w.o1.orderCode]);
    expect(second).toMatchObject({ total: 2, page: 2, limit: 1 });
  });

  it('khách: thấy cả đơn nháp của mình, không thấy đơn khách khác', async () => {
    const w = await build();
    const minh = await list(w.minh.auth);
    expect(minh.total).toBe(3);
    expect(minh.statusCounts).toEqual({ PENDING_PROVIDER: 2, DRAFT: 1 });
    expect(codes(await list(w.hoa.auth))).toEqual([w.o2.orderCode]);
    expect((await list(w.hoa.auth, { q: 'lan ho' })).total).toBe(0);
  });

  it('handoverStatus = phiên nhận cây mới nhất khi vườn đã tới lấy cây', async () => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    await seed.webhook(order.orderCode, order.amountDue).expect(200);
    await post(`${id}/handover/start`, provider.auth).expect(201);

    const [item] = (await list(provider.auth)).data;
    expect(item).toMatchObject({
      status: 'HANDOVER_IN_PROGRESS',
      handoverStatus: 'IN_PROGRESS',
    });
  });

  it('q quá 100 ký tự hoặc sort lạ → 400', async () => {
    const customer = await seed.customer();
    await request(http)
      .get(`${API}/orders`)
      .query({ q: 'a'.repeat(101) })
      .set(customer.auth)
      .expect(400);
    await request(http)
      .get(`${API}/orders`)
      .query({ sort: 'price' })
      .set(customer.auth)
      .expect(400);
  });
});
