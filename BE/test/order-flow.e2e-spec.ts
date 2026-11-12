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
 * Đặc tả hành vi luồng đơn HIỆN TẠI (DRAFT → IN_CARE) trên Postgres thật.
 * Viết trước khi gom việc đổi trạng thái về OrderStateService: refactor xong, file này phải pass
 * nguyên vẹn — chứng minh hành vi và response không đổi.
 */
describe('Order flow DRAFT → IN_CARE (e2e)', () => {
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

  const statusOf = async (orderId: string, auth: { Authorization: string }) => {
    const res = await request(http)
      .get(`${API}/orders/${orderId}`)
      .set(auth)
      .expect(200);
    return res.body.status as string;
  };

  const assessBody = (decision = 'ACCEPT') => ({
    checklist: { leaf: 'xanh', root: 'chắc' },
    decision,
    isHighRisk: decision === 'ACCEPT_HIGH_RISK',
    photos: [{ photoUrl: 'https://example.com/assess.jpg' }],
  });

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  const setup = async (opts?: {
    plantCount?: number;
    withPhotos?: boolean;
  }): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider, opts);
    return { customer, provider, order };
  };

  // Các bước dựng sẵn — mỗi bước kiểm luôn status code + trạng thái trả về.
  const submit = (c: Ctx) =>
    post(`${c.order.orderId}/submit`, c.customer.auth).expect(200);
  const accept = (c: Ctx) =>
    post(`${c.order.orderId}/negotiation/respond`, c.provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
  const signBoth = async (c: Ctx) => {
    await post(`${c.order.orderId}/agreement/sign`, c.customer.auth).expect(200);
    return post(`${c.order.orderId}/agreement/sign`, c.provider.auth).expect(
      200,
    );
  };
  const pay = (c: Ctx) =>
    seed.webhook(c.order.orderCode, c.order.amountDue).expect(200);
  const toPaid = async (c: Ctx) => {
    await submit(c);
    await accept(c);
    await signBoth(c);
    await pay(c);
  };

  it('luồng chính: submit → ACCEPT → ký 2 bên → SePay → bàn giao → khách xác nhận → IN_CARE', async () => {
    const c = await setup();
    const { orderId, plantIds } = c.order;

    const submitted = await submit(c);
    expect(submitted.body.status).toBe('PENDING_PROVIDER');

    const accepted = await accept(c);
    expect(accepted.body).toMatchObject({ status: 'AGREEMENT_PENDING' });
    expect(accepted.body.agreementId).toEqual(expect.any(String));

    const first = await post(
      `${orderId}/agreement/sign`,
      c.customer.auth,
    ).expect(200);
    expect(first.body).toMatchObject({
      signed: ['CUSTOMER'],
      waitingFor: ['PROVIDER'],
    });
    const second = await post(
      `${orderId}/agreement/sign`,
      c.provider.auth,
    ).expect(200);
    expect(second.body).toEqual({
      status: 'AWAITING_PAYMENT',
      amountDue: c.order.amountDue,
      customerFee: c.order.customerFee,
    });

    const paid = await pay(c);
    expect(paid.body).toMatchObject({ success: true, status: 'PAID' });
    expect(await statusOf(orderId, c.customer.auth)).toBe('PAID');
    const ledger = (await ctx.dataSource.query(
      'SELECT entry_type, amount FROM escrow_ledger WHERE service_order_id = $1',
      [orderId],
    )) as { entry_type: string; amount: string }[];
    expect(ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: c.order.amountDue },
    ]);

    const started = await post(
      `${orderId}/handover/start`,
      c.provider.auth,
    ).expect(201);
    expect(started.body.status).toBe('HANDOVER_IN_PROGRESS');

    for (const plantId of plantIds) {
      await post(
        `${orderId}/handover/plants/${plantId}/assess`,
        c.provider.auth,
        assessBody(),
      ).expect(201);
    }
    const completed = await post(
      `${orderId}/handover/complete`,
      c.provider.auth,
    ).expect(200);
    expect(completed.body.finalTotal).toBe('400000');
    expect(await statusOf(orderId, c.provider.auth)).toBe(
      'HANDOVER_AWAITING_CONFIRM',
    );

    const confirmed = await post(
      `${orderId}/handover/confirm`,
      c.customer.auth,
    ).expect(200);
    expect(confirmed.body).toMatchObject({
      status: 'IN_CARE',
      finalTotal: '400000',
    });
    const [order] = (await ctx.dataSource.query(
      'SELECT care_started_at, care_due_at, final_locked_at FROM service_orders WHERE id = $1',
      [orderId],
    )) as {
      care_started_at: Date;
      care_due_at: Date;
      final_locked_at: Date;
    }[];
    const days =
      (order.care_due_at.getTime() - order.care_started_at.getTime()) /
      86_400_000;
    expect(days).toBe(30);
    expect(order.final_locked_at).not.toBeNull();
  });

  it('vườn REJECT → REJECTED, sau đó ACCEPT bị 409', async () => {
    const c = await setup();
    await submit(c);
    const rejected = await post(
      `${c.order.orderId}/negotiation/respond`,
      c.provider.auth,
      { response: 'REJECT' },
    ).expect(200);
    expect(rejected.body).toEqual({ status: 'REJECTED' });
    const again = await post(
      `${c.order.orderId}/negotiation/respond`,
      c.provider.auth,
      { response: 'ACCEPT' },
    ).expect(409);
    expect(again.body.message).toBe('INVALID_STATE_TRANSITION');
  });

  it('cây thiếu ảnh → 400 MISSING_INITIAL_PHOTO, đơn vẫn DRAFT', async () => {
    const c = await setup({ withPhotos: false });
    const res = await post(`${c.order.orderId}/submit`, c.customer.auth).expect(
      400,
    );
    expect(res.body.message).toBe('MISSING_INITIAL_PHOTO');
    expect(await statusOf(c.order.orderId, c.customer.auth)).toBe('DRAFT');
  });

  it('submit 2 lần cùng lúc → đúng 1 request thắng, còn lại 409', async () => {
    const c = await setup();
    const results = await Promise.all([
      post(`${c.order.orderId}/submit`, c.customer.auth),
      post(`${c.order.orderId}/submit`, c.customer.auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const [{ count }] = (await ctx.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM negotiations WHERE service_order_id = $1',
      [c.order.orderId],
    )) as { count: number }[];
    expect(count).toBe(1);
  });

  it('2 bên ký cùng lúc → đơn AWAITING_PAYMENT đúng 1 lần, không sinh trùng khoản phải trả', async () => {
    const c = await setup();
    await submit(c);
    await accept(c);
    const results = await Promise.all([
      post(`${c.order.orderId}/agreement/sign`, c.customer.auth),
      post(`${c.order.orderId}/agreement/sign`, c.provider.auth),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await statusOf(c.order.orderId, c.customer.auth)).toBe(
      'AWAITING_PAYMENT',
    );
    const [{ count }] = (await ctx.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM payment_components WHERE service_order_id = $1',
      [c.order.orderId],
    )) as { count: number }[];
    expect(count).toBe(2); // PACKAGE_PRICE + PICKUP_FEE
  });

  it('phí 6%: QR đòi 484.000; chuyển số cũ 460.000 bị thiếu tiền; chuyển đủ → PAID, DEPOSIT 484.000', async () => {
    const c = await setup();
    await submit(c);
    await accept(c);
    const signed = await signBoth(c);
    expect(signed.body).toEqual({
      status: 'AWAITING_PAYMENT',
      amountDue: '484000',
      customerFee: '24000',
    });

    const qr = await post(
      `${c.order.orderId}/payment/qr`,
      c.customer.auth,
    ).expect(200);
    // Mobile đọc đúng 6 field này — chỉ số tiền đổi.
    expect(Object.keys(qr.body).sort()).toEqual(
      [
        'amount',
        'bankAccountName',
        'bankAccountNumber',
        'bankBin',
        'qrImageUrl',
        'transferContent',
      ].sort(),
    );
    expect(qr.body.amount).toBe('484000');
    expect(qr.body.qrImageUrl).toContain('amount=484000');
    expect(qr.body.transferContent).toBe(c.order.orderCode);

    const old = await seed.webhook(c.order.orderCode, '460000').expect(200);
    expect(old.body).toMatchObject({ ignored: 'INSUFFICIENT_AMOUNT' });
    expect(await statusOf(c.order.orderId, c.customer.auth)).toBe(
      'AWAITING_PAYMENT',
    );

    const paid = await seed.webhook(c.order.orderCode, '484000').expect(200);
    expect(paid.body).toMatchObject({ success: true, status: 'PAID' });
    const ledger = (await ctx.dataSource.query(
      'SELECT entry_type, amount, balance_after FROM escrow_ledger WHERE service_order_id = $1',
      [c.order.orderId],
    )) as { entry_type: string; amount: string; balance_after: string }[];
    expect(ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
    ]);
    const components = (await ctx.dataSource.query(
      `SELECT component_type, amount, customer_fee, status FROM payment_components
        WHERE service_order_id = $1 ORDER BY component_type`,
      [c.order.orderId],
    )) as Record<string, string>[];
    expect(components).toEqual([
      {
        component_type: 'PACKAGE_PRICE',
        amount: '400000',
        customer_fee: '24000',
        status: 'PAID',
      },
      {
        component_type: 'PICKUP_FEE',
        amount: '60000',
        customer_fee: '0',
        status: 'PAID',
      },
    ]);
  });

  it('webhook: thiếu tiền → bỏ qua, đơn đứng yên; gửi lại cùng id → duplicated; đơn đã PAID → bỏ qua', async () => {
    const c = await setup();
    await submit(c);
    await accept(c);
    await signBoth(c);

    const short = await seed
      .webhook(c.order.orderCode, '100000')
      .expect(200);
    expect(short.body).toMatchObject({ ignored: 'INSUFFICIENT_AMOUNT' });
    expect(await statusOf(c.order.orderId, c.customer.auth)).toBe(
      'AWAITING_PAYMENT',
    );

    const paid = await seed
      .webhook(c.order.orderCode, c.order.amountDue, 990001)
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    const replay = await seed
      .webhook(c.order.orderCode, c.order.amountDue, 990001)
      .expect(200);
    expect(replay.body).toMatchObject({ duplicated: true });

    const late = await seed
      .webhook(c.order.orderCode, c.order.amountDue)
      .expect(200);
    expect(late.body).toMatchObject({ ignored: 'ORDER_NOT_AWAITING_PAYMENT' });
    const deposits = (await ctx.dataSource.query(
      `SELECT 1 FROM escrow_ledger WHERE service_order_id = $1 AND entry_type = 'DEPOSIT'`,
      [c.order.orderId],
    )) as unknown[];
    expect(deposits).toHaveLength(1);
  });

  it('gọi sai chặng → 409 INVALID_STATE_TRANSITION', async () => {
    const c = await setup();
    await submit(c);
    await accept(c);
    // Chưa thanh toán mà vườn bắt đầu bàn giao.
    const start = await post(
      `${c.order.orderId}/handover/start`,
      c.provider.auth,
    ).expect(409);
    expect(start.body.message).toBe('INVALID_STATE_TRANSITION');
    // Chưa chốt bàn giao mà khách xác nhận.
    await signBoth(c);
    await pay(c);
    const confirm = await post(
      `${c.order.orderId}/handover/confirm`,
      c.customer.auth,
    ).expect(409);
    expect(confirm.body.message).toBe('INVALID_STATE_TRANSITION');
  });

  it('vườn từ chối 1 cây lúc nhận → giá chốt còn 1 cây, xác nhận ghi bút toán hoàn', async () => {
    const c = await setup();
    await toPaid(c);
    const [keep, reject] = c.order.plantIds;
    await post(`${c.order.orderId}/handover/start`, c.provider.auth).expect(
      201,
    );
    await post(
      `${c.order.orderId}/handover/plants/${keep}/assess`,
      c.provider.auth,
      assessBody(),
    ).expect(201);
    await post(
      `${c.order.orderId}/handover/plants/${reject}/assess`,
      c.provider.auth,
      assessBody('REJECT'),
    ).expect(201);
    const completed = await post(
      `${c.order.orderId}/handover/complete`,
      c.provider.auth,
    ).expect(200);
    expect(completed.body.finalTotal).toBe('200000');

    await post(`${c.order.orderId}/handover/confirm`, c.customer.auth).expect(
      200,
    );
    const ledger = (await ctx.dataSource.query(
      `SELECT entry_type, amount, balance_after FROM escrow_ledger
        WHERE service_order_id = $1 ORDER BY created_at`,
      [c.order.orderId],
    )) as { entry_type: string; amount: string; balance_after: string }[];
    // 484.000 = 400.000 + 6% (24.000) + 60.000. REFUND chưa hoàn phần 6% của cây bị từ chối
    // (đã ghi nhận, chờ mentor) nên số dư còn 284.000.
    expect(ledger).toEqual([
      { entry_type: 'DEPOSIT', amount: '484000', balance_after: '484000' },
      { entry_type: 'REFUND', amount: '-200000', balance_after: '284000' },
    ]);
  });
});
