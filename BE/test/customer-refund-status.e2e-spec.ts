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

type Auth = { Authorization: string };
type Row = Record<string, any>;

const CUSTOMER_BANK = {
  bank_name: 'MBBank',
  bank_account: '0123456789',
  bank_holder: 'NGUYEN THI LAN',
};

const RECEIPT_URL =
  'https://res.cloudinary.com/demo/image/upload/lancare-hub/payment-receipts/bien-lai.jpg';

// Đúng 7 khoá của một lệnh chi khách thấy — không có tài khoản, mã giao dịch, ghi chú admin.
const VIEW_KEYS = [
  'amount',
  'eligibleAt',
  'id',
  'paidAt',
  'receiptUrl',
  'status',
  'type',
];

/**
 * Khách xem tiền hoàn của đơn đã chuyển chưa: `customerDisbursements` trong GET /orders/:orderId.
 * Đơn mẫu: 2 cây × 200.000, phí 6% = 24.000, phí lấy cây 60.000 → khách trả 484.000;
 * có khai giá (cây A khai 3.000.000) thì thêm 300.000 tiền bảo đảm khai giá → 784.000.
 * Huỷ sớm → REFUND 484.000 + DECLARED_RETURN 300.000. Huỷ muộn → khách REFUND 424.000, vườn PAYOUT 60.000.
 */
describe('Khách xem trạng thái tiền hoàn của đơn (e2e)', () => {
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
      .body as Row;

  const markPaid = (id: string, auth: Auth, body: object) =>
    request(http)
      .post(`${API}/admin/disbursements/${id}/mark-paid`)
      .set(auth)
      .send(body);

  const sql = (query: string, params: unknown[] = []) =>
    ctx.dataSource.query(query, params) as Promise<Row[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
    id: string;
  }

  // Đưa đơn mẫu tới AWAITING_PAYMENT (đủ 2 chữ ký) hoặc PAID bằng API thật; khách có sẵn tài khoản nhận tiền.
  const to = async (
    stage: 'AWAITING_PAYMENT' | 'PAID',
    { declared = false } = {},
  ): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    const id = order.orderId;
    await sql(
      `UPDATE customer_profiles SET bank_name = $2, bank_account = $3, bank_holder = $4 WHERE id = $1`,
      [
        customer.profileId,
        CUSTOMER_BANK.bank_name,
        CUSTOMER_BANK.bank_account,
        CUSTOMER_BANK.bank_holder,
      ],
    );
    if (declared) {
      await sql(
        `UPDATE plants SET is_value_declared = true, declared_value = 3000000,
                declared_deposit = 300000 WHERE id = $1`,
        [order.plantIds[0]],
      );
    }
    await post(`${id}/submit`, customer.auth).expect(200);
    await post(`${id}/negotiation/respond`, provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`${id}/agreement/sign`, customer.auth).expect(200);
    await post(`${id}/agreement/sign`, provider.auth).expect(200);
    const c = { customer, provider, order, id };
    if (stage === 'AWAITING_PAYMENT') return c;
    await seed
      .webhook(order.orderCode, declared ? '784000' : order.amountDue)
      .expect(200);
    return c;
  };

  // Tua giờ: đặt giờ hẹn lấy cây cách hiện tại `offsetMs`.
  const setPickup = (orderId: string, offsetMs: number) =>
    sql(`UPDATE service_orders SET scheduled_pickup_at = $2 WHERE id = $1`, [
      orderId,
      new Date(Date.now() + offsetMs),
    ]);

  const byType = (rows: Row[], type: string) => {
    const row = rows.find((item) => item.type === type);
    if (!row) {
      throw new Error(`Không có lệnh chi ${type}: ${JSON.stringify(rows)}`);
    }
    return row;
  };

  const expectOnlyViewKeys = (rows: Row[]) => {
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(VIEW_KEYS);
      expect(row).not.toHaveProperty('bankAccount');
      expect(row).not.toHaveProperty('transferCode');
      expect(row).not.toHaveProperty('note');
    }
  };

  it('đơn chưa thanh toán → khách thấy customerDisbursements: []', async () => {
    const c = await to('AWAITING_PAYMENT');
    const view = await detail(c.id, c.customer.auth);
    expect(view.customerDisbursements).toEqual([]);
  });

  it('khách huỷ sớm đơn có khai giá → 2 dòng PENDING; admin chuyển REFUND kèm biên lai → chỉ dòng đó PAID; vườn không thấy khoá', async () => {
    const c = await to('PAID', { declared: true });
    await post(`${c.id}/cancel`, c.customer.auth, {
      reason: 'Đổi kế hoạch',
    }).expect(200);

    const before = (await detail(c.id, c.customer.auth))
      .customerDisbursements as Row[];
    expect(before).toHaveLength(2);
    expectOnlyViewKeys(before);
    expect(byType(before, 'REFUND')).toMatchObject({
      amount: '484000',
      status: 'PENDING',
      paidAt: null,
      receiptUrl: null,
    });
    expect(byType(before, 'DECLARED_RETURN')).toMatchObject({
      amount: '300000',
      status: 'PENDING',
      paidAt: null,
      receiptUrl: null,
    });
    for (const row of before) {
      expect(row.eligibleAt).toEqual(expect.any(String));
    }
    // Thứ tự khớp DB: created_at rồi id tăng (hai dòng sinh cùng transaction → xếp theo id).
    const ordered = await sql(
      `SELECT id FROM disbursements WHERE service_order_id = $1 AND customer_id = $2
        ORDER BY created_at, id`,
      [c.id, c.customer.profileId],
    );
    expect(before.map((row) => row.id)).toEqual(ordered.map((row) => row.id));

    // Admin bấm "Đã chuyển" dòng REFUND kèm biên lai.
    const admin = await seed.admin();
    const refundId = byType(before, 'REFUND').id as string;
    await markPaid(refundId, admin.auth, {
      transferCode: 'FT26331001',
      note: 'Chuyển qua MBBank',
      receiptUrl: RECEIPT_URL,
    }).expect(200);

    const after = (await detail(c.id, c.customer.auth))
      .customerDisbursements as Row[];
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    expectOnlyViewKeys(after);
    const paid = byType(after, 'REFUND');
    expect(paid).toMatchObject({
      id: refundId,
      amount: '484000',
      status: 'PAID',
      receiptUrl: RECEIPT_URL,
    });
    expect(paid.paidAt).toEqual(expect.any(String));
    expect(byType(after, 'DECLARED_RETURN')).toMatchObject({
      status: 'PENDING',
      paidAt: null,
      receiptUrl: null,
    });

    // Vườn xem cùng đơn → không có khoá customerDisbursements.
    const providerView = await detail(c.id, c.provider.auth);
    expect(providerView).not.toHaveProperty('customerDisbursements');
    expect(providerView).toHaveProperty('settlement');
  });

  it('khách huỷ muộn (vườn giữ phí lấy cây) → khách chỉ thấy REFUND 424.000, không thấy PAYOUT của vườn', async () => {
    const c = await to('PAID');
    await setPickup(c.id, HOUR_MS);
    const res = await post(`${c.id}/cancel`, c.customer.auth, {
      reason: 'Bận đột xuất',
    }).expect(200);
    expect(res.body.cancelCode).toBe('CUSTOMER_CANCELLED_LATE');

    // Trong DB đơn có cả lệnh của vườn.
    const all = await sql(
      `SELECT type FROM disbursements WHERE service_order_id = $1 ORDER BY type`,
      [c.id],
    );
    expect(all.map((row) => row.type)).toEqual(['PAYOUT', 'REFUND']);

    const rows = (await detail(c.id, c.customer.auth))
      .customerDisbursements as Row[];
    expectOnlyViewKeys(rows);
    expect(rows.map((row) => [row.type, row.amount, row.status])).toEqual([
      ['REFUND', '424000', 'PENDING'],
    ]);
  });

  it('khách khác xem đơn → 404 ORDER_NOT_FOUND', async () => {
    const c = await to('PAID', { declared: true });
    await post(`${c.id}/cancel`, c.customer.auth, {
      reason: 'Đổi kế hoạch',
    }).expect(200);
    const stranger = await seed.customer();
    const res = await request(http)
      .get(`${API}/orders/${c.id}`)
      .set(stranger.auth)
      .expect(404);
    expect(res.body.message).toBe('ORDER_NOT_FOUND');
  });
});
