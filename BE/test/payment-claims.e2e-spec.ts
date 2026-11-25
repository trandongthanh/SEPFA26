import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
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
type Row = Record<string, any>;

const CUSTOMER_BANK = {
  bank_name: 'MBBank',
  bank_account: '0123456789',
  bank_holder: 'NGUYEN THI LAN',
};

// TK admin nhập tay khi hoàn tiền không mã (không có người nhận gợi ý).
const OTHER_BANK = {
  bankName: 'VCB',
  bankAccount: '999888777',
  bankHolder: 'TRAN THI LA',
};

const PHOTOS = [
  { photoUrl: 'https://example.com/sao-ke-1.jpg' },
  { photoUrl: 'https://example.com/sao-ke-2.jpg' },
];

// PNG 1×1 hợp lệ (đủ chữ ký 8 byte đầu) cho ca tải biên lai.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const RECEIPT_URL =
  'https://res.cloudinary.com/demo/image/upload/lancare-hub/payment-receipts/bien-lai.jpg';

/**
 * Phiếu báo đã chuyển tiền (khách / vườn kèm ảnh sao kê) + admin hoàn kèm phiếu + biên lai khi "Đã chuyển".
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000 (QR 484.000).
 * Kịch bản chị Lan: chuyển 530.000 quên ghi mã đơn → nộp phiếu → admin hoàn kèm phiếu → chuyển trả kèm biên lai.
 */
describe('Phiếu báo đã chuyển tiền + hoàn kèm phiếu + biên lai (e2e)', () => {
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
    ctx.dataSource.query(query, params) as Promise<Row[]>;

  interface Ctx {
    customer: OrderActor;
    provider: OrderProvider;
    order: DraftOrder;
  }

  const giveCustomerBank = (customer: OrderActor) =>
    sql(
      `UPDATE customer_profiles SET bank_name = $2, bank_account = $3, bank_holder = $4 WHERE id = $1`,
      [
        customer.profileId,
        CUSTOMER_BANK.bank_name,
        CUSTOMER_BANK.bank_account,
        CUSTOMER_BANK.bank_holder,
      ],
    );

  // Đơn DRAFT (phiếu nộp được ở mọi trạng thái đơn).
  const newOrder = async (): Promise<Ctx> => {
    const customer = await seed.customer();
    const provider = await seed.provider();
    const order = await seed.draftOrder(customer, provider);
    await giveCustomerBank(customer);
    return { customer, provider, order };
  };

  // DRAFT → đủ 2 chữ ký (AWAITING_PAYMENT, hoá đơn đã sinh).
  const sign = async (c: Ctx) => {
    const id = c.order.orderId;
    await post(`orders/${id}/submit`, c.customer.auth).expect(200);
    await post(`orders/${id}/negotiation/respond`, c.provider.auth, {
      response: 'ACCEPT',
    }).expect(200);
    await post(`orders/${id}/agreement/sign`, c.customer.auth).expect(200);
    await post(`orders/${id}/agreement/sign`, c.provider.auth).expect(200);
  };

  const toAwaitingPayment = async (): Promise<Ctx> => {
    const c = await newOrder();
    await sign(c);
    return c;
  };

  const submitClaim = (orderId: string, auth: Auth, body: object = {}) =>
    post(`orders/${orderId}/payment-claims`, auth, {
      amount: 530000,
      photos: PHOTOS,
      ...body,
    });

  const claimsOf = async (orderId: string, auth: Auth) =>
    (await get(`orders/${orderId}/payment-claims`, auth).expect(200))
      .body as Row[];

  const unmatchedOpen = async (auth: Auth) =>
    (
      (await get('admin/unmatched-transactions?status=OPEN', auth).expect(200))
        .body as { data: Row[] }
    ).data;

  const refund = (txnId: string, auth: Auth, body: object = {}) =>
    post(`admin/unmatched-transactions/${txnId}/refund`, auth, body);

  const markPaid = (id: string, auth: Auth, body: object) =>
    post(`admin/disbursements/${id}/mark-paid`, auth, body);

  // Toàn bảng sổ ký quỹ: số dòng + tổng + danh sách id — so trước/sau để chắc phiếu không ghi sổ.
  const ledgerSnapshot = async () => {
    const [agg] = await sql(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::text AS sum FROM escrow_ledger`,
    );
    const ids = (await sql(`SELECT id FROM escrow_ledger ORDER BY id`)).map(
      (r) => r.id as string,
    );
    return { count: agg.count as number, sum: agg.sum as string, ids };
  };

  describe('nộp và xem phiếu', () => {
    it('khách nộp (2 ảnh) → CUSTOMER/OPEN; vườn nộp → PROVIDER; mỗi bên chỉ thấy phiếu của mình', async () => {
      const c = await newOrder();
      const id = c.order.orderId;

      const mine = (
        await submitClaim(id, c.customer.auth, {
          transferredAt: '2026-11-25T10:15:00+07:00',
          note: '  Em quên ghi mã đơn  ',
        }).expect(201)
      ).body as Row;
      expect(mine).toMatchObject({
        orderId: id,
        party: 'CUSTOMER',
        status: 'OPEN',
        amount: '530000',
        note: 'Em quên ghi mã đơn',
        rejectReason: null,
        handledAt: null,
        refund: null,
      });
      expect(mine.photos.map((p: Row) => p.photoUrl)).toEqual(
        PHOTOS.map((p) => p.photoUrl),
      );
      expect(new Date(mine.transferredAt).toISOString()).toBe(
        '2026-11-25T03:15:00.000Z',
      );

      const theirs = (
        await submitClaim(id, c.provider.auth, { amount: 800000 }).expect(201)
      ).body as Row;
      expect(theirs).toMatchObject({
        party: 'PROVIDER',
        status: 'OPEN',
        amount: '800000',
        refund: null,
      });

      // Khách không thấy phiếu của vườn và ngược lại.
      const forCustomer = await claimsOf(id, c.customer.auth);
      expect(forCustomer.map((x) => x.id)).toEqual([mine.id]);
      expect(forCustomer[0].photos).toHaveLength(2);
      const forProvider = await claimsOf(id, c.provider.auth);
      expect(forProvider.map((x) => x.id)).toEqual([theirs.id]);
    });

    it('người ngoài đơn → 404 ORDER_NOT_FOUND (cả POST lẫn GET); đơn không tồn tại → 404; admin → 403', async () => {
      const c = await newOrder();
      const outsider = await seed.customer();
      const admin = await seed.admin();

      expect(
        (await submitClaim(c.order.orderId, outsider.auth).expect(404)).body
          .message,
      ).toBe('ORDER_NOT_FOUND');
      expect(
        (
          await get(
            `orders/${c.order.orderId}/payment-claims`,
            outsider.auth,
          ).expect(404)
        ).body.message,
      ).toBe('ORDER_NOT_FOUND');

      const ghost = randomUUID();
      expect(
        (await submitClaim(ghost, c.customer.auth).expect(404)).body.message,
      ).toBe('ORDER_NOT_FOUND');
      expect(
        (
          await get(`orders/${ghost}/payment-claims`, c.customer.auth).expect(
            404,
          )
        ).body.message,
      ).toBe('ORDER_NOT_FOUND');

      await submitClaim(c.order.orderId, admin.auth).expect(403);
      expect(await sql(`SELECT id FROM payment_claims`)).toHaveLength(0);
    });

    it('validation: 0 ảnh, 4 ảnh, amount 0, note > 500 ký tự, ảnh không phải URL → 400', async () => {
      const c = await newOrder();
      const id = c.order.orderId;
      const photo = { photoUrl: 'https://example.com/a.jpg' };

      await submitClaim(id, c.customer.auth, { photos: [] }).expect(400);
      await submitClaim(id, c.customer.auth, {
        photos: [photo, photo, photo, photo],
      }).expect(400);
      await submitClaim(id, c.customer.auth, { amount: 0 }).expect(400);
      await submitClaim(id, c.customer.auth, { note: 'a'.repeat(501) }).expect(
        400,
      );
      await submitClaim(id, c.customer.auth, {
        photos: [{ photoUrl: 'khong-phai-url' }],
      }).expect(400);
      // Bên nộp do BE suy ra — client gửi party bị chặn.
      await submitClaim(id, c.customer.auth, { party: 'PROVIDER' }).expect(400);
      // 3 ảnh (trần) vẫn hợp lệ.
      await submitClaim(id, c.customer.auth, {
        photos: [photo, photo, photo],
      }).expect(201);
    });

    it('phiếu mở thứ 4 cùng bên → 409 PAYMENT_CLAIM_LIMIT_REACHED; bên kia vẫn nộp được', async () => {
      const c = await newOrder();
      const id = c.order.orderId;
      for (let i = 0; i < 3; i++) {
        await submitClaim(id, c.customer.auth).expect(201);
      }
      expect(
        (await submitClaim(id, c.customer.auth).expect(409)).body.message,
      ).toBe('PAYMENT_CLAIM_LIMIT_REACHED');
      await submitClaim(id, c.provider.auth).expect(201);
      expect(await claimsOf(id, c.customer.auth)).toHaveLength(3);
    });
  });

  describe('admin xem và từ chối phiếu', () => {
    it('lọc theo trạng thái + số tiền, có orderCode và submittedBy; không phải admin → 403', async () => {
      const c = await newOrder();
      const id = c.order.orderId;
      const admin = await seed.admin();
      const lan = (await submitClaim(id, c.customer.auth).expect(201))
        .body as Row;
      await submitClaim(id, c.customer.auth, { amount: 250000 }).expect(201);
      await submitClaim(id, c.provider.auth, { amount: 530000 }).expect(201);

      const filtered = (
        await get(
          'admin/payment-claims?status=OPEN&amount=530000',
          admin.auth,
        ).expect(200)
      ).body as Row;
      expect(filtered).toMatchObject({ total: 2, page: 1, limit: 10 });
      expect(
        filtered.data.every(
          (x: Row) => x.amount === '530000' && x.status === 'OPEN',
        ),
      ).toBe(true);
      const row = filtered.data.find((x: Row) => x.id === lan.id);
      expect(row).toMatchObject({
        orderId: id,
        orderCode: c.order.orderCode,
        party: 'CUSTOMER',
        submittedBy: { accountId: c.customer.accountId },
        refund: null,
      });
      expect(row.submittedBy.fullName).toEqual(expect.any(String));
      expect(row.photos).toHaveLength(2);

      expect(
        (
          await get('admin/payment-claims?amount=250000', admin.auth).expect(
            200,
          )
        ).body.total,
      ).toBe(1);
      expect(
        (
          await get('admin/payment-claims?status=REJECTED', admin.auth).expect(
            200,
          )
        ).body.total,
      ).toBe(0);
      await get('admin/payment-claims?status=WHATEVER', admin.auth).expect(400);
      await get('admin/payment-claims?amount=0', admin.auth).expect(400);

      await get('admin/payment-claims', c.customer.auth).expect(403);
      await get('admin/payment-claims', c.provider.auth).expect(403);
    });

    it('từ chối: lý do ngắn 400; OK → REJECTED; lần 2 → 409; id lạ → 404; nộp lại được (phiếu REJECTED không tính giới hạn)', async () => {
      const c = await newOrder();
      const id = c.order.orderId;
      const admin = await seed.admin();
      const claims: Row[] = [];
      for (let i = 0; i < 3; i++) {
        claims.push(
          (await submitClaim(id, c.customer.auth).expect(201)).body as Row,
        );
      }
      const reject = (claimId: string, body: object, auth = admin.auth) =>
        post(`admin/payment-claims/${claimId}/reject`, auth, body);

      await reject(claims[0].id, { reason: 'abc' }).expect(400);
      await reject(claims[0].id, { reason: '   ab    ' }).expect(400);
      await reject(
        claims[0].id,
        {
          reason: 'Ảnh sao kê bị mờ, chụp lại',
        },
        c.customer.auth,
      ).expect(403);

      const rejected = (
        await reject(claims[0].id, {
          reason: '  Ảnh sao kê bị mờ, chụp lại  ',
        }).expect(200)
      ).body as Row;
      expect(rejected).toMatchObject({
        id: claims[0].id,
        status: 'REJECTED',
        rejectReason: 'Ảnh sao kê bị mờ, chụp lại',
        refund: null,
      });
      expect(rejected.handledAt).toEqual(expect.any(String));
      expect(rejected.photos).toHaveLength(2);
      const [saved] = await sql(
        `SELECT handled_by_account_id FROM payment_claims WHERE id = $1`,
        [claims[0].id],
      );
      expect(saved.handled_by_account_id).toBe(admin.accountId);

      expect(
        (await reject(claims[0].id, { reason: 'Từ chối lần hai' }).expect(409))
          .body.message,
      ).toBe('PAYMENT_CLAIM_NOT_OPEN');
      expect(
        (await reject(randomUUID(), { reason: 'Không có phiếu' }).expect(404))
          .body.message,
      ).toBe('PAYMENT_CLAIM_NOT_FOUND');

      // Còn 2 phiếu mở → nộp lại được phiếu mới; tới 3 mở thì lại chặn.
      await submitClaim(id, c.customer.auth).expect(201);
      expect(
        (await submitClaim(id, c.customer.auth).expect(409)).body.message,
      ).toBe('PAYMENT_CLAIM_LIMIT_REACHED');

      // Người nộp thấy lý do từ chối.
      const mine = await claimsOf(id, c.customer.auth);
      expect(mine).toHaveLength(4);
      expect(mine.find((x) => x.id === claims[0].id)).toMatchObject({
        status: 'REJECTED',
        rejectReason: 'Ảnh sao kê bị mờ, chụp lại',
      });
    });
  });

  describe('admin hoàn tiền chưa khớp kèm phiếu', () => {
    it('chị Lan: 530.000 không mã → phiếu 2 ảnh → hoàn kèm phiếu (thiếu ghi chú 400) → mark-paid kèm biên lai → khách thấy PAID; sổ ký quỹ không đổi', async () => {
      const admin = await seed.admin();
      // Một đơn khác đã trả tiền để sổ ký quỹ có dòng thật khi so trước/sau.
      const other = await toAwaitingPayment();
      await seed
        .webhook(other.order.orderCode, other.order.amountDue)
        .expect(200);

      const lan = await toAwaitingPayment();
      const id = lan.order.orderId;
      const before = await ledgerSnapshot();
      expect(before.count).toBeGreaterThan(0);

      const res = await seed.webhook('', '530000').expect(200);
      expect(res.body.ignored).toBe('ORDER_CODE_NOT_FOUND');
      const [txn] = await unmatchedOpen(admin.auth);
      expect(txn).toMatchObject({
        amount: '530000',
        reason: 'NO_CODE',
        order: null,
      });

      const claim = (await submitClaim(id, lan.customer.auth).expect(201))
        .body as Row;

      // Thiếu ghi chú → 400, không có gì thay đổi.
      expect(
        (await refund(txn.id, admin.auth, { claimId: claim.id }).expect(400))
          .body.message,
      ).toBe('RESOLUTION_NOTE_REQUIRED');
      expect((await claimsOf(id, lan.customer.auth))[0]).toMatchObject({
        status: 'OPEN',
        refund: null,
      });
      expect(
        await sql(
          `SELECT id FROM disbursements WHERE source_transaction_id = $1`,
          [txn.id],
        ),
      ).toHaveLength(0);

      const done = (
        await refund(txn.id, admin.auth, {
          claimId: claim.id,
          note: 'Khách nộp phiếu kèm 2 ảnh sao kê, khớp số tiền và giờ',
        }).expect(200)
      ).body as Row;
      expect(done.resolution).toMatchObject({ disbursementStatus: 'PENDING' });

      // Lệnh chi gắn khách (TK hồ sơ khách), KHÔNG gắn đơn của phiếu.
      const list = (await get('admin/disbursements', admin.auth).expect(200))
        .body as { data: Row[] };
      const line = list.data.find((d) => d.sourceTransactionId === txn.id)!;
      expect(line).toMatchObject({
        type: 'UNMATCHED_REFUND',
        amount: '530000',
        orderId: null,
        orderCode: null,
        recipient: 'CUSTOMER',
        customerId: lan.customer.profileId,
        providerId: null,
        isEligible: true,
        status: 'PENDING',
        receiptUrl: null,
        bank: {
          bankName: CUSTOMER_BANK.bank_name,
          bankAccount: CUSTOMER_BANK.bank_account,
          bankHolder: CUSTOMER_BANK.bank_holder,
        },
      });

      const [savedClaim] = await sql(
        `SELECT status, transaction_id, handled_by_account_id FROM payment_claims WHERE id = $1`,
        [claim.id],
      );
      expect(savedClaim).toEqual({
        status: 'RESOLVED',
        transaction_id: txn.id,
        handled_by_account_id: admin.accountId,
      });
      expect((await claimsOf(id, lan.customer.auth))[0]).toMatchObject({
        id: claim.id,
        status: 'RESOLVED',
        refund: { status: 'PENDING', paidAt: null, receiptUrl: null },
      });

      // Admin chuyển trả kèm biên lai.
      const paid = (
        await markPaid(line.id, admin.auth, {
          transferCode: 'FT26330001',
          receiptUrl: RECEIPT_URL,
        }).expect(200)
      ).body as Row;
      expect(paid).toMatchObject({ status: 'PAID', receiptUrl: RECEIPT_URL });

      const [seen] = await claimsOf(id, lan.customer.auth);
      expect(seen.refund).toMatchObject({
        status: 'PAID',
        receiptUrl: RECEIPT_URL,
      });
      expect(seen.refund.paidAt).toEqual(expect.any(String));

      // Admin xem phiếu cũng thấy trạng thái hoàn.
      const adminView = (
        await get('admin/payment-claims?status=RESOLVED', admin.auth).expect(
          200,
        )
      ).body as { data: Row[] };
      expect(adminView.data[0]).toMatchObject({
        id: claim.id,
        refund: { status: 'PAID', receiptUrl: RECEIPT_URL },
      });

      // Phiếu + hoàn + chuyển trả không ghi sổ ký quỹ.
      expect(await ledgerSnapshot()).toEqual(before);
      expect(
        await sql(`SELECT id FROM escrow_ledger WHERE service_order_id = $1`, [
          id,
        ]),
      ).toHaveLength(0);
    });

    it('phiếu đã RESOLVED dùng cho khoản khác → 409 PAYMENT_CLAIM_NOT_OPEN; claimId lạ → 404; phiếu REJECTED → 409', async () => {
      const admin = await seed.admin();
      const c = await newOrder();
      const claim = (
        await submitClaim(c.order.orderId, c.customer.auth).expect(201)
      ).body as Row;
      const note = { note: 'Đối chiếu ảnh sao kê' };

      await seed.webhook('', '530000').expect(200);
      const [first] = await unmatchedOpen(admin.auth);
      await refund(first.id, admin.auth, { claimId: claim.id, ...note }).expect(
        200,
      );

      await seed.webhook('', '530000').expect(200);
      const [second] = await unmatchedOpen(admin.auth);
      expect(second.id).not.toBe(first.id);
      expect(
        (
          await refund(second.id, admin.auth, {
            claimId: claim.id,
            ...note,
          }).expect(409)
        ).body.message,
      ).toBe('PAYMENT_CLAIM_NOT_OPEN');
      expect(
        (
          await refund(second.id, admin.auth, {
            claimId: randomUUID(),
            ...note,
          }).expect(404)
        ).body.message,
      ).toBe('PAYMENT_CLAIM_NOT_FOUND');
      await refund(second.id, admin.auth, {
        claimId: 'khong-phai-uuid',
        ...note,
      }).expect(400);

      const rejected = (
        await submitClaim(c.order.orderId, c.customer.auth).expect(201)
      ).body as Row;
      await post(`admin/payment-claims/${rejected.id}/reject`, admin.auth, {
        reason: 'Sao kê không khớp',
      }).expect(200);
      expect(
        (
          await refund(second.id, admin.auth, {
            claimId: rejected.id,
            ...note,
          }).expect(409)
        ).body.message,
      ).toBe('PAYMENT_CLAIM_NOT_OPEN');

      // Khoản thứ hai vẫn chưa hoàn, phiếu đầu vẫn gắn khoản thứ nhất.
      expect((await unmatchedOpen(admin.auth)).map((t) => t.id)).toEqual([
        second.id,
      ]);
      const [saved] = await sql(
        `SELECT transaction_id FROM payment_claims WHERE id = $1`,
        [claim.id],
      );
      expect(saved.transaction_id).toBe(first.id);
    });

    it('tiền gắn đơn (chuyển thiếu đơn A): phiếu đơn khác → 409 MISMATCH; phiếu của vườn → 409 MISMATCH; đúng đơn đúng bên → 200 RESOLVED', async () => {
      const admin = await seed.admin();
      const a = await toAwaitingPayment();
      // Đơn B của cùng khách.
      const b = await seed.draftOrder(a.customer, a.provider);
      const before = await ledgerSnapshot();

      const res = await seed.webhook(a.order.orderCode, '400000').expect(200);
      expect(res.body.ignored).toBe('INSUFFICIENT_AMOUNT');
      const [txn] = await unmatchedOpen(admin.auth);
      expect(txn.order).toMatchObject({ id: a.order.orderId });

      const onB = (
        await submitClaim(b.orderId, a.customer.auth, {
          amount: 400000,
        }).expect(201)
      ).body as Row;
      const byProvider = (
        await submitClaim(a.order.orderId, a.provider.auth, {
          amount: 400000,
        }).expect(201)
      ).body as Row;
      const right = (
        await submitClaim(a.order.orderId, a.customer.auth, {
          amount: 400000,
        }).expect(201)
      ).body as Row;

      for (const wrong of [onB, byProvider]) {
        expect(
          (await refund(txn.id, admin.auth, { claimId: wrong.id }).expect(409))
            .body.message,
        ).toBe('PAYMENT_CLAIM_MISMATCH');
      }

      // Tiền gắn đơn + TK hồ sơ khách → không cần ghi chú.
      await refund(txn.id, admin.auth, { claimId: right.id }).expect(200);
      const rows = await sql(
        `SELECT id, status, transaction_id FROM payment_claims ORDER BY created_at, id`,
      );
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      expect(byId.get(right.id)).toMatchObject({
        status: 'RESOLVED',
        transaction_id: txn.id,
      });
      expect(byId.get(onB.id)).toMatchObject({
        status: 'OPEN',
        transaction_id: null,
      });
      expect(byId.get(byProvider.id)).toMatchObject({
        status: 'OPEN',
        transaction_id: null,
      });
      const [line] = await sql(
        `SELECT type, amount, service_order_id, customer_id FROM disbursements WHERE source_transaction_id = $1`,
        [txn.id],
      );
      expect(line).toEqual({
        type: 'UNMATCHED_REFUND',
        amount: '400000',
        service_order_id: a.order.orderId,
        customer_id: a.customer.profileId,
      });
      expect(await ledgerSnapshot()).toEqual(before);
    });

    it('hoàn KHÔNG kèm phiếu vẫn như cũ và không chạm phiếu nào', async () => {
      const admin = await seed.admin();
      const c = await newOrder();
      const claim = (
        await submitClaim(c.order.orderId, c.customer.auth).expect(201)
      ).body as Row;

      await seed.webhook('', '530000').expect(200);
      const [txn] = await unmatchedOpen(admin.auth);
      await refund(txn.id, admin.auth, {
        ...OTHER_BANK,
        note: 'Người chuyển gửi ảnh sao kê',
      }).expect(200);

      const [line] = await sql(
        `SELECT customer_id, provider_id, bank_account FROM disbursements WHERE source_transaction_id = $1`,
        [txn.id],
      );
      expect(line).toEqual({
        customer_id: null,
        provider_id: null,
        bank_account: OTHER_BANK.bankAccount,
      });
      const [saved] = await sql(
        `SELECT status, transaction_id, handled_at FROM payment_claims WHERE id = $1`,
        [claim.id],
      );
      expect(saved).toEqual({
        status: 'OPEN',
        transaction_id: null,
        handled_at: null,
      });
    });
  });

  describe('biên lai chuyển khoản', () => {
    it('receipt-upload: không phải admin 403; thiếu file 400; ảnh hợp lệ khi chưa cấu hình Cloudinary → 503', async () => {
      const admin = await seed.admin();
      const customer = await seed.customer();
      const upload = (auth: Auth) =>
        request(http)
          .post(`${API}/admin/disbursements/receipt-upload`)
          .set(auth);

      await upload(customer.auth)
        .attach('file', TINY_PNG, {
          filename: 'bien-lai.png',
          contentType: 'image/png',
        })
        .expect(403);
      expect((await upload(admin.auth).expect(400)).body.message).toBe(
        'IMAGE_FILE_REQUIRED',
      );
      // File giả mạo: mimetype ảnh nhưng nội dung không phải ảnh.
      expect(
        (
          await upload(admin.auth)
            .attach('file', Buffer.from('not an image'), {
              filename: 'gia.png',
              contentType: 'image/png',
            })
            .expect(400)
        ).body.message,
      ).toBe('IMAGE_FILE_INVALID');

      // Không gọi Cloudinary thật: chỉ kiểm khi môi trường test không cấu hình.
      if (!ctx.app.get(ConfigService).get<string>('CLOUDINARY_URL')) {
        expect(
          (
            await upload(admin.auth)
              .attach('file', TINY_PNG, {
                filename: 'bien-lai.png',
                contentType: 'image/png',
              })
              .expect(503)
          ).body.message,
        ).toBe('CLOUDINARY_NOT_CONFIGURED');
      }
    });

    it('mark-paid: receiptUrl không phải URL → 400, lệnh chi vẫn PENDING', async () => {
      const admin = await seed.admin();
      await seed.webhook('', '250000').expect(200);
      const [txn] = await unmatchedOpen(admin.auth);
      await refund(txn.id, admin.auth, {
        ...OTHER_BANK,
        note: 'Người chuyển gửi ảnh sao kê',
      }).expect(200);
      const [{ id: lineId }] = await sql(
        `SELECT id FROM disbursements WHERE source_transaction_id = $1`,
        [txn.id],
      );

      await markPaid(lineId, admin.auth, {
        transferCode: 'FT001',
        receiptUrl: 'khong-phai-url',
      }).expect(400);
      const [row] = await sql(
        `SELECT status, receipt_url FROM disbursements WHERE id = $1`,
        [lineId],
      );
      expect(row).toEqual({ status: 'PENDING', receipt_url: null });

      // Không đính biên lai vẫn chuyển được (biên lai không bắt buộc).
      const paid = (
        await markPaid(lineId, admin.auth, { transferCode: 'FT001' }).expect(
          200,
        )
      ).body as Row;
      expect(paid).toMatchObject({ status: 'PAID', receiptUrl: null });
    });

    it('vườn xem đơn COMPLETED thấy settlement.payout.receiptUrl sau khi admin chuyển tiền công kèm biên lai', async () => {
      const c = await toAwaitingPayment();
      const id = c.order.orderId;
      // Trả tiền → nhận cây → chăm → trả cây → khách xác nhận → COMPLETED (như payout.e2e-spec).
      await seed.webhook(c.order.orderCode, c.order.amountDue).expect(200);
      await post(`orders/${id}/handover/start`, c.provider.auth).expect(201);
      for (const plantId of c.order.plantIds) {
        await post(
          `orders/${id}/handover/plants/${plantId}/assess`,
          c.provider.auth,
          {
            checklist: { leaf: 'xanh' },
            decision: 'ACCEPT',
            isHighRisk: false,
            photos: [{ photoUrl: 'https://example.com/in.jpg' }],
          },
        ).expect(201);
      }
      await post(`orders/${id}/handover/complete`, c.provider.auth).expect(200);
      await post(`orders/${id}/handover/confirm`, c.customer.auth).expect(200);
      await seed.paySecurityDeposit(id);
      await sql(
        `UPDATE service_orders
           SET care_started_at = care_started_at - interval '40 days',
               care_due_at = now() - interval '1 hour'
         WHERE id = $1`,
        [id],
      );
      await post(`orders/${id}/return/start`, c.provider.auth).expect(200);
      for (const plantId of c.order.plantIds) {
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

      const detail = async (auth: Auth) =>
        (await get(`orders/${id}`, auth).expect(200)).body as Row;
      expect((await detail(c.provider.auth)).status).toBe('COMPLETED');
      expect((await detail(c.provider.auth)).settlement.payout).toMatchObject({
        status: 'PENDING',
        receiptUrl: null,
      });

      // Giả lập đã qua 3 ngày đối soát.
      await sql(
        `UPDATE disbursements SET eligible_at = now() - interval '1 minute' WHERE service_order_id = $1`,
        [id],
      );
      const admin = await seed.admin();
      const [{ id: payoutId }] = await sql(
        `SELECT id FROM disbursements WHERE service_order_id = $1 AND type = 'PAYOUT'`,
        [id],
      );
      await markPaid(payoutId, admin.auth, {
        transferCode: 'FT26330002',
        receiptUrl: RECEIPT_URL,
      }).expect(200);

      const payout = (await detail(c.provider.auth)).settlement.payout;
      expect(payout).toMatchObject({ status: 'PAID', receiptUrl: RECEIPT_URL });
      expect(payout.paidAt).toEqual(expect.any(String));
      // Khách không thấy phần payout của vườn.
      expect((await detail(c.customer.auth)).settlement.payout).toBeUndefined();
    });
  });
});
