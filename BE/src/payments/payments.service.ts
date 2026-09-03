import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { extractOrderCode } from '../orders/order-code';
import { assertTransition } from '../orders/order-status';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentComponent)
    private readonly componentRepo: Repository<PaymentComponent>,
    @InjectRepository(PaymentTransaction)
    private readonly transactionRepo: Repository<PaymentTransaction>,
    @InjectRepository(PaymentWebhookLog)
    private readonly webhookLogRepo: Repository<PaymentWebhookLog>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * POST /orders/:id/payment/qr — trả thông tin chuyển khoản + URL ảnh VietQR.
   * Đọc-tính-trả, không ghi DB → gọi lại bao nhiêu lần cũng được.
   * Số tiền + nội dung CK do BE quyết (QR nhúng sẵn) — khách chỉ quét và bấm.
   */
  async getPaymentQr(accountId: string, orderId: string) {
    const customer = await this.customerRepo.findOne({ where: { accountId } });
    if (!customer) {
      throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, customerId: customer.id },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    if (order.status !== 'AWAITING_PAYMENT') {
      throw new ConflictException('INVALID_STATE_TRANSITION');
    }

    const amount = await this.sumPendingComponents(order.id);
    const bin = this.config.get<string>('BANK_BIN')!;
    const accountNumber = this.config.get<string>('BANK_ACCOUNT_NUMBER')!;
    const accountName = this.config.get<string>('BANK_ACCOUNT_NAME')!;
    const qrImageUrl =
      `https://img.vietqr.io/image/${bin}-${accountNumber}-compact2.png` +
      `?amount=${amount}&addInfo=${order.orderCode}` +
      `&accountName=${encodeURIComponent(accountName)}`;

    return {
      qrImageUrl,
      bankBin: bin,
      bankAccountNumber: accountNumber,
      bankAccountName: accountName,
      amount,
      transferContent: order.orderCode,
    };
  }

  /**
   * POST /webhooks/sepay — tiền vào → PAID.
   * Trình tự sống còn (mỗi bước có lý do, đổi thứ tự là sinh lỗi cũ):
   * (1) GHI LOG TRƯỚC MỌI THỨ — kể cả khi auth sai vẫn còn dấu vết trong DB;
   *     UNIQUE sepay_txn_id = chốt idempotency, nhưng trùng KHÔNG đồng nghĩa
   *     đã xử lý: phải đọc lại processed — false là lần trước chết dở, xử lý tiếp.
   * (2) Soi Apikey constant-time.
   * (3) Tự validate body thô bằng DTO với luật mềm (field lạ bỏ qua, không 400).
   * (4) Đối chiếu: đúng chiều tiền vào + ĐÚNG số tài khoản của mình.
   * (5) Mọi ca tiền thật vào mà không xử lý được → vẫn ghi transactions
   *     (PENDING, có thể chưa gắn đơn) — sổ tài chính không được trắng.
   * (6) Đủ tiền → 1 transaction DB: TRANSACTION + DEPOSIT ledger
   *     + components PAID + đơn PAID + log processed. THU ĐỦ (escrow),
   *     không thanh toán một phần. Mọi ca "không xử lý" đều trả 200
   *     (trả 4xx là SePay dội lại vô hạn).
   */
  async handleSepayWebhook(
    authorization: string | undefined,
    rawBody: Record<string, unknown>,
  ) {
    // (1) Log trước — id thiếu/hỏng vẫn phải ghi được: sinh khóa thay thế.
    const rawId = rawBody['id'];
    const sepayTxnId =
      typeof rawId === 'number' ||
      (typeof rawId === 'string' && rawId.trim() !== '')
        ? String(rawId).trim()
        : `INVALID:${randomUUID()}`;

    let log: PaymentWebhookLog;
    try {
      log = await this.webhookLogRepo.save(
        this.webhookLogRepo.create({
          sepayTxnId,
          rawPayload: rawBody,
          processed: false,
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) {
        throw err;
      }
      const existing = await this.webhookLogRepo.findOne({
        where: { sepayTxnId },
      });
      if (!existing) {
        throw err;
      }
      if (existing.processed) {
        // Trùng thật (SePay retry sau khi mình đã xử lý xong) — không lặp lại.
        return { success: true, duplicated: true };
      }
      // Lần trước chết giữa chừng → dùng lại dòng log cũ, xử lý tiếp.
      log = existing;
    }

    // (2) Auth SAU log: key lệch thì 401 nhưng DB vẫn còn bằng chứng cú gọi.
    this.assertWebhookKey(authorization);

    // (3) Validate luật mềm: áp khuôn DTO lên body thô, field lạ chỉ bị bỏ.
    const dto = plainToInstance(SepayWebhookDto, rawBody);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      const fields = errors.map((e) => e.property).join(', ');
      this.logger.warn(
        `Webhook ${sepayTxnId}: payload không hợp lệ (${fields})`,
      );
      return { success: true, ignored: 'INVALID_PAYLOAD' };
    }

    if (dto.transferType !== 'in') {
      return { success: true, ignored: 'NOT_INCOMING' };
    }

    // (4) Tiền phải vào ĐÚNG tài khoản mình theo dõi — lệch là không phải
    // tiền của hệ thống, chỉ ghi log, không ghi sổ tài chính.
    const expectedAccount = this.config.get<string>('BANK_ACCOUNT_NUMBER')!;
    if (dto.accountNumber !== expectedAccount) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: tài khoản nhận ${dto.accountNumber} không khớp cấu hình`,
      );
      return { success: true, ignored: 'ACCOUNT_MISMATCH' };
    }

    const transferAmount = BigInt(dto.transferAmount);
    if (transferAmount <= 0n) {
      this.logger.warn(`Webhook ${sepayTxnId}: số tiền 0, bỏ qua`);
      return { success: true, ignored: 'ZERO_AMOUNT' };
    }

    // Từ đây trở xuống: tiền THẬT đã vào tài khoản mình — mọi nhánh thoát
    // đều phải để lại dấu vết trong transactions (5).
    const orderCode = extractOrderCode(dto.content ?? '');
    if (!orderCode) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: không tìm thấy mã đơn trong nội dung CK`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, null);
      return { success: true, ignored: 'ORDER_CODE_NOT_FOUND' };
    }

    const order = await this.orderRepo.findOne({ where: { orderCode } });
    if (!order) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: mã ${orderCode} không khớp đơn nào`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, null);
      return { success: true, ignored: 'ORDER_NOT_MATCHED' };
    }
    await this.webhookLogRepo.update(log.id, { matchedOrderId: order.id });

    if (order.status !== 'AWAITING_PAYMENT') {
      this.logger.warn(
        `Webhook ${sepayTxnId}: đơn ${orderCode} đang ${order.status}, bỏ qua`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, order.id);
      return { success: true, ignored: 'ORDER_NOT_AWAITING_PAYMENT' };
    }

    const amountDue = BigInt(await this.sumPendingComponents(order.id));
    if (transferAmount < amountDue) {
      // KHÔNG thanh toán một phần — đơn đứng yên, tiền vẫn vào sổ chờ admin.
      this.logger.warn(
        `Webhook ${sepayTxnId}: đơn ${orderCode} thiếu tiền (nhận ${transferAmount}, cần ${amountDue})`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, order.id);
      return { success: true, ignored: 'INSUFFICIENT_AMOUNT' };
    }

    // (6) Đủ tiền → nguyên tử hoá 5 thao tác trong 1 transaction DB.
    assertTransition(order.status, 'PAID');
    const processed = await this.dataSource.transaction(async (manager) => {
      // Khóa dòng đơn + re-check: 2 webhook khác txnId cùng trả 1 đơn chỉ 1 cái ăn.
      const lockedOrder = await manager.findOne(ServiceOrder, {
        where: { id: order.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!lockedOrder || lockedOrder.status !== 'AWAITING_PAYMENT') {
        return false;
      }

      // Retry sau crash có thể đã để lại dòng PENDING cùng sepay_txn_id
      // (UNIQUE) — nâng cấp dòng đó thay vì insert đụng khóa.
      let txn = await manager.findOne(PaymentTransaction, {
        where: { sepayTxnId },
      });
      if (txn) {
        txn.serviceOrderId = order.id;
        txn.amount = transferAmount.toString();
        txn.status = 'SUCCESS';
        txn = await manager.save(txn);
      } else {
        txn = await manager.save(
          manager.create(PaymentTransaction, {
            serviceOrderId: order.id,
            direction: 'IN' as const,
            amount: transferAmount.toString(),
            sepayTxnId,
            transferContent: dto.content ?? null,
            status: 'SUCCESS' as const,
            rawPayload: rawBody,
          }),
        );
      }

      // DEPOSIT toàn bộ tiền thật nhận (kể cả chuyển dư) — sổ phản ánh tiền thật.
      const lastBalance = await this.lastEscrowBalance(manager, order.id);
      await manager.save(
        manager.create(EscrowLedger, {
          serviceOrderId: order.id,
          transactionId: txn.id,
          entryType: 'DEPOSIT' as const,
          amount: transferAmount.toString(),
          balanceAfter: (lastBalance + transferAmount).toString(),
          note: `Thu đủ đơn ${order.orderCode} qua SePay #${sepayTxnId}`,
        }),
      );

      await manager.update(
        PaymentComponent,
        { serviceOrderId: order.id, status: 'PENDING' },
        { status: 'PAID' },
      );

      lockedOrder.status = 'PAID';
      await manager.save(lockedOrder);
      await manager.update(PaymentWebhookLog, log.id, { processed: true });
      return true;
    });

    if (!processed) {
      // Thua re-check (đơn vừa được webhook khác trả xong) — tiền vẫn phải vào sổ.
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, order.id);
      return { success: true, ignored: 'ORDER_NOT_AWAITING_PAYMENT' };
    }
    return { success: true, orderCode, status: 'PAID' };
  }

  // ---- helpers ----

  /**
   * Ghi dấu vết tài chính cho tiền thật vào mà chưa xử lý được:
   * status PENDING, có thể chưa gắn đơn (serviceOrderId null) — admin đối soát.
   * Retry đụng UNIQUE sepay_txn_id → dòng đã có từ lần trước, giữ nguyên.
   */
  private async recordPendingTransaction(
    sepayTxnId: string,
    dto: SepayWebhookDto,
    rawBody: Record<string, unknown>,
    serviceOrderId: string | null,
  ): Promise<void> {
    try {
      await this.transactionRepo.save(
        this.transactionRepo.create({
          serviceOrderId,
          direction: 'IN' as const,
          amount: dto.transferAmount,
          sepayTxnId,
          transferContent: dto.content ?? null,
          status: 'PENDING' as const,
          rawPayload: rawBody,
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) {
        throw err;
      }
    }
  }

  // "Còn phải trả" = Σ component PENDING — một nguồn sự thật duy nhất.
  private async sumPendingComponents(orderId: string): Promise<string> {
    const components = await this.componentRepo.find({
      where: { serviceOrderId: orderId, status: 'PENDING' },
    });
    return components
      .reduce((sum, component) => sum + BigInt(component.amount), 0n)
      .toString();
  }

  // Số dư escrow hiện tại của đơn = balance_after của bút toán mới nhất.
  private async lastEscrowBalance(
    manager: { getRepository: DataSource['getRepository'] },
    orderId: string,
  ): Promise<bigint> {
    const last = await manager.getRepository(EscrowLedger).findOne({
      where: { serviceOrderId: orderId },
      order: { createdAt: 'DESC' },
    });
    return last ? BigInt(last.balanceAfter) : 0n;
  }

  // So sánh constant-time (chống timing attack dò key) — format SePay: "Apikey <key>".
  private assertWebhookKey(authorization: string | undefined) {
    const expected = `Apikey ${this.config.get<string>('SEPAY_WEBHOOK_KEY')}`;
    const received = authorization ?? '';
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(received);
    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      throw new UnauthorizedException('WEBHOOK_UNAUTHORIZED');
    }
  }
}
