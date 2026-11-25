import type { DataSource, Repository } from 'typeorm';
import { DisbursementsService } from './disbursements.service';
import type { Disbursement } from './entities/disbursement.entity';

/** Ảnh biên lai lúc admin bấm "Đã chuyển": ghi vào lệnh chi và trả trong view. */
describe('DisbursementsService.markPaid — ảnh biên lai', () => {
  const RECEIPT =
    'https://res.cloudinary.com/demo/lancare-hub/payment-receipts/bien-lai.jpg';
  let row: Record<string, unknown>;

  const manager = {
    findOne: jest.fn(() => Promise.resolve(row)),
    save: jest.fn((value: object) => Promise.resolve(value)),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };
  const disbursementRepo = {
    findOneOrFail: jest.fn(() => Promise.resolve(row)),
  };

  let service: DisbursementsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Lệnh hoàn của chị Lan, đã có TK chụp sẵn, chi được ngay.
    row = {
      id: 'disb-1',
      serviceOrderId: null,
      customerId: 'cust-1',
      providerId: null,
      customer: { account: { fullName: 'Nguyễn Thị Lan' } },
      provider: null,
      serviceOrder: null,
      sourceTransactionId: 'txn-1',
      type: 'UNMATCHED_REFUND',
      amount: '530000',
      eligibleAt: new Date('2026-11-25T07:05:00.000Z'),
      status: 'PENDING',
      bankName: 'MBBank',
      bankAccount: '0901234567',
      bankHolder: 'NGUYEN THI LAN',
      bankBin: '970422',
      transferCode: null,
      paidAt: null,
      paidByAccountId: null,
      note: null,
      receiptUrl: null,
    };
    service = new DisbursementsService(
      disbursementRepo as unknown as Repository<Disbursement>,
      dataSource as unknown as DataSource,
    );
  });

  it('gửi receiptUrl → lưu vào lệnh chi và trả receiptUrl', async () => {
    const view = await service.markPaid('acc-admin', 'disb-1', {
      transferCode: 'FT26329876543',
      receiptUrl: RECEIPT,
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PAID',
        transferCode: 'FT26329876543',
        receiptUrl: RECEIPT,
      }),
    );
    expect(view).toMatchObject({ status: 'PAID', receiptUrl: RECEIPT });
  });

  it('không gửi receiptUrl → null, mã giao dịch vẫn ghi như cũ', async () => {
    const view = await service.markPaid('acc-admin', 'disb-1', {
      transferCode: 'FT26329876543',
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PAID', receiptUrl: null }),
    );
    expect(view.receiptUrl).toBeNull();
  });
});
