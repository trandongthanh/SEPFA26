import {
  ConflictException,
  ForbiddenException,
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
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { expireAddon } from '../orders/addon-expiry';
import { extractAddonCode, overdueReason } from '../orders/addon-rules';
import { AddonProposal } from '../orders/entities/addon-proposal.entity';
import { Handover } from '../orders/entities/handover.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import {
  extractOrderCode,
  extractSecurityDepositCode,
} from '../orders/order-code';
import { OrderStateService } from '../orders/order-state.service';
import { assertTransition } from '../orders/order-status';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { SepayWebhookDto } from './dto/sepay-webhook.dto';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentWebhookLog } from './entities/payment-webhook-log.entity';
import { SecurityDeposit } from './entities/security-deposit.entity';
import { escrowBalance } from './escrow-balance';

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
    @InjectRepository(AddonProposal)
    private readonly addonRepo: Repository<AddonProposal>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    @InjectRepository(SecurityDeposit)
    private readonly depositRepo: Repository<SecurityDeposit>,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly orderState: OrderStateService,
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
    return this.buildQr(amount, order.orderCode);
  }

  /**
   * POST /orders/:orderId/addons/:addonId/payment/qr — QR trả tiền MỘT add-on khách đã đồng ý.
   * Cùng 6 field với QR của đơn; số tiền = giá add-on + 6% (chốt lúc đồng ý), nội dung CK = mã add-on.
   * Ví dụ add-on 100.000 → amount "106000", transferContent "ADDON1A2B3C4D".
   */
  async getAddonPaymentQr(accountId: string, orderId: string, addonId: string) {
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
    const proposal = await this.addonRepo.findOne({
      where: { id: addonId, serviceOrderId: order.id },
    });
    if (!proposal) {
      throw new NotFoundException('ADDON_NOT_FOUND');
    }
    // Kiểm hạn lúc chạm: quá 24 giờ chưa trả thì đóng đề xuất, không phát QR nữa.
    const now = new Date();
    const reason = overdueReason(proposal, now);
    if (reason) {
      await expireAddon(this.dataSource.manager, proposal, reason, now);
    }
    if (proposal.status === 'EXPIRED') {
      throw new ConflictException('ADDON_EXPIRED');
    }
    if (proposal.status !== 'ACCEPTED') {
      throw new ConflictException('ADDON_INVALID_STATE');
    }
    const amount = BigInt(proposal.price) + BigInt(proposal.customerFee);
    return this.buildQr(amount.toString(), proposal.addonCode);
  }

  /**
   * POST /orders/:orderId/security-deposit/qr — vườn của đơn lấy QR nộp tiền bảo đảm tại chỗ.
   * Đọc-tính-trả, không ghi DB → gọi lại bao nhiêu lần cũng được trong lúc khoản còn PENDING.
   * Đơn mẫu: amount "3400000", transferContent "BAODAM5E6F7A8B", dueAt = lúc khách đồng ý + 2 giờ.
   * Khoản đã nộp / đã huỷ / khách chưa đồng ý biên bản → 409 SECURITY_DEPOSIT_NOT_PENDING.
   * Khoản còn PENDING nhưng đã quá hạn 2 giờ → 409 SECURITY_DEPOSIT_EXPIRED.
   */
  async getSecurityDepositQr(accountId: string, orderId: string) {
    // Người ngoài đơn → 404, chống IDOR (cùng luật với các route bàn giao của vườn).
    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    // Vườn bị tước APPROVED không được tiếp tục bàn giao — nộp bảo đảm là bước đưa đơn vào IN_CARE.
    if (provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROFILE_NOT_APPROVED');
    }
    const order = await this.orderRepo.findOne({
      where: { id: orderId, providerId: provider.id },
    });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const deposit = await this.depositRepo.findOne({
      where: {
        serviceOrderId: order.id,
        providerId: provider.id,
        status: 'PENDING',
      },
    });
    if (!deposit) {
      throw new ConflictException('SECURITY_DEPOSIT_NOT_PENDING');
    }
    // Quá 2 giờ mà bộ quét chưa kịp huỷ đơn: không phát QR nữa, vì tiền chuyển lúc này webhook cũng
    // không ghi nhận (khách đồng ý 09:00 → hạn 11:00; 11:01 vườn xin QR → 409).
    if (deposit.dueAt.getTime() <= Date.now()) {
      throw new ConflictException('SECURITY_DEPOSIT_EXPIRED');
    }
    // Cùng hình dạng với QR tiền đơn / QR add-on (qrImageUrl + thông tin ngân hàng), thêm hạn nộp.
    return {
      ...this.buildQr(deposit.amount, deposit.depositCode),
      dueAt: deposit.dueAt,
    };
  }

  // Thông tin chuyển khoản + URL ảnh VietQR — dùng chung cho tiền đơn, tiền add-on và tiền bảo đảm.
  private buildQr(amount: string, transferContent: string) {
    const bin = this.config.get<string>('BANK_BIN')!;
    const accountNumber = this.config.get<string>('BANK_ACCOUNT_NUMBER')!;
    const accountName = this.config.get<string>('BANK_ACCOUNT_NAME')!;
    const qrImageUrl =
      `https://img.vietqr.io/image/${bin}-${accountNumber}-compact2.png` +
      `?amount=${amount}&addInfo=${transferContent}` +
      `&accountName=${encodeURIComponent(accountName)}`;

    return {
      qrImageUrl,
      bankBin: bin,
      bankAccountNumber: accountNumber,
      bankAccountName: accountName,
      amount,
      transferContent,
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

    // Tiền bảo đảm của vườn có mã riêng (BAODAM + 8 hex, không lẫn với mã đơn / mã add-on)
    // → rẽ nhánh trước khi tìm mã đơn.
    const depositCode = extractSecurityDepositCode(dto.content ?? '');
    if (depositCode) {
      return this.handleSecurityDepositPayment(
        log,
        sepayTxnId,
        dto,
        rawBody,
        depositCode,
        transferAmount,
      );
    }

    // Tiền add-on có mã riêng (ADDON + 8 hex, không lẫn với mã đơn) → rẽ nhánh trước khi tìm mã đơn.
    const addonCode = extractAddonCode(dto.content ?? '');
    if (addonCode) {
      return this.handleAddonPayment(
        log,
        sepayTxnId,
        dto,
        rawBody,
        addonCode,
        transferAmount,
      );
    }

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

      const txn = await this.saveSuccessTransaction(
        manager,
        order.id,
        sepayTxnId,
        transferAmount,
        dto,
        rawBody,
      );

      // DEPOSIT toàn bộ tiền thật nhận (kể cả chuyển dư) — sổ phản ánh tiền thật.
      const lastBalance = await escrowBalance(manager, order.id);
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

  /**
   * Tiền add-on vào (đơn đang IN_CARE, trạng thái đơn KHÔNG đổi).
   * Đạt khi: đề xuất ACCEPTED, còn hạn trả 24 giờ, đủ tiền (giá + 6%) → 1 transaction DB:
   * giao dịch SUCCESS + bút toán DEPOSIT + dòng hoá đơn ADD_ON (sinh ra đã PAID) + đề xuất PAID.
   * Không đạt (quá hạn, thiếu tiền, đề xuất đã trả / đã đóng) → tiền thật vẫn ghi `transactions` PENDING
   * gắn đơn để admin hoàn tay, trả 200 như mọi nhánh "không xử lý" khác.
   */
  private async handleAddonPayment(
    log: PaymentWebhookLog,
    sepayTxnId: string,
    dto: SepayWebhookDto,
    rawBody: Record<string, unknown>,
    addonCode: string,
    transferAmount: bigint,
  ) {
    const found = await this.addonRepo.findOne({ where: { addonCode } });
    if (!found) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: mã add-on ${addonCode} không khớp đề xuất nào`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, null);
      return { success: true, ignored: 'ADDON_NOT_MATCHED' };
    }
    const orderId = found.serviceOrderId;
    await this.webhookLogRepo.update(log.id, { matchedOrderId: orderId });

    const ignored = await this.dataSource.transaction(async (manager) => {
      // Khoá đơn trước (sổ ký quỹ theo đơn: 2 khoản tiền cùng vào không ghi chồng số dư), rồi khoá đề xuất.
      const order = await manager.findOne(ServiceOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      const proposal = await manager.findOne(AddonProposal, {
        where: { id: found.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order || !proposal) {
        return 'ADDON_NOT_PAYABLE';
      }
      const now = new Date();
      const reason = overdueReason(proposal, now);
      if (reason) {
        // Tiền về sau hạn: đóng đề xuất (dòng này được commit vì không ném lỗi), tiền chờ admin hoàn.
        await expireAddon(manager, proposal, reason, now);
        return 'ADDON_NOT_PAYABLE';
      }
      if (proposal.status !== 'ACCEPTED' || order.status !== 'IN_CARE') {
        return 'ADDON_NOT_PAYABLE';
      }
      const amountDue = BigInt(proposal.price) + BigInt(proposal.customerFee);
      if (transferAmount < amountDue) {
        return 'INSUFFICIENT_AMOUNT';
      }

      const txn = await this.saveSuccessTransaction(
        manager,
        order.id,
        sepayTxnId,
        transferAmount,
        dto,
        rawBody,
      );
      const lastBalance = await escrowBalance(manager, order.id);
      await manager.save(
        manager.create(EscrowLedger, {
          serviceOrderId: order.id,
          transactionId: txn.id,
          entryType: 'DEPOSIT' as const,
          amount: transferAmount.toString(),
          balanceAfter: (lastBalance + transferAmount).toString(),
          note: `Thu add-on ${proposal.addonCode} của đơn ${order.orderCode} qua SePay #${sepayTxnId}`,
        }),
      );
      // Dòng hoá đơn add-on chỉ sinh khi tiền đã về → không bao giờ có dòng PENDING mồ côi.
      await manager.save(
        manager.create(PaymentComponent, {
          serviceOrderId: order.id,
          addonId: proposal.id,
          componentType: 'ADD_ON' as const,
          amount: proposal.price,
          customerFee: proposal.customerFee,
          status: 'PAID' as const,
        }),
      );
      proposal.status = 'PAID';
      proposal.paidAt = now;
      await manager.save(proposal);
      await manager.update(PaymentWebhookLog, log.id, { processed: true });
      return null;
    });

    if (ignored) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: add-on ${addonCode} không ghi nhận được (${ignored}, nhận ${transferAmount})`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, orderId);
      return { success: true, ignored };
    }
    return { success: true, addonCode, status: 'PAID' };
  }

  /**
   * Tiền bảo đảm của vườn vào (đơn đang HANDOVER_AWAITING_CONFIRM, phiên nhận cây AWAITING_DEPOSIT).
   * Đạt khi: khoản còn PENDING, đơn còn chờ, còn hạn 2 giờ, đủ tiền → 1 transaction DB: giao dịch SUCCESS + bút toán
   * SECURITY_IN vào sổ BẢO ĐẢM (số thực nhận) + khoản PAID + phiên nhận cây CONFIRMED + đơn IN_CARE,
   * ngày chăm tính từ LÚC NÀY (trước đó vườn chưa được mang cây đi).
   * Đơn mẫu: vườn chuyển 3.400.000 nội dung BAODAM5E6F7A8B → sổ bảo đảm +3.400.000 (sổ đơn vẫn 484.000).
   * Không đạt (thiếu tiền, quá hạn, khoản đã nộp / đã huỷ, mã không khớp) → tiền thật vẫn ghi `transactions`
   * PENDING để admin hoàn tay cho vườn, trả 200 như mọi nhánh "không xử lý" khác, không đổi gì khác.
   */
  private async handleSecurityDepositPayment(
    log: PaymentWebhookLog,
    sepayTxnId: string,
    dto: SepayWebhookDto,
    rawBody: Record<string, unknown>,
    depositCode: string,
    transferAmount: bigint,
  ) {
    const found = await this.depositRepo.findOne({ where: { depositCode } });
    if (!found) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: mã bảo đảm ${depositCode} không khớp khoản nào`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, null);
      return { success: true, ignored: 'SECURITY_DEPOSIT_NOT_MATCHED' };
    }
    const orderId = found.serviceOrderId;
    await this.webhookLogRepo.update(log.id, { matchedOrderId: orderId });

    const ignored = await this.dataSource.transaction(async (manager) => {
      // Khoá đơn trước rồi khoá khoản bảo đảm — cùng thứ tự với nhánh vườn huỷ / bộ quét 2 giờ,
      // nên tiền về và lệnh huỷ chạy cùng lúc chỉ một bên thắng.
      const order = await this.orderState.lock(manager, orderId);
      const deposit = await manager.findOne(SecurityDeposit, {
        where: { id: found.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !order ||
        !deposit ||
        deposit.status !== 'PENDING' ||
        order.status !== 'HANDOVER_AWAITING_CONFIRM'
      ) {
        return 'SECURITY_DEPOSIT_NOT_PENDING';
      }
      const now = new Date();
      // Chỉ ghi nhận khi "đủ tiền và còn hạn": quá 2 giờ thì đơn sắp bị bộ quét huỷ, hoàn khách 100%
      // → tiền tới trễ ghi chờ admin hoàn tay cho vườn, không đưa đơn vào IN_CARE nữa.
      if (deposit.dueAt.getTime() <= now.getTime()) {
        return 'SECURITY_DEPOSIT_EXPIRED';
      }
      if (transferAmount < BigInt(deposit.amount)) {
        // KHÔNG nhận một phần — giống luật thanh toán đơn.
        return 'INSUFFICIENT_AMOUNT';
      }

      const txn = await this.saveSuccessTransaction(
        manager,
        order.id,
        sepayTxnId,
        transferAmount,
        dto,
        rawBody,
      );
      // Ghi toàn bộ tiền thật nhận (kể cả chuyển dư) vào sổ BẢO ĐẢM; balance_after là số dư riêng sổ này.
      const lastBalance = await escrowBalance(manager, order.id, 'SECURITY');
      await manager.save(
        manager.create(EscrowLedger, {
          serviceOrderId: order.id,
          transactionId: txn.id,
          book: 'SECURITY' as const,
          entryType: 'SECURITY_IN' as const,
          amount: transferAmount.toString(),
          balanceAfter: (lastBalance + transferAmount).toString(),
          note: `Vườn nộp tiền bảo đảm đơn ${order.orderCode} (${deposit.depositCode}) qua SePay #${sepayTxnId}`,
        }),
      );
      deposit.status = 'PAID';
      deposit.paidAt = now;
      deposit.transactionId = txn.id;
      await manager.save(deposit);

      await manager.update(
        Handover,
        {
          serviceOrderId: order.id,
          handoverType: 'IN',
          status: 'AWAITING_DEPOSIT',
        },
        { status: 'CONFIRMED', confirmedAt: now, lockedAt: now },
      );

      // Điểm khoá giá CHÍNH THỨC + bắt đầu kỳ chăm: gói 30 ngày → care_due_at = now + 30 ngày.
      order.finalLockedAt = now;
      order.careStartedAt = now;
      order.careDueAt = new Date(
        now.getTime() + order.durationDaysSnapshot * 24 * 60 * 60 * 1000,
      );
      await this.orderState.apply(manager, order, 'IN_CARE');
      await manager.update(PaymentWebhookLog, log.id, { processed: true });
      return null;
    });

    if (ignored) {
      this.logger.warn(
        `Webhook ${sepayTxnId}: tiền bảo đảm ${depositCode} không ghi nhận được (${ignored}, nhận ${transferAmount})`,
      );
      await this.recordPendingTransaction(sepayTxnId, dto, rawBody, orderId);
      return { success: true, ignored };
    }
    return { success: true, depositCode, status: 'PAID' };
  }

  // ---- helpers ----

  /**
   * Ghi giao dịch tiền vào thành công. Retry sau crash có thể đã để lại dòng PENDING cùng
   * sepay_txn_id (UNIQUE) — nâng cấp dòng đó thay vì insert đụng khóa.
   */
  private async saveSuccessTransaction(
    manager: EntityManager,
    orderId: string,
    sepayTxnId: string,
    transferAmount: bigint,
    dto: SepayWebhookDto,
    rawBody: Record<string, unknown>,
  ): Promise<PaymentTransaction> {
    const existing = await manager.findOne(PaymentTransaction, {
      where: { sepayTxnId },
    });
    if (existing) {
      existing.serviceOrderId = orderId;
      existing.amount = transferAmount.toString();
      existing.status = 'SUCCESS';
      return manager.save(existing);
    }
    return manager.save(
      manager.create(PaymentTransaction, {
        serviceOrderId: orderId,
        direction: 'IN' as const,
        amount: transferAmount.toString(),
        sepayTxnId,
        transferContent: dto.content ?? null,
        status: 'SUCCESS' as const,
        rawPayload: rawBody,
      }),
    );
  }

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

  // "Còn phải trả" = Σ (amount + customer_fee) của component PENDING — một nguồn sự thật duy nhất,
  // QR và webhook dùng chung. Phí 6% đã chốt vào component lúc ký (đơn ký trước CP2 có customer_fee = 0).
  private async sumPendingComponents(orderId: string): Promise<string> {
    const components = await this.componentRepo.find({
      where: { serviceOrderId: orderId, status: 'PENDING' },
    });
    return components
      .reduce(
        (sum, component) =>
          sum + BigInt(component.amount) + BigInt(component.customerFee),
        0n,
      )
      .toString();
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
