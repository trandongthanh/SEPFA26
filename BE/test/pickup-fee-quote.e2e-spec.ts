import request from 'supertest';
import type { App } from 'supertest/types';
import { CryptoService } from '../src/crypto/crypto.service';
import { haversineKm, ROAD_FACTOR } from '../src/orders/shipping-fee';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';
import {
  OrderSeed,
  type OrderActor,
  type OrderProvider,
} from './orders/order-seed';

const API = '/api/v1';
const QUOTE = `${API}/orders/pickup-fee-quote`;

// Nhà khách (Q1) và vườn (Tân Bình). E2E không có Google key → km = chim bay × 1.3.
const HOME = { lat: 10.7769, lng: 106.7009 };
const GARDEN = { lat: 10.8231, lng: 106.6297 };
const KM = Math.round(haversineKm(HOME, GARDEN) * ROAD_FACTOR * 100) / 100;

/**
 * Xem trước phí lấy cây + phí lấy cây 1 lần cho cả đơn (chốt 14/11/2026), trên Postgres thật.
 * Bảng phí: [0, 5) km = 100.000đ; ≥ 5 km = 100.000đ + 10.000đ mỗi km vượt 5.
 */
describe('Phí lấy cây — xem trước + 1 lần cho cả đơn (e2e)', () => {
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

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  const seedRates = () =>
    sql(
      `INSERT INTO shipping_rates (min_km, max_km, base_fee, per_km_fee, is_active)
       VALUES (0, 5, 100000, 0, true), (5, NULL, 100000, 10000, true)`,
    );

  // ctx.reset() chỉ xoá accounts (CASCADE) — bảng phí phải tự dọn.
  beforeEach(async () => {
    await ctx.reset();
    await sql('DELETE FROM shipping_rates');
  });

  const providerWithGps = async (): Promise<OrderProvider> => {
    const provider = await seed.provider();
    await sql(
      'UPDATE provider_profiles SET gps_lat = $2, gps_lng = $3 WHERE id = $1',
      [provider.profileId, GARDEN.lat, GARDEN.lng],
    );
    return provider;
  };

  const quote = (
    auth: OrderActor['auth'],
    query: Record<string, string | number>,
  ) => request(http).get(QUOTE).set(auth).query(query);

  const homeQuery = (servicePackageId: string) => ({
    servicePackageId,
    pickupGpsLat: HOME.lat,
    pickupGpsLng: HOME.lng,
  });

  // Phí đúng công thức bậc 2: 100.000 + (km − 5) × 10.000, làm tròn về đồng.
  const expectedFee = () => String(Math.round(100000 + (KM - 5) * 10000));

  it('200: trả km đường bộ + phí theo bảng bậc', async () => {
    const customer = await seed.customer();
    const provider = await providerWithGps();
    await seedRates();

    const res = await quote(
      customer.auth,
      homeQuery(provider.packageId),
    ).expect(200);

    expect(KM).toBeGreaterThan(5);
    expect(res.body).toEqual({ distanceKm: KM, pickupFee: expectedFee() });
  });

  it('POST /orders 3 cây: pickupFeeSnapshot = số đã xem trước (không nhân số cây)', async () => {
    const customer = await seed.customer();
    const provider = await providerWithGps();
    await seedRates();
    await verifyCustomer(customer);

    const quoted = await quote(
      customer.auth,
      homeQuery(provider.packageId),
    ).expect(200);

    const created = await request(http)
      .post(`${API}/orders`)
      .set(customer.auth)
      .send({
        servicePackageId: provider.packageId,
        scheduledPickupAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        pickupGpsLat: HOME.lat,
        pickupGpsLng: HOME.lng,
        plants: [{ name: 'Lan 1' }, { name: 'Lan 2' }, { name: 'Lan 3' }],
      })
      .expect(201);

    const [order] = await sql(
      'SELECT plant_count, pickup_fee_snapshot FROM service_orders WHERE id = $1',
      [(created.body as { id: string }).id],
    );
    expect(order.plant_count).toBe(3);
    expect(order.pickup_fee_snapshot).toBe(
      (quoted.body as { pickupFee: string }).pickupFee,
    );
  });

  it('bảng phí rỗng → phí 0 (không chặn khách)', async () => {
    const customer = await seed.customer();
    const provider = await providerWithGps();

    const res = await quote(
      customer.auth,
      homeQuery(provider.packageId),
    ).expect(200);

    expect(res.body).toEqual({ distanceKm: KM, pickupFee: '0' });
  });

  it('404: gói không tồn tại / vườn chưa duyệt / gói ngừng bán', async () => {
    const customer = await seed.customer();
    const provider = await providerWithGps();

    await quote(
      customer.auth,
      homeQuery('6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'),
    ).expect(404, /SERVICE_PACKAGE_NOT_FOUND/);

    await sql(
      `UPDATE provider_profiles SET verification_status = 'PENDING' WHERE id = $1`,
      [provider.profileId],
    );
    await quote(customer.auth, homeQuery(provider.packageId)).expect(404);

    await sql(
      `UPDATE provider_profiles SET verification_status = 'APPROVED' WHERE id = $1`,
      [provider.profileId],
    );
    await sql('UPDATE service_packages SET is_active = false WHERE id = $1', [
      provider.packageId,
    ]);
    await quote(customer.auth, homeQuery(provider.packageId)).expect(404);
  });

  it('503 PROVIDER_GPS_MISSING khi vườn chưa ghim vị trí', async () => {
    const customer = await seed.customer();
    const provider = await seed.provider();

    await quote(customer.auth, homeQuery(provider.packageId)).expect(
      503,
      /PROVIDER_GPS_MISSING/,
    );
  });

  it('400: thiếu / sai query', async () => {
    const customer = await seed.customer();
    const provider = await providerWithGps();

    await quote(customer.auth, {}).expect(400);
    await quote(customer.auth, {
      ...homeQuery('khong-phai-uuid'),
    }).expect(400);
    await quote(customer.auth, {
      ...homeQuery(provider.packageId),
      pickupGpsLat: 91,
    }).expect(400);
    await quote(customer.auth, {
      ...homeQuery(provider.packageId),
      pickupGpsLng: 'abc',
    }).expect(400);
  });

  it('401 không token · 403 vườn gọi', async () => {
    const provider = await providerWithGps();

    await request(http)
      .get(QUOTE)
      .query(homeQuery(provider.packageId))
      .expect(401);
    await quote(provider.auth, homeQuery(provider.packageId)).expect(403);
  });

  // Khách đủ điều kiện đặt đơn: hồ sơ APPROVED + đủ thông tin cơ bản + SĐT (mã hoá như code thật).
  async function verifyCustomer(customer: OrderActor) {
    await sql(
      `UPDATE customer_profiles
          SET verification_status = 'APPROVED',
              address = '25 Lê Lợi, Q1, TP.HCM',
              date_of_birth = '15/05/1992',
              place_of_origin = 'Quận 1, TP.HCM'
        WHERE id = $1`,
      [customer.profileId],
    );
    await sql('UPDATE accounts SET phone = $2 WHERE id = $1', [
      customer.accountId,
      ctx.app.get(CryptoService).encrypt('0909000001'),
    ]);
  }
});
