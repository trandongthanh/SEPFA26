import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CryptoService } from '../../src/crypto/crypto.service';
import type { AuthTestApp } from '../auth-test-app';

const API = '/api/v1';
const PASSWORD = 'matkhau123';

export interface OrderActor {
  accountId: string;
  profileId: string;
  auth: { Authorization: string };
}

export interface OrderProvider extends OrderActor {
  packageId: string;
}

export interface DraftOrder {
  orderId: string;
  orderCode: string;
  plantIds: string[];
  // Phí dịch vụ 6% của provisional_total (sinh lúc đủ 2 chữ ký)
  customerFee: string;
  // provisional_total + customerFee + pickup_fee_snapshot = số khách phải chuyển
  amountDue: string;
}

/**
 * Seed cho e2e luồng đơn: tài khoản qua API đăng ký/đăng nhập thật; hồ sơ, gói, đơn DRAFT
 * (kèm cây + ảnh ban đầu) bằng SQL — bỏ qua bước tạo đơn vì cần dịch vụ tính khoảng cách bên ngoài.
 * Vườn có sẵn SĐT + số CCCD (mã hoá thật) để ACCEPT tạo được hợp đồng.
 */
export class OrderSeed {
  private seq = 0;
  private webhookSeq = Date.now();

  constructor(private readonly ctx: AuthTestApp) {}

  get http(): App {
    return this.ctx.app.getHttpServer() as App;
  }

  private get crypto(): CryptoService {
    return this.ctx.app.get(CryptoService);
  }

  private async account(role: 'CUSTOMER' | 'PROVIDER') {
    const n = ++this.seq;
    const email = `of${n}-${role.toLowerCase()}@example.com`;
    await request(this.http)
      .post(`${API}/auth/register`)
      .send({ email, password: PASSWORD, fullName: `Người ${n}`, role })
      .expect(201);
    const res = await request(this.http)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = res.body as { accessToken: string; account: { id: string } };
    return {
      accountId: body.account.id,
      auth: { Authorization: `Bearer ${body.accessToken}` },
    };
  }

  /** Admin không tự đăng ký được → đăng ký khách, đổi role bằng SQL, đăng nhập lại lấy token ADMIN. */
  async admin(): Promise<{
    accountId: string;
    auth: { Authorization: string };
  }> {
    const { accountId } = await this.account('CUSTOMER');
    await this.ctx.dataSource.query(
      `UPDATE accounts SET role = 'ADMIN', status = 'ACTIVE' WHERE id = $1`,
      [accountId],
    );
    const [{ email }] = (await this.ctx.dataSource.query(
      'SELECT email FROM accounts WHERE id = $1',
      [accountId],
    )) as { email: string }[];
    const res = await request(this.http)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = res.body as { accessToken: string };
    return { accountId, auth: { Authorization: `Bearer ${body.accessToken}` } };
  }

  async customer(): Promise<OrderActor> {
    const account = await this.account('CUSTOMER');
    const [{ id }] = (await this.ctx.dataSource.query(
      'INSERT INTO customer_profiles (account_id) VALUES ($1) RETURNING id',
      [account.accountId],
    )) as { id: string }[];
    return { ...account, profileId: id };
  }

  async provider(): Promise<OrderProvider> {
    const account = await this.account('PROVIDER');
    const n = String(this.seq).padStart(4, '0');
    // SĐT ở accounts, số CCCD ở provider_profiles — đều là ciphertext như code thật lưu.
    await this.ctx.dataSource.query(
      'UPDATE accounts SET phone = $2 WHERE id = $1',
      [account.accountId, this.crypto.encrypt(`090912${n}`)],
    );
    const [{ id }] = (await this.ctx.dataSource.query(
      `INSERT INTO provider_profiles
         (account_id, provider_type, display_name, verification_status, cccd_number)
       VALUES ($1, 'NURSERY', 'Vườn Lan', 'APPROVED', $2) RETURNING id`,
      [account.accountId, this.crypto.encrypt(`00123456${n}`)],
    )) as { id: string }[];
    const [{ id: packageId }] = (await this.ctx.dataSource.query(
      `INSERT INTO service_packages
         (provider_id, name, duration_days, report_frequency_days, max_plants, base_price,
          is_active, approval_status)
       VALUES ($1, 'Gói thường', 30, 7, 5, 200000, true, 'APPROVED') RETURNING id`,
      [id],
    )) as { id: string }[];
    return { ...account, profileId: id, packageId };
  }

  /** Đơn DRAFT `plantCount` cây, 200.000đ/cây, phí lấy cây 60.000đ; `withPhotos=false` → cây thiếu ảnh. */
  async draftOrder(
    customer: OrderActor,
    provider: OrderProvider,
    { plantCount = 2, withPhotos = true } = {},
  ): Promise<DraftOrder> {
    // Đúng định dạng LANCARE + 8 hex để webhook SePay tách được mã đơn từ nội dung chuyển khoản.
    const orderCode = `LANCARE${randomBytes(4).toString('hex').toUpperCase()}`;
    const provisional = 200000 * plantCount;
    const [{ id: orderId }] = (await this.ctx.dataSource.query(
      `INSERT INTO service_orders
         (order_code, customer_id, provider_id, service_package_id, status, plant_count,
          base_price_snapshot, pickup_fee_snapshot, duration_days_snapshot,
          report_frequency_snapshot, provisional_total, scheduled_pickup_at,
          pickup_gps_lat, pickup_gps_lng)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5, 200000, 60000, 30, 7, $6,
               now() + interval '1 day', 10.77, 106.70)
       RETURNING id`,
      [
        orderCode,
        customer.profileId,
        provider.profileId,
        provider.packageId,
        plantCount,
        provisional,
      ],
    )) as { id: string }[];

    const plantIds: string[] = [];
    for (let i = 1; i <= plantCount; i++) {
      const [{ id: plantId }] = (await this.ctx.dataSource.query(
        `INSERT INTO plants (service_order_id, name) VALUES ($1, $2) RETURNING id`,
        [orderId, `Lan ${i}`],
      )) as { id: string }[];
      plantIds.push(plantId);
      if (withPhotos) {
        await this.ctx.dataSource.query(
          `INSERT INTO initial_photos (plant_id, photo_url) VALUES ($1, $2)`,
          [plantId, `https://example.com/lan-${i}.jpg`],
        );
      }
    }
    // Số cố định (6% của 200.000 × n chia hết) để test đọc như đơn mẫu: 2 cây → 24.000, tổng 484.000.
    const customerFee = (provisional * 6) / 100;
    return {
      orderId,
      orderCode,
      plantIds,
      customerFee: String(customerFee),
      amountDue: String(provisional + customerFee + 60000),
    };
  }

  /** Gửi webhook SePay tiền vào cho đơn; `id` truyền vào để giả lập SePay gửi lại cùng giao dịch. */
  webhook(orderCode: string, amount: string, id = ++this.webhookSeq) {
    const config = this.ctx.app.get(ConfigService);
    return request(this.http)
      .post(`${API}/webhooks/sepay`)
      .set('Authorization', `Apikey ${config.get<string>('SEPAY_WEBHOOK_KEY')}`)
      .send({
        id,
        gateway: 'MBBank',
        transactionDate: '2026-11-11 10:00:00',
        accountNumber: config.get<string>('BANK_ACCOUNT_NUMBER'),
        code: null,
        content: `CK ${orderCode} thanh toan`,
        transferType: 'in',
        transferAmount: Number(amount),
        accumulated: Number(amount),
        subAccount: null,
        referenceCode: `FT${id}`,
      });
  }
}
