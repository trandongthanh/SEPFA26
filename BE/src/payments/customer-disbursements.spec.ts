import type { EntityManager } from 'typeorm';
import { loadCustomerDisbursements } from './customer-disbursements';
import { Disbursement } from './entities/disbursement.entity';

/** Khách xem lệnh chi của đơn mình: chỉ 7 field trạng thái, không lộ tài khoản / mã giao dịch / ghi chú. */
describe('loadCustomerDisbursements', () => {
  const RECEIPT =
    'https://res.cloudinary.com/demo/lancare-hub/payment-receipts/bien-lai.jpg';
  const order = { id: 'order-1', customerId: 'cust-1' };
  const manager = { find: jest.fn() };

  // Đơn mẫu khách huỷ sớm: REFUND 484.000 đã chuyển kèm biên lai, DECLARED_RETURN 300.000 còn chờ.
  const refund = {
    id: 'disb-1',
    serviceOrderId: 'order-1',
    customerId: 'cust-1',
    providerId: null,
    sourceTransactionId: null,
    type: 'REFUND',
    amount: '484000',
    eligibleAt: new Date('2026-11-25T07:00:00.000Z'),
    status: 'PAID',
    bankName: 'MBBank',
    bankAccount: '0123456789',
    bankHolder: 'NGUYEN THI LAN',
    bankBin: '970422',
    transferCode: 'FT26329876543',
    paidAt: new Date('2026-11-25T08:00:00.000Z'),
    paidByAccountId: 'acc-admin',
    note: 'Chuyển qua MBBank',
    receiptUrl: RECEIPT,
    createdAt: new Date('2026-11-25T07:00:00.000Z'),
    updatedAt: new Date('2026-11-25T08:00:00.000Z'),
    deletedAt: null,
    version: 2,
  };
  const declaredReturn = {
    ...refund,
    id: 'disb-2',
    type: 'DECLARED_RETURN',
    amount: '300000',
    status: 'PENDING',
    transferCode: null,
    paidAt: null,
    paidByAccountId: null,
    note: null,
    receiptUrl: null,
    version: 1,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const load = () =>
    loadCustomerDisbursements(manager as unknown as EntityManager, order);

  it('lọc đúng đơn + đúng khách, xếp createdAt rồi id tăng', async () => {
    manager.find.mockResolvedValue([]);
    await load();
    expect(manager.find).toHaveBeenCalledTimes(1);
    expect(manager.find).toHaveBeenCalledWith(Disbursement, {
      where: { serviceOrderId: 'order-1', customerId: 'cust-1' },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  });

  it('mỗi dòng chỉ có đúng 7 field, không lộ tài khoản / mã giao dịch / ghi chú', async () => {
    manager.find.mockResolvedValue([refund, declaredReturn]);
    const views = await load();
    expect(views).toEqual([
      {
        id: 'disb-1',
        type: 'REFUND',
        amount: '484000',
        status: 'PAID',
        eligibleAt: refund.eligibleAt,
        paidAt: refund.paidAt,
        receiptUrl: RECEIPT,
      },
      {
        id: 'disb-2',
        type: 'DECLARED_RETURN',
        amount: '300000',
        status: 'PENDING',
        eligibleAt: declaredReturn.eligibleAt,
        paidAt: null,
        receiptUrl: null,
      },
    ]);
    for (const view of views) {
      expect(Object.keys(view).sort()).toEqual(
        [
          'amount',
          'eligibleAt',
          'id',
          'paidAt',
          'receiptUrl',
          'status',
          'type',
        ].sort(),
      );
    }
  });

  it('không có lệnh chi → []', async () => {
    manager.find.mockResolvedValue([]);
    await expect(load()).resolves.toEqual([]);
  });
});
