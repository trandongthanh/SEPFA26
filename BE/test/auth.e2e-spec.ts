import request from 'supertest';
import type { App } from 'supertest/types';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';

const API = '/api/v1';

describe('Auth (e2e)', () => {
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

  const registerBody = (overrides: Record<string, unknown> = {}) => ({
    email: 'lan@example.com',
    password: 'matkhau123',
    fullName: 'Nguyễn Văn Lan',
    role: 'CUSTOMER',
    ...overrides,
  });

  const register = (overrides: Record<string, unknown> = {}) =>
    request(http).post(`${API}/auth/register`).send(registerBody(overrides));

  // ===================== POST /auth/register =====================
  describe('POST /auth/register', () => {
    it('201: tạo account base PENDING, không trả token, không tạo profile', async () => {
      const res = await register().expect(201);

      expect(res.body).toEqual({
        accountId: expect.any(String),
        email: 'lan@example.com',
        role: 'CUSTOMER',
        status: 'PENDING',
      });
      expect(res.body).not.toHaveProperty('accessToken');

      const [row] = await ctx.dataSource.query(
        'SELECT email, full_name, role, status, phone, password_hash FROM accounts',
      );
      expect(row).toMatchObject({
        email: 'lan@example.com',
        full_name: 'Nguyễn Văn Lan',
        role: 'CUSTOMER',
        status: 'PENDING',
        phone: null,
      });
      // Lưu bcrypt hash, không lưu mật khẩu thô.
      expect(row.password_hash).toMatch(/^\$2[aby]\$/);
      expect(row.password_hash).not.toContain('matkhau123');

      const [{ count: customers }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM customer_profiles',
      );
      const [{ count: providers }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM provider_profiles',
      );
      expect(customers).toBe(0);
      expect(providers).toBe(0);
    });

    it('201: PROVIDER chỉ cần email/mật khẩu/tên/role (không GPS, không SĐT)', async () => {
      const res = await register({ role: 'PROVIDER' }).expect(201);
      expect(res.body.role).toBe('PROVIDER');
    });

    it('chuẩn hoá email về chữ thường + trim', async () => {
      const res = await register({ email: '  Lan@Example.COM ' }).expect(201);
      expect(res.body.email).toBe('lan@example.com');
    });

    it('409 EMAIL_EXISTS khi trùng email (khác hoa/thường vẫn là trùng)', async () => {
      await register().expect(201);
      const res = await register({ email: 'LAN@example.com' }).expect(409);
      expect(res.body.message).toBe('EMAIL_EXISTS');
    });

    it('409 (không 500) khi 2 request cùng email chạy song song', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => register()),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409]);
      const [{ count }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM accounts',
      );
      expect(count).toBe(1);
    });

    it('400 khi role = ADMIN (không tự đăng ký admin)', async () => {
      await register({ role: 'ADMIN' }).expect(400);
    });

    it.each([
      ['email sai định dạng', { email: 'not-an-email' }],
      ['mật khẩu < 8 ký tự', { password: 'short' }],
      ['mật khẩu > 64 ký tự', { password: 'a'.repeat(65) }],
      ['tên < 2 ký tự', { fullName: ' A ' }],
      ['thiếu role', { role: undefined }],
    ])('400 khi %s', async (_case, overrides) => {
      await register(overrides).expect(400);
    });

    it('400 khi gửi field lạ (vd status, isAdmin) — whitelist', async () => {
      await register({ status: 'ACTIVE' }).expect(400);
      await register({ isAdmin: true }).expect(400);
    });

    it('tương thích form cũ: gửi kèm phone/providerType/address/GPS → 201, bị BỎ QUA không lưu', async () => {
      // Đúng payload form đăng ký nhà vườn cũ của Mobile.
      await register({
        role: 'PROVIDER',
        phone: '0909123456',
        providerType: 'NURSERY',
        address: '123 Đường Số 1',
        gpsLat: 10.77,
        gpsLng: 106.7,
      }).expect(201);
      // Giá trị rác cũng không bị validate (bỏ qua hoàn toàn).
      await register({ email: 'b@example.com', phone: 12345 }).expect(201);

      const rows = await ctx.dataSource.query(
        'SELECT phone, phone_hash FROM accounts',
      );
      expect(rows).toEqual([
        { phone: null, phone_hash: null },
        { phone: null, phone_hash: null },
      ]);
      const [{ count }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM provider_profiles',
      );
      expect(count).toBe(0);
    });
  });

  const login = (email = 'lan@example.com', password = 'matkhau123') =>
    request(http).post(`${API}/auth/login`).send({ email, password });

  const setStatus = (email: string, status: string) =>
    ctx.dataSource.query('UPDATE accounts SET status = $1 WHERE email = $2', [
      status,
      email,
    ]);

  // ===================== POST /auth/login =====================
  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await register().expect(201);
    });

    it('200: trả access + refresh + account, lưu hash refresh token vào DB', async () => {
      const res = await login().set('User-Agent', 'e2e-agent/1.0').expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        account: {
          id: expect.any(String),
          email: 'lan@example.com',
          fullName: 'Nguyễn Văn Lan',
          role: 'CUSTOMER',
          status: 'PENDING',
        },
      });

      const rows = await ctx.dataSource.query(
        'SELECT token_hash, user_agent, revoked_at, expires_at FROM refresh_tokens',
      );
      expect(rows).toHaveLength(1);
      // Lưu SHA-256 (64 hex), không lưu token thô.
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].token_hash).not.toBe(res.body.refreshToken);
      expect(rows[0].user_agent).toBe('e2e-agent/1.0');
      expect(rows[0].revoked_at).toBeNull();
      expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('PENDING vẫn đăng nhập được (để đi nộp hồ sơ kích hoạt)', async () => {
      const res = await login().expect(200);
      expect(res.body.account.status).toBe('PENDING');
    });

    it('email khác hoa/thường vẫn đăng nhập được', async () => {
      await login('  LAN@Example.com ').expect(200);
    });

    it('401 INVALID_CREDENTIALS khi sai mật khẩu', async () => {
      const res = await login('lan@example.com', 'sai-mat-khau').expect(401);
      expect(res.body.message).toBe('INVALID_CREDENTIALS');
    });

    it('401 INVALID_CREDENTIALS (cùng mã) khi email không tồn tại — chống dò email', async () => {
      const res = await login('khongco@example.com').expect(401);
      expect(res.body.message).toBe('INVALID_CREDENTIALS');
    });

    it('403 ACCOUNT_SUSPENDED khi tài khoản bị khoá, không cấp token', async () => {
      await setStatus('lan@example.com', 'SUSPENDED');
      const res = await login().expect(403);
      expect(res.body.message).toBe('ACCOUNT_SUSPENDED');
      const [{ count }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM refresh_tokens',
      );
      expect(count).toBe(0);
    });

    it('mỗi lần login là 1 phiên riêng (2 thiết bị → 2 refresh token khác nhau)', async () => {
      const a = await login().expect(200);
      const b = await login().expect(200);
      expect(a.body.refreshToken).not.toBe(b.body.refreshToken);
      const [{ count }] = await ctx.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM refresh_tokens',
      );
      expect(count).toBe(2);
    });

    it('400 khi thiếu mật khẩu / email sai định dạng', async () => {
      await request(http)
        .post(`${API}/auth/login`)
        .send({ email: 'lan@example.com' })
        .expect(400);
      await login('not-an-email').expect(400);
    });
  });

  // Đăng ký + đăng nhập, trả cặp token.
  const registerAndLogin = async (overrides: Record<string, unknown> = {}) => {
    const body = registerBody(overrides);
    await register(overrides).expect(201);
    const res = await login(
      body.email as string,
      body.password as string,
    ).expect(200);
    return res.body as { accessToken: string; refreshToken: string };
  };

  const me = (accessToken: string) =>
    request(http)
      .get(`${API}/accounts/me`)
      .set('Authorization', `Bearer ${accessToken}`);

  // ============ JWT guard + GET /accounts/me ============
  describe('JWT guard + GET /accounts/me', () => {
    it('200: trả thông tin account, không lộ password_hash', async () => {
      const { accessToken } = await registerAndLogin();
      const res = await me(accessToken).expect(200);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: 'lan@example.com',
        fullName: 'Nguyễn Văn Lan',
        phone: null,
        role: 'CUSTOMER',
        status: 'PENDING',
      });
    });

    it('401 khi không gửi token / token rác', async () => {
      await request(http).get(`${API}/accounts/me`).expect(401);
      await me('rac.rac.rac').expect(401);
    });

    it('401 khi đem REFRESH token dùng như access token', async () => {
      const { refreshToken } = await registerAndLogin();
      await me(refreshToken).expect(401);
    });

    it('401 ngay khi tài khoản bị khoá — không chờ access token hết hạn', async () => {
      const { accessToken } = await registerAndLogin();
      await me(accessToken).expect(200);
      await setStatus('lan@example.com', 'SUSPENDED');
      await me(accessToken).expect(401);
    });

    it('401 khi account đã bị xoá', async () => {
      const { accessToken } = await registerAndLogin();
      await ctx.dataSource.query('DELETE FROM accounts');
      await me(accessToken).expect(401);
    });

    it('route @Public không cần token (register/login vẫn gọi được)', async () => {
      await register().expect(201);
    });
  });

  const changePassword = (
    accessToken: string,
    currentPassword: string,
    newPassword: string,
  ) =>
    request(http)
      .patch(`${API}/accounts/me/password`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword, newPassword });

  // ============ PATCH /accounts/me/password ============
  describe('PATCH /accounts/me/password', () => {
    it('204: đổi xong thì mật khẩu mới đăng nhập được, mật khẩu cũ thì không', async () => {
      const { accessToken } = await registerAndLogin();
      await changePassword(accessToken, 'matkhau123', 'matkhaumoi456').expect(
        204,
      );
      await login('lan@example.com', 'matkhaumoi456').expect(200);
      await login('lan@example.com', 'matkhau123').expect(401);
    });

    it('đổi mật khẩu → MỌI phiên bị thu hồi (kẻ giữ refresh token cũ bị đẩy ra)', async () => {
      const me1 = await registerAndLogin();
      const attacker = await login().expect(200); // thiết bị khác đang đăng nhập

      await changePassword(
        me1.accessToken,
        'matkhau123',
        'matkhaumoi456',
      ).expect(204);

      expect(await liveTokenCount()).toBe(0);
      await refresh(attacker.body.refreshToken).expect(401);
      await refresh(me1.refreshToken).expect(401);
      // Đăng nhập lại bằng mật khẩu mới thì có phiên mới bình thường.
      const again = await login('lan@example.com', 'matkhaumoi456').expect(200);
      await refresh(again.body.refreshToken).expect(200);
    });

    it('sai mật khẩu hiện tại → KHÔNG thu hồi phiên nào', async () => {
      const s = await registerAndLogin();
      await changePassword(s.accessToken, 'sai-roi', 'matkhaumoi456').expect(
        400,
      );
      expect(await liveTokenCount()).toBe(1);
      await refresh(s.refreshToken).expect(200);
    });

    it('400 CURRENT_PASSWORD_INCORRECT khi sai mật khẩu hiện tại, mật khẩu không đổi', async () => {
      const { accessToken } = await registerAndLogin();
      const res = await changePassword(
        accessToken,
        'sai-roi',
        'matkhaumoi456',
      ).expect(400);
      expect(res.body.message).toBe('CURRENT_PASSWORD_INCORRECT');
      await login('lan@example.com', 'matkhau123').expect(200);
    });

    it('400 khi mật khẩu mới < 8 hoặc > 64 ký tự', async () => {
      const { accessToken } = await registerAndLogin();
      await changePassword(accessToken, 'matkhau123', 'short').expect(400);
      await changePassword(accessToken, 'matkhau123', 'a'.repeat(65)).expect(
        400,
      );
    });

    it('401 khi không đăng nhập', async () => {
      await request(http)
        .patch(`${API}/accounts/me/password`)
        .send({ currentPassword: 'matkhau123', newPassword: 'matkhaumoi456' })
        .expect(401);
    });
  });

  const refresh = (refreshToken: string) =>
    request(http).post(`${API}/auth/refresh`).send({ refreshToken });

  const liveTokenCount = async () => {
    const [{ count }] = await ctx.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE revoked_at IS NULL',
    );
    return count as number;
  };

  // ===================== POST /auth/refresh =====================
  describe('POST /auth/refresh', () => {
    it('200: cấp cặp mới, token cũ bị thu hồi (rotation), access mới dùng được', async () => {
      const first = await registerAndLogin();
      const res = await refresh(first.refreshToken).expect(200);

      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      expect(res.body.account.email).toBe('lan@example.com');
      await me(res.body.accessToken).expect(200);
      expect(await liveTokenCount()).toBe(1);
    });

    it('chuỗi refresh liên tiếp đều chạy (A → B → C)', async () => {
      const a = await registerAndLogin();
      const b = await refresh(a.refreshToken).expect(200);
      const c = await refresh(b.body.refreshToken).expect(200);
      await me(c.body.accessToken).expect(200);
    });

    it('401 REFRESH_TOKEN_REUSED khi dùng lại token cũ → MỌI phiên bị thu hồi (và lưu thật vào DB)', async () => {
      const a = await registerAndLogin();
      const otherDevice = await login().expect(200);
      const b = await refresh(a.refreshToken).expect(200);

      const res = await refresh(a.refreshToken).expect(401);
      expect(res.body.message).toBe('REFRESH_TOKEN_REUSED');

      expect(await liveTokenCount()).toBe(0);
      await refresh(b.body.refreshToken).expect(401);
      await refresh(otherDevice.body.refreshToken).expect(401);
    });

    it('2 request refresh song song cùng 1 token: đúng 1 thành công, phần còn lại 401 và mọi phiên bị thu hồi', async () => {
      const a = await registerAndLogin();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => refresh(a.refreshToken)),
      );
      const ok = results.filter((r) => r.status === 200);
      const rejected = results.filter((r) => r.status === 401);
      expect(ok).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      // Bug cũ: thu hồi nằm trong transaction rồi throw → rollback → phiên vẫn sống.
      expect(await liveTokenCount()).toBe(0);
      await refresh(ok[0].body.refreshToken).expect(401);
    });

    it('401 INVALID_REFRESH_TOKEN khi token rác / ký bằng secret khác', async () => {
      const res = await refresh('rac.rac.rac').expect(401);
      expect(res.body.message).toBe('INVALID_REFRESH_TOKEN');
    });

    it('401 khi đem ACCESS token đi refresh', async () => {
      const { accessToken } = await registerAndLogin();
      const res = await refresh(accessToken).expect(401);
      expect(res.body.message).toBe('INVALID_REFRESH_TOKEN');
    });

    it('401 khi token hợp lệ về chữ ký nhưng không có trong DB', async () => {
      const { refreshToken } = await registerAndLogin();
      await ctx.dataSource.query('DELETE FROM refresh_tokens');
      await refresh(refreshToken).expect(401);
    });

    it('401 khi tài khoản đã bị khoá', async () => {
      const { refreshToken } = await registerAndLogin();
      await setStatus('lan@example.com', 'SUSPENDED');
      await refresh(refreshToken).expect(401);
    });

    it('400 khi thiếu refreshToken', async () => {
      await request(http).post(`${API}/auth/refresh`).send({}).expect(400);
    });
  });

  const logout = (accessToken: string, body: Record<string, unknown> = {}) =>
    request(http)
      .post(`${API}/auth/logout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);

  // ===================== POST /auth/logout =====================
  describe('POST /auth/logout', () => {
    it('có refreshToken: chỉ thu hồi thiết bị đó, thiết bị khác vẫn refresh được', async () => {
      const phone = await registerAndLogin();
      const laptop = await login().expect(200);

      await logout(phone.accessToken, { refreshToken: phone.refreshToken })
        .expect(200)
        .expect({ success: true });

      // Laptop vẫn sống sau khi điện thoại logout.
      await refresh(laptop.body.refreshToken).expect(200);
      // Token điện thoại đã chết. (Gửi lại token đã thu hồi bị coi là lộ token → thu hồi mọi
      // phiên, nên bước này đặt SAU cùng — xem test "gửi lại token đã logout" bên dưới.)
      await refresh(phone.refreshToken).expect(401);
    });

    it('gửi lại refresh token ĐÃ LOGOUT → coi như bị lộ, thu hồi mọi phiên', async () => {
      const phone = await registerAndLogin();
      const laptop = await login().expect(200);
      await logout(phone.accessToken, {
        refreshToken: phone.refreshToken,
      }).expect(200);

      const res = await refresh(phone.refreshToken).expect(401);
      expect(res.body.message).toBe('REFRESH_TOKEN_REUSED');
      await refresh(laptop.body.refreshToken).expect(401);
    });

    it('bỏ trống refreshToken: thu hồi mọi thiết bị', async () => {
      const phone = await registerAndLogin();
      const laptop = await login().expect(200);

      await logout(phone.accessToken).expect(200);

      expect(await liveTokenCount()).toBe(0);
      await refresh(laptop.body.refreshToken).expect(401);
    });

    it('idempotent: logout lại cùng token vẫn 200', async () => {
      const s = await registerAndLogin();
      await logout(s.accessToken, { refreshToken: s.refreshToken }).expect(200);
      await logout(s.accessToken, { refreshToken: s.refreshToken }).expect(200);
    });

    it('không thu hồi được refresh token của NGƯỜI KHÁC dù biết chuỗi token', async () => {
      const victim = await registerAndLogin();
      const attacker = await registerAndLogin({
        email: 'attacker@example.com',
      });

      await logout(attacker.accessToken, {
        refreshToken: victim.refreshToken,
      }).expect(200);

      await refresh(victim.refreshToken).expect(200);
    });

    it('401 khi không có access token', async () => {
      await request(http).post(`${API}/auth/logout`).send({}).expect(401);
    });
  });

  const google = (idToken: string, role?: string) =>
    request(http)
      .post(`${API}/auth/google`)
      .send(role ? { idToken, role } : { idToken });

  const accountCount = async () => {
    const [{ count }] = await ctx.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM accounts',
    );
    return count as number;
  };

  // ===================== POST /auth/google =====================
  describe('POST /auth/google', () => {
    const TOKEN = 'google:hoa@gmail.com:Trần Thị Hoa';

    it('lần đầu, không gửi role → 404 GOOGLE_ACCOUNT_NOT_REGISTERED kèm email/tên, KHÔNG tạo account', async () => {
      const res = await google(TOKEN).expect(404);
      expect(res.body).toMatchObject({
        message: 'GOOGLE_ACCOUNT_NOT_REGISTERED',
        email: 'hoa@gmail.com',
        fullName: 'Trần Thị Hoa',
      });
      expect(await accountCount()).toBe(0);
      expect(ctx.mailbox.sent).toHaveLength(0);
    });

    it('lần đầu + role → tạo account PENDING, trả token, gửi mail mật khẩu', async () => {
      const res = await google(TOKEN, 'PROVIDER').expect(200);

      expect(res.body.isNewAccount).toBe(true);
      expect(res.body.account).toMatchObject({
        email: 'hoa@gmail.com',
        fullName: 'Trần Thị Hoa',
        role: 'PROVIDER',
        status: 'PENDING',
      });
      await me(res.body.accessToken).expect(200);

      expect(ctx.mailbox.sent).toHaveLength(1);
      const mail = ctx.mailbox.sent[0];
      expect(mail.to).toBe('hoa@gmail.com');
      expect(mail.password).toMatch(/^[A-Za-z0-9_-]{12}$/);
    });

    it('gửi lại cùng idToken kèm role sau khi nhận 404 (luồng trang đăng nhập) → tạo được', async () => {
      await google(TOKEN).expect(404);
      const res = await google(TOKEN, 'CUSTOMER').expect(200);
      expect(res.body.isNewAccount).toBe(true);
    });

    it('mật khẩu trong mail đăng nhập thường được; đổi mật khẩu bằng nó được', async () => {
      await google(TOKEN, 'CUSTOMER').expect(200);
      const { password } = ctx.mailbox.sent[0];

      const res = await login('hoa@gmail.com', password).expect(200);
      await changePassword(
        res.body.accessToken,
        password,
        'matkhaucuahoa',
      ).expect(204);
      await login('hoa@gmail.com', 'matkhaucuahoa').expect(200);
      // Đổi mật khẩu xong vẫn đăng nhập Google bình thường.
      await google(TOKEN).expect(200);
    });

    it('lần sau: đăng nhập luôn, isNewAccount=false, không gửi mail nữa, role gửi kèm bị bỏ qua', async () => {
      await google(TOKEN, 'CUSTOMER').expect(200);
      const res = await google(TOKEN, 'PROVIDER').expect(200);

      expect(res.body.isNewAccount).toBe(false);
      expect(res.body.account.role).toBe('CUSTOMER');
      expect(ctx.mailbox.sent).toHaveLength(1);
      expect(await accountCount()).toBe(1);
    });

    it('email đã đăng ký thường → Google đăng nhập vào CHÍNH account đó (không tạo mới, mật khẩu cũ giữ nguyên)', async () => {
      await register({ email: 'hoa@gmail.com' }).expect(201);
      const res = await google(TOKEN).expect(200);

      expect(res.body.isNewAccount).toBe(false);
      expect(res.body.account.fullName).toBe('Nguyễn Văn Lan');
      expect(await accountCount()).toBe(1);
      expect(ctx.mailbox.sent).toHaveLength(0);
      await login('hoa@gmail.com', 'matkhau123').expect(200);
    });

    it('email Google khác hoa/thường vẫn khớp account', async () => {
      await register({ email: 'hoa@gmail.com' }).expect(201);
      const res = await google('google:HOA@Gmail.com:Hoa').expect(200);
      expect(res.body.isNewAccount).toBe(false);
    });

    it('bấm Google 2 lần song song (chưa có account) → đúng 1 account, cả 2 request đều đăng nhập được', async () => {
      const results = await Promise.all(
        Array.from({ length: 3 }, () => google(TOKEN, 'CUSTOMER')),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.body.isNewAccount)).toHaveLength(1);
      expect(await accountCount()).toBe(1);
      expect(ctx.mailbox.sent).toHaveLength(1);
    });

    it('SMTP lỗi → vẫn tạo account + đăng nhập được (mail là phụ)', async () => {
      ctx.mailbox.failing = true;
      const res = await google(TOKEN, 'CUSTOMER').expect(200);
      expect(res.body.isNewAccount).toBe(true);
      await me(res.body.accessToken).expect(200);
    });

    it('403 ACCOUNT_SUSPENDED khi account bị khoá', async () => {
      await google(TOKEN, 'CUSTOMER').expect(200);
      await setStatus('hoa@gmail.com', 'SUSPENDED');
      const res = await google(TOKEN).expect(403);
      expect(res.body.message).toBe('ACCOUNT_SUSPENDED');
    });

    it('401 INVALID_GOOGLE_TOKEN khi token sai', async () => {
      const res = await google('token-gia', 'CUSTOMER').expect(401);
      expect(res.body.message).toBe('INVALID_GOOGLE_TOKEN');
      expect(await accountCount()).toBe(0);
    });

    it('401 GOOGLE_EMAIL_NOT_VERIFIED khi email Google chưa xác minh', async () => {
      const res = await google(
        'google-unverified:x@gmail.com',
        'CUSTOMER',
      ).expect(401);
      expect(res.body.message).toBe('GOOGLE_EMAIL_NOT_VERIFIED');
    });

    it('400 khi role = ADMIN / thiếu idToken', async () => {
      await google(TOKEN, 'ADMIN').expect(400);
      await request(http).post(`${API}/auth/google`).send({}).expect(400);
    });

    it('refresh/logout với phiên Google chạy như phiên thường', async () => {
      const g = await google(TOKEN, 'CUSTOMER').expect(200);
      const r = await refresh(g.body.refreshToken).expect(200);
      await logout(r.body.accessToken).expect(200);
      await refresh(r.body.refreshToken).expect(401);
    });
  });

  // ===================== Tổng thể =====================
  describe('Luồng đầu cuối', () => {
    it('đăng ký → đăng nhập → me → refresh → đổi mật khẩu → logout → đăng nhập lại', async () => {
      await register().expect(201);
      const s1 = await login().expect(200);
      await me(s1.body.accessToken).expect(200);

      const s2 = await refresh(s1.body.refreshToken).expect(200);
      await changePassword(
        s2.body.accessToken,
        'matkhau123',
        'matkhaumoi456',
      ).expect(204);
      await logout(s2.body.accessToken).expect(200);
      expect(await liveTokenCount()).toBe(0);

      await login('lan@example.com', 'matkhau123').expect(401);
      const s3 = await login('lan@example.com', 'matkhaumoi456').expect(200);
      await me(s3.body.accessToken).expect(200);
    });
  });
});
