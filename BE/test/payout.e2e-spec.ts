import { randomUUID } from 'node:crypto';
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
 * CP4 — khối tiền `settlement` trong chi tiết đơn + route admin trả tiền vườn, trên Postgres thật.
 * Sổ ký quỹ / webhook thiếu tiền đã kiểm ở order-flow + order-return, ở đây không lặp lại.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 → khách 484.000, vườn nhận 412.000.
 */
describe('Payout: settlement trong chi tiết đơn + admin trả tiền vườn (e2e)', () => {
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

  const listDisbursements = (auth: Auth, query = '') =>
    request(http).get(`${API}/admin/disbursements${query}`).set(auth);

  const markPaid = (id: string, auth: Auth, body: object) =>
    request(http)
      .post(`${API}/admin/disbursements/${id}/mark-paid`)
      .set(auth)
      .send(body);

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  const newOrder = async (): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    return { customer, provider, order };
  };

  // DRAFT → đủ 2 chữ ký (AWAITING_PAYMENT, hoá đơn đã sinh).
  const sign = async (c: Ctx) => {
    const id = c.order.orderId;
    await post(`${id}/submit`, c.customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, c.provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, c.customer.auth).expect(200);
    await post(`${id}/agreement/sign`, c.provider.auth).expect(200);
  };

  // Đã ký → trả tiền → nhận cây → chăm → trả cây → khách xác nhận → COMPLETED.
  const payToCompleted = async (c: Ctx, { rejectFirst = false } = {}) => {
    const id = c.order.orderId;
    await seed.webhook(c.order.orderCode, c.order.amountDue).expect(200);
    await post(`${id}/handover/start`, c.provider.auth).expect(201);
    for (const [i, plantId] of c.order.plantIds.entries()) {
      await post(`${id}/handover/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: rejectFirst && i === 0 ? 'REJECT' : 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, c.provider.auth).expect(200);
    await post(`${id}/handover/confirm`, c.customer.auth).expect(200);
    await ctx.dataSource.query(
      `UPDATE service_orders
         SET care_started_at = care_started_at - interval '40 days',
             care_due_at = now() - interval '1 hour'
       WHERE id = $1`,
      [id],
    );
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of c.order.plantIds.slice(rejectFirst ? 1 : 0)) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);
  };

  const toCompleted = async (opts: { rejectFirst?: boolean } = {}) => {
    const c = await newOrder();
    await sign(c);
    await payToCompleted(c, opts);
    return c;
  };

  const setBank = (providerProfileId: string) =>
    ctx.dataSource.query(
      `UPDATE provider_profiles
          SET bank_name = 'MBBank', bank_account = '0123456789', bank_holder = 'VUON LAN'
        WHERE id = $1`,
      [providerProfileId],
    );

  // Giả lập đã qua 3 ngày chờ khiếu nại.
  const makeEligible = (orderId: string) =>
    ctx.dataSource.query(
      `UPDATE disbursements SET eligible_at = now() - interval '1 minute'
        WHERE service_order_id = $1`,
      [orderId],
    );

  const BANK = {
    bankName: 'MBBank',
    bankAccount: '0123456789',
    bankHolder: 'VUON LAN',
  };

  it('settlement: chưa ký → null; đã ký → khách thấy 484.000; COMPLETED → vườn thấy phần mình, khách không thấy', async () => {
    const c = await newOrder();
    const id = c.order.orderId;
    expect((await detail(id, c.customer.auth)).settlement).toBeNull();

    await sign(c);
    const customerPart = {
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      customerTotal: '484000',
      refundAmount: '0',
    };
    // Trước COMPLETED: khách và vườn cùng thấy đúng phần hoá đơn, chưa có phần chia tiền.
    expect((await detail(id, c.customer.auth)).settlement).toEqual(
      customerPart,
    );
    expect((await detail(id, c.provider.auth)).settlement).toEqual(
      customerPart,
    );

    await payToCompleted(c);
    const forProvider = (await detail(id, c.provider.auth)).settlement;
    expect(forProvider).toMatchObject({
      ...customerPart,
      serviceAmount: '400000',
      providerFee: '48000',
      providerReceives: '412000',
      payout: { status: 'PENDING', paidAt: null },
    });
    // Được chi sau đúng 3 ngày kể từ lúc khách xác nhận nhận lại cây.
    const [{ confirmed_at }] = (await ctx.dataSource.query(
      `SELECT confirmed_at FROM handovers
        WHERE service_order_id = $1 AND handover_type = 'OUT' AND status = 'CONFIRMED'`,
      [id],
    )) as { confirmed_at: Date }[];
    expect(
      new Date(forProvider.payout.eligibleAt).getTime() -
        new Date(confirmed_at).getTime(),
    ).toBe(3 * 24 * 60 * 60 * 1000);
    // Khách không thấy vườn bị trừ bao nhiêu / nhận bao nhiêu.
    expect((await detail(id, c.customer.auth)).settlement).toEqual(
      customerPart,
    );
  });

  it('settlement: vườn từ chối 1 cây → khách thấy đã hoàn 200.000; vườn nhận 236.000', async () => {
    const c = await toCompleted({ rejectFirst: true });
    const id = c.order.orderId;

    expect((await detail(id, c.customer.auth)).settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      customerTotal: '484000',
      refundAmount: '200000',
    });
    expect((await detail(id, c.provider.auth)).settlement).toMatchObject({
      refundAmount: '200000',
      serviceAmount: '200000',
      providerFee: '24000',
      providerReceives: '236000',
      payout: { status: 'PENDING' },
    });
  });

  it('admin: danh sách → bấm sớm 409 → tới hạn 200 PAID → bấm lại 409; lọc theo trạng thái', async () => {
    const c = await newOrder();
    const id = c.order.orderId;
    await sign(c);
    await setBank(c.provider.profileId); // khai trước COMPLETED → lệnh chi chụp sẵn tài khoản
    await payToCompleted(c);
    const admin = await seed.admin();

    const pending = await listDisbursements(
      admin.auth,
      '?status=PENDING',
    ).expect(200);
    expect(pending.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    const row = pending.body.data[0] as Record<string, any>;
    expect(row).toMatchObject({
      orderId: id,
      orderCode: c.order.orderCode,
      providerId: c.provider.profileId,
      providerName: 'Vườn Lan',
      type: 'PAYOUT',
      amount: '412000',
      isEligible: false,
      status: 'PENDING',
      bank: BANK,
      transferCode: null,
      paidAt: null,
    });

    const early = await markPaid(row.id, admin.auth, {
      transferCode: 'FT001',
    }).expect(409);
    expect(early.body.message).toBe('DISBURSEMENT_NOT_ELIGIBLE');

    await makeEligible(id);
    const eligible = await listDisbursements(admin.auth).expect(200);
    expect(eligible.body.data[0].isEligible).toBe(true);

    const paid = await markPaid(row.id, admin.auth, {
      transferCode: '  FT001  ',
      note: 'Chuyển qua MBBank',
    }).expect(200);
    expect(paid.body).toMatchObject({
      id: row.id,
      status: 'PAID',
      transferCode: 'FT001',
      note: 'Chuyển qua MBBank',
      bank: BANK,
    });
    expect(paid.body.paidAt).toEqual(expect.any(String));
    const [saved] = (await ctx.dataSource.query(
      `SELECT paid_by_account_id FROM disbursements WHERE id = $1`,
      [row.id],
    )) as { paid_by_account_id: string }[];
    expect(saved.paid_by_account_id).toBe(admin.accountId);

    const again = await markPaid(row.id, admin.auth, {
      transferCode: 'FT002',
    }).expect(409);
    expect(again.body.message).toBe('DISBURSEMENT_ALREADY_PAID');

    expect(
      (await listDisbursements(admin.auth, '?status=PENDING').expect(200)).body
        .total,
    ).toBe(0);
    const paidList = await listDisbursements(admin.auth, '?status=PAID').expect(
      200,
    );
    expect(paidList.body.data).toEqual([
      expect.objectContaining({ id: row.id, transferCode: 'FT001' }),
    ]);

    // Vườn mở chi tiết đơn thấy đã được chuyển tiền.
    const payout = (await detail(id, c.provider.auth)).settlement.payout;
    expect(payout.status).toBe('PAID');
    expect(payout.paidAt).toEqual(expect.any(String));
  });

  it('admin: khách/vườn gọi → 403; id lạ → 404; thiếu mã giao dịch → 400', async () => {
    const c = await toCompleted();
    const admin = await seed.admin();
    const [{ id: disbursementId }] = (await ctx.dataSource.query(
      `SELECT id FROM disbursements WHERE service_order_id = $1`,
      [c.order.orderId],
    )) as { id: string }[];

    for (const auth of [c.customer.auth, c.provider.auth]) {
      await listDisbursements(auth).expect(403);
      await markPaid(disbursementId, auth, { transferCode: 'FT001' }).expect(
        403,
      );
    }

    const missing = await markPaid(randomUUID(), admin.auth, {
      transferCode: 'FT001',
    }).expect(404);
    expect(missing.body.message).toBe('DISBURSEMENT_NOT_FOUND');
    await markPaid(disbursementId, admin.auth, {}).expect(400);
    await markPaid(disbursementId, admin.auth, { transferCode: '   ' }).expect(
      400,
    );
    await listDisbursements(admin.auth, '?status=LA').expect(400);
    await listDisbursements(admin.auth, '?limit=51').expect(400);
    await listDisbursements(admin.auth, '?page=0').expect(400);
    await markPaid('khong-phai-uuid', admin.auth, {
      transferCode: 'FT001',
    }).expect(400);
    await markPaid(disbursementId, admin.auth, {
      transferCode: 'FT001',
      note: 'x'.repeat(1001),
    }).expect(400);

    // Không đăng nhập → 401.
    await request(http).get(`${API}/admin/disbursements`).expect(401);
    await request(http)
      .post(`${API}/admin/disbursements/${disbursementId}/mark-paid`)
      .send({ transferCode: 'FT001' })
      .expect(401);
  });

  it('admin: 2 lệnh chi xếp theo ngày tới hạn, phân trang đúng; 2 admin bấm cùng lúc → đúng 1 người được', async () => {
    const first = await toCompleted();
    const second = await toCompleted();
    const admin = await seed.admin();
    // Đơn tạo SAU tới hạn TRƯỚC → phải lên đầu (xếp theo eligible_at, không theo ngày tạo).
    await makeEligible(second.order.orderId);
    await setBank(second.provider.profileId);

    const all = await listDisbursements(admin.auth).expect(200);
    expect(all.body.total).toBe(2);
    expect(
      (all.body.data as Record<string, any>[]).map((row) => row.orderId),
    ).toEqual([second.order.orderId, first.order.orderId]);

    const page2 = await listDisbursements(admin.auth, '?page=2&limit=1').expect(
      200,
    );
    expect(page2.body).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(page2.body.data).toEqual([
      expect.objectContaining({ orderId: first.order.orderId }),
    ]);
    const beyond = await listDisbursements(admin.auth, '?page=9').expect(200);
    expect(beyond.body).toMatchObject({ total: 2, data: [] });

    // Khoá dòng: 2 yêu cầu song song, mã giao dịch khác nhau → 1 cái 200, 1 cái 409.
    const targetId = all.body.data[0].id as string;
    const results = await Promise.all(
      ['FT-A', 'FT-B'].map((transferCode) =>
        markPaid(targetId, admin.auth, { transferCode }),
      ),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const won = results.find((res) => res.status === 200)!;
    const lost = results.find((res) => res.status === 409)!;
    expect(lost.body.message).toBe('DISBURSEMENT_ALREADY_PAID');
    const [saved] = (await ctx.dataSource.query(
      `SELECT transfer_code FROM disbursements WHERE id = $1`,
      [targetId],
    )) as { transfer_code: string }[];
    expect(saved.transfer_code).toBe(won.body.transferCode);
  });

  it('admin: vườn chưa khai ngân hàng → 409; khai xong → 200 và lệnh chi lưu bản chụp tài khoản', async () => {
    const c = await toCompleted();
    const id = c.order.orderId;
    const admin = await seed.admin();
    await makeEligible(id);

    const list = await listDisbursements(admin.auth).expect(200);
    const row = list.body.data[0] as Record<string, any>;
    expect(row.bank).toBeNull();

    const noBank = await markPaid(row.id, admin.auth, {
      transferCode: 'FT001',
    }).expect(409);
    expect(noBank.body.message).toBe('PROVIDER_BANK_INFO_MISSING');

    // Khai thiếu 1 trong 3 trường (chưa có chủ tài khoản) vẫn coi là chưa khai.
    await ctx.dataSource.query(
      `UPDATE provider_profiles SET bank_name = 'MBBank', bank_account = '0123456789' WHERE id = $1`,
      [c.provider.profileId],
    );
    expect(
      (await listDisbursements(admin.auth).expect(200)).body.data[0].bank,
    ).toBeNull();
    await markPaid(row.id, admin.auth, { transferCode: 'FT001' }).expect(409);

    await setBank(c.provider.profileId);
    // Lệnh hoàn tiền khách (giả lập bằng SQL) KHÔNG được lấy tài khoản của vườn.
    const setType = (type: string) =>
      ctx.dataSource.query(`UPDATE disbursements SET type = $2 WHERE id = $1`, [
        row.id,
        type,
      ]);
    await setType('REFUND');
    expect(
      (await listDisbursements(admin.auth).expect(200)).body.data[0].bank,
    ).toBeNull();
    const refund = await markPaid(row.id, admin.auth, {
      transferCode: 'FT001',
    }).expect(409);
    expect(refund.body.message).toBe('DISBURSEMENT_BANK_INFO_MISSING');
    await setType('PAYOUT');

    // Danh sách gợi ý theo hồ sơ hiện tại dù lệnh chi chưa có bản chụp.
    expect(
      (await listDisbursements(admin.auth).expect(200)).body.data[0].bank,
    ).toEqual(BANK);

    const paid = await markPaid(row.id, admin.auth, {
      transferCode: 'FT001',
      note: '   ', // toàn khoảng trắng → lưu null
    }).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', bank: BANK });
    const [saved] = (await ctx.dataSource.query(
      `SELECT bank_name, bank_account, bank_holder, note FROM disbursements WHERE id = $1`,
      [row.id],
    )) as Record<string, string | null>[];
    expect(saved).toEqual({
      bank_name: 'MBBank',
      bank_account: '0123456789',
      bank_holder: 'VUON LAN',
      note: null,
    });
  });
});
