import { createHash } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CryptoService } from '../src/crypto/crypto.service';
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

  // ============ Response không lộ dữ liệu nhạy cảm ============
  // Trước đây: @Exclude(passwordHash) vô tác dụng (không có ClassSerializerInterceptor) và các
  // service spread entity Account → GET /providers/:id (public) trả cả bcrypt hash, SĐT, STK...
  describe('Response không lộ passwordHash / PII', () => {
    // Field/giá trị không được xuất hiện ở response public hoặc của bên kia trong đơn.
    const SECRET_KEYS = ['passwordHash', 'password_hash', 'phoneHash', '$2b$'];
    const PRIVATE_PROFILE_KEYS = [
      'bankAccount',
      'bankName',
      'bankHolder',
      'cccdFrontUrl',
      'cccdBackUrl',
      'selfieUrl',
      'businessLicenseUrl',
      'licenseInfo',
      'verificationNote',
      '0909123456',
      'vuon@example.com',
    ];
    const expectAbsent = (body: unknown, keys: string[]) => {
      const json = JSON.stringify(body);
      for (const key of keys) {
        expect(json).not.toContain(key);
      }
    };

    const loginAs = async (email: string, role: 'CUSTOMER' | 'PROVIDER') => {
      await register({ email, role }).expect(201);
      const res = await login(email).expect(200);
      return res.body as { accessToken: string; account: { id: string } };
    };

    // Vườn APPROVED có đủ dữ liệu nhạy cảm (SĐT mã hoá, STK, ảnh CCCD, GPKD, ghi chú admin).
    const seedProvider = async () => {
      const session = await loginAs('vuon@example.com', 'PROVIDER');
      const crypto = ctx.app.get(CryptoService);
      await ctx.dataSource.query(
        'UPDATE accounts SET phone = $1, phone_hash = $2 WHERE id = $3',
        [crypto.encrypt('0909123456'), 'f'.repeat(64), session.account.id],
      );
      const [{ id }] = (await ctx.dataSource.query(
        `INSERT INTO provider_profiles
           (account_id, provider_type, display_name, verification_status, license_info,
            verification_note, bank_name, bank_account, bank_holder, cccd_front_url,
            cccd_back_url, selfie_url, business_license_url, specialties)
         VALUES ($1, 'NURSERY', 'Vườn Lan A', 'APPROVED', 'GPKD 0123', 'ghi chú nội bộ',
                 'VCB', '0123456789', 'NGUYEN VAN A', 'https://x/cccd-f.jpg',
                 'https://x/cccd-b.jpg', 'https://x/selfie.jpg', 'https://x/gpkd.jpg',
                 'Hồ Điệp')
         RETURNING id`,
        [session.account.id],
      )) as { id: string }[];
      return { ...session, providerId: id };
    };

    it('GET /providers/:id (public): chỉ field giới thiệu vườn, không account/ngân hàng/giấy tờ', async () => {
      const { providerId } = await seedProvider();
      const res = await request(http)
        .get(`${API}/providers/${providerId}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: providerId,
        displayName: 'Vườn Lan A',
        providerType: 'NURSERY',
        specialties: 'Hồ Điệp',
      });
      expect(res.body.account).toBeUndefined();
      expectAbsent(res.body, [...SECRET_KEYS, ...PRIVATE_PROFILE_KEYS]);
    });

    it('GET /providers/me: chủ hồ sơ thấy SĐT giải mã nhưng KHÔNG thấy passwordHash/phoneHash', async () => {
      const { accessToken } = await seedProvider();
      const res = await request(http)
        .get(`${API}/providers/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(res.body.account).toEqual({
        id: expect.any(String),
        email: 'vuon@example.com',
        fullName: 'Nguyễn Văn Lan',
        role: 'PROVIDER',
        status: 'PENDING',
        phone: '0909123456',
      });
      expectAbsent(res.body, SECRET_KEYS);
    });

    it('GET /orders: vườn chỉ thấy tên khách, khách chỉ thấy tên/địa chỉ vườn', async () => {
      const provider = await seedProvider();
      const customer = await loginAs('khach@example.com', 'CUSTOMER');
      const crypto = ctx.app.get(CryptoService);
      await ctx.dataSource.query(
        'UPDATE accounts SET phone = $1, phone_hash = $2 WHERE id = $3',
        [crypto.encrypt('0911222333'), 'e'.repeat(64), customer.account.id],
      );
      const [{ id: customerId }] = (await ctx.dataSource.query(
        'INSERT INTO customer_profiles (account_id) VALUES ($1) RETURNING id',
        [customer.account.id],
      )) as { id: string }[];
      const [{ id: packageId }] = (await ctx.dataSource.query(
        `INSERT INTO service_packages
           (provider_id, name, duration_days, report_frequency_days, max_plants, base_price,
            is_active, approval_status)
         VALUES ($1, 'Gói thường', 30, 7, 5, 200000, true, 'APPROVED') RETURNING id`,
        [provider.providerId],
      )) as { id: string }[];
      await ctx.dataSource.query(
        `INSERT INTO service_orders
           (order_code, customer_id, provider_id, service_package_id, status, plant_count,
            base_price_snapshot, pickup_fee_snapshot, duration_days_snapshot,
            report_frequency_snapshot, provisional_total, scheduled_pickup_at,
            pickup_gps_lat, pickup_gps_lng)
         VALUES ('LANCARE0000ABCD', $1, $2, $3, 'PENDING_PROVIDER', 1, 200000, 0, 30, 7,
                 200000, now() + interval '1 day', 10.77, 106.70)`,
        [customerId, provider.providerId, packageId],
      );

      const res = await request(http)
        .get(`${API}/orders`)
        .set('Authorization', `Bearer ${provider.accessToken}`)
        .expect(200);
      expect(res.body.total).toBe(1);
      const [order] = res.body.data;
      // Shape FE provider đang đọc: order.customer.account.fullName + servicePackage.name.
      expect(order.customer).toEqual({
        id: customerId,
        account: { fullName: 'Nguyễn Văn Lan' },
      });
      expect(order.servicePackage.name).toBe('Gói thường');
      expect(order.customerName).toBe('Nguyễn Văn Lan');
      expectAbsent(res.body, [
        ...SECRET_KEYS,
        'khach@example.com',
        'cccdNumber',
      ]);

      // Phía khách: chỉ thấy tên/địa chỉ vườn — không STK, giấy tờ, ghi chú admin của vườn.
      const mine = await request(http)
        .get(`${API}/orders`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .expect(200);
      const [own] = mine.body.data;
      // Mobile đọc provider.gardenName (OrdersScreen, OrderDetailScreen).
      expect(own.provider).toEqual({
        id: provider.providerId,
        displayName: 'Vườn Lan A',
        gardenName: 'Vườn Lan A',
        address: null,
      });
      expect(own.gardenName).toBe('Vườn Lan A');
      expectAbsent(mine.body, [...SECRET_KEYS, ...PRIVATE_PROFILE_KEYS]);
    });

    it('màn admin (khách + vườn + duyệt khách): account rút gọn, SĐT/CCCD giải mã, không lộ hash', async () => {
      const provider = await seedProvider();
      const customer = await loginAs('khach@example.com', 'CUSTOMER');
      await request(http)
        .put(`${API}/customers/me/profile`)
        .set('Authorization', `Bearer ${customer.accessToken}`)
        .send({ phone: '0911222333', cccdNumber: '001234567890' })
        .expect(200);

      // ADMIN không tự đăng ký được → tạo account thường rồi nâng quyền trong DB.
      await register({ email: 'admin@example.com' }).expect(201);
      await ctx.dataSource.query(
        `UPDATE accounts SET role = 'ADMIN', status = 'ACTIVE' WHERE email = 'admin@example.com'`,
      );
      const adminToken = (await login('admin@example.com').expect(200)).body
        .accessToken as string;
      const asAdmin = { Authorization: `Bearer ${adminToken}` };
      const ACCOUNT_KEYS = [
        'email',
        'fullName',
        'id',
        'phone',
        'role',
        'status',
      ];

      const customers = await request(http)
        .get(`${API}/customers/admin`)
        .set(asAdmin)
        .expect(200);
      const row = (
        customers.body as { id: string; account: { email: string } }[]
      ).find((c) => c.account.email === 'khach@example.com')!;
      expect(Object.keys(row.account).sort()).toEqual(ACCOUNT_KEYS);
      expect(row).toMatchObject({
        phone: '0911222333',
        cccdNumber: '001234567890',
      });

      const detail = await request(http)
        .get(`${API}/customers/admin/${row.id}`)
        .set(asAdmin)
        .expect(200);
      expect(detail.body.cccdNumber).toBe('001234567890');

      // Trước đây trả entity thô: cccdNumber còn mã hoá + cccdNumberHash + account entity.
      const verified = await request(http)
        .post(`${API}/customers/admin/${row.id}/verify`)
        .set(asAdmin)
        .send({ decision: 'REJECTED', note: 'Ảnh CCCD bị mờ' })
        .expect(201);
      expect(verified.body).toMatchObject({
        verificationStatus: 'REJECTED',
        verificationNote: 'Ảnh CCCD bị mờ',
        phone: '0911222333',
        cccdNumber: '001234567890',
      });
      expect(Object.keys(verified.body.account).sort()).toEqual(ACCOUNT_KEYS);

      const providers = await request(http)
        .get(`${API}/admin/providers`)
        .set(asAdmin)
        .expect(200);
      const vuon = (
        providers.body as { id: string; account: Record<string, unknown> }[]
      ).find((p) => p.id === provider.providerId)!;
      expect(Object.keys(vuon.account).sort()).toEqual(ACCOUNT_KEYS);
      expect(vuon.account.phone).toBe('0909123456');

      const vuonDetail = await request(http)
        .get(`${API}/admin/providers/${provider.providerId}`)
        .set(asAdmin)
        .expect(200);
      expect(Object.keys(vuonDetail.body.provider.account).sort()).toEqual(
        ACCOUNT_KEYS,
      );

      for (const res of [customers, detail, verified, providers, vuonDetail]) {
        expectAbsent(res.body, [
          ...SECRET_KEYS,
          'cccdNumberHash',
          'cccd_number_hash',
        ]);
      }
    });
  });

  // ============ Kích hoạt hồ sơ (account mới chỉ có ACCOUNT) ============
  describe('Kích hoạt hồ sơ customer / provider', () => {
    const session = async (email: string, role: 'CUSTOMER' | 'PROVIDER') => {
      await register({ email, role }).expect(201);
      const res = await login(email).expect(200);
      return res.body.accessToken as string;
    };
    const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
    const countRows = async (table: string) => {
      const [{ count }] = (await ctx.dataSource.query(
        `SELECT COUNT(*)::int AS count FROM ${table}`,
      )) as { count: number }[];
      return count;
    };
    const getCustomer = (token: string) =>
      request(http).get(`${API}/customers/me/profile`).set(auth(token));
    const putCustomer = (token: string, body: Record<string, unknown>) =>
      request(http)
        .put(`${API}/customers/me/profile`)
        .set(auth(token))
        .send(body);
    const putProvider = (token: string, body: Record<string, unknown>) =>
      request(http)
        .put(`${API}/providers/me/profile`)
        .set(auth(token))
        .send(body);

    describe('customer', () => {
      it('GET lần đầu → 200 hồ sơ rỗng PENDING (tự tạo), gọi lại không tạo thêm', async () => {
        const token = await session('khach@example.com', 'CUSTOMER');
        const res = await getCustomer(token).expect(200);
        expect(res.body).toMatchObject({
          accountId: expect.any(String),
          verificationStatus: 'PENDING',
          address: null,
          phone: null,
          cccdNumber: null,
        });
        expect(res.body).not.toHaveProperty('cccdNumberHash');
        await getCustomer(token).expect(200);
        expect(await countRows('customer_profiles')).toBe(1);
      });

      it('2 request đầu tiên song song → đúng 1 hồ sơ, cả 2 đều 200', async () => {
        const token = await session('khach@example.com', 'CUSTOMER');
        const [a, b] = await Promise.all([
          getCustomer(token),
          putCustomer(token, { address: '25 Lê Lợi' }),
        ]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(await countRows('customer_profiles')).toBe(1);
      });

      it('PUT CCCD rồi PUT địa chỉ → CCCD vẫn đọc được, DB không lưu CCCD dạng rõ', async () => {
        const token = await session('khach@example.com', 'CUSTOMER');
        await putCustomer(token, {
          cccdNumber: '001234567890',
          phone: '0909123456',
        }).expect(200);
        // Trước đây: lần PUT thứ 2 save bản đã giải mã → cột cccd_number thành "001234567890".
        const res = await putCustomer(token, { address: '25 Lê Lợi' }).expect(
          200,
        );
        expect(res.body).toMatchObject({
          address: '25 Lê Lợi',
          cccdNumber: '001234567890',
          phone: '0909123456',
        });
        const [row] = (await ctx.dataSource.query(
          'SELECT cccd_number FROM customer_profiles',
        )) as { cccd_number: string }[];
        expect(row.cccd_number).not.toBe('001234567890');
        expect(row.cccd_number).not.toMatch(/^\d{12}$/);
        await getCustomer(token).expect(200);
      });

      it('409 PHONE_EXISTS và KHÔNG đổi gì khác trong cùng request (transaction)', async () => {
        const a = await session('a@example.com', 'CUSTOMER');
        const b = await session('b@example.com', 'CUSTOMER');
        await putCustomer(a, { phone: '0909123456' }).expect(200);
        const res = await putCustomer(b, {
          phone: '+84909123456', // cùng số sau chuẩn hoá
          address: 'Địa chỉ mới',
        }).expect(409);
        expect(res.body.message).toBe('PHONE_EXISTS');
        const profile = await getCustomer(b).expect(200);
        expect(profile.body.address).toBeNull();
        expect(profile.body.phone).toBeNull();
      });

      it('409 CCCD_NUMBER_EXISTS khi CCCD đã thuộc khách khác', async () => {
        const a = await session('a@example.com', 'CUSTOMER');
        const b = await session('b@example.com', 'CUSTOMER');
        await putCustomer(a, { cccdNumber: '001234567890' }).expect(200);
        const res = await putCustomer(b, {
          cccdNumber: '001234567890',
        }).expect(409);
        expect(res.body.message).toBe('CCCD_NUMBER_EXISTS');
      });

      it('403 khi PROVIDER gọi API hồ sơ customer (không tạo hồ sơ customer cho provider)', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        await getCustomer(token).expect(403);
        expect(await countRows('customer_profiles')).toBe(0);
      });
    });

    describe('provider', () => {
      it('GET /providers/me trước khi tạo → 404 PROVIDER_PROFILE_NOT_FOUND', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        const res = await request(http)
          .get(`${API}/providers/me`)
          .set(auth(token))
          .expect(404);
        expect(res.body.message).toBe('PROVIDER_PROFILE_NOT_FOUND');
      });

      it('PUT lần đầu thiếu providerType/displayName → 400, không tạo hồ sơ', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        const res = await putProvider(token, { displayName: 'Vườn A' }).expect(
          400,
        );
        expect(res.body.message).toBe('PROVIDER_PROFILE_FIELDS_REQUIRED');
        await putProvider(token, { providerType: 'NURSERY' }).expect(400);
        expect(await countRows('provider_profiles')).toBe(0);
      });

      it('PUT lần đầu đủ field → tạo hồ sơ PENDING; PUT sau merge, giữ field cũ', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        const created = await putProvider(token, {
          providerType: 'NURSERY',
          displayName: 'Vườn Lan A',
          bankAccount: '0123456789',
        }).expect(200);
        expect(created.body).toMatchObject({
          providerType: 'NURSERY',
          displayName: 'Vườn Lan A',
          verificationStatus: 'PENDING',
          bankAccount: '0123456789',
        });

        const updated = await putProvider(token, {
          bio: 'Chuyên Hồ Điệp',
        }).expect(200);
        expect(updated.body).toMatchObject({
          id: created.body.id,
          displayName: 'Vườn Lan A',
          bio: 'Chuyên Hồ Điệp',
          bankAccount: '0123456789',
        });

        const me = await request(http)
          .get(`${API}/providers/me`)
          .set(auth(token))
          .expect(200);
        expect(me.body.id).toBe(created.body.id);
        expect(await countRows('provider_profiles')).toBe(1);
      });

      it('2 PUT tạo hồ sơ song song → đúng 1 hồ sơ, cả 2 đều 200', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        const body = { providerType: 'EXPERT', displayName: 'Chuyên gia B' };
        const [a, b] = await Promise.all([
          putProvider(token, body),
          putProvider(token, body),
        ]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(await countRows('provider_profiles')).toBe(1);
      });

      it('400 khi field vượt độ dài cột (vd bankAccount > 50) thay vì 500', async () => {
        const token = await session('vuon@example.com', 'PROVIDER');
        await putProvider(token, {
          providerType: 'NURSERY',
          displayName: 'Vườn A',
          bankAccount: '1'.repeat(51),
        }).expect(400);
      });

      it('403 khi CUSTOMER gọi PUT /providers/me/profile', async () => {
        const token = await session('khach@example.com', 'CUSTOMER');
        await putProvider(token, {
          providerType: 'NURSERY',
          displayName: 'Vườn A',
        }).expect(403);
        expect(await countRows('provider_profiles')).toBe(0);
      });
    });
  });

  // ============ Gia cố: rate limit, index, dọn token, header ============
  describe('Gia cố auth', () => {
    // DB lưu SHA-256 của refresh token (TokenService.hashToken).
    const hashOf = (token: string) =>
      createHash('sha256').update(token).digest('hex');

    it('rate limit: 1 email login sai quá 5 lần/phút → 429, kể cả lần đúng mật khẩu', async () => {
      await register().expect(201);
      // setup-e2e-env tắt rate limit cho cả suite; bật lại riêng test này.
      process.env.THROTTLE_DISABLED = 'false';
      try {
        for (let i = 0; i < 5; i++) {
          await login('lan@example.com', 'sai-mat-khau').expect(401);
        }
        await login('lan@example.com', 'sai-mat-khau').expect(429);
        await login().expect(429);
      } finally {
        process.env.THROTTLE_DISABLED = 'true';
      }
      // Tắt lại → không còn bị chặn (các test khác không bị ảnh hưởng).
      await login().expect(200);
    });

    it('rate limit đếm theo IP + email: email A bị 429 thì email B CÙNG IP vẫn đăng nhập được', async () => {
      // Email riêng cho test này — bộ đếm in-memory giữ 60 giây giữa các test.
      await register({ email: 'a.limit@example.com' }).expect(201);
      await register({ email: 'b.limit@example.com' }).expect(201);
      process.env.THROTTLE_DISABLED = 'false';
      try {
        for (let i = 0; i < 5; i++) {
          await login('a.limit@example.com', 'sai-mat-khau').expect(401);
        }
        await login('a.limit@example.com').expect(429);
        // Cả phòng chung Wi-Fi (cùng IP): người khác không bị vạ lây.
        const res = await login('b.limit@example.com').expect(200);
        expect(res.headers['x-ratelimit-limit-account']).toBe('5');
        // Email viết hoa/có khoảng trắng vẫn tính là cùng 1 email (không lách được).
        await login('  A.LIMIT@example.com ').expect(429);
      } finally {
        process.env.THROTTLE_DISABLED = 'true';
      }
    });

    it('refresh_tokens.token_hash có UNIQUE index (tra token không quét cả bảng)', async () => {
      const rows = (await ctx.dataSource.query(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'refresh_tokens'`,
      )) as { indexdef: string }[];
      expect(
        rows.some(
          (row) =>
            row.indexdef.includes('UNIQUE') &&
            row.indexdef.includes('token_hash'),
        ),
      ).toBe(true);
    });

    it('cấp token mới → xoá token ĐÃ HẾT HẠN của account; giữ token đã thu hồi còn hạn (để phát hiện reuse)', async () => {
      await register().expect(201);
      const expired = await login().expect(200);
      const revoked = await login().expect(200);
      await ctx.dataSource.query(
        `UPDATE refresh_tokens SET expires_at = now() - interval '1 day'
         WHERE token_hash = $1`,
        [hashOf(expired.body.refreshToken)],
      );
      await logout(revoked.body.accessToken, {
        refreshToken: revoked.body.refreshToken,
      }).expect(200);

      await login().expect(200);

      const hashes = (
        (await ctx.dataSource.query(
          'SELECT token_hash FROM refresh_tokens',
        )) as { token_hash: string }[]
      ).map((row) => row.token_hash);
      expect(hashes).not.toContain(hashOf(expired.body.refreshToken));
      expect(hashes).toContain(hashOf(revoked.body.refreshToken));
      // Token đã logout gửi lại vẫn bị coi là reuse như trước.
      await request(http)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: revoked.body.refreshToken })
        .expect(401);
    });

    it('helmet: có header bảo mật, ẩn X-Powered-By', async () => {
      const res = await login('khong-ton-tai@example.com').expect(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ============ Quên mật khẩu ============
  describe('POST /auth/forgot-password + /auth/reset-password', () => {
    const forgot = (email: string) =>
      request(http).post(`${API}/auth/forgot-password`).send({ email });
    const resetPassword = (token: string, newPassword = 'matkhaumoi456') =>
      request(http)
        .post(`${API}/auth/reset-password`)
        .send({ token, newPassword });
    const lastResetToken = () => {
      const mails = ctx.mailbox.resetMails;
      expect(mails.length).toBeGreaterThan(0);
      return mails[mails.length - 1].token;
    };
    const resetTokenRows = async () =>
      (await ctx.dataSource.query(
        'SELECT token_hash, used_at FROM password_reset_tokens',
      )) as { token_hash: string; used_at: Date | null }[];

    beforeEach(async () => {
      await register().expect(201);
    });

    it('email KHÔNG tồn tại → vẫn 200 { success: true }, không gửi mail, không tạo token (chống dò email)', async () => {
      const res = await forgot('khong-ai@example.com').expect(200);
      expect(res.body).toEqual({ success: true });
      expect(ctx.mailbox.resetMails).toHaveLength(0);
      expect(await resetTokenRows()).toHaveLength(0);
    });

    it('email tồn tại (khác hoa/thường) → 200 cùng body, gửi 1 mail; DB chỉ lưu hash của token', async () => {
      const res = await forgot('  LAN@example.com ').expect(200);
      expect(res.body).toEqual({ success: true });
      expect(ctx.mailbox.resetMails).toHaveLength(1);
      expect(ctx.mailbox.resetMails[0]).toMatchObject({
        to: 'lan@example.com',
        fullName: 'Nguyễn Văn Lan',
      });
      const token = lastResetToken();
      const rows = await resetTokenRows();
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).not.toBe(token);
      expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reset → 204; mật khẩu mới đăng nhập được, cũ thì không; MỌI phiên cũ bị thu hồi', async () => {
      const oldSession = await login().expect(200);
      await forgot('lan@example.com').expect(200);

      await resetPassword(lastResetToken()).expect(204);

      await login('lan@example.com', 'matkhau123').expect(401);
      await login('lan@example.com', 'matkhaumoi456').expect(200);
      await request(http)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: oldSession.body.refreshToken })
        .expect(401);
    });

    it('token chỉ dùng 1 lần → lần 2: 400 RESET_TOKEN_INVALID', async () => {
      await forgot('lan@example.com').expect(200);
      const token = lastResetToken();
      await resetPassword(token).expect(204);
      const res = await resetPassword(token, 'matkhaukhac789').expect(400);
      expect(res.body.message).toBe('RESET_TOKEN_INVALID');
      await login('lan@example.com', 'matkhaumoi456').expect(200);
    });

    it('2 request reset song song cùng token → đúng 1 thành công', async () => {
      await forgot('lan@example.com').expect(200);
      const token = lastResetToken();
      const results = await Promise.all([
        resetPassword(token, 'matkhauA1111'),
        resetPassword(token, 'matkhauB2222'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 400]);
    });

    it('token hết hạn → 400, mật khẩu không đổi', async () => {
      await forgot('lan@example.com').expect(200);
      await ctx.dataSource.query(
        `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'`,
      );
      await resetPassword(lastResetToken()).expect(400);
      await login().expect(200);
    });

    it('yêu cầu lần 2 → link lần 1 vô hiệu, chỉ link mới nhất dùng được', async () => {
      await forgot('lan@example.com').expect(200);
      const first = lastResetToken();
      await forgot('lan@example.com').expect(200);
      const second = lastResetToken();
      expect(second).not.toBe(first);
      await resetPassword(first).expect(400);
      await resetPassword(second).expect(204);
    });

    it('token rác → 400 RESET_TOKEN_INVALID', async () => {
      const res = await resetPassword('token-rac').expect(400);
      expect(res.body.message).toBe('RESET_TOKEN_INVALID');
    });

    it('account SUSPENDED: forgot không gửi mail; token có sẵn cũng không dùng được', async () => {
      await forgot('lan@example.com').expect(200);
      const token = lastResetToken();
      await setStatus('lan@example.com', 'SUSPENDED');

      await forgot('lan@example.com').expect(200);
      expect(ctx.mailbox.resetMails).toHaveLength(1);
      await resetPassword(token).expect(400);

      await setStatus('lan@example.com', 'ACTIVE');
      await login().expect(200); // mật khẩu cũ giữ nguyên
    });

    it('5 yêu cầu forgot song song → chỉ còn 1 token, đúng 1 link dùng được', async () => {
      const N = 5;
      await Promise.all(
        Array.from({ length: N }, () => forgot('lan@example.com').expect(200)),
      );
      expect(ctx.mailbox.resetMails).toHaveLength(N);
      expect(await resetTokenRows()).toHaveLength(1);
      const statuses: number[] = [];
      for (const { token } of ctx.mailbox.resetMails) {
        statuses.push((await resetPassword(token)).status);
      }
      expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    });

    it('đổi mật khẩu → link quên mật khẩu đang còn hạn bị huỷ', async () => {
      const session = await login().expect(200);
      await forgot('lan@example.com').expect(200);
      const token = lastResetToken();
      await changePassword(
        session.body.accessToken,
        'matkhau123',
        'matkhaudoi789',
      ).expect(204);
      expect(await resetTokenRows()).toHaveLength(0);
      await resetPassword(token).expect(400);
      await login('lan@example.com', 'matkhaudoi789').expect(200);
    });

    // Trước đây reset khoá link rồi tài khoản — ngược với forgot/đổi mật khẩu (tài khoản rồi
    // link) → 2 bên chờ nhau vòng tròn (deadlock 40P01), Postgres huỷ 1 bên → 500. Giờ mọi chỗ
    // khoá tài khoản trước.
    // Reset băm bcrypt (~60ms) TRƯỚC khi vào transaction và khe deadlock chỉ ~1–3ms → gửi
    // request thứ 2 trễ 40–99ms (nhích 1ms mỗi vòng) để 2 transaction thật sự chồng lên nhau.
    // Đã kiểm: thứ tự khoá cũ (token → account) cho 6/120 request 500; thứ tự mới: 0.
    it('reset chạy cùng lúc với forgot / đổi mật khẩu → không request nào 500 (không deadlock)', async () => {
      const ROUNDS = 60;
      const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));
      const later = <T>(ms: number, run: () => PromiseLike<T>) =>
        sleep(ms).then(run);
      const statuses: number[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        const delay = 40 + i;
        const email = `race${i}@example.com`;
        await register({ email }).expect(201);
        const session = await login(email).expect(200);

        await forgot(email).expect(200);
        const raceForgot = await Promise.all([
          resetPassword(lastResetToken(), 'matkhauReset1'),
          later(delay, () => forgot(email)),
        ]);

        // Vòng 1 có thể reset thắng (mật khẩu đổi) hoặc forgot xoá token trước (reset 400) —
        // dùng đúng mật khẩu hiện tại để đổi mật khẩu thật sự vào transaction mà đua.
        const current =
          raceForgot[0].status === 204 ? 'matkhauReset1' : 'matkhau123';
        await forgot(email).expect(200);
        const raceChange = await Promise.all([
          resetPassword(lastResetToken(), 'matkhauReset2'),
          later(delay, () =>
            changePassword(session.body.accessToken, current, 'matkhauDoi333'),
          ),
        ]);
        statuses.push(...[...raceForgot, ...raceChange].map((r) => r.status));
      }
      expect(statuses.filter((status) => status >= 500)).toEqual([]);
      // 60 vòng × (~6 lần bcrypt + 2 khoảng chờ) vượt testTimeout chung 30s trên máy chậm.
    }, 120_000);

    it('SMTP lỗi → vẫn 200 (mail là phụ)', async () => {
      ctx.mailbox.failing = true;
      await forgot('lan@example.com').expect(200);
    });

    it('400 khi email sai định dạng / mật khẩu mới < 8 hoặc > 64 / thiếu token', async () => {
      await forgot('khong-phai-email').expect(400);
      await forgot('lan@example.com').expect(200);
      const token = lastResetToken();
      await resetPassword(token, 'ngan').expect(400);
      await resetPassword(token, 'x'.repeat(65)).expect(400);
      await request(http)
        .post(`${API}/auth/reset-password`)
        .send({ newPassword: 'matkhaumoi456' })
        .expect(400);
      // Các lần 400 do validate KHÔNG đốt token.
      await resetPassword(token).expect(204);
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
