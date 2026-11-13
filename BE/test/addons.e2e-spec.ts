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

type Auth = { Authorization: string };

/**
 * Add-on (việc phát sinh lúc đang chăm) trên Postgres thật: đề xuất → khách trả lời → QR + webhook →
 * vườn báo xong → trả cây → chia tiền. Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000 (khách đã trả 484.000);
 * add-on "Thay giá thể" 100.000 → khách chuyển 106.000 → vườn nhận 500.000, nền tảng 90.000, sổ về 0.
 */
describe('Add-on: đề xuất, trả tiền, báo xong, chia tiền (e2e)', () => {
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

  const detail = async (orderId: string, auth: Auth) =>
    (await request(http).get(`${API}/orders/${orderId}`).set(auth).expect(200))
      .body as Record<string, any>;

  const listAddons = async (orderId: string, auth: Auth) =>
    (
      await request(http)
        .get(`${API}/orders/${orderId}/addons`)
        .set(auth)
        .expect(200)
    ).body as Record<string, any>[];

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  // Đi hết luồng nhận cây bằng API thật → đơn IN_CARE (khách đã trả 484.000).
  const toInCare = async ({ rejectFirst = false } = {}): Promise<Ctx> => {
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
    await seed.paySecurityDeposit(id);
    return { customer, provider, order };
  };

  const addonBody = (overrides: object = {}) => ({
    title: 'Thay giá thể',
    reason: 'Giá thể đã mục, rễ bắt đầu úng',
    price: '100000',
    photoUrls: ['https://example.com/re-ung.jpg'],
    ...overrides,
  });

  const propose = async (c: Ctx, overrides: object = {}) =>
    (
      await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody(overrides),
      ).expect(201)
    ).body as Record<string, any>;

  const respond = (c: Ctx, addonId: string, decision: string, auth?: Auth) =>
    post(
      `${c.order.orderId}/addons/${addonId}/respond`,
      auth ?? c.customer.auth,
      { decision },
    );

  const complete = (c: Ctx, addonId: string, auth?: Auth) =>
    post(
      `${c.order.orderId}/addons/${addonId}/complete`,
      auth ?? c.provider.auth,
      { photoUrls: ['https://example.com/da-thay.jpg'], note: 'Đã thay dớn' },
    );

  // Đề xuất → khách đồng ý → tiền về đủ → PAID.
  const paidAddon = async (c: Ctx, overrides: object = {}) => {
    const addon = await propose(c, overrides);
    const accepted = (await respond(c, addon.id, 'ACCEPT').expect(200))
      .body as Record<string, any>;
    await seed.webhook(addon.addonCode, accepted.amountDue).expect(200);
    return addon;
  };

  const makeCareDue = (orderId: string) =>
    sql(
      `UPDATE service_orders
         SET care_started_at = care_started_at - interval '40 days',
             care_due_at = now() - interval '1 hour'
       WHERE id = $1`,
      [orderId],
    );

  // Trả cây trọn vẹn: tới hạn → bắt đầu → kiểm từng cây → chốt → khách xác nhận → COMPLETED.
  const returnAndComplete = async (c: Ctx) => {
    const id = c.order.orderId;
    await makeCareDue(id);
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);
  };

  // Sổ ĐƠN (book ORDER) — tiền bảo đảm của vườn nằm ở sổ riêng, không cộng lẫn vào đây.
  const ledgerOf = (orderId: string) =>
    sql(
      `SELECT entry_type, amount FROM escrow_ledger WHERE service_order_id = $1 AND book = 'ORDER'
        ORDER BY created_at, CASE entry_type WHEN 'PLATFORM_FEE' THEN 1 WHEN 'PAYOUT' THEN 2 ELSE 0 END`,
      [orderId],
    );

  const balanceOf = async (orderId: string) =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
          WHERE service_order_id = $1 AND book = 'ORDER'`,
        [orderId],
      )
    )[0].sum as string;

  describe('vườn đề xuất', () => {
    it('đơn IN_CARE → 201 PENDING, hạn trả lời 48 giờ, có mã ADDON riêng, hiện sẵn số khách sẽ phải trả', async () => {
      const c = await toInCare();
      const before = Date.now();
      const addon = await propose(c, { plantId: c.order.plantIds[0] });

      expect(addon.status).toBe('PENDING');
      expect(addon.addonCode).toMatch(/^ADDON[0-9A-F]{8}$/);
      expect(addon.price).toBe('100000');
      expect(addon.customerFee).toBe('6000');
      expect(addon.amountDue).toBe('106000');
      expect(addon.plant).toEqual({ id: c.order.plantIds[0], name: 'Lan 1' });
      const dueInHours =
        (new Date(addon.respondDueAt).getTime() - before) / 3_600_000;
      expect(dueInHours).toBeGreaterThan(47.9);
      expect(dueInHours).toBeLessThan(48.1);

      // Cả khách lẫn vườn đều thấy; chi tiết đơn báo có 1 đề xuất đang mở.
      expect(await listAddons(c.order.orderId, c.customer.auth)).toHaveLength(
        1,
      );
      expect(await listAddons(c.order.orderId, c.provider.auth)).toHaveLength(
        1,
      );
      expect(
        (await detail(c.order.orderId, c.customer.auth)).openAddonCount,
      ).toBe(1);
    });

    it('cây của đơn khác hoặc cây bị từ chối lúc nhận → 400 PLANT_NOT_IN_ORDER', async () => {
      const c = await toInCare({ rejectFirst: true });
      const other = await toInCare();

      const foreign = await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ plantId: other.order.plantIds[0] }),
      ).expect(400);
      expect(foreign.body.message).toBe('PLANT_NOT_IN_ORDER');

      const rejected = await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ plantId: c.order.plantIds[0] }),
      ).expect(400);
      expect(rejected.body.message).toBe('PLANT_NOT_IN_ORDER');
    });

    it('đơn chưa IN_CARE → 409; vườn khác → 404; khách gọi → 403; giá ngoài khoảng / thiếu ảnh → 400', async () => {
      const customer = await seed.customer();
      const provider = await seed.provider();
      const draft = await seed.draftOrder(customer, provider);
      const notInCare = await post(
        `${draft.orderId}/addons`,
        provider.auth,
        addonBody(),
      ).expect(409);
      expect(notInCare.body.message).toBe('INVALID_STATE_TRANSITION');

      const c = await toInCare();
      const stranger = await seed.provider();
      const notMine = await post(
        `${c.order.orderId}/addons`,
        stranger.auth,
        addonBody(),
      ).expect(404);
      expect(notMine.body.message).toBe('ORDER_NOT_FOUND');

      await post(
        `${c.order.orderId}/addons`,
        c.customer.auth,
        addonBody(),
      ).expect(403);

      const tooCheap = await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ price: '999' }),
      ).expect(400);
      expect(tooCheap.body.message).toBe('ADDON_PRICE_OUT_OF_RANGE');
      await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ price: '50000001' }),
      ).expect(400);
      await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ photoUrls: [] }),
      ).expect(400);
      await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody({ photoUrls: ['http://example.com/khong-https.jpg'] }),
      ).expect(400);
    });

    it('tối đa 3 đề xuất đang mở; khách từ chối 1 cái thì tạo tiếp được', async () => {
      const c = await toInCare();
      const first = await propose(c);
      await propose(c);
      await propose(c);
      const fourth = await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody(),
      ).expect(409);
      expect(fourth.body.message).toBe('ADDON_LIMIT_REACHED');

      await respond(c, first.id, 'REJECT').expect(200);
      await propose(c);
    });
  });

  describe('khách trả lời', () => {
    it('đồng ý → ACCEPTED, chốt phí 6%, hạn trả tiền 24 giờ', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      const before = Date.now();
      const res = await respond(c, addon.id, 'ACCEPT').expect(200);

      expect(res.body.status).toBe('ACCEPTED');
      expect(res.body.customerFee).toBe('6000');
      expect(res.body.amountDue).toBe('106000');
      const dueInHours =
        (new Date(res.body.paymentDueAt).getTime() - before) / 3_600_000;
      expect(dueInHours).toBeGreaterThan(23.9);
      expect(dueInHours).toBeLessThan(24.1);
      const [row] = await sql(
        `SELECT customer_fee FROM addon_proposals WHERE id = $1`,
        [addon.id],
      );
      expect(row.customer_fee).toBe('6000');
    });

    it('từ chối → REJECTED kèm ghi chú, vẫn nằm trong danh sách; trả lời lại → 409 ADDON_INVALID_STATE', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      const rejected = await post(
        `${c.order.orderId}/addons/${addon.id}/respond`,
        c.customer.auth,
        { decision: 'REJECT', note: 'Tôi tự thay sau' },
      ).expect(200);
      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.customerNote).toBe('Tôi tự thay sau');

      const again = await respond(c, addon.id, 'ACCEPT').expect(409);
      expect(again.body.message).toBe('ADDON_INVALID_STATE');

      // Bằng chứng vườn đã cảnh báo: đề xuất bị từ chối không biến mất.
      const list = await listAddons(c.order.orderId, c.provider.auth);
      expect(list.map((item) => item.status)).toEqual(['REJECTED']);
      expect(
        (await detail(c.order.orderId, c.customer.auth)).openAddonCount,
      ).toBe(0);
    });

    it('quá 48 giờ → 409 ADDON_EXPIRED, đề xuất thành EXPIRED / NO_RESPONSE (không ai đồng ý thay khách)', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await sql(
        `UPDATE addon_proposals SET respond_due_at = now() - interval '1 minute' WHERE id = $1`,
        [addon.id],
      );
      // Chi tiết đơn không còn tính đề xuất quá hạn là "đang mở", dù DB chưa kịp ghi EXPIRED.
      expect(
        (await detail(c.order.orderId, c.customer.auth)).openAddonCount,
      ).toBe(0);

      const late = await respond(c, addon.id, 'ACCEPT').expect(409);
      expect(late.body.message).toBe('ADDON_EXPIRED');
      const [row] = await sql(
        `SELECT status, expired_reason FROM addon_proposals WHERE id = $1`,
        [addon.id],
      );
      expect(row).toEqual({ status: 'EXPIRED', expired_reason: 'NO_RESPONSE' });
    });

    it('xem danh sách cũng tự đóng đề xuất quá hạn', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await sql(
        `UPDATE addon_proposals SET respond_due_at = now() - interval '1 minute' WHERE id = $1`,
        [addon.id],
      );
      const [item] = await listAddons(c.order.orderId, c.customer.auth);
      expect(item.status).toBe('EXPIRED');
      expect(item.expiredReason).toBe('NO_RESPONSE');
    });

    it('sai người: vườn trả lời → 403; khách báo xong → 403; khách khác → 404; mã add-on lạ → 404', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'ACCEPT', c.provider.auth).expect(403);
      await complete(c, addon.id, c.customer.auth).expect(403);

      const stranger = await seed.customer();
      const notMine = await respond(
        c,
        addon.id,
        'ACCEPT',
        stranger.auth,
      ).expect(404);
      expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
      await request(http)
        .get(`${API}/orders/${c.order.orderId}/addons`)
        .set(stranger.auth)
        .expect(404);

      const unknown = await respond(
        c,
        '3f2c1d7e-5b0a-4c7e-9d2f-1a2b3c4d5e6f',
        'ACCEPT',
      ).expect(404);
      expect(unknown.body.message).toBe('ADDON_NOT_FOUND');
    });
  });

  describe('khách trả tiền add-on', () => {
    const qr = (c: Ctx, addonId: string) =>
      post(`${c.order.orderId}/addons/${addonId}/payment/qr`, c.customer.auth);

    it('QR: chưa đồng ý → 409; đã đồng ý → số tiền 106.000, nội dung CK là mã add-on', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      const early = await qr(c, addon.id).expect(409);
      expect(early.body.message).toBe('ADDON_INVALID_STATE');

      await respond(c, addon.id, 'ACCEPT').expect(200);
      const res = await qr(c, addon.id).expect(200);
      expect(res.body.amount).toBe('106000');
      expect(res.body.transferContent).toBe(addon.addonCode);
      expect(res.body.qrImageUrl).toContain(`addInfo=${addon.addonCode}`);
      expect(res.body.qrImageUrl).toContain('amount=106000');
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'amount',
          'bankAccountName',
          'bankAccountNumber',
          'bankBin',
          'qrImageUrl',
          'transferContent',
        ].sort(),
      );
    });

    it('tiền về đủ → đề xuất PAID, sổ +106.000, sinh dòng hoá đơn ADD_ON, đơn vẫn IN_CARE', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'ACCEPT').expect(200);
      const res = await seed.webhook(addon.addonCode, '106000').expect(200);
      expect(res.body).toMatchObject({
        success: true,
        addonCode: addon.addonCode,
        status: 'PAID',
      });

      const [item] = await listAddons(c.order.orderId, c.customer.auth);
      expect(item.status).toBe('PAID');
      expect(item.paidAt).not.toBeNull();
      expect(await balanceOf(c.order.orderId)).toBe('590000');
      const components = await sql(
        `SELECT component_type, amount, customer_fee, status, addon_id FROM payment_components
          WHERE service_order_id = $1 AND component_type = 'ADD_ON'`,
        [c.order.orderId],
      );
      expect(components).toEqual([
        {
          component_type: 'ADD_ON',
          amount: '100000',
          customer_fee: '6000',
          status: 'PAID',
          addon_id: addon.id,
        },
      ]);
      const order = await detail(c.order.orderId, c.customer.auth);
      expect(order.status).toBe('IN_CARE');
      expect(order.settlement).toMatchObject({
        packageAmount: '400000',
        addonAmount: '100000',
        customerFee: '30000',
        pickupFee: '60000',
        customerTotal: '590000',
      });
      // QR không phát lại cho add-on đã trả.
      const again = await qr(c, addon.id).expect(409);
      expect(again.body.message).toBe('ADDON_INVALID_STATE');
    });

    it('chuyển thiếu → đề xuất đứng yên, tiền vẫn có dấu vết PENDING; SePay gửi lại cùng giao dịch → không ghi 2 lần', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'ACCEPT').expect(200);

      const short = await seed.webhook(addon.addonCode, '100000').expect(200);
      expect(short.body.ignored).toBe('INSUFFICIENT_AMOUNT');
      expect(await balanceOf(c.order.orderId)).toBe('484000');
      const pending = await sql(
        `SELECT amount, status FROM transactions
          WHERE service_order_id = $1 AND status = 'PENDING'`,
        [c.order.orderId],
      );
      expect(pending).toEqual([{ amount: '100000', status: 'PENDING' }]);
      expect(
        (await listAddons(c.order.orderId, c.customer.auth))[0].status,
      ).toBe('ACCEPTED');

      const txnId = Date.now() + 500_000;
      await seed.webhook(addon.addonCode, '106000', txnId).expect(200);
      const dup = await seed
        .webhook(addon.addonCode, '106000', txnId)
        .expect(200);
      expect(dup.body.duplicated).toBe(true);
      expect(await balanceOf(c.order.orderId)).toBe('590000');
    });

    it('tiền về sau hạn 24 giờ → đề xuất EXPIRED / NOT_PAID, sổ không đổi, tiền ghi PENDING chờ admin hoàn', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'ACCEPT').expect(200);
      await sql(
        `UPDATE addon_proposals SET payment_due_at = now() - interval '1 minute' WHERE id = $1`,
        [addon.id],
      );

      const late = await seed.webhook(addon.addonCode, '106000').expect(200);
      expect(late.body.ignored).toBe('ADDON_NOT_PAYABLE');
      const [row] = await sql(
        `SELECT status, expired_reason FROM addon_proposals WHERE id = $1`,
        [addon.id],
      );
      expect(row).toEqual({ status: 'EXPIRED', expired_reason: 'NOT_PAID' });
      expect(await balanceOf(c.order.orderId)).toBe('484000');
      const pending = await sql(
        `SELECT amount FROM transactions WHERE service_order_id = $1 AND status = 'PENDING'`,
        [c.order.orderId],
      );
      expect(pending).toEqual([{ amount: '106000' }]);

      const noQr = await qr(c, addon.id).expect(409);
      expect(noQr.body.message).toBe('ADDON_EXPIRED');
    });

    it('chuyển tiền cho đề xuất chưa được đồng ý, hoặc mã add-on không tồn tại → không ghi sổ', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      const notAccepted = await seed
        .webhook(addon.addonCode, '106000')
        .expect(200);
      expect(notAccepted.body.ignored).toBe('ADDON_NOT_PAYABLE');

      const unknown = await seed.webhook('ADDON00000000', '106000').expect(200);
      expect(unknown.body.ignored).toBe('ADDON_NOT_MATCHED');
      expect(await balanceOf(c.order.orderId)).toBe('484000');
    });
  });

  describe('vườn báo xong và trả cây', () => {
    it('chưa trả tiền mà báo xong → 409; đã trả → DONE kèm ảnh; báo lần 2 → 409', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'ACCEPT').expect(200);
      const early = await complete(c, addon.id).expect(409);
      expect(early.body.message).toBe('ADDON_INVALID_STATE');

      await seed.webhook(addon.addonCode, '106000').expect(200);
      const done = await complete(c, addon.id).expect(200);
      expect(done.body.status).toBe('DONE');
      expect(done.body.donePhotoUrls).toEqual([
        'https://example.com/da-thay.jpg',
      ]);
      expect(done.body.doneNote).toBe('Đã thay dớn');
      expect(done.body.doneAt).not.toBeNull();

      const again = await complete(c, addon.id).expect(409);
      expect(again.body.message).toBe('ADDON_INVALID_STATE');
    });

    it('còn add-on đã trả tiền mà chưa báo xong → trả cây bị chặn ADDON_OPEN, đơn vẫn IN_CARE; báo xong thì trả được', async () => {
      const c = await toInCare();
      const addon = await paidAddon(c);
      await makeCareDue(c.order.orderId);

      const blocked = await post(
        `${c.order.orderId}/return/start`,
        c.provider.auth,
      ).expect(409);
      expect(blocked.body.message).toBe('ADDON_OPEN');
      expect((await detail(c.order.orderId, c.provider.auth)).status).toBe(
        'IN_CARE',
      );

      await complete(c, addon.id).expect(200);
      await post(`${c.order.orderId}/return/start`, c.provider.auth).expect(
        200,
      );
    });

    it('bắt đầu trả cây thì đề xuất còn chờ trả lời / chờ trả tiền bị đóng (ORDER_RETURNING); tiền về sau đó không ghi sổ', async () => {
      const c = await toInCare();
      const waiting = await propose(c);
      const accepted = await propose(c, { title: 'Trị nấm' });
      await respond(c, accepted.id, 'ACCEPT').expect(200);
      await makeCareDue(c.order.orderId);
      await post(`${c.order.orderId}/return/start`, c.provider.auth).expect(
        200,
      );

      const rows = await sql(
        `SELECT status, expired_reason FROM addon_proposals WHERE id = ANY($1::uuid[])`,
        [[waiting.id, accepted.id]],
      );
      expect(rows).toEqual([
        { status: 'EXPIRED', expired_reason: 'ORDER_RETURNING' },
        { status: 'EXPIRED', expired_reason: 'ORDER_RETURNING' },
      ]);
      const late = await seed.webhook(accepted.addonCode, '106000').expect(200);
      expect(late.body.ignored).toBe('ADDON_NOT_PAYABLE');
      expect(await balanceOf(c.order.orderId)).toBe('484000');

      // Đơn đã rời IN_CARE → không đề xuất thêm được.
      await post(
        `${c.order.orderId}/addons`,
        c.provider.auth,
        addonBody(),
      ).expect(409);
    });
  });

  describe('chia tiền khi đơn hoàn tất', () => {
    it('đơn mẫu + 1 add-on 100.000 đã làm: sổ 590.000 → phí nền tảng 90.000, vườn 500.000, sổ về 0', async () => {
      const c = await toInCare();
      const addon = await paidAddon(c);
      await complete(c, addon.id).expect(200);
      await returnAndComplete(c);

      expect(await ledgerOf(c.order.orderId)).toEqual([
        { entry_type: 'DEPOSIT', amount: '484000' },
        { entry_type: 'DEPOSIT', amount: '106000' },
        { entry_type: 'PLATFORM_FEE', amount: '-90000' },
        { entry_type: 'PAYOUT', amount: '-500000' },
      ]);
      expect(await balanceOf(c.order.orderId)).toBe('0');
      const disbursements = await sql(
        `SELECT type, amount, status FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
        [c.order.orderId],
      );
      // Add-on không đổi tiền bảo đảm: vườn nhận lại đủ 800.000 (2 cây không khai giá × 400.000).
      expect(disbursements).toEqual([
        { type: 'PAYOUT', amount: '500000', status: 'PENDING' },
        { type: 'SECURITY_RETURN', amount: '800000', status: 'PENDING' },
      ]);
      const components = await sql(
        `SELECT component_type, provider_fee, status FROM payment_components
          WHERE service_order_id = $1 ORDER BY component_type`,
        [c.order.orderId],
      );
      expect(components).toEqual([
        { component_type: 'ADD_ON', provider_fee: '12000', status: 'RELEASED' },
        {
          component_type: 'PACKAGE_PRICE',
          provider_fee: '48000',
          status: 'RELEASED',
        },
        { component_type: 'PICKUP_FEE', provider_fee: '0', status: 'RELEASED' },
      ]);

      // Khách: thấy tổng đã trả gồm add-on, KHÔNG thấy phần của vườn.
      const customerView = (await detail(c.order.orderId, c.customer.auth))
        .settlement as Record<string, unknown>;
      expect(customerView).toEqual({
        packageAmount: '400000',
        customerFee: '30000',
        pickupFee: '60000',
        addonAmount: '100000',
        customerTotal: '590000',
        refundAmount: '0',
        compensationAmount: '0',
      });
      // Vườn: giá dịch vụ đã làm 500.000, bị trừ 12% = 60.000, nhận 500.000 (gồm phí lấy cây 60.000).
      const providerView = (await detail(c.order.orderId, c.provider.auth))
        .settlement as Record<string, any>;
      expect(providerView).toMatchObject({
        addonAmount: '100000',
        serviceAmount: '500000',
        providerFee: '60000',
        providerReceives: '500000',
      });
      expect(providerView.payout.status).toBe('PENDING');
    });

    it('2 add-on giá lẻ: phí cộng theo từng dòng nên sổ vẫn về đúng 0', async () => {
      const c = await toInCare();
      // 6% của 33.333 = 1.999,98 → 2.000; 6% của 1.008 = 60,48 → 60.
      const first = await paidAddon(c, { price: '33333' });
      const second = await paidAddon(c, { price: '1008', title: 'Bón phân' });
      await complete(c, first.id).expect(200);
      await complete(c, second.id).expect(200);
      await returnAndComplete(c);

      expect(await balanceOf(c.order.orderId)).toBe('0');
      const ledger = await ledgerOf(c.order.orderId);
      const total = (type: string) =>
        ledger
          .filter((entry) => entry.entry_type === type)
          .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      // Tiền vào = 484.000 + (33.333 + 2.000) + (1.008 + 60).
      expect(total('DEPOSIT')).toBe(520_401n);
      // Nền tảng: 72.000 + (2.000 + 4.000) + (60 + 121); vườn: 412.000 + 29.333 + 887.
      expect(total('PLATFORM_FEE')).toBe(-78_181n);
      expect(total('PAYOUT')).toBe(-442_220n);
    });

    it('đề xuất bị từ chối không ảnh hưởng tiền: đơn chia đúng như đơn không add-on', async () => {
      const c = await toInCare();
      const addon = await propose(c);
      await respond(c, addon.id, 'REJECT').expect(200);
      await returnAndComplete(c);

      expect(await ledgerOf(c.order.orderId)).toEqual([
        { entry_type: 'DEPOSIT', amount: '484000' },
        { entry_type: 'PLATFORM_FEE', amount: '-72000' },
        { entry_type: 'PAYOUT', amount: '-412000' },
      ]);
      const settlement = (await detail(c.order.orderId, c.customer.auth))
        .settlement as Record<string, unknown>;
      expect(settlement.addonAmount).toBe('0');
      expect(settlement.customerTotal).toBe('484000');
    });
  });
});
