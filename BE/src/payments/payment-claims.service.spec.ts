import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import type { CreatePaymentClaimDto } from './dto/create-payment-claim.dto';
import type { PaymentClaim } from './entities/payment-claim.entity';
import { PaymentClaimsService } from './payment-claims.service';

const CREATED_AT = new Date('2026-11-25T05:02:00.000Z');

describe('PaymentClaimsService', () => {
  // Query builder giả: các hàm nối chuỗi trả lại chính nó, getManyAndCount trả dữ liệu của từng test.
  const qb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };
  const claimRepo = {
    find: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    createQueryBuilder: jest.fn(() => qb),
  };
  const orderRepo = { findOne: jest.fn() };

  // Đơn mẫu: khách chị Lan (acc-lan), vườn (acc-vuon).
  const order = {
    id: 'order-1',
    customerId: 'cust-1',
    providerId: 'prov-1',
  };
  const profiles: Record<string, { id: string; accountId: string } | null> = {
    CustomerProfile: { id: 'cust-1', accountId: 'acc-lan' },
    ProviderProfile: { id: 'prov-1', accountId: 'acc-vuon' },
  };

  const manager = {
    findOne: jest.fn((entity: { name: string }) => {
      if (entity.name === 'ServiceOrder') {
        return Promise.resolve(order);
      }
      if (entity.name in profiles) {
        return Promise.resolve(profiles[entity.name]);
      }
      throw new Error(`findOne ngoài dự kiến: ${entity.name}`);
    }),
    count: jest.fn(),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn((value: object | object[]) =>
      Promise.resolve(
        Array.isArray(value)
          ? (value as object[]).map((photo, index) => ({
              id: `photo-${index + 1}`,
              createdAt: CREATED_AT,
              ...photo,
            }))
          : { id: 'claim-1', createdAt: CREATED_AT, ...value },
      ),
    ),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };

  let service: PaymentClaimsService;

  const dto = (
    overrides: Partial<CreatePaymentClaimDto> = {},
  ): CreatePaymentClaimDto => ({
    amount: 530000,
    transferredAt: '2026-11-25T10:15:00+07:00',
    note: 'Em quên ghi mã đơn',
    photos: [
      { photoUrl: 'https://example.com/sao-ke-1.jpg' },
      { photoUrl: 'https://example.com/sao-ke-2.jpg' },
    ],
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    profiles.CustomerProfile = { id: 'cust-1', accountId: 'acc-lan' };
    profiles.ProviderProfile = { id: 'prov-1', accountId: 'acc-vuon' };
    manager.count.mockResolvedValue(0);
    orderRepo.findOne.mockResolvedValue({
      ...order,
      customer: profiles.CustomerProfile,
      provider: profiles.ProviderProfile,
    });
    service = new PaymentClaimsService(
      claimRepo as unknown as Repository<PaymentClaim>,
      orderRepo as unknown as Repository<ServiceOrder>,
      dataSource as unknown as DataSource,
    );
  });

  describe('create', () => {
    it('khách của đơn nộp → phiếu CUSTOMER OPEN kèm 2 ảnh, khoá dòng đơn, refund null', async () => {
      const view = await service.create('acc-lan', 'order-1', dto());

      expect(view).toEqual({
        id: 'claim-1',
        orderId: 'order-1',
        party: 'CUSTOMER',
        amount: '530000',
        transferredAt: new Date('2026-11-25T03:15:00.000Z'),
        note: 'Em quên ghi mã đơn',
        status: 'OPEN',
        rejectReason: null,
        photos: [
          { id: 'photo-1', photoUrl: 'https://example.com/sao-ke-1.jpg' },
          { id: 'photo-2', photoUrl: 'https://example.com/sao-ke-2.jpg' },
        ],
        createdAt: CREATED_AT,
        handledAt: null,
        refund: null,
      });
      expect(manager.findOne).toHaveBeenCalledWith(
        ServiceOrder,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.count).toHaveBeenCalledWith(expect.anything(), {
        where: { serviceOrderId: 'order-1', party: 'CUSTOMER', status: 'OPEN' },
      });
      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          submittedByAccountId: 'acc-lan',
          amount: '530000',
          status: 'OPEN',
        }),
      );
    });

    it('vườn của đơn nộp → phiếu PROVIDER; không gửi giờ / ghi chú → null', async () => {
      const view = await service.create(
        'acc-vuon',
        'order-1',
        dto({ transferredAt: undefined, note: '' }),
      );
      expect(view).toMatchObject({
        party: 'PROVIDER',
        transferredAt: null,
        note: null,
      });
      expect(manager.count).toHaveBeenCalledWith(expect.anything(), {
        where: { serviceOrderId: 'order-1', party: 'PROVIDER', status: 'OPEN' },
      });
    });

    it('người ngoài đơn → 404 ORDER_NOT_FOUND, không lưu gì', async () => {
      await expect(
        service.create('acc-khac', 'order-1', dto()),
      ).rejects.toThrow(new NotFoundException('ORDER_NOT_FOUND'));
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('không có đơn → 404 ORDER_NOT_FOUND', async () => {
      manager.findOne.mockImplementationOnce(() => Promise.resolve(null));
      await expect(service.create('acc-lan', 'order-x', dto())).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('bên này đã có 3 phiếu mở → 409 PAYMENT_CLAIM_LIMIT_REACHED', async () => {
      manager.count.mockResolvedValue(3);
      await expect(service.create('acc-lan', 'order-1', dto())).rejects.toThrow(
        new ConflictException('PAYMENT_CLAIM_LIMIT_REACHED'),
      );
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('listForOrder', () => {
    it('khách gọi → chỉ lọc phiếu CUSTOMER của đơn, mới nhất lên đầu, kèm ảnh + lệnh hoàn', async () => {
      claimRepo.find.mockResolvedValue([]);
      await service.listForOrder('acc-lan', 'order-1');
      expect(claimRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { serviceOrderId: 'order-1', party: 'CUSTOMER' },
          relations: {
            photos: true,
            transaction: { refundDisbursement: true },
          },
          order: expect.objectContaining({ createdAt: 'DESC' }) as unknown,
        }),
      );
    });

    it('vườn gọi → chỉ lọc phiếu PROVIDER', async () => {
      claimRepo.find.mockResolvedValue([]);
      await service.listForOrder('acc-vuon', 'order-1');
      expect(claimRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { serviceOrderId: 'order-1', party: 'PROVIDER' },
        }),
      );
    });

    it('không có đơn hoặc người ngoài đơn → 404 ORDER_NOT_FOUND', async () => {
      await expect(service.listForOrder('acc-khac', 'order-1')).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      orderRepo.findOne.mockResolvedValue(null);
      await expect(service.listForOrder('acc-lan', 'order-x')).rejects.toThrow(
        new NotFoundException('ORDER_NOT_FOUND'),
      );
      expect(claimRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('listForAdmin', () => {
    const photoIdB = {
      id: 'photo-b',
      photoUrl: 'https://example.com/sao-ke-2.jpg',
      createdAt: CREATED_AT,
    };
    const photoIdA = {
      id: 'photo-a',
      photoUrl: 'https://example.com/sao-ke-1.jpg',
      createdAt: CREATED_AT,
    };
    const row = {
      id: 'claim-1',
      serviceOrderId: 'order-1',
      party: 'CUSTOMER' as const,
      submittedByAccountId: 'acc-lan',
      submittedBy: { id: 'acc-lan', fullName: 'Nguyễn Thị Lan' },
      serviceOrder: {
        id: 'order-1',
        orderCode: 'LANCARE7A2B9C1D',
        status: 'CANCELLED',
      },
      amount: '530000',
      transferredAt: null,
      note: 'Em quên ghi mã đơn',
      status: 'OPEN' as const,
      rejectReason: null,
      createdAt: CREATED_AT,
      handledAt: null,
      transactionId: null,
      transaction: null,
      photos: [photoIdB, photoIdA],
    };

    it('trả {data, total, page, limit}; mỗi dòng = phiếu + orderCode, orderStatus, submittedBy; ảnh xếp ổn định', async () => {
      qb.getManyAndCount.mockResolvedValue([[row], 1]);
      const result = await service.listForAdmin({
        status: 'OPEN',
        amount: 530000,
        page: 2,
        limit: 5,
      });

      expect(result).toEqual({
        data: [
          {
            id: 'claim-1',
            orderId: 'order-1',
            party: 'CUSTOMER',
            amount: '530000',
            transferredAt: null,
            note: 'Em quên ghi mã đơn',
            status: 'OPEN',
            rejectReason: null,
            photos: [
              { id: 'photo-a', photoUrl: 'https://example.com/sao-ke-1.jpg' },
              { id: 'photo-b', photoUrl: 'https://example.com/sao-ke-2.jpg' },
            ],
            createdAt: CREATED_AT,
            handledAt: null,
            refund: null,
            orderCode: 'LANCARE7A2B9C1D',
            orderStatus: 'CANCELLED',
            submittedBy: { accountId: 'acc-lan', fullName: 'Nguyễn Thị Lan' },
          },
        ],
        total: 1,
        page: 2,
        limit: 5,
      });
      // Phân trang bằng skip/take (không lệch khi join ảnh), mới nhất lên đầu.
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(5);
      expect(qb.orderBy).toHaveBeenCalledWith('claim.createdAt', 'DESC');
      expect(qb.andWhere).toHaveBeenCalledWith('claim.status = :status', {
        status: 'OPEN',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('claim.amount = :amount', {
        amount: '530000',
      });
    });

    it('không lọc → không thêm điều kiện, mặc định trang 1, 10 dòng', async () => {
      qb.getManyAndCount.mockResolvedValue([[], 0]);
      const result = await service.listForAdmin({});
      expect(result).toEqual({ data: [], total: 0, page: 1, limit: 10 });
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(qb.skip).toHaveBeenCalledWith(0);
    });
  });

  describe('reject', () => {
    const reason = 'Ảnh sao kê không thấy số tiền';

    it('phiếu OPEN → UPDATE có điều kiện status OPEN, trả phiếu REJECTED kèm lý do', async () => {
      claimRepo.update.mockResolvedValue({ affected: 1 });
      claimRepo.findOneOrFail.mockResolvedValue({
        id: 'claim-1',
        serviceOrderId: 'order-1',
        party: 'CUSTOMER',
        amount: '530000',
        transferredAt: null,
        note: null,
        status: 'REJECTED',
        rejectReason: reason,
        createdAt: CREATED_AT,
        handledAt: CREATED_AT,
        transactionId: null,
        transaction: null,
        photos: [],
      });

      const view = await service.reject('acc-admin', 'claim-1', { reason });

      expect(claimRepo.update).toHaveBeenCalledWith(
        { id: 'claim-1', status: 'OPEN' },
        {
          status: 'REJECTED',
          rejectReason: reason,
          handledByAccountId: 'acc-admin',
          handledAt: expect.any(Date) as unknown,
        },
      );
      expect(view).toMatchObject({
        id: 'claim-1',
        status: 'REJECTED',
        rejectReason: reason,
        refund: null,
      });
      expect(claimRepo.findOne).not.toHaveBeenCalled();
    });

    it('không có phiếu → 404 PAYMENT_CLAIM_NOT_FOUND', async () => {
      claimRepo.update.mockResolvedValue({ affected: 0 });
      claimRepo.findOne.mockResolvedValue(null);
      await expect(
        service.reject('acc-admin', 'claim-x', { reason }),
      ).rejects.toThrow(new NotFoundException('PAYMENT_CLAIM_NOT_FOUND'));
    });

    it('phiếu đã RESOLVED / REJECTED → 409 PAYMENT_CLAIM_NOT_OPEN', async () => {
      claimRepo.update.mockResolvedValue({ affected: 0 });
      claimRepo.findOne.mockResolvedValue({
        id: 'claim-1',
        status: 'RESOLVED',
      });
      await expect(
        service.reject('acc-admin', 'claim-1', { reason }),
      ).rejects.toThrow(new ConflictException('PAYMENT_CLAIM_NOT_OPEN'));
      expect(claimRepo.findOneOrFail).not.toHaveBeenCalled();
    });
  });

  describe('toView', () => {
    const base = {
      id: 'claim-1',
      serviceOrderId: 'order-1',
      party: 'CUSTOMER' as const,
      amount: '530000',
      transferredAt: null,
      note: null,
      createdAt: CREATED_AT,
      photos: [{ id: 'photo-1', photoUrl: 'https://example.com/a.jpg' }],
    };

    it('phiếu bị từ chối, chưa gắn khoản tiền → refund null, có lý do', () => {
      const view = service.toView({
        ...base,
        status: 'REJECTED',
        rejectReason: 'Sao kê không khớp số tiền',
        handledAt: CREATED_AT,
        transactionId: null,
        transaction: null,
      });
      expect(view.refund).toBeNull();
      expect(view.rejectReason).toBe('Sao kê không khớp số tiền');
      expect(view.photos).toEqual([
        { id: 'photo-1', photoUrl: 'https://example.com/a.jpg' },
      ]);
    });

    it('phiếu đã gắn khoản tiền, admin đã chuyển → refund lấy từ lệnh hoàn', () => {
      const paidAt = new Date('2026-11-25T07:20:00.000Z');
      const view = service.toView({
        ...base,
        status: 'RESOLVED',
        rejectReason: null,
        handledAt: CREATED_AT,
        transactionId: 'txn-1',
        transaction: {
          refundDisbursement: {
            status: 'PAID',
            paidAt,
            receiptUrl: 'https://example.com/bien-lai.jpg',
          },
        } as PaymentClaim['transaction'],
      });
      expect(view.refund).toEqual({
        status: 'PAID',
        paidAt,
        receiptUrl: 'https://example.com/bien-lai.jpg',
      });
    });

    it('đã gắn lệnh hoàn nhưng chưa chuyển → refund PENDING, paidAt / receiptUrl null', () => {
      const view = service.toView({
        ...base,
        status: 'RESOLVED',
        rejectReason: null,
        handledAt: CREATED_AT,
        transactionId: 'txn-1',
        transaction: {
          refundDisbursement: {
            status: 'PENDING',
            paidAt: null,
            receiptUrl: null,
          },
        } as PaymentClaim['transaction'],
      });
      expect(view.refund).toEqual({
        status: 'PENDING',
        paidAt: null,
        receiptUrl: null,
      });
    });
  });
});
