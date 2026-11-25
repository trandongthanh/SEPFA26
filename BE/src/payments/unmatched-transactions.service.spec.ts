import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { RefundUnmatchedTransactionDto } from './dto/refund-unmatched-transaction.dto';
import { PaymentClaim } from './entities/payment-claim.entity';
import type { PaymentTransaction } from './entities/payment-transaction.entity';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';

/**
 * Nhánh hoàn tiền chưa khớp kèm phiếu báo đã chuyển tiền.
 * Đơn mẫu: chị Lan (cust-1, MBBank trong hồ sơ) đơn order-1, vườn prov-1 (VCB trong hồ sơ).
 */
const LAN_BANK = {
  bankName: 'MBBank',
  bankAccount: '0901234567',
  bankHolder: 'NGUYEN THI LAN',
  bankBin: '970422',
};
const VUON_BANK = {
  bankName: 'VCB',
  bankAccount: '999888777',
  bankHolder: 'VUON LAN XANH',
  bankBin: null,
};

describe('UnmatchedTransactionsService.refund', () => {
  let txn: Record<string, unknown> | null;
  let claim: Record<string, unknown> | null;
  const orders: Record<string, Record<string, unknown>> = {
    'order-1': {
      id: 'order-1',
      orderCode: 'LANCARE7A2B9C1D',
      customerId: 'cust-1',
      providerId: 'prov-1',
      customer: {
        id: 'cust-1',
        ...LAN_BANK,
        account: { fullName: 'Nguyễn Thị Lan' },
      },
      provider: { id: 'prov-1', displayName: 'Vườn Lan Xanh', ...VUON_BANK },
    },
  };

  const manager = {
    findOne: jest.fn(
      (entity: { name: string }, options: { where: { id: string } }) => {
        if (entity.name === 'PaymentTransaction') return Promise.resolve(txn);
        if (entity.name === 'PaymentClaim') return Promise.resolve(claim);
        if (entity.name === 'ServiceOrder') {
          return Promise.resolve(orders[options.where.id] ?? null);
        }
        throw new Error(`findOne ngoài dự kiến: ${entity.name}`);
      },
    ),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn((value: Record<string, unknown>) =>
      Promise.resolve(
        value.type === 'UNMATCHED_REFUND' ? { id: 'disb-1', ...value } : value,
      ),
    ),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };
  // Đọc lại view sau khi lưu — chỉ cần trả một dòng hợp lệ.
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOneOrFail: jest.fn(() =>
      Promise.resolve({
        ...txn,
        serviceOrder: null,
        refundDisbursement: { status: 'PENDING' },
        resolvedBy: { fullName: 'Admin' },
      }),
    ),
  };
  const transactionRepo = { createQueryBuilder: jest.fn(() => qb) };

  let service: UnmatchedTransactionsService;

  const unmatchedTxn = (overrides: Record<string, unknown> = {}) => ({
    id: 'txn-1',
    sepayTxnId: '3391742',
    amount: '530000',
    transferContent: 'CHUYEN TIEN',
    createdAt: new Date('2026-11-25T03:15:00.000Z'),
    status: 'PENDING',
    direction: 'IN',
    serviceOrderId: null,
    unmatchedReason: 'NO_CODE',
    refundDisbursementId: null,
    resolvedByAccountId: null,
    resolvedAt: null,
    resolutionNote: null,
    ...overrides,
  });
  const openClaim = (overrides: Record<string, unknown> = {}) => ({
    id: 'claim-1',
    serviceOrderId: 'order-1',
    party: 'CUSTOMER',
    status: 'OPEN',
    transactionId: null,
    handledByAccountId: null,
    handledAt: null,
    ...overrides,
  });
  const NOTE = 'Sao kê MB 10:15 ngày 25/11, 530.000đ, NGUYEN THI LAN';

  const savedDisbursement = () =>
    manager.save.mock.calls
      .map(([value]) => value)
      .find((value) => value.type === 'UNMATCHED_REFUND');
  const savedClaim = () =>
    manager.save.mock.calls
      .map(([value]) => value)
      .find((value) => value === claim);

  beforeEach(() => {
    jest.clearAllMocks();
    txn = unmatchedTxn();
    claim = openClaim();
    service = new UnmatchedTransactionsService(
      transactionRepo as unknown as Repository<PaymentTransaction>,
      dataSource as unknown as DataSource,
    );
  });

  const refund = (dto: RefundUnmatchedTransactionDto) =>
    service.refund('acc-admin', 'txn-1', dto);

  it('tiền không gắn đơn + phiếu của khách + ghi chú → lệnh chi gắn khách, TK hồ sơ, không gắn đơn; phiếu RESOLVED', async () => {
    await refund({ claimId: 'claim-1', note: NOTE });

    expect(manager.findOne).toHaveBeenCalledWith(PaymentClaim, {
      where: { id: 'claim-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(savedDisbursement()).toMatchObject({
      serviceOrderId: null,
      customerId: 'cust-1',
      providerId: null,
      sourceTransactionId: 'txn-1',
      amount: '530000',
      ...LAN_BANK,
    });
    expect(txn).toMatchObject({
      refundDisbursementId: 'disb-1',
      resolvedByAccountId: 'acc-admin',
      resolutionNote: NOTE,
    });
    expect(savedClaim()).toMatchObject({
      status: 'RESOLVED',
      transactionId: 'txn-1',
      handledByAccountId: 'acc-admin',
    });
    // Cùng một mốc giờ với khoản tiền.
    expect(claim?.handledAt).toBe(txn?.resolvedAt);
  });

  it('tiền không gắn đơn + phiếu của vườn → lệnh chi gắn vườn, TK hồ sơ vườn', async () => {
    claim = openClaim({ party: 'PROVIDER' });
    await refund({ claimId: 'claim-1', note: NOTE });
    expect(savedDisbursement()).toMatchObject({
      serviceOrderId: null,
      customerId: null,
      providerId: 'prov-1',
      ...VUON_BANK,
    });
  });

  it('tiền không gắn đơn + phiếu nhưng thiếu ghi chú → 400 RESOLUTION_NOTE_REQUIRED, không ghi gì', async () => {
    await expect(refund({ claimId: 'claim-1' })).rejects.toThrow(
      new BadRequestException('RESOLUTION_NOTE_REQUIRED'),
    );
    expect(manager.save).not.toHaveBeenCalled();
    expect(claim?.status).toBe('OPEN');
  });

  it('không có phiếu → 404 PAYMENT_CLAIM_NOT_FOUND, không ghi gì', async () => {
    claim = null;
    await expect(refund({ claimId: 'claim-x', note: NOTE })).rejects.toThrow(
      new NotFoundException('PAYMENT_CLAIM_NOT_FOUND'),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('phiếu không còn OPEN → 409 PAYMENT_CLAIM_NOT_OPEN', async () => {
    claim = openClaim({ status: 'REJECTED' });
    await expect(refund({ claimId: 'claim-1', note: NOTE })).rejects.toThrow(
      new ConflictException('PAYMENT_CLAIM_NOT_OPEN'),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('tiền gắn đơn mà phiếu khác đơn → 409 PAYMENT_CLAIM_MISMATCH', async () => {
    txn = unmatchedTxn({
      serviceOrderId: 'order-1',
      unmatchedReason: 'INSUFFICIENT_AMOUNT',
    });
    claim = openClaim({ serviceOrderId: 'order-2' });
    await expect(refund({ claimId: 'claim-1' })).rejects.toThrow(
      new ConflictException('PAYMENT_CLAIM_MISMATCH'),
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('khoản tiền không có → 404 UNMATCHED_TRANSACTION_NOT_FOUND trước, không đọc phiếu', async () => {
    txn = null;
    await expect(refund({ claimId: 'claim-1', note: NOTE })).rejects.toThrow(
      new NotFoundException('UNMATCHED_TRANSACTION_NOT_FOUND'),
    );
    expect(manager.findOne).not.toHaveBeenCalledWith(
      PaymentClaim,
      expect.anything(),
    );
  });

  it('tiền gắn đơn + phiếu đúng đơn, đúng bên → người nhận theo luật cũ, gắn đơn, không cần ghi chú; phiếu RESOLVED', async () => {
    txn = unmatchedTxn({
      serviceOrderId: 'order-1',
      unmatchedReason: 'INSUFFICIENT_AMOUNT',
    });
    await refund({ claimId: 'claim-1' });
    expect(savedDisbursement()).toMatchObject({
      serviceOrderId: 'order-1',
      customerId: 'cust-1',
      ...LAN_BANK,
    });
    expect(savedClaim()).toMatchObject({
      status: 'RESOLVED',
      transactionId: 'txn-1',
    });
  });

  it('không gửi claimId → không đọc / ghi bảng phiếu, chạy như cũ', async () => {
    txn = unmatchedTxn({
      serviceOrderId: 'order-1',
      unmatchedReason: 'INSUFFICIENT_AMOUNT',
    });
    await refund({});
    expect(manager.findOne).not.toHaveBeenCalledWith(
      PaymentClaim,
      expect.anything(),
    );
    expect(savedDisbursement()).toMatchObject({
      serviceOrderId: 'order-1',
      customerId: 'cust-1',
    });
    // Chỉ lưu lệnh chi + khoản tiền.
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it('không gửi claimId, tiền không gắn đơn → vẫn bắt nhập TK như cũ (400 REFUND_BANK_INFO_REQUIRED)', async () => {
    await expect(refund({ note: NOTE })).rejects.toThrow(
      new BadRequestException('REFUND_BANK_INFO_REQUIRED'),
    );
    expect(manager.findOne).not.toHaveBeenCalledWith(
      PaymentClaim,
      expect.anything(),
    );
  });
});
