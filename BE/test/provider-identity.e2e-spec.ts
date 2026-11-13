import request from 'supertest';
import type { App } from 'supertest/types';
import { CryptoService } from '../src/crypto/crypto.service';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';

const API = '/api/v1';
const CCCD = '001234567890';
const PHONE = '0909123456';

// Provider khai SĐT + số CCCD (feature/provider-identity) — chạy trên Postgres thật để kiểm
// cả UNIQUE index (23505) mà unit test chỉ giả lập được.
describe('Provider identity (e2e)', () => {
  let ctx: AuthTestApp;
  let http: App;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
    http = ctx.app.getHttpServer() as App;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  const session = async (email: string, role: 'CUSTOMER' | 'PROVIDER') => {
    await request(http)
      .post(`${API}/auth/register`)
      .send({ email, password: 'matkhau123', fullName: 'Nguyễn Văn Lan', role })
      .expect(201);
    const res = await request(http)
      .post(`${API}/auth/login`)
      .send({ email, password: 'matkhau123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken as string}` };
  };

  const putProvider = (
    auth: Record<string, string>,
    body: Record<string, unknown>,
  ) => request(http).put(`${API}/providers/me/profile`).set(auth).send(body);

  const createProvider = async (email = 'vuon@example.com') => {
    const auth = await session(email, 'PROVIDER');
    const res = await putProvider(auth, {
      providerType: 'NURSERY',
      displayName: 'Vườn Lan A',
      cccdFrontUrl: 'https://x/cccd-f.jpg',
      cccdBackUrl: 'https://x/cccd-b.jpg',
      selfieUrl: 'https://x/selfie.jpg',
    }).expect(200);
    return { auth, providerId: res.body.id as string };
  };

  // ADMIN không tự đăng ký được → đăng ký account thường, nâng quyền trong DB rồi mới đăng nhập.
  const adminAuth = async () => {
    await request(http)
      .post(`${API}/auth/register`)
      .send({
        email: 'admin@example.com',
        password: 'matkhau123',
        fullName: 'Admin',
        role: 'CUSTOMER',
      })
      .expect(201);
    await ctx.dataSource.query(
      `UPDATE accounts SET role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin@example.com'`,
    );
    const res = await request(http)
      .post(`${API}/auth/login`)
      .send({ email: 'admin@example.com', password: 'matkhau123' })
      .expect(200);
    return { Authorization: `Bearer ${res.body.accessToken as string}` };
  };

  const expectNoSecrets = (body: unknown) => {
    const json = JSON.stringify(body);
    for (const key of ['cccdNumberHash', 'passwordHash', 'phoneHash', '$2b$']) {
      expect(json).not.toContain(key);
    }
  };

  it('PUT phone + cccdNumber → response & GET /me giải mã; DB chỉ có ciphertext', async () => {
    const { auth } = await createProvider();
    const res = await putProvider(auth, {
      // DTO chỉ nhận dạng liền (regex giống customer); +84 được chuẩn hoá về 0 trước khi lưu.
      phone: '+84909123456',
      cccdNumber: CCCD,
    }).expect(200);
    expect(res.body).toMatchObject({ phone: PHONE, cccdNumber: CCCD });
    expect(res.body.account.phone).toBe(PHONE);
    expectNoSecrets(res.body);

    const me = await request(http)
      .get(`${API}/providers/me`)
      .set(auth)
      .expect(200);
    expect(me.body).toMatchObject({ phone: PHONE, cccdNumber: CCCD });
    expectNoSecrets(me.body);

    const [row] = (await ctx.dataSource.query(
      'SELECT cccd_number, cccd_number_hash FROM provider_profiles',
    )) as { cccd_number: string; cccd_number_hash: string }[];
    expect(row.cccd_number).not.toContain(CCCD);
    expect(ctx.app.get(CryptoService).decrypt(row.cccd_number)).toBe(CCCD);
    expect(row.cccd_number_hash).toHaveLength(64);
  });

  it('400 khi phone/cccdNumber sai định dạng', async () => {
    const { auth } = await createProvider();
    await putProvider(auth, { cccdNumber: '12345' }).expect(400);
    await putProvider(auth, { phone: '0123' }).expect(400);
  });

  it('409 PHONE_EXISTS khi SĐT đã thuộc account khác (kể cả account khách)', async () => {
    const customer = await session('khach@example.com', 'CUSTOMER');
    await request(http)
      .put(`${API}/customers/me/profile`)
      .set(customer)
      .send({ phone: PHONE })
      .expect(200);

    const { auth } = await createProvider();
    const res = await putProvider(auth, { phone: '84909123456' }).expect(409);
    expect(res.body.message).toBe('PHONE_EXISTS');
  });

  it('409 CCCD_NUMBER_EXISTS khi 2 vườn khai trùng CCCD; khách trùng CCCD với vườn thì được', async () => {
    const a = await createProvider('vuon-a@example.com');
    await putProvider(a.auth, { cccdNumber: CCCD }).expect(200);

    const b = await createProvider('vuon-b@example.com');
    const res = await putProvider(b.auth, { cccdNumber: CCCD }).expect(409);
    expect(res.body.message).toBe('CCCD_NUMBER_EXISTS');

    // Unique chỉ trong bảng provider — 1 người được có cả tài khoản khách.
    const customer = await session('khach@example.com', 'CUSTOMER');
    await request(http)
      .put(`${API}/customers/me/profile`)
      .set(customer)
      .send({ cccdNumber: CCCD })
      .expect(200);
  });

  it('2 vườn cùng khai 1 CCCD song song → đúng 1 thành công, 1 bị 409 (UNIQUE index chốt)', async () => {
    const a = await createProvider('vuon-a@example.com');
    const b = await createProvider('vuon-b@example.com');
    const [ra, rb] = await Promise.all([
      putProvider(a.auth, { cccdNumber: CCCD }),
      putProvider(b.auth, { cccdNumber: CCCD }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
  });

  describe('admin duyệt', () => {
    it('APPROVED khi thiếu số CCCD/SĐT → 400 PROVIDER_PROFILE_NOT_SUBMITTED; canVerify=false', async () => {
      const { providerId } = await createProvider();
      const admin = await adminAuth();

      const list = await request(http)
        .get(`${API}/admin/providers`)
        .set(admin)
        .expect(200);
      expect(
        (list.body as { id: string; canVerify: boolean }[]).find(
          (p) => p.id === providerId,
        )?.canVerify,
      ).toBe(false);

      const res = await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'APPROVED' })
        .set(admin)
        .expect(400);
      expect(res.body.message).toBe('PROVIDER_PROFILE_NOT_SUBMITTED');
    });

    it('đủ bộ → canVerify=true, APPROVED; admin thấy SĐT/CCCD giải mã, không lộ hash', async () => {
      const { auth, providerId } = await createProvider();
      await putProvider(auth, { phone: PHONE, cccdNumber: CCCD }).expect(200);
      const admin = await adminAuth();

      const list = await request(http)
        .get(`${API}/admin/providers`)
        .set(admin)
        .expect(200);
      const row = (
        list.body as { id: string; canVerify: boolean; cccdNumber: string }[]
      ).find((p) => p.id === providerId)!;
      expect(row).toMatchObject({ canVerify: true, cccdNumber: CCCD });

      const detail = await request(http)
        .get(`${API}/admin/providers/${providerId}`)
        .set(admin)
        .expect(200);
      expect(detail.body.provider).toMatchObject({
        phone: PHONE,
        cccdNumber: CCCD,
      });

      const verified = await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'APPROVED' })
        .set(admin)
        .expect(201);
      expect(verified.body).toMatchObject({
        verificationStatus: 'APPROVED',
        phone: PHONE,
        cccdNumber: CCCD,
      });
      expect(verified.body.account.status).toBe('ACTIVE');

      for (const body of [list.body, detail.body, verified.body]) {
        expectNoSecrets(body);
      }
    });

    it('sau APPROVED: đổi SĐT giữ APPROVED; đổi số CCCD → PENDING', async () => {
      const { auth, providerId } = await createProvider();
      await putProvider(auth, { phone: PHONE, cccdNumber: CCCD }).expect(200);
      const admin = await adminAuth();
      await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'APPROVED' })
        .set(admin)
        .expect(201);

      const phoneChanged = await putProvider(auth, {
        phone: '0911222333',
      }).expect(200);
      expect(phoneChanged.body.verificationStatus).toBe('APPROVED');

      const cccdChanged = await putProvider(auth, {
        cccdNumber: '009999999999',
      }).expect(200);
      expect(cccdChanged.body.verificationStatus).toBe('PENDING');
    });
  });

  // Vườn ACCEPT → snapshot hợp đồng v2 (SĐT/CCCD mã hoá) → GET đơn + hợp đồng đọc bản đóng băng.
  describe('hợp đồng (ACCEPT → snapshot → contract)', () => {
    const CUSTOMER_CCCD = '001111111111';
    const CUSTOMER_PHONE = '0911222333';

    // Vườn APPROVED (+ SĐT/CCCD nếu withIdentity) + khách có SĐT/CCCD + 1 đơn PENDING_PROVIDER.
    const seedOrder = async (withIdentity: boolean) => {
      const { auth: providerAuth, providerId } = await createProvider();
      if (withIdentity) {
        await putProvider(providerAuth, {
          phone: PHONE,
          cccdNumber: CCCD,
        }).expect(200);
      }
      await ctx.dataSource.query(
        `UPDATE provider_profiles SET verification_status = 'APPROVED', address = '12 Nguyễn Văn Bảo'`,
      );

      const customerAuth = await session('khach@example.com', 'CUSTOMER');
      await request(http)
        .put(`${API}/customers/me/profile`)
        .set(customerAuth)
        .send({
          phone: CUSTOMER_PHONE,
          cccdNumber: CUSTOMER_CCCD,
          address: '25 Lê Lợi',
        })
        .expect(200);
      const [{ id: customerId }] = (await ctx.dataSource.query(
        'SELECT id FROM customer_profiles',
      )) as { id: string }[];

      const [{ id: packageId }] = (await ctx.dataSource.query(
        `INSERT INTO service_packages
           (provider_id, name, duration_days, report_frequency_days, max_plants, base_price,
            is_active, approval_status)
         VALUES ($1, 'Gói thường', 30, 7, 5, 200000, true, 'APPROVED') RETURNING id`,
        [providerId],
      )) as { id: string }[];
      const [{ id: orderId }] = (await ctx.dataSource.query(
        `INSERT INTO service_orders
           (order_code, customer_id, provider_id, service_package_id, status, plant_count,
            base_price_snapshot, pickup_fee_snapshot, duration_days_snapshot,
            report_frequency_snapshot, provisional_total, scheduled_pickup_at,
            pickup_gps_lat, pickup_gps_lng)
         VALUES ('LANCARE0000ABCD', $1, $2, $3, 'PENDING_PROVIDER', 1, 200000, 0, 30, 7,
                 200000, now() + interval '1 day', 10.77, 106.70) RETURNING id`,
        [customerId, providerId, packageId],
      )) as { id: string }[];
      await ctx.dataSource.query(
        `INSERT INTO plants (service_order_id, name) VALUES ($1, 'Hồ Điệp trắng')`,
        [orderId],
      );
      await ctx.dataSource.query(
        'INSERT INTO negotiations (service_order_id) VALUES ($1)',
        [orderId],
      );
      return { providerAuth, orderId };
    };

    const respond = (
      auth: Record<string, string>,
      orderId: string,
      response: string,
    ) =>
      request(http)
        .post(`${API}/orders/${orderId}/negotiation/respond`)
        .set(auth)
        .send({ response });

    it('vườn APPROVED chưa khai SĐT/CCCD: ACCEPT → 403 PROVIDER_IDENTITY_INCOMPLETE; REJECT vẫn được', async () => {
      const { providerAuth, orderId } = await seedOrder(false);
      const res = await respond(providerAuth, orderId, 'ACCEPT').expect(403);
      expect(res.body.message).toBe('PROVIDER_IDENTITY_INCOMPLETE');
      const [{ count }] = (await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM service_agreements',
      )) as { count: number }[];
      expect(count).toBe(0);

      await respond(providerAuth, orderId, 'REJECT').expect(200);
    });

    it('ACCEPT → DB snapshot không chứa SĐT/CCCD dạng rõ; GET đơn + hợp đồng hiện đủ 2 bên', async () => {
      const { providerAuth, orderId } = await seedOrder(true);
      await respond(providerAuth, orderId, 'ACCEPT').expect(200);

      const [{ terms }] = (await ctx.dataSource.query(
        'SELECT terms_snapshot::text AS terms FROM service_agreements',
      )) as { terms: string }[];
      for (const plain of [CCCD, PHONE, CUSTOMER_CCCD, CUSTOMER_PHONE]) {
        expect(terms).not.toContain(plain);
      }

      const detail = await request(http)
        .get(`${API}/orders/${orderId}`)
        .set(providerAuth)
        .expect(200);
      const parties = detail.body.agreement.termsSnapshot.parties;
      expect(parties.provider).toMatchObject({
        phone: PHONE,
        identityNumber: CCCD,
        address: '12 Nguyễn Văn Bảo',
      });
      expect(parties.customer).toMatchObject({
        phone: CUSTOMER_PHONE,
        identityNumber: CUSTOMER_CCCD,
      });
      expect(JSON.stringify(parties)).not.toContain('Enc');

      const contract = await request(http)
        .get(`${API}/orders/${orderId}/agreement/contract`)
        .set(providerAuth)
        .expect(200);
      expect(contract.body.parties.provider).toMatchObject({
        phone: PHONE,
        identityNumber: CCCD,
      });
      expect(contract.body.parties.customer.identityNumber).toBe(CUSTOMER_CCCD);
    });

    it('hợp đồng đóng băng: vườn đổi CCCD SAU khi ACCEPT → hợp đồng vẫn in số cũ', async () => {
      const { providerAuth, orderId } = await seedOrder(true);
      await respond(providerAuth, orderId, 'ACCEPT').expect(200);
      await putProvider(providerAuth, { cccdNumber: '009999999999' }).expect(
        200,
      );

      const contract = await request(http)
        .get(`${API}/orders/${orderId}/agreement/contract`)
        .set(providerAuth)
        .expect(200);
      expect(contract.body.parties.provider.identityNumber).toBe(CCCD);
    });
  });
});
