import request from 'supertest';
import type { App } from 'supertest/types';
import { DisputesService } from '../src/orders/disputes.service';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';
import {
  OrderSeed,
  PROVIDER_BANK,
  type DraftOrder,
  type OrderActor,
  type OrderProvider,
} from './orders/order-seed';

const API = '/api/v1';

type Auth = { Authorization: string };
type Book = 'ORDER' | 'SECURITY' | 'DECLARED';

/**
 * Tiền bảo đảm khai giá của KHÁCH, trên Postgres thật.
 * Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000. Cây A khách khai 3.000.000 (vượt 2 × giá gói) → khách nộp thêm
 * 10% = 300.000 cùng tiền đơn: QR 484.000 + 300.000 = 784.000; sổ đơn 484.000, sổ khai giá 300.000.
 * Vườn vẫn nộp tiền bảo đảm 3.400.000 lúc nhận cây (sổ bảo đảm).
 * Seed dựng đơn bằng SQL (bỏ qua POST /orders vì cần dịch vụ đo km) nên `declared_deposit` cũng đặt bằng SQL;
 * phép tính 10% / ngưỡng 2× đã có unit test ở declared-deposit.spec.ts.
 */
describe('Tiền bảo đảm khai giá của khách (e2e)', () => {
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
    plantA: string;
    plantB: string;
  }

  // Đơn mẫu tới AWAITING_PAYMENT (đủ 2 chữ ký). Trả kèm response của chữ ký thứ hai.
  const toAwaitingPayment = async () => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    const [plantA, plantB] = order.plantIds;
    await sql(
      `UPDATE plants SET is_value_declared = true, declared_value = 3000000,
              declared_deposit = 300000 WHERE id = $1`,
      [plantA],
    );
    await sql(
      `UPDATE customer_profiles
          SET bank_name = 'Vietcombank', bank_account = '9876543210',
              bank_holder = 'NGUYEN VAN MINH' WHERE id = $1`,
      [customer.profileId],
    );
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    const signed = await post(`${id}/agreement/sign`, provider.auth).expect(
      200,
    );
    const c: Ctx = { customer, provider, order, plantA, plantB };
    return { c, signed: signed.body as Record<string, string> };
  };

  // Khách trả đủ 784.000 → vườn chốt biên bản nhận cây (HANDOVER_AWAITING_CONFIRM).
  const toAwaitingConfirm = async ({ rejectA = false } = {}): Promise<Ctx> => {
    const { c } = await toAwaitingPayment();
    const id = c.order.orderId;
    await seed.webhook(c.order.orderCode, '784000').expect(200);
    await post(`${id}/handover/start`, c.provider.auth).expect(201);
    for (const plantId of c.order.plantIds) {
      await post(`${id}/handover/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        decision: rejectA && plantId === c.plantA ? 'REJECT' : 'ACCEPT',
        isHighRisk: false,
        photos: [{ photoUrl: 'https://example.com/in.jpg' }],
      }).expect(201);
    }
    await post(`${id}/handover/complete`, c.provider.auth).expect(200);
    return c;
  };

  // Đi hết tới lúc vườn chốt trả cây (RETURN_AWAITING_CONFIRM).
  const toReturnAwaiting = async ({ rejectA = false } = {}): Promise<Ctx> => {
    const c = await toAwaitingConfirm({ rejectA });
    const id = c.order.orderId;
    await post(`${id}/handover/confirm`, c.customer.auth).expect(200);
    await seed.paySecurityDeposit(id);
    await sql(
      `UPDATE service_orders
          SET care_started_at = care_started_at - interval '40 days',
              care_due_at = now() - interval '1 hour'
        WHERE id = $1`,
      [id],
    );
    await post(`${id}/return/start`, c.provider.auth).expect(200);
    for (const plantId of rejectA ? [c.plantB] : c.order.plantIds) {
      await post(`${id}/return/plants/${plantId}/assess`, c.provider.auth, {
        checklist: { leaf: 'xanh' },
        photos: [{ photoUrl: 'https://example.com/out.jpg' }],
      }).expect(201);
    }
    await post(`${id}/return/complete`, c.provider.auth).expect(200);
    return c;
  };

  // Khách mở tranh chấp cây A rồi tua hạn thương lượng → admin xử.
  const toAdminReview = async (c: Ctx, plantIds: string[] = [c.plantA]) => {
    const res = await post(`${c.order.orderId}/dispute`, c.customer.auth, {
      reason: 'Cây xuống sắc sau kỳ chăm',
      description: 'Nhận lại cây thì lá héo.',
      plantIds,
      evidence: [
        {
          photoUrl: 'https://example.com/cay-heo.jpg',
          caption: 'Lá héo',
          plantId: plantIds[0],
        },
      ],
    }).expect(201);
    const disputeId = res.body.disputeId as string;
    await sql(
      `UPDATE disputes SET negotiation_due_at = now() - interval '1 minute' WHERE id = $1`,
      [disputeId],
    );
    expect(
      await ctx.dataSource.transaction((manager) =>
        ctx.app
          .get(DisputesService)
          .escalateDispute(manager, disputeId, new Date()),
      ),
    ).toBe(true);
    return disputeId;
  };

  const resolve = async (
    disputeId: string,
    plants: { plantId: string; verdict: string }[],
  ) => {
    const admin = await seed.admin();
    return request(http)
      .post(`${API}/admin/disputes/${disputeId}/resolve`)
      .set(admin.auth)
      .send({ plants, note: 'Đã xem ảnh nhận cây, ảnh trả cây và báo cáo.' })
      .expect(200);
  };

  const ledger = (orderId: string, book: Book) =>
    sql(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 AND book = $2
        ORDER BY created_at, balance_after DESC`,
      [orderId, book],
    );

  const balance = async (orderId: string, book: Book) =>
    (
      await sql(
        `SELECT COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger
          WHERE service_order_id = $1 AND book = $2`,
        [orderId, book],
      )
    )[0].sum as string;

  const expectAllBooksZero = async (orderId: string) => {
    for (const book of ['ORDER', 'SECURITY', 'DECLARED'] as const) {
      expect(await balance(orderId, book)).toBe('0');
    }
  };

  const declaredDisbursements = (orderId: string) =>
    sql(
      `SELECT type, amount, status, customer_id, provider_id, bank_account,
              (eligible_at > now() + interval '2 days') AS held
         FROM disbursements
        WHERE service_order_id = $1 AND type LIKE 'DECLARED%' ORDER BY type`,
      [orderId],
    );

  const declaredComponent = async (orderId: string) =>
    (
      await sql(
        `SELECT amount, customer_fee, status FROM payment_components
          WHERE service_order_id = $1 AND component_type = 'DECLARED_DEPOSIT'`,
        [orderId],
      )
    )[0];

  it('đủ 2 chữ ký → dòng hoá đơn DECLARED_DEPOSIT 300.000 không phí, số phải trả 784.000', async () => {
    const { c, signed } = await toAwaitingPayment();
    const id = c.order.orderId;
    expect(signed).toMatchObject({
      status: 'AWAITING_PAYMENT',
      amountDue: '784000',
      customerFee: '24000',
      declaredDeposit: '300000',
    });
    expect(await declaredComponent(id)).toEqual({
      amount: '300000',
      customer_fee: '0',
      status: 'PENDING',
    });
    const qr = await post(`${id}/payment/qr`, c.customer.auth).expect(200);
    expect(qr.body.amount).toBe('784000');

    const view = await detail(id, c.customer.auth);
    expect(view.declaredDepositTotal).toBe('300000');
    expect(
      (view.plants as { id: string; declaredDeposit: string }[])
        .map((plant) => [plant.id, plant.declaredDeposit])
        .sort(),
    ).toEqual(
      [
        [c.plantA, '300000'],
        [c.plantB, '0'],
      ].sort(),
    );
    expect(view.settlement).toMatchObject({
      customerTotal: '784000',
      declaredDeposit: '300000',
      declaredDepositReturned: '0',
      declaredDepositForfeited: '0',
    });
  });

  it('chuyển 484.000 (thiếu phần khai giá) → không ghi nhận; chuyển đủ → hai sổ 484.000 và 300.000', async () => {
    const { c } = await toAwaitingPayment();
    const id = c.order.orderId;
    const short = await seed.webhook(c.order.orderCode, '484000').expect(200);
    expect(short.body.ignored).toBe('INSUFFICIENT_AMOUNT');
    expect(await balance(id, 'ORDER')).toBe('0');
    expect(await balance(id, 'DECLARED')).toBe('0');

    const paid = await seed.webhook(c.order.orderCode, '784000').expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(await ledger(id, 'ORDER')).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
    ]);
    expect(await ledger(id, 'DECLARED')).toEqual([
      { entry_type: 'DECLARED_IN', amount: '300000', balance_after: '300000' },
    ]);
    expect((await declaredComponent(id)).status).toBe('PAID');
  });

  it('khách chuyển dư 10.000 → phần dư vào sổ đơn, sổ khai giá vẫn đúng 300.000', async () => {
    const { c } = await toAwaitingPayment();
    await seed.webhook(c.order.orderCode, '794000').expect(200);
    expect(await balance(c.order.orderId, 'ORDER')).toBe('494000');
    expect(await balance(c.order.orderId, 'DECLARED')).toBe('300000');
  });

  it('đơn xong không tranh chấp → trả đủ 300.000 cho khách, chi được ngay, ba sổ về 0', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);

    expect(await ledger(id, 'DECLARED')).toEqual([
      { entry_type: 'DECLARED_IN', amount: '300000', balance_after: '300000' },
      { entry_type: 'DECLARED_RETURN', amount: '-300000', balance_after: '0' },
    ]);
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toEqual([
      {
        type: 'DECLARED_RETURN',
        amount: '300000',
        status: 'PENDING',
        customer_id: c.customer.profileId,
        provider_id: null,
        bank_account: '9876543210',
        held: false,
      },
    ]);
    expect((await declaredComponent(id)).status).toBe('REFUNDED');
    const view = await detail(id, c.customer.auth);
    expect(view.settlement).toMatchObject({
      declaredDepositReturned: '300000',
      declaredDepositForfeited: '0',
    });
  });

  it('vườn từ chối cây A lúc nhận → 300.000 của cây A vẫn trả đủ lúc chia tiền cuối', async () => {
    const c = await toReturnAwaiting({ rejectA: true });
    const id = c.order.orderId;
    await post(`${id}/return/confirm`, c.customer.auth).expect(200);
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toMatchObject([
      { type: 'DECLARED_RETURN', amount: '300000' },
    ]);
  });

  it('admin phán cây A vườn không lỗi → 300.000 sang vườn (chờ 3 ngày), khách +1 lần thua', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await toAdminReview(c);
    const res = await resolve(disputeId, [
      { plantId: c.plantA, verdict: 'NOT_AT_FAULT' },
    ]);
    expect(res.body).toMatchObject({
      status: 'RESOLVED',
      outcome: 'ADJUDICATED',
      refundAmount: '0',
      compensationAmount: '0',
      declaredForfeitAmount: '300000',
    });

    expect(await ledger(id, 'DECLARED')).toEqual([
      { entry_type: 'DECLARED_IN', amount: '300000', balance_after: '300000' },
      { entry_type: 'DECLARED_FORFEIT', amount: '-300000', balance_after: '0' },
    ]);
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toEqual([
      {
        type: 'DECLARED_FORFEIT',
        amount: '300000',
        status: 'PENDING',
        customer_id: null,
        provider_id: c.provider.profileId,
        bank_account: PROVIDER_BANK.bank_account,
        held: true,
      },
    ]);
    expect((await declaredComponent(id)).status).toBe('RELEASED');
    expect(
      (
        await sql(
          `SELECT lost_dispute_count FROM customer_profiles WHERE id = $1`,
          [c.customer.profileId],
        )
      )[0].lost_dispute_count,
    ).toBe(1);

    const forCustomer = await detail(id, c.customer.auth);
    expect(forCustomer.settlement).toMatchObject({
      declaredDepositReturned: '0',
      declaredDepositForfeited: '300000',
    });
    const forProvider = await detail(id, c.provider.auth);
    expect(forProvider.settlement.declaredForfeitReceived).toBe('300000');
  });

  it('admin phán cây A mất giá trị → khách nhận đền 3.000.000 và vẫn được trả đủ 300.000', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await toAdminReview(c);
    const res = await resolve(disputeId, [
      { plantId: c.plantA, verdict: 'VALUE_LOST' },
    ]);
    expect(res.body).toMatchObject({
      compensationAmount: '3000000',
      declaredForfeitAmount: '0',
    });
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toMatchObject([
      { type: 'DECLARED_RETURN', amount: '300000', held: false },
    ]);
  });

  it('khiếu nại cả hai cây: A không lỗi, B vườn lỗi → chỉ mất 300.000 của cây A, không tính là thua', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    const disputeId = await toAdminReview(c, [c.plantA, c.plantB]);
    const res = await resolve(disputeId, [
      { plantId: c.plantA, verdict: 'NOT_AT_FAULT' },
      { plantId: c.plantB, verdict: 'SERVICE_FAULT' },
    ]);
    expect(res.body).toMatchObject({
      refundAmount: '200000',
      declaredForfeitAmount: '300000',
    });
    await expectAllBooksZero(id);
    expect(
      (
        await sql(
          `SELECT lost_dispute_count FROM customer_profiles WHERE id = $1`,
          [c.customer.profileId],
        )
      )[0].lost_dispute_count,
    ).toBe(0);
  });

  it('khách rút tranh chấp → không ai kết luận khách sai, trả đủ 300.000', async () => {
    const c = await toReturnAwaiting();
    const id = c.order.orderId;
    await post(`${id}/dispute`, c.customer.auth, {
      reason: 'Cây xuống sắc sau kỳ chăm',
      description: 'Nhận lại cây thì lá héo.',
      plantIds: [c.plantA],
      evidence: [
        { photoUrl: 'https://example.com/cay-heo.jpg', plantId: c.plantA },
      ],
    }).expect(201);
    await post(`${id}/dispute/withdraw`, c.customer.auth).expect(200);
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toMatchObject([
      { type: 'DECLARED_RETURN', amount: '300000' },
    ]);
    expect(
      (
        await sql(
          `SELECT declared_forfeit_amount FROM disputes WHERE service_order_id = $1`,
          [id],
        )
      )[0].declared_forfeit_amount,
    ).toBe('0');
  });

  it('khách từ chối giao cây → mất phí lấy cây như cũ nhưng 300.000 trả đủ', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;
    const res = await post(`${id}/handover/decline`, c.customer.auth, {
      reason: 'Không đồng ý biên bản',
    }).expect(200);
    expect(res.body).toEqual({
      status: 'CANCELLED',
      refundAmount: '424000',
      declaredDepositReturned: '300000',
    });
    await expectAllBooksZero(id);
    expect((await declaredComponent(id)).status).toBe('REFUNDED');
    expect(await declaredDisbursements(id)).toMatchObject([
      { type: 'DECLARED_RETURN', amount: '300000', held: false },
    ]);
  });

  it('vườn huỷ vì không nộp tiền bảo đảm → khách nhận lại 484.000 và 300.000', async () => {
    const c = await toAwaitingConfirm();
    const id = c.order.orderId;
    await post(`${id}/handover/confirm`, c.customer.auth).expect(200);
    await post(`${id}/handover/cancel`, c.provider.auth, {
      reason: 'Không chuẩn bị kịp tiền bảo đảm',
    }).expect(200);
    await expectAllBooksZero(id);
    expect(await declaredDisbursements(id)).toMatchObject([
      { type: 'DECLARED_RETURN', amount: '300000' },
    ]);
    const view = await detail(id, c.customer.auth);
    expect(view.settlement).toMatchObject({
      refundAmount: '484000',
      declaredDepositReturned: '300000',
    });
  });

  it('đơn không có cây khai giá cao → không sinh dòng hoá đơn, sổ khai giá trống, chia tiền như cũ', async () => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    const signed = await post(`${id}/agreement/sign`, provider.auth).expect(
      200,
    );
    expect(signed.body).toMatchObject({
      amountDue: '484000',
      declaredDeposit: '0',
    });
    expect(await declaredComponent(id)).toBeUndefined();
    await seed.webhook(order.orderCode, '484000').expect(200);
    expect(await ledger(id, 'DECLARED')).toEqual([]);
  });
});
