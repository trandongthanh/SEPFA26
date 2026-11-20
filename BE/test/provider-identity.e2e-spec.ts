import request from 'supertest';
import type { App } from 'supertest/types';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';

const API = '/api/v1';
const PHONE = '0909123456';
const DOB = '20/10/1985';
const ORIGIN = 'TP. Bảo Lộc, Lâm Đồng';
const ADDRESS = '12 Nguyễn Văn Bảo, Gò Vấp, TP.HCM';

// Provider khai SĐT + Địa chỉ + Ngày sinh + Quê quán (KHÔNG lưu số CCCD hay ảnh CCCD/chân dung).
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
    for (const key of [
      'cccdNumber',
      'cccdNumberHash',
      'cccdFrontUrl',
      'cccdBackUrl',
      'selfieUrl',
      'passwordHash',
      'phoneHash',
      '$2b$',
    ]) {
      expect(json).not.toContain(key);
    }
  };

  it('PUT phone + dateOfBirth + placeOfOrigin + address → response & GET /me giải mã SĐT', async () => {
    const { auth } = await createProvider();
    const res = await putProvider(auth, {
      phone: '+84909123456',
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
      address: ADDRESS,
    }).expect(200);
    expect(res.body).toMatchObject({
      phone: PHONE,
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
      address: ADDRESS,
    });
    expect(res.body.account.phone).toBe(PHONE);
    expectNoSecrets(res.body);

    const me = await request(http)
      .get(`${API}/providers/me`)
      .set(auth)
      .expect(200);
    expect(me.body).toMatchObject({
      phone: PHONE,
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
      address: ADDRESS,
    });
    expectNoSecrets(me.body);
  });

  it('400 khi phone sai định dạng', async () => {
    const { auth } = await createProvider();
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

  describe('admin duyệt', () => {
    it('APPROVED khi thiếu SĐT/Địa chỉ/Ngày sinh/Quê quán → 400 PROVIDER_PROFILE_NOT_SUBMITTED; canVerify=false', async () => {
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

    it('đủ bộ → canVerify=true, APPROVED; admin thấy SĐT giải mã, không lộ CCCD/hash', async () => {
      const { auth, providerId } = await createProvider();
      await putProvider(auth, {
        phone: PHONE,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        address: ADDRESS,
      }).expect(200);
      const admin = await adminAuth();

      const list = await request(http)
        .get(`${API}/admin/providers`)
        .set(admin)
        .expect(200);
      const row = (
        list.body as {
          id: string;
          canVerify: boolean;
          dateOfBirth: string;
          placeOfOrigin: string;
        }[]
      ).find((p) => p.id === providerId)!;
      expect(row).toMatchObject({
        canVerify: true,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
      });

      const detail = await request(http)
        .get(`${API}/admin/providers/${providerId}`)
        .set(admin)
        .expect(200);
      expect(detail.body.provider).toMatchObject({
        phone: PHONE,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
      });

      const verified = await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'APPROVED' })
        .set(admin)
        .expect(201);
      expect(verified.body).toMatchObject({
        verificationStatus: 'APPROVED',
        phone: PHONE,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
      });
      expect(verified.body.account.status).toBe('ACTIVE');

      for (const body of [list.body, detail.body, verified.body]) {
        expectNoSecrets(body);
      }
    });

    it('sau APPROVED: đổi SĐT/Địa chỉ giữ APPROVED; đổi Ngày sinh hoặc Quê quán → PENDING', async () => {
      const { auth, providerId } = await createProvider();
      await putProvider(auth, {
        phone: PHONE,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        address: ADDRESS,
      }).expect(200);
      const admin = await adminAuth();
      await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'APPROVED' })
        .set(admin)
        .expect(201);

      const phoneChanged = await putProvider(auth, {
        phone: '0911222333',
        address: '99 Hai Bà Trưng',
      }).expect(200);
      expect(phoneChanged.body.verificationStatus).toBe('APPROVED');

      const dobChanged = await putProvider(auth, {
        dateOfBirth: '01/01/1990',
      }).expect(200);
      expect(dobChanged.body.verificationStatus).toBe('PENDING');
    });

    it('sau REJECTED: vườn cập nhật nộp lại hồ sơ → về PENDING và xoá verificationNote', async () => {
      const { auth, providerId } = await createProvider();
      const admin = await adminAuth();

      await request(http)
        .post(`${API}/admin/providers/${providerId}/verify`)
        .send({ decision: 'REJECTED', note: 'Thiếu thông tin quê quán' })
        .set(admin)
        .expect(201);

      const resubmitted = await putProvider(auth, {
        address: '99 Hai Bà Trưng',
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        phone: PHONE,
      }).expect(200);
      expect(resubmitted.body.verificationStatus).toBe('PENDING');
      expect(resubmitted.body.verificationNote).toBeNull();
    });
  });

  // Vườn ACCEPT → snapshot hợp đồng v3 (không chứa số CCCD hay ảnh) → GET đơn + hợp đồng đọc bản đóng băng.
  describe('hợp đồng (ACCEPT → snapshot → contract)', () => {
    const CUSTOMER_PHONE = '0911222333';
    const CUSTOMER_DOB = '15/05/1992';
    const CUSTOMER_ORIGIN = 'Quận 1, TP.HCM';

    const seedOrder = async (withIdentity: boolean) => {
      const { auth: providerAuth, providerId } = await createProvider();
      if (withIdentity) {
        await putProvider(providerAuth, {
          phone: PHONE,
          dateOfBirth: DOB,
          placeOfOrigin: ORIGIN,
          address: ADDRESS,
        }).expect(200);
      }
      await ctx.dataSource.query(
        `UPDATE provider_profiles SET verification_status = 'APPROVED' WHERE id = $1`,
        [providerId],
      );

      const customerAuth = await session('khach@example.com', 'CUSTOMER');
      await request(http)
        .put(`${API}/customers/me/profile`)
        .set(customerAuth)
        .send({
          phone: CUSTOMER_PHONE,
          dateOfBirth: CUSTOMER_DOB,
          placeOfOrigin: CUSTOMER_ORIGIN,
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

    it('vườn APPROVED chưa đủ SĐT/Địa chỉ/Ngày sinh/Quê quán: ACCEPT → 403 PROVIDER_IDENTITY_INCOMPLETE; REJECT vẫn được', async () => {
      const { providerAuth, orderId } = await seedOrder(false);
      const res = await respond(providerAuth, orderId, 'ACCEPT').expect(403);
      expect(res.body.message).toBe('PROVIDER_IDENTITY_INCOMPLETE');
      const [{ count }] = (await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM service_agreements',
      )) as { count: number }[];
      expect(count).toBe(0);

      await respond(providerAuth, orderId, 'REJECT').expect(200);
    });

    it('ACCEPT → DB snapshot không chứa SĐT dạng rõ; GET đơn + hợp đồng hiện đủ 5 trường hợp lệ 2 bên', async () => {
      const { providerAuth, orderId } = await seedOrder(true);
      await respond(providerAuth, orderId, 'ACCEPT').expect(200);

      const [{ terms }] = (await ctx.dataSource.query(
        'SELECT terms_snapshot::text AS terms FROM service_agreements',
      )) as { terms: string }[];
      for (const plain of [PHONE, CUSTOMER_PHONE, 'identityNumber', 'identityDocuments']) {
        expect(terms).not.toContain(plain);
      }

      const detail = await request(http)
        .get(`${API}/orders/${orderId}`)
        .set(providerAuth)
        .expect(200);
      const parties = detail.body.agreement.termsSnapshot.parties;
      expect(parties.provider).toEqual({
        fullName: 'Nguyễn Văn Lan',
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        address: ADDRESS,
        phone: PHONE,
      });
      expect(parties.customer).toEqual({
        fullName: 'Nguyễn Văn Lan',
        dateOfBirth: CUSTOMER_DOB,
        placeOfOrigin: CUSTOMER_ORIGIN,
        address: '25 Lê Lợi',
        phone: CUSTOMER_PHONE,
      });
      expect(JSON.stringify(parties)).not.toContain('Enc');

      const contract = await request(http)
        .get(`${API}/orders/${orderId}/agreement/contract`)
        .set(providerAuth)
        .expect(200);
      expect(contract.body.parties.provider).toMatchObject({
        phone: PHONE,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
      });
      expect(contract.body.parties.customer.dateOfBirth).toBe(CUSTOMER_DOB);
      expect(contract.body.parties.customer.placeOfOrigin).toBe(CUSTOMER_ORIGIN);
    });

    it('hợp đồng đóng băng: vườn đổi Ngày sinh/Quê quán SAU khi ACCEPT → hợp đồng vẫn in thông tin cũ', async () => {
      const { providerAuth, orderId } = await seedOrder(true);
      await respond(providerAuth, orderId, 'ACCEPT').expect(200);
      await putProvider(providerAuth, { placeOfOrigin: 'Hà Nội' }).expect(200);

      const contract = await request(http)
        .get(`${API}/orders/${orderId}/agreement/contract`)
        .set(providerAuth)
        .expect(200);
      expect(contract.body.parties.provider.placeOfOrigin).toBe(ORIGIN);
    });
  });
});
