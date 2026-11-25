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

const CUSTOMER_BANK = {
  bank_name: 'MBBank',
  bank_account: '0123456789',
  bank_holder: 'NGUYEN VAN KHACH',
};

/**
 * Hoàn tiền đợt 1 trên Postgres thật. Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000 (QR 484.000),
 * tiền bảo đảm 800.000 (2 cây không khai giá × 2 × 200.000).
 * - B23: vườn chốt lại giá khi Nhận đơn → giá công lúc nhận cây theo giá đã ký.
 * - Thối tiền chuyển dư ngay lúc tiền về (đơn, add-on, tiền bảo đảm).
 * - Tiền chưa khớp: lý do, admin hoàn qua lệnh chi UNMATCHED_REFUND, chặn "phong bì gửi lại".
 * - Vườn trả lại add-on đã thu tiền.
 */
describe('Hoàn tiền: giá đã ký, chuyển dư, tiền chưa khớp, trả lại add-on (e2e)', () => {
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
    request(http).post(`${API}/${path}`).set(auth).send(body);

  const get = (path: string, auth: Auth) =>
    request(http).get(`${API}/${path}`).set(auth);

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Record<string, any>[]>;

  const detail = async (orderId: string, auth: Auth) =>
    (await get(`orders/${orderId}`, auth).expect(200)).body as Record<
      string,
      any
    >;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  const giveCustomerBank = (c: Ctx) =>
    sql(
      `UPDATE customer_profiles SET bank_name = $2, bank_account = $3, bank_holder = $4 WHERE id = $1`,
      [
        c.customer.profileId,
        CUSTOMER_BANK.bank_name,
        CUSTOMER_BANK.bank_account,
        CUSTOMER_BANK.bank_holder,
      ],
    );

  // Đơn tới AWAITING_PAYMENT (đủ 2 chữ ký). proposedTotal = giá vườn chốt lại khi Nhận đơn.
  const toAwaitingPayment = async (
    opts: { proposedTotal?: string } = {},
  ): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    const c = { customer, provider, order };
    await giveCustomerBank(c);
    await post(`orders/${id}/submit`, customer.auth).expect(200);
    await post(`orders/${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
      ...(opts.proposedTotal ? { proposedTotal: opts.proposedTotal } : {}),
    }).expect(200);
    await post(`orders/${id}/agreement/sign`, customer.auth).expect(200);
    await post(`orders/${id}/agreement/sign`, provider.auth).expect(200);
    return c;
  };

  const amountDueOf = async (orderId: string) =>
    (
      await sql(
        `SELECT SUM(amount + customer_fee)::text AS due FROM payment_components
          WHERE service_order_id = $1 AND status = 'PENDING'`,
        [orderId],
      )
    )[0].due as string;

  // Đi tiếp tới IN_CARE. extra = số chuyển dư khi trả đơn / nộp tiền bảo đảm.
  const toInCare = async (
    opts: {
      proposedTotal?: string;
      payExtra?: number;
      depositExtra?: number;
      rejectFirst?: boolean;
    } = {},
  ): Promise<Ctx> => {
    const c = await toAwaitingPayment(opts);
    const id = c.order.orderId;
    const due = Number(await amountDueOf(id));
    await seed
      .webhook(c.order.orderCode, String(due + (opts.payExtra ?? 0)))
      .expect(200);
    await post(`orders/${id}/handover/start`, c.provider.auth).expect(201);
    for (const [i, plantId] of c.order.plantIds.entries()) {
      await post(
        `orders/${id}/handover/plants/${plantId}/assess`,
        c.provider.auth,
        {
          checklist: { leaf: 'xanh' },
          decision: opts.rejectFirst && i === 0 ? 'REJECT' : 'ACCEPT',
          isHighRisk: false,
          photos: [{ photoUrl: 'https://example.com/in.jpg' }],
        },
      ).expect(201);
    }
    await post(`orders/${id}/handover/complete`, c.provider.auth).expect(200);
    await post(`orders/${id}/handover/confirm`, c.customer.auth).expect(200);
    const deposit = await seed.pendingSecurityDeposit(id);
    const res = await seed
      .webhook(
        deposit.deposit_code,
        String(Number(deposit.amount) + (opts.depositExtra ?? 0)),
      )
      .expect(200);
    expect(res.body.status).toBe('PAID');
    return c;
  };

  const returnAndComplete = async (c: Ctx) => {
    const id = c.order.orderId;
    await sql(
      `UPDATE service_orders
         SET care_started_at = care_started_at - interval '40 days',
             care_due_at = now() - interval '1 hour'
       WHERE id = $1`,
      [id],
    );
    await post(`orders/${id}/return/start`, c.provider.auth).expect(200);
    // Chỉ trả những cây vườn đã nhận (cây bị từ chối lúc nhận đã ở lại nhà khách).
    const kept = await sql(
      `SELECT id FROM plants WHERE service_order_id = $1 AND handover_decision <> 'REJECT'`,
      [id],
    );
    for (const { id: plantId } of kept) {
      await post(
        `orders/${id}/return/plants/${plantId}/assess`,
        c.provider.auth,
        {
          checklist: { leaf: 'xanh' },
          photos: [{ photoUrl: 'https://example.com/out.jpg' }],
        },
      ).expect(201);
    }
    await post(`orders/${id}/return/complete`, c.provider.auth).expect(200);
    await post(`orders/${id}/return/confirm`, c.customer.auth).expect(200);
  };

  const ledgerOf = (orderId: string, book = 'ORDER') =>
    sql(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = $2
        ORDER BY created_at,
          CASE entry_type WHEN 'DEPOSIT' THEN 0 WHEN 'SECURITY_IN' THEN 0 WHEN 'OVERPAY_RETURN' THEN 1
                          WHEN 'REFUND' THEN 2 WHEN 'PLATFORM_FEE' THEN 3 ELSE 4 END`,
      [orderId, book],
    );

  const balanceOf = async (orderId: string, book = 'ORDER') =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2`,
        [orderId, book],
      )
    )[0].sum as string;

  const disbursementsOf = (orderId: string) =>
    sql(
      `SELECT type, amount, customer_id IS NOT NULL AS to_customer, provider_id IS NOT NULL AS to_provider,
              eligible_at <= now() AS eligible
         FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [orderId],
    );

  describe('B23: giá vườn chốt lại khi Nhận đơn', () => {
    it('hạ giá 300.000 → khách trả 378.000, giá công lúc nhận cây 300.000, đơn hoàn tất, sổ về 0', async () => {
      const c = await toInCare({ proposedTotal: '300000' });
      const [order] = await sql(
        `SELECT final_total FROM service_orders WHERE id = $1`,
        [c.order.orderId],
      );
      expect(order.final_total).toBe('300000');

      await returnAndComplete(c);
      expect(await balanceOf(c.order.orderId)).toBe('0');
      // 300.000 − 12% (36.000) + phí lấy cây 60.000; không có tiền hoàn nào.
      expect(
        (await disbursementsOf(c.order.orderId)).map((d) => [d.type, d.amount]),
      ).toEqual([
        ['PAYOUT', '324000'],
        ['SECURITY_RETURN', '800000'],
      ]);
    });

    it('tăng giá 500.000 → phần tăng KHÔNG bị hoàn nhầm cho khách', async () => {
      const c = await toInCare({ proposedTotal: '500000' });
      await returnAndComplete(c);
      expect(await balanceOf(c.order.orderId)).toBe('0');
      expect(
        (await disbursementsOf(c.order.orderId)).map((d) => [d.type, d.amount]),
      ).toEqual([
        ['PAYOUT', '500000'],
        ['SECURITY_RETURN', '800000'],
      ]);
    });

    it('hạ giá 300.000 rồi từ chối 1 cây → hoàn đúng 150.000 + 6%', async () => {
      const c = await toInCare({ proposedTotal: '300000', rejectFirst: true });
      await returnAndComplete(c);
      const rows = await disbursementsOf(c.order.orderId);
      expect(rows.find((d) => d.type === 'REFUND')?.amount).toBe('159000');
      expect(rows.find((d) => d.type === 'PAYOUT')?.amount).toBe('192000');
      expect(await balanceOf(c.order.orderId)).toBe('0');
    });
  });

  describe('thối tiền chuyển dư', () => {
    it('đơn: cần 484.000 chuyển 500.000 → thối 16.000 ngay, cuối đơn sổ về 0', async () => {
      const c = await toInCare({ payExtra: 16000 });
      expect(await ledgerOf(c.order.orderId)).toEqual([
        { entry_type: 'DEPOSIT', amount: '500000', balance_after: '500000' },
        {
          entry_type: 'OVERPAY_RETURN',
          amount: '-16000',
          balance_after: '484000',
        },
      ]);
      expect(await disbursementsOf(c.order.orderId)).toEqual([
        {
          type: 'OVERPAY_RETURN',
          amount: '16000',
          to_customer: true,
          to_provider: false,
          eligible: true,
        },
      ]);
      const [snapshot] = await sql(
        `SELECT bank_account FROM disbursements WHERE service_order_id = $1 AND type = 'OVERPAY_RETURN'`,
        [c.order.orderId],
      );
      expect(snapshot.bank_account).toBe(CUSTOMER_BANK.bank_account);
      expect(
        (await detail(c.order.orderId, c.customer.auth)).settlement
          .overpayReturned,
      ).toBe('16000');

      await returnAndComplete(c);
      expect(await balanceOf(c.order.orderId)).toBe('0');
    });

    it('add-on: cần 106.000 chuyển 110.000 → thối 4.000', async () => {
      const c = await toInCare();
      const id = c.order.orderId;
      const addon = (
        await post(`orders/${id}/addons`, c.provider.auth, {
          title: 'Thay giá thể',
          reason: 'Giá thể đã mục, rễ bắt đầu úng',
          price: '100000',
          photoUrls: ['https://example.com/re-ung.jpg'],
        }).expect(201)
      ).body as Record<string, any>;
      await post(`orders/${id}/addons/${addon.id}/respond`, c.customer.auth, {
        decision: 'ACCEPT',
      }).expect(200);
      await seed.webhook(addon.addonCode, '110000').expect(200);

      expect(await balanceOf(id)).toBe('590000');
      const rows = await disbursementsOf(id);
      expect(rows.map((d) => [d.type, d.amount])).toEqual([
        ['OVERPAY_RETURN', '4000'],
      ]);
    });

    it('tiền bảo đảm: vườn nộp dư 50.000 → trả vườn ngay, sổ bảo đảm chỉ giữ 800.000', async () => {
      const c = await toInCare({ depositExtra: 50000 });
      expect(await ledgerOf(c.order.orderId, 'SECURITY')).toEqual([
        {
          entry_type: 'SECURITY_IN',
          amount: '850000',
          balance_after: '850000',
        },
        {
          entry_type: 'OVERPAY_RETURN',
          amount: '-50000',
          balance_after: '800000',
        },
      ]);
      expect(await disbursementsOf(c.order.orderId)).toEqual([
        {
          type: 'OVERPAY_RETURN',
          amount: '50000',
          to_customer: false,
          to_provider: true,
          eligible: true,
        },
      ]);
    });
  });

  describe('tiền chưa khớp: admin hoàn', () => {
    const list = async (auth: Auth, status?: string) =>
      (
        await get(
          `admin/unmatched-transactions${status ? `?status=${status}` : ''}`,
          auth,
        ).expect(200)
      ).body as Record<string, any>;

    const OTHER_BANK = {
      bankName: 'VCB',
      bankAccount: '999888777',
      bankHolder: 'TRAN THI LA',
    };

    it('không có mã đơn → lý do NO_CODE; phải nhập TK + ghi chú; hoàn một lần; mark-paid chạy với lệnh không gắn đơn', async () => {
      const admin = await seed.admin();
      const res = await seed.webhook('', '250000').expect(200);
      expect(res.body.ignored).toBe('ORDER_CODE_NOT_FOUND');

      const open = await list(admin.auth, 'OPEN');
      expect(open.total).toBe(1);
      const item = open.data[0];
      expect(item).toMatchObject({
        amount: '250000',
        reason: 'NO_CODE',
        order: null,
        suggestedRecipient: null,
        resolution: null,
      });

      const refund = (body: object) =>
        post(
          `admin/unmatched-transactions/${item.id}/refund`,
          admin.auth,
          body,
        );
      expect((await refund({}).expect(400)).body.message).toBe(
        'REFUND_BANK_INFO_REQUIRED',
      );
      expect((await refund(OTHER_BANK).expect(400)).body.message).toBe(
        'RESOLUTION_NOTE_REQUIRED',
      );
      expect((await refund({ bankName: 'VCB' }).expect(400)).body.message).toBe(
        'BANK_INFO_INCOMPLETE',
      );

      const done = (
        await refund({
          ...OTHER_BANK,
          note: 'Người chuyển gửi ảnh sao kê',
        }).expect(200)
      ).body as Record<string, any>;
      expect(done.resolution).toMatchObject({
        disbursementStatus: 'PENDING',
        note: 'Người chuyển gửi ảnh sao kê',
      });
      expect(
        (await refund({ ...OTHER_BANK, note: 'lần 2' }).expect(409)).body
          .message,
      ).toBe('TRANSACTION_ALREADY_RESOLVED');
      expect((await list(admin.auth, 'OPEN')).total).toBe(0);
      expect((await list(admin.auth, 'RESOLVED')).total).toBe(1);

      const disbursements = (
        await get('admin/disbursements', admin.auth).expect(200)
      ).body as Record<string, any>;
      const line = disbursements.data.find(
        (d: Record<string, any>) => d.type === 'UNMATCHED_REFUND',
      );
      expect(line).toMatchObject({
        orderId: null,
        orderCode: null,
        recipient: 'OTHER',
        amount: '250000',
        isEligible: true,
        sourceTransactionId: item.id,
        bank: { ...OTHER_BANK, bankBin: null },
      });
      await post(`admin/disbursements/${line.id}/mark-paid`, admin.auth, {
        transferCode: 'FT001',
      }).expect(200);
    });

    it('chuyển thiếu → lý do INSUFFICIENT_AMOUNT, gợi ý khách + TK hồ sơ; hoàn không cần ghi chú', async () => {
      const admin = await seed.admin();
      const c = await toAwaitingPayment();
      const res = await seed.webhook(c.order.orderCode, '400000').expect(200);
      expect(res.body.ignored).toBe('INSUFFICIENT_AMOUNT');

      const [item] = (await list(admin.auth, 'OPEN')).data;
      expect(item).toMatchObject({
        reason: 'INSUFFICIENT_AMOUNT',
        order: { id: c.order.orderId, orderCode: c.order.orderCode },
        suggestedRecipient: {
          type: 'CUSTOMER',
          id: c.customer.profileId,
          bank: {
            bankName: CUSTOMER_BANK.bank_name,
            bankAccount: CUSTOMER_BANK.bank_account,
            bankHolder: CUSTOMER_BANK.bank_holder,
          },
        },
      });
      await post(
        `admin/unmatched-transactions/${item.id}/refund`,
        admin.auth,
      ).expect(200);
      const [row] = await sql(
        `SELECT type, amount, customer_id, bank_account FROM disbursements WHERE source_transaction_id = $1`,
        [item.id],
      );
      expect(row).toEqual({
        type: 'UNMATCHED_REFUND',
        amount: '400000',
        customer_id: c.customer.profileId,
        bank_account: CUSTOMER_BANK.bank_account,
      });
      // Đổi sang TK khác TK hồ sơ → bắt buộc ghi chú (kiểm ở đơn khác).
    });

    it('phong bì gửi lại sau khi đã hoàn → không ghi nhận vào đơn (cả log cũ chưa đánh dấu)', async () => {
      const admin = await seed.admin();
      const customer = await seed.customer();
      const provider = await seed.provider();
      const order = await seed.draftOrder(customer, provider);
      const c = { customer, provider, order };
      await giveCustomerBank(c);
      const id = order.orderId;
      await post(`orders/${id}/submit`, customer.auth).expect(200);

      // Khách chuyển trước khi đủ chữ ký → vào hộp chờ.
      const sepayId = Date.now() + 999;
      const first = await seed
        .webhook(order.orderCode, order.amountDue, sepayId)
        .expect(200);
      expect(first.body.ignored).toBe('ORDER_NOT_AWAITING_PAYMENT');
      const [item] = (await list(admin.auth, 'OPEN')).data;
      await post(
        `admin/unmatched-transactions/${item.id}/refund`,
        admin.auth,
      ).expect(200);

      await post(`orders/${id}/negotiation/respond`, provider.auth, {
        response: 'ACCEPT',
      }).expect(200);
      await post(`orders/${id}/agreement/sign`, customer.auth).expect(200);
      await post(`orders/${id}/agreement/sign`, provider.auth).expect(200);

      // Lớp 1: log đã đánh dấu processed → duplicated.
      const resend = await seed
        .webhook(order.orderCode, order.amountDue, sepayId)
        .expect(200);
      expect(resend.body.duplicated).toBe(true);

      // Lớp 2: log cũ (trước bản sửa) chưa đánh dấu → vẫn không nâng SUCCESS.
      await sql(
        `UPDATE payment_webhook_logs SET processed = false WHERE sepay_txn_id = $1`,
        [String(sepayId)],
      );
      const legacy = await seed
        .webhook(order.orderCode, order.amountDue, sepayId)
        .expect(200);
      expect(legacy.body.ignored).toBe('ALREADY_REFUNDED');

      expect((await detail(id, customer.auth)).status).toBe('AWAITING_PAYMENT');
      const [txn] = await sql(
        `SELECT status FROM transactions WHERE sepay_txn_id = $1`,
        [String(sepayId)],
      );
      expect(txn.status).toBe('PENDING');
      expect(await balanceOf(id)).toBe('0');
    });

    it('không phải admin → 403', async () => {
      const customer = await seed.customer();
      await get('admin/unmatched-transactions', customer.auth).expect(403);
    });
  });

  describe('vườn trả lại add-on đã thu tiền', () => {
    const paidAddon = async (c: Ctx) => {
      const id = c.order.orderId;
      const addon = (
        await post(`orders/${id}/addons`, c.provider.auth, {
          title: 'Thay giá thể',
          reason: 'Giá thể đã mục, rễ bắt đầu úng',
          price: '100000',
          photoUrls: ['https://example.com/re-ung.jpg'],
        }).expect(201)
      ).body as Record<string, any>;
      await post(`orders/${id}/addons/${addon.id}/respond`, c.customer.auth, {
        decision: 'ACCEPT',
      }).expect(200);
      return addon;
    };

    const refund = (c: Ctx, addonId: string, auth: Auth, reason: string) =>
      post(`orders/${c.order.orderId}/addons/${addonId}/refund`, auth, {
        reason,
      });

    it('PAID → REFUNDED: hoàn khách 106.000 ngay, trả cây được, cuối đơn sổ về 0, vườn không được tính add-on', async () => {
      const c = await toInCare();
      const id = c.order.orderId;
      const addon = await paidAddon(c);
      // Chưa trả tiền → chưa có gì để trả lại.
      expect(
        (
          await refund(c, addon.id, c.provider.auth, 'Không làm được').expect(
            409,
          )
        ).body.message,
      ).toBe('ADDON_INVALID_STATE');
      await seed.webhook(addon.addonCode, '106000').expect(200);

      await refund(c, addon.id, c.customer.auth, 'Khách tự bấm').expect(403);
      await refund(c, addon.id, c.provider.auth, 'abc').expect(400);
      const res = (
        await refund(
          c,
          addon.id,
          c.provider.auth,
          'Cây đang yếu, thay chậu dễ sốc rễ',
        ).expect(200)
      ).body as Record<string, any>;
      expect(res).toMatchObject({
        status: 'REFUNDED',
        refundReason: 'Cây đang yếu, thay chậu dễ sốc rễ',
      });
      expect(res.refundedAt).toBeTruthy();
      await refund(c, addon.id, c.provider.auth, 'Bấm lần hai').expect(409);

      expect(await balanceOf(id)).toBe('484000');
      const [component] = await sql(
        `SELECT status FROM payment_components WHERE addon_id = $1`,
        [addon.id],
      );
      expect(component.status).toBe('REFUNDED');
      expect(
        (await disbursementsOf(id)).map((d) => [d.type, d.amount, d.eligible]),
      ).toEqual([['REFUND', '106000', true]]);

      await returnAndComplete(c);
      expect(await balanceOf(id)).toBe('0');
      const rows = await disbursementsOf(id);
      expect(rows.find((d) => d.type === 'PAYOUT')?.amount).toBe('412000');
      const providerView = await detail(id, c.provider.auth);
      expect(providerView.settlement.serviceAmount).toBe('400000');
      // Khách: đã trả add-on 106.000 và được hoàn đúng 106.000.
      const customerView = await detail(id, c.customer.auth);
      expect(customerView.settlement.refundAmount).toBe('106000');
    });
  });
});
