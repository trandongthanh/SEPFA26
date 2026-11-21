import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { In, type Repository } from 'typeorm';
import type { Account } from '../accounts/entities/account.entity';
import type { CustomerProfile } from '../customers/entities/customer-profile.entity';
import type { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { Notification } from './entities/notification.entity';
import { NOTIFICATION_WS_EVENTS } from './notification.constants';
import { NotificationsService } from './notifications.service';
import type { RealtimeEmitter } from './realtime-emitter.service';

const ACC_1 = '11111111-1111-4111-8111-111111111111';
const ACC_2 = '22222222-2222-4222-8222-222222222222';
const NOTIF_1 = '33333333-3333-4333-8333-333333333333';
const CUS_PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const PROV_PROFILE_ID = '55555555-5555-4555-8555-555555555555';

function makeNotification(patch: Partial<Notification> = {}): Notification {
  return Object.assign(new Notification(), {
    id: NOTIF_1,
    accountId: ACC_1,
    type: 'ORDER_SUBMITTED',
    title: 'Có đơn mới',
    body: 'Đơn LCH-123 chờ duyệt',
    refEntity: 'ORDER',
    refId: '66666666-6666-4666-8666-666666666666',
    metadata: { orderCode: 'LCH-123' },
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-11-21T03:00:00Z'),
    ...patch,
  });
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationRepo: {
    findAndCount: jest.Mock;
    count: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let accountRepo: { find: jest.Mock };
  let customerRepo: { findOne: jest.Mock };
  let providerRepo: { findOne: jest.Mock };
  let realtime: { emitToAccount: jest.Mock; emitToAccounts: jest.Mock };
  let qb: {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    groupBy: jest.Mock;
    getRawMany: jest.Mock;
  };

  beforeEach(() => {
    qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    notificationRepo = {
      findAndCount: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn((data: Partial<Notification>) =>
        makeNotification({ ...data, id: data.id ?? NOTIF_1 }),
      ),
      createQueryBuilder: jest.fn(() => qb),
    };
    accountRepo = { find: jest.fn().mockResolvedValue([]) };
    customerRepo = { findOne: jest.fn().mockResolvedValue(null) };
    providerRepo = { findOne: jest.fn().mockResolvedValue(null) };
    realtime = { emitToAccount: jest.fn(), emitToAccounts: jest.fn() };

    service = new NotificationsService(
      notificationRepo as unknown as Repository<Notification>,
      accountRepo as unknown as Repository<Account>,
      customerRepo as unknown as Repository<CustomerProfile>,
      providerRepo as unknown as Repository<ProviderProfile>,
      realtime as unknown as RealtimeEmitter,
    );
  });

  describe('User inbox (list, count, get, markRead, delete)', () => {
    it('listForAccount: lọc page/limit/isRead/type/refEntity và trả unreadCount chuẩn', async () => {
      const row = makeNotification();
      notificationRepo.findAndCount.mockResolvedValue([[row], 1]);
      notificationRepo.count.mockResolvedValue(3);

      const res = await service.listForAccount(ACC_1, {
        page: 2,
        limit: 10,
        isRead: false,
        type: 'ORDER_SUBMITTED',
        refEntity: 'ORDER',
      });

      expect(notificationRepo.findAndCount).toHaveBeenCalledWith({
        where: {
          accountId: ACC_1,
          isRead: false,
          type: 'ORDER_SUBMITTED',
          refEntity: 'ORDER',
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 10,
        take: 10,
      });
      expect(notificationRepo.count).toHaveBeenCalledWith({
        where: { accountId: ACC_1, isRead: false },
      });
      expect(res.total).toBe(1);
      expect(res.unreadCount).toBe(3);
      expect(res.page).toBe(2);
      expect(res.limit).toBe(10);
      expect(res.data[0]).not.toHaveProperty('accountId');
      expect(res.data[0]).toMatchObject({
        id: NOTIF_1,
        type: 'ORDER_SUBMITTED',
      });
    });

    it('countUnread: trả số thông báo chưa đọc', async () => {
      notificationRepo.count.mockResolvedValue(7);
      await expect(service.countUnread(ACC_1)).resolves.toEqual({
        unreadCount: 7,
      });
    });

    it('getById: không tìm thấy hoặc thuộc tài khoản khác → 404 NOTIFICATION_NOT_FOUND', async () => {
      notificationRepo.findOne.mockResolvedValue(null);
      await expect(service.getById(ACC_2, NOTIF_1)).rejects.toThrow(
        NotFoundException,
      );
      expect(notificationRepo.findOne).toHaveBeenCalledWith({
        where: { id: NOTIF_1, accountId: ACC_2 },
      });
    });

    it('markAsRead: chuyển chưa đọc → đã đọc và phát socket notification.read', async () => {
      const unread = makeNotification({ isRead: false, readAt: null });
      notificationRepo.findOne.mockResolvedValue(unread);
      notificationRepo.save.mockImplementation((entity: Notification) =>
        Promise.resolve(entity),
      );
      notificationRepo.count.mockResolvedValue(2);

      const res = await service.markAsRead(ACC_1, NOTIF_1);

      expect(unread.isRead).toBe(true);
      expect(unread.readAt).toBeInstanceOf(Date);
      expect(notificationRepo.save).toHaveBeenCalledTimes(1);
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_1,
        NOTIFICATION_WS_EVENTS.READ,
        { notificationId: NOTIF_1, unreadCount: 2 },
      );
      expect(res.isRead).toBe(true);
      expect(res.unreadCount).toBe(2);
    });

    it('markAsRead: đã đọc rồi → idempotent, giữ nguyên readAt gốc, không ghi lại DB', async () => {
      const originalReadAt = new Date('2026-11-20T10:00:00Z');
      const alreadyRead = makeNotification({
        isRead: true,
        readAt: originalReadAt,
      });
      notificationRepo.findOne.mockResolvedValue(alreadyRead);
      notificationRepo.count.mockResolvedValue(1);

      const res = await service.markAsRead(ACC_1, NOTIF_1);

      expect(notificationRepo.save).not.toHaveBeenCalled();
      expect(res.readAt).toEqual(originalReadAt);
      expect(res.unreadCount).toBe(1);
    });

    it('markAsRead: không tồn tại / sai chủ → 404', async () => {
      notificationRepo.findOne.mockResolvedValue(null);
      await expect(service.markAsRead(ACC_2, NOTIF_1)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('markAllAsRead: cập nhật các dòng chưa đọc và phát notification.read_all khi updatedCount > 0', async () => {
      notificationRepo.update.mockResolvedValue({ affected: 4 });
      const res = await service.markAllAsRead(ACC_1);

      expect(res).toEqual({ updatedCount: 4, unreadCount: 0 });
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_1,
        NOTIFICATION_WS_EVENTS.READ_ALL,
        { unreadCount: 0 },
      );
    });

    it('markAllAsRead: updatedCount === 0 → không phát socket thừa', async () => {
      notificationRepo.update.mockResolvedValue({ affected: 0 });
      const res = await service.markAllAsRead(ACC_1);

      expect(res).toEqual({ updatedCount: 0, unreadCount: 0 });
      expect(realtime.emitToAccount).not.toHaveBeenCalled();
    });

    it('deleteOne: xoá thành công → phát notification.deleted với unreadCount mới', async () => {
      notificationRepo.delete.mockResolvedValue({ affected: 1 });
      notificationRepo.count.mockResolvedValue(3);

      const res = await service.deleteOne(ACC_1, NOTIF_1);

      expect(notificationRepo.delete).toHaveBeenCalledWith({
        id: NOTIF_1,
        accountId: ACC_1,
      });
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_1,
        NOTIFICATION_WS_EVENTS.DELETED,
        { notificationId: NOTIF_1, unreadCount: 3 },
      );
      expect(res).toEqual({ deleted: true, id: NOTIF_1, unreadCount: 3 });
    });

    it('deleteOne: không khớp dòng nào → 404 NOTIFICATION_NOT_FOUND', async () => {
      notificationRepo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteOne(ACC_2, NOTIF_1)).rejects.toThrow(
        NotFoundException,
      );
      expect(realtime.emitToAccount).not.toHaveBeenCalled();
    });

    it('deleteRead: xoá các thông báo đã đọc và trả deletedCount', async () => {
      notificationRepo.delete.mockResolvedValue({ affected: 6 });
      const res = await service.deleteRead(ACC_1);

      expect(notificationRepo.delete).toHaveBeenCalledWith({
        accountId: ACC_1,
        isRead: true,
      });
      expect(res).toEqual({ deletedCount: 6 });
    });
  });

  describe('Dispatch & safe helpers', () => {
    it('createAndEmit: lưu DB và phát socket notification.new kèm unreadCount', async () => {
      notificationRepo.save.mockImplementation((entity: Notification) =>
        Promise.resolve(entity),
      );
      notificationRepo.count.mockResolvedValue(5);

      const res = await service.createAndEmit({
        accountId: ACC_1,
        type: 'ORDER_PAID',
        title: 'Đã thanh toán',
        body: 'Thanh toán thành công',
        refEntity: 'ORDER',
        refId: NOTIF_1,
      });

      expect(res.type).toBe('ORDER_PAID');
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_1,
        NOTIFICATION_WS_EVENTS.NEW,
        {
          unreadCount: 5,
          notification: expect.objectContaining({
            type: 'ORDER_PAID',
          }) as unknown,
        },
      );
    });

    it('createManyAndEmit: lưu hàng loạt và đếm unread theo nhóm trong 1 query', async () => {
      notificationRepo.save.mockImplementation((chunk: Notification[]) =>
        Promise.resolve(chunk),
      );
      qb.getRawMany.mockResolvedValue([
        { accountId: ACC_1, count: 2 },
        { accountId: ACC_2, count: '4' },
      ]);

      const res = await service.createManyAndEmit([
        {
          accountId: ACC_1,
          type: 'SYSTEM_ANNOUNCEMENT',
          title: 'TB',
          body: 'Nội dung',
        },
        {
          accountId: ACC_2,
          type: 'SYSTEM_ANNOUNCEMENT',
          title: 'TB',
          body: 'Nội dung',
        },
      ]);

      expect(res).toHaveLength(2);
      expect(qb.groupBy).toHaveBeenCalledWith('n.account_id');
      expect(realtime.emitToAccount).toHaveBeenNthCalledWith(
        1,
        ACC_1,
        NOTIFICATION_WS_EVENTS.NEW,
        expect.objectContaining({ unreadCount: 2 }),
      );
      expect(realtime.emitToAccount).toHaveBeenNthCalledWith(
        2,
        ACC_2,
        NOTIFICATION_WS_EVENTS.NEW,
        expect.objectContaining({ unreadCount: 4 }),
      );
    });

    it('sendSafe & sendManySafe: lỗi DB chỉ log warn, không ném lỗi', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      notificationRepo.save.mockRejectedValue(new Error('db timeout'));

      await expect(
        service.sendSafe({
          accountId: ACC_1,
          type: 'ORDER_SUBMITTED',
          title: 'T',
          body: 'B',
        }),
      ).resolves.toBeUndefined();
      await expect(
        service.sendManySafe([
          {
            accountId: ACC_1,
            type: 'ORDER_SUBMITTED',
            title: 'T',
            body: 'B',
          },
        ]),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(2);
      warn.mockRestore();
    });

    it('notifyOrderCustomerSafe & notifyOrderProviderSafe & notifyOrderPartiesSafe: tra accountId từ profileId', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: CUS_PROFILE_ID,
        accountId: ACC_1,
      });
      providerRepo.findOne.mockResolvedValue({
        id: PROV_PROFILE_ID,
        accountId: ACC_2,
      });
      notificationRepo.save.mockImplementation(
        (arg: Notification | Notification[]) => Promise.resolve(arg),
      );
      qb.getRawMany.mockResolvedValue([
        { accountId: ACC_1, count: 1 },
        { accountId: ACC_2, count: 1 },
      ]);

      await service.notifyOrderCustomerSafe(
        { customerId: CUS_PROFILE_ID },
        { type: 'ORDER_ACCEPTED', title: 'C', body: 'B' },
      );
      expect(customerRepo.findOne).toHaveBeenCalledWith({
        where: { id: CUS_PROFILE_ID },
        select: { id: true, accountId: true },
      });
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_1,
        NOTIFICATION_WS_EVENTS.NEW,
        expect.anything(),
      );

      realtime.emitToAccount.mockClear();
      await service.notifyOrderProviderSafe(
        { providerId: PROV_PROFILE_ID },
        { type: 'ORDER_SUBMITTED', title: 'P', body: 'B' },
      );
      expect(realtime.emitToAccount).toHaveBeenCalledWith(
        ACC_2,
        NOTIFICATION_WS_EVENTS.NEW,
        expect.anything(),
      );

      realtime.emitToAccount.mockClear();
      await service.notifyOrderPartiesSafe(
        { customerId: CUS_PROFILE_ID, providerId: PROV_PROFILE_ID },
        {
          customer: { type: 'ORDER_PAID', title: 'C2', body: 'B2' },
          provider: { type: 'ORDER_PAID', title: 'P2', body: 'B2' },
        },
      );
      expect(realtime.emitToAccount).toHaveBeenCalledTimes(2);
    });

    it('notifyOrderCustomerSafe: thiếu profile → bỏ qua êm, không lỗi', async () => {
      customerRepo.findOne.mockResolvedValue(null);
      await expect(
        service.notifyOrderCustomerSafe(
          { customerId: CUS_PROFILE_ID },
          { type: 'ORDER_ACCEPTED', title: 'C', body: 'B' },
        ),
      ).resolves.toBeUndefined();
      expect(notificationRepo.save).not.toHaveBeenCalled();
    });

    it('notifyAdminsSafe: gửi tới toàn bộ tài khoản ADMIN đang ACTIVE', async () => {
      accountRepo.find.mockResolvedValue([{ id: ACC_1 }, { id: ACC_2 }]);
      notificationRepo.save.mockImplementation((rows: Notification[]) =>
        Promise.resolve(rows),
      );
      qb.getRawMany.mockResolvedValue([
        { accountId: ACC_1, count: 1 },
        { accountId: ACC_2, count: 1 },
      ]);

      await service.notifyAdminsSafe({
        type: 'PROFILE_SUBMITTED_FOR_REVIEW',
        title: 'Hồ sơ mới',
        body: 'Chờ duyệt',
      });

      expect(accountRepo.find).toHaveBeenCalledWith({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      expect(realtime.emitToAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('Admin broadcast', () => {
    it('target = ACCOUNT nhưng thiếu accountIds → 400 TARGET_ACCOUNTS_REQUIRED', async () => {
      await expect(
        service.broadcast({
          title: 'Thông báo',
          body: 'Nội dung',
          target: 'ACCOUNT',
          accountIds: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('target = ALL / CUSTOMER / PROVIDER / ACCOUNT → lọc đúng người nhận (bỏ SUSPENDED)', async () => {
      accountRepo.find.mockResolvedValue([{ id: ACC_1 }, { id: ACC_2 }]);
      notificationRepo.save.mockImplementation((rows: Notification[]) =>
        Promise.resolve(rows),
      );
      qb.getRawMany.mockResolvedValue([
        { accountId: ACC_1, count: 1 },
        { accountId: ACC_2, count: 1 },
      ]);

      const resAll = await service.broadcast({
        title: 'Bảo trì',
        body: 'Hệ thống bảo trì',
        target: 'ALL',
      });
      expect(resAll).toEqual({ sentCount: 2 });
      expect(accountRepo.find).toHaveBeenLastCalledWith({
        where: { status: In(['ACTIVE', 'PENDING']) },
        select: { id: true },
      });

      await service.broadcast({
        title: 'Ưu đãi',
        body: 'Cho khách',
        target: 'CUSTOMER',
      });
      expect(accountRepo.find).toHaveBeenLastCalledWith({
        where: { status: In(['ACTIVE', 'PENDING']), role: 'CUSTOMER' },
        select: { id: true },
      });

      await service.broadcast({
        title: 'Quy định',
        body: 'Cho vườn',
        target: 'PROVIDER',
      });
      expect(accountRepo.find).toHaveBeenLastCalledWith({
        where: { status: In(['ACTIVE', 'PENDING']), role: 'PROVIDER' },
        select: { id: true },
      });

      await service.broadcast({
        title: 'Riêng',
        body: 'Gửi riêng',
        target: 'ACCOUNT',
        accountIds: [ACC_1],
      });
      expect(accountRepo.find).toHaveBeenLastCalledWith({
        where: { status: In(['ACTIVE', 'PENDING']), id: In([ACC_1]) },
        select: { id: true },
      });
    });
  });
});
