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
const DAY_MS = 24 * HOUR_MS;

type Auth = { Authorization: string };

/**
 * Tiền bảo đảm lúc nhận cây + 2 nhánh huỷ tại chỗ, trên Postgres thật.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 → khách trả 484.000 (sổ đơn).
 * Cây A khách khai 3.000.000, cây B không khai (mức đền 2 × 200.000) → tiền bảo đảm 3.400.000 (sổ bảo đảm).
 */
describe('Tiền bảo đảm lúc nhận cây + huỷ tại chỗ (e2e)', () => {
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

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  // Đơn mẫu tới lúc vườn chốt biên bản nhận cây (HANDOVER_AWAITING_CONFIRM, phiên AWAITING_CUSTOMER).
  const toAwaitingConfirm = async (): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    // Cây A khách khai giá 3.000.000; cây B không khai.
    await sql(
      `UPDATE plants SET is_value_declared = true, declared_value = 3000000 WHERE id = $1`,
      [order.plantIds[0]],
    );
    await post(`${id}/submit`, customer.auth).expect(200);
    const accepted = await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    // Vườn thấy trước số tiền bảo đảm phải chuẩn bị: 3.000.000 + 2 × 200.000.
    expect(accepted.body.estimatedSecurityDeposit).toBe('3400000');
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    await seed.webhook(order.orderCode, order.amountDue).expect(200);
    await post(`${id}/handover/start`, provider.auth).expect(201);
    for (const plantId of order.plantIds) {
      await post(`${id}/handover/plants/${plantId}/assess`, provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    const completed = await post(
      `${id}/handover/complete`,
      provider.auth,
    ).expect(200);
    expect(completed.body.securityDepositAmount).toBe('3400000');
    return { customer, provider, order };
  };

  // Khách đồng ý biên bản → phiên AWAITING_DEPOSIT, khoản bảo đảm PENDING.
  const toAwaitingDeposit = async (): Promise<Ctx> => {
    const c = await toAwaitingConfirm();
    await post(`${c.order.orderId}/handover/confirm`, c.customer.auth).expect(
      200,
    );
    return c;
  };

  const ledger = (orderId: string, book: 'ORDER' | 'SECURITY') =>
    sql(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = $2
        ORDER BY created_at, CASE entry_type
          WHEN 'DEPOSIT' THEN 0 WHEN 'SECURITY_IN' THEN 0 WHEN 'REFUND' THEN 1
          WHEN 'COMPENSATION' THEN 1 WHEN 'PLATFORM_FEE' THEN 2 ELSE 3 END`,
      [orderId, book],
    );

  const disbursements = (orderId: string) =>
    sql(
      `SELECT type, amount, status, customer_id, provider_id, eligible_at,
              bank_name, bank_account, bank_holder
         FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [orderId],
    );

  const components = (orderId: string) =>
    sql(
      `SELECT component_type, status FROM payment_components
        WHERE service_order_id = $1 ORDER BY component_type`,
      [orderId],
    );

  const inHandover = async (orderId: string) =>
    (
      await sql(
        `SELECT status, note, customer_objection_note, confirmed_at, locked_at
           FROM handovers WHERE service_order_id = $1 AND handover_type = 'IN'`,
        [orderId],
      )
    )[0];

  const depositRow = async (orderId: string) =>
    (
      await sql(
        `SELECT amount, deposit_code, status, due_at, paid_at, transaction_id, provider_id, created_at
           FROM security_deposits WHERE service_order_id = $1`,
        [orderId],
      )
    )[0];

  const orderRow = async (orderId: string) =>
    (
      await sql(
        `SELECT status, final_locked_at, care_started_at, care_due_at,
                cancelled_by, cancelled_at, cancel_reason
           FROM service_orders WHERE id = $1`,
        [orderId],
      )
    )[0];

  it('khách đồng ý → AWAITING_DEPOSIT → vườn lấy QR → tiền về đủ → IN_CARE, sổ bảo đảm 3.400.000', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;

    // Khách chưa đồng ý thì chưa có khoản nào để nộp.
    const tooEarly = await post(
      `${id}/security-deposit/qr`,
      c.provider.auth,
    ).expect(409);
    expect(tooEarly.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
    expect((await detail(id, c.provider.auth)).securityDeposit).toBeNull();

    const confirmed = await post(
      `${id}/handover/confirm`,
      c.customer.auth,
    ).expect(200);
    expect(confirmed.body).toMatchObject({
      status: 'HANDOVER_AWAITING_CONFIRM',
      handoverStatus: 'AWAITING_DEPOSIT',
      finalTotal: '400000',
      securityDepositAmount: '3400000',
    });
    // Đơn CHƯA sang IN_CARE, chưa tính ngày chăm, chưa khoá giá.
    expect(await orderRow(id)).toMatchObject({
      status: 'HANDOVER_AWAITING_CONFIRM',
      final_locked_at: null,
      care_started_at: null,
      care_due_at: null,
    });
    const pending = await depositRow(id);
    expect(pending).toMatchObject({
      amount: '3400000',
      status: 'PENDING',
      paid_at: null,
      transaction_id: null,
      provider_id: c.provider.profileId,
    });
    expect(pending.deposit_code).toMatch(/^BAODAM[0-9A-F]{8}$/);
    // Hạn nộp đúng 2 giờ kể từ lúc khách đồng ý.
    expect(new Date(confirmed.body.depositDueAt).getTime()).toBe(
      new Date(pending.due_at).getTime(),
    );
    const window =
      new Date(pending.due_at).getTime() -
      new Date(pending.created_at).getTime();
    expect(Math.abs(window - 2 * HOUR_MS)).toBeLessThan(5_000);
    expect((await inHandover(id)).status).toBe('AWAITING_DEPOSIT');
    // Chữ ký giai đoạn HANDOVER của khách vẫn ghi như cũ.
    const signatures = await sql(
      `SELECT s.signer_role FROM agreement_signatures s
         JOIN service_agreements a ON a.id = s.agreement_id
        WHERE a.service_order_id = $1 AND s.sign_phase = 'HANDOVER'`,
      [id],
    );
    expect(signatures).toEqual([{ signer_role: 'CUSTOMER' }]);

    // Bấm đồng ý lần 2 → 409, không sinh khoản thứ hai.
    const again = await post(`${id}/handover/confirm`, c.customer.auth).expect(
      409,
    );
    expect(again.body.message).toBe('INVALID_STATE_TRANSITION');
    expect(
      await sql(`SELECT 1 FROM security_deposits WHERE service_order_id = $1`, [
        id,
      ]),
    ).toHaveLength(1);

    // QR: chỉ vườn của đơn lấy được.
    const qr = await post(`${id}/security-deposit/qr`, c.provider.auth).expect(
      200,
    );
    // Cùng hình dạng với QR tiền đơn / QR add-on, thêm hạn nộp.
    expect(qr.body).toEqual({
      qrImageUrl: expect.stringContaining(`addInfo=${pending.deposit_code}`),
      bankBin: expect.any(String),
      bankAccountNumber: expect.any(String),
      bankAccountName: expect.any(String),
      amount: '3400000',
      transferContent: pending.deposit_code,
      dueAt: confirmed.body.depositDueAt,
    });
    expect(qr.body.qrImageUrl).toContain('amount=3400000');
    await post(`${id}/security-deposit/qr`, c.customer.auth).expect(403);
    const stranger = await seed.provider();
    const notMine = await post(
      `${id}/security-deposit/qr`,
      stranger.auth,
    ).expect(404);
    expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
    await request(http)
      .post(`${API}/orders/${id}/security-deposit/qr`)
      .expect(401);

    // Chi tiết đơn lúc đang chờ: vườn thấy khoản bảo đảm, khách KHÔNG có field này.
    const forProvider = await detail(id, c.provider.auth);
    expect(forProvider.handoverStatus).toBe('AWAITING_DEPOSIT');
    expect(forProvider.securityDeposit).toEqual({
      amount: '3400000',
      status: 'PENDING',
      dueAt: confirmed.body.depositDueAt,
    });
    expect(
      (forProvider.plants as Record<string, any>[])
        .map((plant) => plant.compensationCap as string)
        .sort(),
    ).toEqual(['3000000', '400000']);
    const forCustomer = await detail(id, c.customer.auth);
    expect(forCustomer.handoverStatus).toBe('AWAITING_DEPOSIT');
    expect(forCustomer).not.toHaveProperty('securityDeposit');
    expect(
      (forCustomer.plants as Record<string, any>[])
        .map((plant) => plant.compensationCap as string)
        .sort(),
    ).toEqual(['3000000', '400000']);

    // Tiền bảo đảm về đủ.
    const paid = await seed
      .webhook(pending.deposit_code, '3400000', 990001)
      .expect(200);
    expect(paid.body).toEqual({
      success: true,
      depositCode: pending.deposit_code,
      status: 'PAID',
    });
    const order = await orderRow(id);
    expect(order.status).toBe('IN_CARE');
    expect(order.final_locked_at).not.toBeNull();
    // Ngày chăm tính từ lúc tiền bảo đảm về: gói 30 ngày.
    expect(
      new Date(order.care_due_at).getTime() -
        new Date(order.care_started_at).getTime(),
    ).toBe(30 * DAY_MS);
    const done = await depositRow(id);
    expect(done.status).toBe('PAID');
    expect(done.paid_at).not.toBeNull();
    expect(done.transaction_id).not.toBeNull();
    const handover = await inHandover(id);
    expect(handover.status).toBe('CONFIRMED');
    expect(handover.confirmed_at).not.toBeNull();
    expect(handover.locked_at).not.toBeNull();

    // Hai sổ tách nhau: sổ đơn vẫn 484.000, sổ bảo đảm 3.400.000.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
    ]);
    expect(await ledger(id, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3400000',
        balance_after: '3400000',
      },
    ]);
    const [txn] = await sql(
      `SELECT status, amount, service_order_id FROM transactions WHERE id = $1`,
      [done.transaction_id],
    );
    expect(txn).toEqual({
      status: 'SUCCESS',
      amount: '3400000',
      service_order_id: id,
    });

    // SePay gửi lại cùng giao dịch → không ghi 2 lần.
    const retry = await seed
      .webhook(pending.deposit_code, '3400000', 990001)
      .expect(200);
    expect(retry.body).toMatchObject({ duplicated: true });
    // Vườn chuyển thêm lần nữa (giao dịch khác) → khoản đã PAID, tiền ghi chờ admin, sổ không đổi.
    const twice = await seed
      .webhook(pending.deposit_code, '3400000')
      .expect(200);
    expect(twice.body).toEqual({
      success: true,
      ignored: 'SECURITY_DEPOSIT_NOT_PENDING',
    });
    expect(await ledger(id, 'SECURITY')).toHaveLength(1);
    expect(
      await sql(
        `SELECT amount FROM transactions WHERE service_order_id = $1 AND status = 'PENDING'`,
        [id],
      ),
    ).toEqual([{ amount: '3400000' }]);

    // Đã nộp rồi: xin QR / vườn huỷ / khách không giao cây đều bị chặn.
    const qrAfter = await post(
      `${id}/security-deposit/qr`,
      c.provider.auth,
    ).expect(409);
    expect(qrAfter.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
    const cancelAfter = await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: 'Đổi ý',
    }).expect(409);
    expect(cancelAfter.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
    const declineAfter = await post(`${id}/handover/decline`, c.customer.auth, {
      reason: 'Đổi ý',
    }).expect(409);
    expect(declineAfter.body.message).toBe('INVALID_STATE_TRANSITION');
    expect((await orderRow(id)).status).toBe('IN_CARE');

    const after = await detail(id, c.provider.auth);
    expect(after.handoverStatus).toBe('CONFIRMED');
    expect(after.securityDeposit).toMatchObject({
      amount: '3400000',
      status: 'PAID',
    });
    expect(await detail(id, c.customer.auth)).not.toHaveProperty(
      'securityDeposit',
    );
  });

  it('vườn chuyển thiếu / sai mã → không ghi nhận, tiền ghi chờ admin; chuyển đủ sau đó thì được', async () => {
    const c = await toAwaitingDeposit();
    const id = c.order.orderId;
    const deposit = await seed.pendingSecurityDeposit(id);

    const short = await seed
      .webhook(deposit.deposit_code, '3399999')
      .expect(200);
    expect(short.body).toEqual({
      success: true,
      ignored: 'INSUFFICIENT_AMOUNT',
    });
    expect((await orderRow(id)).status).toBe('HANDOVER_AWAITING_CONFIRM');
    expect((await depositRow(id)).status).toBe('PENDING');
    expect((await inHandover(id)).status).toBe('AWAITING_DEPOSIT');
    expect(await ledger(id, 'SECURITY')).toEqual([]);
    expect(
      await sql(
        `SELECT amount, status FROM transactions
          WHERE service_order_id = $1 AND status = 'PENDING'`,
        [id],
      ),
    ).toEqual([{ amount: '3399999', status: 'PENDING' }]);

    // Mã bảo đảm không tồn tại → không khớp đơn nào, không rơi sang nhánh mã đơn / add-on.
    const unknown = await seed.webhook('BAODAM00000000', '3400000').expect(200);
    expect(unknown.body).toEqual({
      success: true,
      ignored: 'SECURITY_DEPOSIT_NOT_MATCHED',
    });
    expect(
      await sql(
        `SELECT amount FROM transactions WHERE service_order_id IS NULL AND status = 'PENDING'`,
      ),
    ).toEqual([{ amount: '3400000' }]);

    // Chuyển dư 1.000 vẫn nhận; sổ bảo đảm ghi đúng số thực nhận.
    await seed.webhook(deposit.deposit_code, '3401000').expect(200);
    expect((await orderRow(id)).status).toBe('IN_CARE');
    expect(await ledger(id, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3401000',
        balance_after: '3401000',
      },
    ]);
    // Sổ đơn không dính tiền bảo đảm.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
    ]);
  });

  it('quá hạn 2 giờ mà bộ quét chưa huỷ: QR → 409 SECURITY_DEPOSIT_EXPIRED, tiền tới trễ không ghi nhận (chờ admin)', async () => {
    const c = await toAwaitingDeposit();
    const id = c.order.orderId;
    const deposit = await seed.pendingSecurityDeposit(id);
    // Tua: hạn nộp đã qua 1 phút, khoản vẫn PENDING vì bộ quét chưa chạy tới.
    await sql(
      `UPDATE security_deposits SET due_at = now() - interval '1 minute' WHERE id = $1`,
      [deposit.id],
    );

    const qr = await post(`${id}/security-deposit/qr`, c.provider.auth).expect(
      409,
    );
    expect(qr.body.message).toBe('SECURITY_DEPOSIT_EXPIRED');

    const late = await seed
      .webhook(deposit.deposit_code, deposit.amount)
      .expect(200);
    expect(late.body).toEqual({
      success: true,
      ignored: 'SECURITY_DEPOSIT_EXPIRED',
    });
    // Không đổi gì: đơn vẫn chờ, khoản vẫn PENDING, sổ bảo đảm trống; tiền thật ghi chờ admin hoàn tay.
    expect((await orderRow(id)).status).toBe('HANDOVER_AWAITING_CONFIRM');
    expect((await depositRow(id)).status).toBe('PENDING');
    expect((await inHandover(id)).status).toBe('AWAITING_DEPOSIT');
    expect(await ledger(id, 'SECURITY')).toEqual([]);
    expect(
      await sql(
        `SELECT amount, status FROM transactions
          WHERE service_order_id = $1 AND status = 'PENDING'`,
        [id],
      ),
    ).toEqual([{ amount: '3400000', status: 'PENDING' }]);
    // Vườn vẫn tự bấm huỷ được như bình thường.
    await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: 'Quá giờ nộp tiền bảo đảm',
    }).expect(200);
    expect((await orderRow(id)).status).toBe('CANCELLED');
  });

  it('khách đồng ý kèm ý kiến phản đối + ảnh → lưu cùng biên bản; quá 10 ảnh / ý kiến quá dài → 400', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;
    const photo = (i: number) => ({
      photoUrl: `https://example.com/phan-doi-${i}.jpg`,
    });

    await post(`${id}/handover/confirm`, c.customer.auth, {
      objectionPhotos: Array.from({ length: 11 }, (_, i) => photo(i)),
    }).expect(400);
    await post(`${id}/handover/confirm`, c.customer.auth, {
      objectionNote: 'x'.repeat(2001),
    }).expect(400);
    await post(`${id}/handover/confirm`, c.customer.auth, {
      objectionPhotos: [{ photoUrl: 'khong-phai-url' }],
    }).expect(400);
    await post(`${id}/handover/confirm`, c.customer.auth, {
      objectionNote: 'ok',
      fieldLa: true,
    }).expect(400);
    // Body lỗi không làm đổi gì.
    expect((await inHandover(id)).status).toBe('AWAITING_CUSTOMER');

    const confirmed = await post(`${id}/handover/confirm`, c.customer.auth, {
      objectionNote: '  Vườn ghi cây A lá vàng sẵn, thực tế lá còn xanh  ',
      objectionPhotos: [
        { photoUrl: 'https://example.com/la-xanh.jpg', caption: 'Lá cây A' },
        { photoUrl: 'https://example.com/toan-cay.jpg' },
      ],
    }).expect(200);
    // Có phản đối vẫn là đồng ý giao cây: vườn vẫn phải nộp đủ tiền bảo đảm.
    expect(confirmed.body).toMatchObject({
      handoverStatus: 'AWAITING_DEPOSIT',
      securityDepositAmount: '3400000',
    });
    const handover = await inHandover(id);
    expect(handover).toMatchObject({
      status: 'AWAITING_DEPOSIT',
      customer_objection_note:
        'Vườn ghi cây A lá vàng sẵn, thực tế lá còn xanh',
    });
    const photos = await sql(
      `SELECT p.photo_url, p.caption FROM handover_objection_photos p
         JOIN handovers h ON h.id = p.handover_id
        WHERE h.service_order_id = $1 ORDER BY p.photo_url`,
      [id],
    );
    expect(photos).toEqual([
      { photo_url: 'https://example.com/la-xanh.jpg', caption: 'Lá cây A' },
      { photo_url: 'https://example.com/toan-cay.jpg', caption: null },
    ]);

    await seed.paySecurityDeposit(id);
    expect((await orderRow(id)).status).toBe('IN_CARE');
  });

  it('khách không giao cây (decline) → CANCELLED: khách 424.000, vườn giữ phí lấy cây 60.000, nền tảng 0', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;
    await request(http)
      .put(`${API}/customers/me/profile`)
      .set(c.customer.auth)
      .send({
        bankName: 'Vietcombank',
        bankAccount: '9876543210',
        bankHolder: 'NGUYEN VAN MINH',
      })
      .expect(200);

    // Sai vai / người ngoài / thiếu lý do.
    await post(`${id}/handover/decline`, c.provider.auth, {
      reason: 'x',
    }).expect(403);
    const stranger = await seed.customer();
    const notMine = await post(`${id}/handover/decline`, stranger.auth, {
      reason: 'x',
    }).expect(404);
    expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
    await post(`${id}/handover/decline`, c.customer.auth, {}).expect(400);
    await post(`${id}/handover/decline`, c.customer.auth, {
      reason: '   ',
    }).expect(400);
    await post(`${id}/handover/decline`, c.customer.auth, {
      reason: 'x'.repeat(501),
    }).expect(400);

    const declined = await post(`${id}/handover/decline`, c.customer.auth, {
      reason: '  Không đồng ý kết quả khám  ',
    }).expect(200);
    // Route của khách: chỉ có số khách nhận lại.
    expect(declined.body).toEqual({
      status: 'CANCELLED',
      refundAmount: '424000',
    });

    const order = await orderRow(id);
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelled_by: 'CUSTOMER',
      cancel_reason: 'Không đồng ý kết quả khám',
      care_started_at: null,
    });
    expect(order.cancelled_at).not.toBeNull();
    expect(await inHandover(id)).toMatchObject({
      status: 'CANCELLED',
      note: 'Không đồng ý kết quả khám',
    });
    // Vườn chưa nộp gì: không có khoản bảo đảm, sổ bảo đảm trống.
    expect(await depositRow(id)).toBeUndefined();
    expect(await ledger(id, 'SECURITY')).toEqual([]);
    // Sổ đơn: 484.000 → hoàn khách 424.000 (400.000 + 6%) → trả vườn 60.000 → 0.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-424000', balance_after: '60000' },
      { entry_type: 'PAYOUT', amount: '-60000', balance_after: '0' },
    ]);
    expect(await components(id)).toEqual([
      { component_type: 'PACKAGE_PRICE', status: 'REFUNDED' },
      { component_type: 'PICKUP_FEE', status: 'RELEASED' },
    ]);

    const rows = await disbursements(id);
    expect(rows).toHaveLength(2);
    const [payout, refund] = rows;
    expect(refund).toMatchObject({
      type: 'REFUND',
      amount: '424000',
      status: 'PENDING',
      customer_id: c.customer.profileId,
      provider_id: null,
      bank_name: 'Vietcombank',
      bank_account: '9876543210',
      bank_holder: 'NGUYEN VAN MINH',
    });
    expect(payout).toMatchObject({
      type: 'PAYOUT',
      amount: '60000',
      status: 'PENDING',
      customer_id: null,
      provider_id: c.provider.profileId,
    });
    // Khách được chi ngay; vườn chờ 3 ngày.
    const cancelledAt = new Date(order.cancelled_at).getTime();
    expect(new Date(refund.eligible_at).getTime()).toBe(cancelledAt);
    expect(new Date(payout.eligible_at).getTime() - cancelledAt).toBe(
      3 * DAY_MS,
    );

    // Đơn đã huỷ: bấm lại / đồng ý / lấy QR đều bị chặn, tiền không đổi.
    await post(`${id}/handover/decline`, c.customer.auth, {
      reason: 'lần 2',
    }).expect(409);
    await post(`${id}/handover/confirm`, c.customer.auth).expect(409);
    await post(`${id}/security-deposit/qr`, c.provider.auth).expect(409);
    expect(await disbursements(id)).toHaveLength(2);
    const view = await detail(id, c.customer.auth);
    expect(view.status).toBe('CANCELLED');
    expect(view.handoverStatus).toBe('CANCELLED');
    expect(view.settlement.refundAmount).toBe('424000');
  });

  it('khách đã đồng ý biên bản thì không decline được nữa (409), đơn vẫn chờ vườn nộp bảo đảm', async () => {
    const c = await toAwaitingDeposit();
    const id = c.order.orderId;
    const res = await post(`${id}/handover/decline`, c.customer.auth, {
      reason: 'Đổi ý sau khi ký',
    }).expect(409);
    expect(res.body.message).toBe('INVALID_STATE_TRANSITION');
    expect((await orderRow(id)).status).toBe('HANDOVER_AWAITING_CONFIRM');
    expect((await inHandover(id)).status).toBe('AWAITING_DEPOSIT');
    expect((await depositRow(id)).status).toBe('PENDING');
    expect(await ledger(id, 'ORDER')).toHaveLength(1);
    expect(await disbursements(id)).toHaveLength(0);
  });

  it('vườn không nộp bảo đảm, tự huỷ (cancel) → CANCELLED: khách nhận lại đủ 484.000; tiền bảo đảm tới sau khi huỷ → ignored', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;

    // Khách chưa đồng ý biên bản thì chưa có khoản nào để huỷ.
    const tooEarly = await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: 'Không đủ tiền',
    }).expect(409);
    expect(tooEarly.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
    expect((await orderRow(id)).status).toBe('HANDOVER_AWAITING_CONFIRM');

    await post(`${id}/handover/confirm`, c.customer.auth).expect(200);
    const deposit = await seed.pendingSecurityDeposit(id);

    // Sai vai / vườn khác / thiếu lý do.
    await post(`${id}/handover/cancel`, c.customer.auth, {
      reason: 'x',
    }).expect(403);
    const stranger = await seed.provider();
    const notMine = await post(`${id}/handover/cancel`, stranger.auth, {
      reason: 'x',
    }).expect(404);
    expect(notMine.body.message).toBe('ORDER_NOT_FOUND');
    await post(`${id}/handover/cancel`, c.provider.auth, {}).expect(400);

    const cancelled = await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: '  Không chuẩn bị đủ tiền bảo đảm  ',
    }).expect(200);
    expect(cancelled.body).toEqual({ status: 'CANCELLED' });

    const order = await orderRow(id);
    expect(order).toMatchObject({
      status: 'CANCELLED',
      cancelled_by: 'PROVIDER',
      cancel_reason: 'Không chuẩn bị đủ tiền bảo đảm',
      care_started_at: null,
    });
    expect((await depositRow(id)).status).toBe('CANCELLED');
    expect(await inHandover(id)).toMatchObject({
      status: 'CANCELLED',
      note: 'Không chuẩn bị đủ tiền bảo đảm',
    });
    // Sổ đơn: hoàn khách toàn bộ, kể cả phí lấy cây → 0. Nền tảng và vườn không nhận gì.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-484000', balance_after: '0' },
    ]);
    expect(await components(id)).toEqual([
      { component_type: 'PACKAGE_PRICE', status: 'REFUNDED' },
      { component_type: 'PICKUP_FEE', status: 'REFUNDED' },
    ]);
    const rows = await disbursements(id);
    expect(rows).toHaveLength(1);
    // Khách chưa khai tài khoản: lệnh hoàn vẫn tạo, phần tài khoản để trống.
    expect(rows[0]).toMatchObject({
      type: 'REFUND',
      amount: '484000',
      status: 'PENDING',
      customer_id: c.customer.profileId,
      provider_id: null,
      bank_name: null,
      bank_account: null,
      bank_holder: null,
    });
    expect(new Date(rows[0].eligible_at).getTime()).toBe(
      new Date(order.cancelled_at).getTime(),
    );

    // Tiền bảo đảm tới SAU khi đã huỷ → không ghi sổ, ghi giao dịch chờ admin hoàn tay cho vườn.
    const late = await seed
      .webhook(deposit.deposit_code, deposit.amount)
      .expect(200);
    expect(late.body).toEqual({
      success: true,
      ignored: 'SECURITY_DEPOSIT_NOT_PENDING',
    });
    expect(await ledger(id, 'SECURITY')).toEqual([]);
    expect((await orderRow(id)).status).toBe('CANCELLED');
    expect((await depositRow(id)).status).toBe('CANCELLED');
    expect(
      await sql(
        `SELECT amount, status FROM transactions
          WHERE service_order_id = $1 AND status = 'PENDING'`,
        [id],
      ),
    ).toEqual([{ amount: '3400000', status: 'PENDING' }]);

    // Huỷ rồi: bấm lại / lấy QR → 409, không sinh thêm lệnh chi.
    const again = await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: 'lần 2',
    }).expect(409);
    expect(again.body.message).toBe('SECURITY_DEPOSIT_NOT_PENDING');
    await post(`${id}/security-deposit/qr`, c.provider.auth).expect(409);
    expect(await disbursements(id)).toHaveLength(1);

    const forProvider = await detail(id, c.provider.auth);
    expect(forProvider.status).toBe('CANCELLED');
    expect(forProvider.securityDeposit).toMatchObject({ status: 'CANCELLED' });
    const forCustomer = await detail(id, c.customer.auth);
    expect(forCustomer).not.toHaveProperty('securityDeposit');
    expect(forCustomer.settlement.refundAmount).toBe('484000');
  });

  it('hoàn tất đơn có tiền bảo đảm, không tranh chấp → sổ bảo đảm về 0, lệnh chi SECURITY_RETURN 3.400.000 cho vườn', async () => {
    const c = await toAwaitingDeposit();
    const id = c.order.orderId;
    await seed.paySecurityDeposit(id);
    await sql(
      `UPDATE service_orders
          SET care_started_at = care_started_at - interval '40 days',
              care_due_at = now() - interval '1 hour'
        WHERE id = $1`,
      [id],
    );
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    const done = await post(`${id}/return/confirm`, c.customer.auth).expect(
      200,
    );
    // Khách không được đền gì và response không lộ tiền bảo đảm của vườn.
    expect(done.body.settlement).toEqual({
      packageAmount: '400000',
      customerFee: '24000',
      pickupFee: '60000',
      addonAmount: '0',
      customerTotal: '484000',
      refundAmount: '0',
      compensationAmount: '0',
    });

    // Sổ đơn chia như đơn thường; sổ bảo đảm trả lại vườn toàn bộ → cả hai về 0.
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'PLATFORM_FEE', amount: '-72000', balance_after: '412000' },
      { entry_type: 'PAYOUT', amount: '-412000', balance_after: '0' },
    ]);
    expect(await ledger(id, 'SECURITY')).toEqual([
      {
        entry_type: 'SECURITY_IN',
        amount: '3400000',
        balance_after: '3400000',
      },
      {
        entry_type: 'SECURITY_RETURN',
        amount: '-3400000',
        balance_after: '0',
      },
    ]);

    const rows = await disbursements(id);
    expect(rows.map((row) => [row.type, row.amount])).toEqual([
      ['PAYOUT', '412000'],
      ['SECURITY_RETURN', '3400000'],
    ]);
    const completedAt = new Date(done.body.completedAt).getTime();
    for (const row of rows) {
      expect(row).toMatchObject({
        status: 'PENDING',
        customer_id: null,
        provider_id: c.provider.profileId,
      });
      // Lệnh của vườn chờ 3 ngày admin đối soát.
      expect(new Date(row.eligible_at).getTime() - completedAt).toBe(
        3 * DAY_MS,
      );
    }
    // Khoản bảo đảm vẫn là PAID (đã nộp); việc trả lại nằm ở sổ + lệnh chi.
    expect((await depositRow(id)).status).toBe('PAID');
  });
});
