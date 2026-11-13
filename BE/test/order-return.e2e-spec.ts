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
 * Chặng trả cây (IN_CARE → COMPLETED) trên Postgres thật — luồng thành công cho demo
 * + huỷ phiên trả rồi trả lại. Đơn đi tới IN_CARE bằng API thật, rồi lùi hạn chăm bằng SQL.
 */
describe('Order return IN_CARE → COMPLETED (e2e)', () => {
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

  const post = (
    path: string,
    auth: { Authorization: string },
    body: object = {},
  ) => request(http).post(`${API}/orders/${path}`).set(auth).send(body);

  const detail = async (orderId: string, auth: { Authorization: string }) =>
    (
      await request(http)
        .get(`${API}/orders/${orderId}`)
        .set(auth)
        .expect(200)
    ).body as Record<string, any>;

  const photos = [{ photoUrl: 'https://example.com/out.jpg', caption: 'Toàn cây' }];

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  // Đi hết luồng nhận cây bằng API thật → đơn IN_CARE. rejectFirst: vườn từ chối cây đầu tiên lúc nhận.
  const toInCare = async ({ rejectFirst = false } = {}): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const c = { customer, provider, order };
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
    return c;
  };

  // Giả lập đã hết hạn chăm: lùi cả ngày bắt đầu lẫn hạn chăm.
  const makeCareDue = (orderId: string) =>
    ctx.dataSource.query(
      `UPDATE service_orders
         SET care_started_at = care_started_at - interval '40 days',
             care_due_at = now() - interval '1 hour'
       WHERE id = $1`,
      [orderId],
    );

  // IN_CARE → tới hạn → bắt đầu trả → kiểm mọi cây đang chăm → chốt → RETURN_AWAITING_CONFIRM.
  const toReturnAwaitingConfirm = async (c: Ctx, keptPlantIds: string[]) => {
    const id = c.order.orderId;
    await makeCareDue(id);
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of keptPlantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos,
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
  };

  // Tiền của đơn trong DB: sổ ĐƠN (theo thứ tự ghi) + tổng sổ đơn, sổ BẢO ĐẢM + tổng, hoá đơn, lệnh chi.
  const money = async (orderId: string) => {
    const q = (sql: string) =>
      ctx.dataSource.query(sql, [orderId]) as Promise<Record<string, any>[]>;
    const ledger = await q(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = 'ORDER'
        ORDER BY created_at, CASE entry_type WHEN 'PLATFORM_FEE' THEN 1 WHEN 'PAYOUT' THEN 2 ELSE 0 END`,
    );
    const [{ sum }] = await q(
      `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
        WHERE service_order_id = $1 AND book = 'ORDER'`,
    );
    const security = await q(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = 'SECURITY'
        ORDER BY created_at, CASE entry_type WHEN 'SECURITY_IN' THEN 0 WHEN 'COMPENSATION' THEN 1 ELSE 2 END`,
    );
    const [{ sum: securitySum }] = await q(
      `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
        WHERE service_order_id = $1 AND book = 'SECURITY'`,
    );
    const components = await q(
      `SELECT component_type, provider_fee, status FROM payment_components
        WHERE service_order_id = $1 ORDER BY component_type`,
    );
    const disbursements = await q(
      `SELECT type, amount, status, eligible_at FROM disbursements WHERE service_order_id = $1`,
    );
    return { ledger, sum, security, securitySum, components, disbursements };
  };

  it('luồng chính: chưa tới hạn → 409; tới hạn → bắt đầu → kiểm từng cây → chốt → khách xác nhận → COMPLETED', async () => {
    const c = await toInCare();
    const id = c.order.orderId;

    const early = await post(`${id}/return/start`, c.provider.auth).expect(409);
    expect(early.body.message).toBe('CARE_NOT_DUE');

    await makeCareDue(id);
    const started = await post(`${id}/return/start`, c.provider.auth).expect(
      200,
    );
    expect(started.body).toMatchObject({ status: 'RETURN_IN_PROGRESS' });

    const notYet = await post(`${id}/return/complete`, c.provider.auth).expect(
      400,
    );
    expect(notYet.body.message).toBe('UNASSESSED_PLANTS');

    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh', root: 'chắc' },
        note: 'Hồi phục tốt',
        photos,
      }).expect(201);
    }
    const completed = await post(
      `${id}/return/complete`,
      c.provider.auth,
    ).expect(200);
    expect(completed.body.status).toBe('RETURN_AWAITING_CONFIRM');
    expect(completed.body.customerConfirmDueAt).toEqual(expect.any(String));

    // Vườn không xác nhận thay khách được.
    await post(`${id}/return/confirm`, c.provider.auth).expect(403);

    const done = await post(`${id}/return/confirm`, c.customer.auth).expect(
      200,
    );
    expect(done.body).toMatchObject({ status: 'COMPLETED' });
    expect(done.body.completedAt).toEqual(expect.any(String));

    // Route của khách: response chỉ có phần khách được thấy, KHÔNG có phí 12% / số vườn nhận.
    expect(done.body.settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '0',
      compensationAmount: '0',
    });
    // CP3: chia tiền trong cùng transaction — 484.000 = nền tảng 72.000 + vườn 412.000 (kiểm trong DB).
    const m = await money(id);
    expect(m.ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'PLATFORM_FEE', amount: '-72000', balance_after: '412000' },
      { entry_type: 'PAYOUT', amount: '-412000', balance_after: '0' },
    ]);
    expect(m.sum).toBe('0');
    expect(m.components).toEqual([
      { component_type: 'PACKAGE_PRICE', provider_fee: '48000', status: 'RELEASED' },
      { component_type: 'PICKUP_FEE', provider_fee: '0', status: 'RELEASED' },
    ]);
    // Sổ bảo đảm: 2 cây không khai giá → vườn đã nộp 800.000, không tranh chấp → trả lại vườn hết, về 0.
    expect(m.security).toEqual([
      { entry_type: 'SECURITY_IN', amount: '800000', balance_after: '800000' },
      { entry_type: 'SECURITY_RETURN', amount: '-800000', balance_after: '0' },
    ]);
    expect(m.securitySum).toBe('0');
    // Mỗi sổ một lệnh chi cho vườn, cùng chờ 3 ngày.
    expect(m.disbursements).toHaveLength(2);
    const payout = m.disbursements.find((row) => row.type === 'PAYOUT')!;
    const securityReturn = m.disbursements.find(
      (row) => row.type === 'SECURITY_RETURN',
    )!;
    expect(payout).toMatchObject({ amount: '412000', status: 'PENDING' });
    expect(securityReturn).toMatchObject({
      amount: '800000',
      status: 'PENDING',
    });
    for (const row of [payout, securityReturn]) {
      const holdMs =
        new Date(row.eligible_at).getTime() -
        new Date(done.body.completedAt).getTime();
      expect(holdMs).toBe(3 * 24 * 60 * 60 * 1000);
    }

    // Bấm lại → 409, không đổi gì (vẫn đúng 2 lệnh chi, hai sổ vẫn 0).
    await post(`${id}/return/confirm`, c.customer.auth).expect(409);
    const again = await money(id);
    expect(again.disbursements).toHaveLength(2);
    expect(again.sum).toBe('0');
    expect(again.securitySum).toBe('0');

    const body = await detail(id, c.customer.auth);
    expect(body.status).toBe('COMPLETED');
    expect(body.handover.status).toBe('CONFIRMED');
    expect(body.handover.assessments).toHaveLength(c.order.plantIds.length);
    expect(body.returnHandover).toMatchObject({ status: 'CONFIRMED' });
    expect(body.returnHandover.assessments).toHaveLength(
      c.order.plantIds.length,
    );
    expect(body.returnHandover.assessments[0].photos).toEqual(photos);
    expect(body.isReturnOverdue).toBe(false);
    expect(body.careReportSchedule).toMatchObject({
      submittedCount: 0,
      isReportOverdue: false,
      nextReportDueAt: null,
    });
  });

  it('B19: danh sách đơn của vườn (không lọc trạng thái) vẫn thấy đơn đang trả cây và đơn COMPLETED', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    const providerList = async () =>
      (
        await request(http)
          .get(`${API}/orders`)
          .set(c.provider.auth)
          .expect(200)
      ).body as { data: { id: string; status: string }[] };

    await makeCareDue(id);
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    expect((await providerList()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'RETURN_IN_PROGRESS' }),
      ]),
    );

    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos,
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);
    expect((await providerList()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id, status: 'COMPLETED' }),
      ]),
    );
  });

  it('vườn từ chối 1 cây lúc nhận → cuối đơn khách được hoàn 212.000 (đủ 6%), vườn 236.000, nền tảng 36.000, sổ về 0', async () => {
    const c = await toInCare({ rejectFirst: true });
    const id = c.order.orderId;
    // Lúc khách xác nhận nhận cây sổ đơn chưa đổi, chưa có lệnh chi nào.
    const before = await money(id);
    expect(before.ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
    ]);
    // Cây bị từ chối không vào tiền bảo đảm: vườn chỉ nộp mức đền của 1 cây nhận = 400.000.
    expect(before.security).toEqual([
      { entry_type: 'SECURITY_IN', amount: '400000', balance_after: '400000' },
    ]);
    expect(before.disbursements).toHaveLength(0);
    // Khách khai tài khoản trước khi đơn xong → lệnh hoàn chụp sẵn.
    await request(http)
      .put(`${API}/customers/me/profile`)
      .set(c.customer.auth)
      .send({
        bankName: 'Vietcombank',
        bankAccount: '9876543210',
        bankHolder: 'NGUYEN VAN MINH',
      })
      .expect(200);
    await toReturnAwaitingConfirm(c, c.order.plantIds.slice(1));

    const done = await post(`${id}/return/confirm`, c.customer.auth).expect(
      200,
    );
    // Khách thấy số đã trả + tiền hoàn cây bị từ chối: 200.000 + 6% = 212.000.
    expect(done.body.settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '212000',
      compensationAmount: '0',
    });
    // S = 200.000: nền tảng giữ 6% (12.000) + 12% (24.000) = 36.000; vườn 200.000 − 24.000 + 60.000.
    const m = await money(id);
    expect(m.ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-212000', balance_after: '272000' },
      { entry_type: 'PLATFORM_FEE', amount: '-36000', balance_after: '236000' },
      { entry_type: 'PAYOUT', amount: '-236000', balance_after: '0' },
    ]);
    expect(m.sum).toBe('0');
    // Dòng gói có cây bị từ chối vẫn RELEASED, phí 12% tính trên 1 cây.
    expect(m.components).toEqual([
      { component_type: 'PACKAGE_PRICE', provider_fee: '24000', status: 'RELEASED' },
      { component_type: 'PICKUP_FEE', provider_fee: '0', status: 'RELEASED' },
    ]);

    const rows = (await ctx.dataSource.query(
      `SELECT type, amount, status, customer_id, provider_id, eligible_at,
              bank_name, bank_account, bank_holder
         FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [id],
    )) as Record<string, any>[];
    expect(rows).toHaveLength(3);
    const [payout, refund, securityReturn] = rows;
    expect(securityReturn).toMatchObject({
      type: 'SECURITY_RETURN',
      amount: '400000',
      status: 'PENDING',
      customer_id: null,
      provider_id: c.provider.profileId,
    });
    expect(m.securitySum).toBe('0');
    expect(payout).toMatchObject({
      type: 'PAYOUT',
      amount: '236000',
      status: 'PENDING',
      customer_id: null,
      provider_id: c.provider.profileId,
    });
    expect(refund).toMatchObject({
      type: 'REFUND',
      amount: '212000',
      status: 'PENDING',
      customer_id: c.customer.profileId,
      provider_id: null,
      bank_name: 'Vietcombank',
      bank_account: '9876543210',
      bank_holder: 'NGUYEN VAN MINH',
    });
    // Khách được chi ngay; vườn chờ 3 ngày.
    const completedAt = new Date(done.body.completedAt).getTime();
    expect(new Date(refund.eligible_at).getTime()).toBe(completedAt);
    expect(new Date(payout.eligible_at).getTime() - completedAt).toBe(
      3 * 24 * 60 * 60 * 1000,
    );
  });

  it('ràng buộc lệnh chi: phải có đúng một người nhận (khách hoặc vườn)', async () => {
    const c = await toInCare();
    const insert = (customerId: string | null, providerId: string | null) =>
      ctx.dataSource.query(
        `INSERT INTO disbursements (service_order_id, customer_id, provider_id, type, amount, eligible_at)
         VALUES ($1, $2, $3, 'REFUND', 1000, now())`,
        [c.order.orderId, customerId, providerId],
      );
    await expect(insert(null, null)).rejects.toThrow(
      /CHK_disbursements_recipient/,
    );
    await expect(
      insert(c.customer.profileId, c.provider.profileId),
    ).rejects.toThrow(/CHK_disbursements_recipient/);
    await expect(insert(c.customer.profileId, null)).resolves.toBeDefined();
  });

  it('CP3: sổ không đủ tiền để chia → 500, rollback cả bước xác nhận (đơn vẫn chờ khách)', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    await toReturnAwaitingConfirm(c, c.order.plantIds);
    // Giả lập sổ lệch: bớt 100.000 → còn 384.000 < 72.000 + 412.000.
    await ctx.dataSource.query(
      `INSERT INTO escrow_ledger (service_order_id, entry_type, amount, balance_after, note)
       VALUES ($1, 'REFUND', -100000, 384000, 'e2e: làm lệch sổ')`,
      [id],
    );

    const res = await post(`${id}/return/confirm`, c.customer.auth).expect(500);
    expect(res.body.message).toBe('ESCROW_BALANCE_INSUFFICIENT');

    expect((await detail(id, c.customer.auth)).status).toBe(
      'RETURN_AWAITING_CONFIRM',
    );
    const [out] = (await ctx.dataSource.query(
      `SELECT status FROM handovers WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    )) as { status: string }[];
    expect(out.status).toBe('AWAITING_CUSTOMER');
    const m = await money(id);
    expect(m.ledger.map((r) => r.entry_type)).toEqual(['DEPOSIT', 'REFUND']);
    expect(m.components.map((r) => r.status)).toEqual(['PAID', 'PAID']);
    expect(m.disbursements).toHaveLength(0);
  });

  it('khách vắng nhà: vườn huỷ phiên trả → về IN_CARE → bắt đầu trả lại được', async () => {
    const c = await toInCare();
    const id = c.order.orderId;
    await makeCareDue(id);

    const inCare = await detail(id, c.provider.auth);
    expect(inCare.isReturnOverdue).toBe(true);

    await post(`${id}/return/start`, c.provider.auth).expect(200);
    const cancelled = await post(`${id}/return/cancel`, c.provider.auth, {
      reason: '  Khách vắng nhà, hẹn chiều mai  ',
    }).expect(200);
    expect(cancelled.body).toEqual({ status: 'IN_CARE' });

    const [row] = (await ctx.dataSource.query(
      `SELECT status, note FROM handovers WHERE service_order_id = $1 AND handover_type = 'OUT'`,
      [id],
    )) as { status: string; note: string }[];
    expect(row).toEqual({
      status: 'CANCELLED',
      note: 'Khách vắng nhà, hẹn chiều mai',
    });

    // Phiên CANCELLED không chặn unique → mở phiên trả mới được.
    const again = await post(`${id}/return/start`, c.provider.auth).expect(
      200,
    );
    expect(again.body.status).toBe('RETURN_IN_PROGRESS');
    await post(`${id}/return/start`, c.provider.auth).expect(409);
  });
});
