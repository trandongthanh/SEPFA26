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
    await seed.paySecurityDeposit(id);
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

  // Giả lập đã qua 3 ngày admin đối soát.
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
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '0',
      compensationAmount: '0',
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

  it('settlement: vườn từ chối 1 cây → khách thấy được hoàn 212.000 (200.000 + 6%); vườn nhận 236.000', async () => {
    const c = await toCompleted({ rejectFirst: true });
    const id = c.order.orderId;

    expect((await detail(id, c.customer.auth)).settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '212000',
      compensationAmount: '0',
    });
    expect((await detail(id, c.provider.auth)).settlement).toMatchObject({
      refundAmount: '212000',
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
    // Vườn có 2 lệnh chi cùng ngày tới hạn: tiền công (PAYOUT) + trả lại tiền bảo đảm (SECURITY_RETURN).
    expect(pending.body).toMatchObject({ total: 2, page: 1, limit: 10 });
    const rows = pending.body.data as Record<string, any>[];
    expect(rows.find((item) => item.type === 'SECURITY_RETURN')).toMatchObject({
      orderId: id,
      recipient: 'PROVIDER',
      providerId: c.provider.profileId,
      customerId: null,
      amount: '800000',
      isEligible: false,
      status: 'PENDING',
      bank: BANK,
    });
    const row = rows.find((item) => item.type === 'PAYOUT')!;
    expect(row).toMatchObject({
      orderId: id,
      orderCode: c.order.orderCode,
      recipient: 'PROVIDER',
      recipientName: 'Vườn Lan',
      customerId: null,
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

    // Còn lại lệnh trả tiền bảo đảm chưa chuyển.
    expect(
      (await listDisbursements(admin.auth, '?status=PENDING').expect(200)).body
        .total,
    ).toBe(1);
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
    // Mỗi đơn 2 lệnh chi cho vườn (PAYOUT + SECURITY_RETURN) cùng ngày tới hạn → 4 dòng.
    expect(all.body.total).toBe(4);
    expect(
      (all.body.data as Record<string, any>[]).map((row) => row.orderId),
    ).toEqual([
      second.order.orderId,
      second.order.orderId,
      first.order.orderId,
      first.order.orderId,
    ]);

    const page2 = await listDisbursements(admin.auth, '?page=2&limit=2').expect(
      200,
    );
    expect(page2.body).toMatchObject({ total: 4, page: 2, limit: 2 });
    expect(page2.body.data).toEqual([
      expect.objectContaining({ orderId: first.order.orderId }),
      expect.objectContaining({ orderId: first.order.orderId }),
    ]);
    const beyond = await listDisbursements(admin.auth, '?page=9').expect(200);
    expect(beyond.body).toMatchObject({ total: 4, data: [] });

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

  it('admin: lệnh hoàn cho khách (REFUND) — chi được ngay, không lấy tài khoản vườn; khách chưa khai → 409, khai xong → 200', async () => {
    const c = await newOrder();
    const id = c.order.orderId;
    await sign(c);
    await setBank(c.provider.profileId); // vườn CÓ tài khoản — lệnh của khách không được mượn
    await payToCompleted(c, { rejectFirst: true });
    const admin = await seed.admin();

    const list = await listDisbursements(admin.auth, '?status=PENDING').expect(
      200,
    );
    // REFUND của khách + PAYOUT và SECURITY_RETURN của vườn.
    expect(list.body.total).toBe(3);
    // Lệnh của khách tới hạn ngay nên đứng trước 2 lệnh của vườn (chờ 3 ngày).
    const listed = list.body.data as Record<string, any>[];
    const refund = listed[0];
    const payout = listed.find((item) => item.type === 'PAYOUT')!;
    expect(refund).toMatchObject({
      orderId: id,
      orderCode: c.order.orderCode,
      recipient: 'CUSTOMER',
      recipientName: expect.stringMatching(/^Người /),
      customerId: c.customer.profileId,
      providerId: null,
      providerName: null,
      type: 'REFUND',
      amount: '212000',
      isEligible: true,
      status: 'PENDING',
      bank: null,
    });
    expect(payout).toMatchObject({
      recipient: 'PROVIDER',
      customerId: null,
      providerId: c.provider.profileId,
      type: 'PAYOUT',
      amount: '236000',
      isEligible: false,
      bank: BANK,
    });

    const noBank = await markPaid(refund.id, admin.auth, {
      transferCode: 'FT-KH-1',
    }).expect(409);
    expect(noBank.body.message).toBe('DISBURSEMENT_BANK_INFO_MISSING');

    // Khách khai thiếu chủ tài khoản → vẫn coi là chưa khai.
    const putProfile = (body: object) =>
      request(http)
        .put(`${API}/customers/me/profile`)
        .set(c.customer.auth)
        .send(body);
    await putProfile({
      bankName: 'Vietcombank',
      bankAccount: '9876543210',
    }).expect(200);
    expect(
      (await listDisbursements(admin.auth).expect(200)).body.data[0].bank,
    ).toBeNull();
    await markPaid(refund.id, admin.auth, { transferCode: 'FT-KH-1' }).expect(
      409,
    );

    await putProfile({ bankHolder: 'NGUYEN VAN MINH' }).expect(200);
    const customerBank = {
      bankName: 'Vietcombank',
      bankAccount: '9876543210',
      bankHolder: 'NGUYEN VAN MINH',
    };
    // Danh sách gợi ý theo hồ sơ khách hiện tại dù lệnh chi chưa có bản chụp.
    expect(
      (await listDisbursements(admin.auth).expect(200)).body.data[0].bank,
    ).toEqual(customerBank);

    const paid = await markPaid(refund.id, admin.auth, {
      transferCode: 'FT-KH-1',
    }).expect(200);
    expect(paid.body).toMatchObject({
      id: refund.id,
      recipient: 'CUSTOMER',
      status: 'PAID',
      transferCode: 'FT-KH-1',
      bank: customerBank,
    });
    const [saved] = (await ctx.dataSource.query(
      `SELECT bank_name, bank_account, bank_holder FROM disbursements WHERE id = $1`,
      [refund.id],
    )) as Record<string, string | null>[];
    expect(saved).toEqual({
      bank_name: 'Vietcombank',
      bank_account: '9876543210',
      bank_holder: 'NGUYEN VAN MINH',
    });
    // Lệnh của vườn không bị ảnh hưởng: vẫn PENDING, chưa tới hạn.
    const early = await markPaid(payout.id, admin.auth, {
      transferCode: 'FT-V-1',
    }).expect(409);
    expect(early.body.message).toBe('DISBURSEMENT_NOT_ELIGIBLE');
  });

  it('hồ sơ khách: khai / sửa / xoá 3 field ngân hàng; khách và admin đều thấy', async () => {
    const customer = await seed.customer();
    const admin = await seed.admin();
    const profile = (method: 'get' | 'put', body?: object) =>
      request(http)
        [method](`${API}/customers/me/profile`)
        .set(customer.auth)
        .send(body);

    const empty = await profile('get').expect(200);
    expect(empty.body).toMatchObject({
      bankName: null,
      bankAccount: null,
      bankHolder: null,
    });

    const saved = await profile('put', {
      bankName: '  Vietcombank  ',
      bankAccount: ' 9876543210 ',
      bankHolder: 'NGUYEN VAN MINH',
    }).expect(200);
    expect(saved.body).toMatchObject({
      bankName: 'Vietcombank',
      bankAccount: '9876543210',
      bankHolder: 'NGUYEN VAN MINH',
    });

    // PUT merge: gửi field khác thì ngân hàng giữ nguyên.
    const merged = await profile('put', { address: '25 Lê Lợi' }).expect(200);
    expect(merged.body).toMatchObject({
      address: '25 Lê Lợi',
      bankAccount: '9876543210',
    });

    await profile('put', { bankName: 'x'.repeat(101) }).expect(400);
    await profile('put', { bankAccount: '1'.repeat(51) }).expect(400);
    await profile('put', { bankHolder: 123 }).expect(400);

    const forAdmin = await request(http)
      .get(`${API}/customers/admin/${customer.profileId}`)
      .set(admin.auth)
      .expect(200);
    expect(forAdmin.body).toMatchObject({
      bankName: 'Vietcombank',
      bankAccount: '9876543210',
      bankHolder: 'NGUYEN VAN MINH',
      lostDisputeCount: 0,
    });

    // Chuỗi rỗng (sau trim) = xoá.
    const cleared = await profile('put', { bankHolder: '   ' }).expect(200);
    expect(cleared.body.bankHolder).toBeNull();
    expect(cleared.body.bankName).toBe('Vietcombank');
  });
});
