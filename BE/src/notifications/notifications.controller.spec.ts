import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { AdminNotificationsController } from './admin-notifications.controller';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

const ACC_ID = '11111111-1111-4111-8111-111111111111';
const NOTIF_ID = '22222222-2222-4222-8222-222222222222';

const USER: CurrentUserData = {
  accountId: ACC_ID,
  role: 'CUSTOMER',
};

describe('Notifications DTO validation & Controllers', () => {
  describe('QueryNotificationsDto', () => {
    it('chuyển chuỗi "false" và "true" sang boolean chính xác (không bị Boolean("false") === true)', async () => {
      const dtoFalse = plainToInstance(QueryNotificationsDto, {
        isRead: 'false',
        page: '2',
        limit: '15',
      });
      expect(dtoFalse.isRead).toBe(false);
      expect(dtoFalse.page).toBe(2);
      expect(dtoFalse.limit).toBe(15);
      await expect(validate(dtoFalse)).resolves.toHaveLength(0);

      const dtoTrue = plainToInstance(QueryNotificationsDto, {
        isRead: 'true',
      });
      expect(dtoTrue.isRead).toBe(true);
      await expect(validate(dtoTrue)).resolves.toHaveLength(0);
    });

    it('từ chối isRead không hợp lệ và limit > 50', async () => {
      const dto = plainToInstance(QueryNotificationsDto, {
        isRead: 'abc',
        limit: '99',
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual(
        expect.arrayContaining(['isRead', 'limit']),
      );
    });
  });

  describe('BroadcastNotificationDto', () => {
    it('trim title/body và chấp nhận payload hợp lệ', async () => {
      const dto = plainToInstance(BroadcastNotificationDto, {
        title: '  Bảo trì hệ thống  ',
        body: '  Hệ thống nâng cấp lúc 02:00.  ',
        target: 'ALL',
      });
      expect(dto.title).toBe('Bảo trì hệ thống');
      expect(dto.body).toBe('Hệ thống nâng cấp lúc 02:00.');
      await expect(validate(dto)).resolves.toHaveLength(0);
    });

    it('từ chối title rỗng sau trim và target không hợp lệ', async () => {
      const dto = plainToInstance(BroadcastNotificationDto, {
        title: '   ',
        body: 'OK',
        target: 'UNKNOWN',
      });
      const errors = await validate(dto);
      expect(errors.map((e) => e.property)).toEqual(
        expect.arrayContaining(['title', 'target']),
      );
    });
  });

  describe('NotificationsController & AdminNotificationsController delegation', () => {
    const service = {
      countUnread: jest.fn(),
      listForAccount: jest.fn(),
      markAllAsRead: jest.fn(),
      deleteRead: jest.fn(),
      getById: jest.fn(),
      markAsRead: jest.fn(),
      deleteOne: jest.fn(),
      broadcast: jest.fn(),
    };
    const controller = new NotificationsController(
      service as unknown as NotificationsService,
    );
    const adminController = new AdminNotificationsController(
      service as unknown as NotificationsService,
    );

    beforeEach(() => jest.clearAllMocks());

    it('uỷ quyền mọi route sang NotificationsService với user.accountId', async () => {
      await controller.countUnread(USER);
      expect(service.countUnread).toHaveBeenCalledWith(ACC_ID);

      await controller.listForAccount(USER, { page: 1, limit: 20 });
      expect(service.listForAccount).toHaveBeenCalledWith(ACC_ID, {
        page: 1,
        limit: 20,
      });

      await controller.markAllAsRead(USER);
      expect(service.markAllAsRead).toHaveBeenCalledWith(ACC_ID);

      await controller.deleteRead(USER);
      expect(service.deleteRead).toHaveBeenCalledWith(ACC_ID);

      await controller.getById(USER, NOTIF_ID);
      expect(service.getById).toHaveBeenCalledWith(ACC_ID, NOTIF_ID);

      await controller.markAsRead(USER, NOTIF_ID);
      expect(service.markAsRead).toHaveBeenCalledWith(ACC_ID, NOTIF_ID);

      await controller.deleteOne(USER, NOTIF_ID);
      expect(service.deleteOne).toHaveBeenCalledWith(ACC_ID, NOTIF_ID);

      const broadcastDto: BroadcastNotificationDto = {
        title: 'TB',
        body: 'Nội dung',
        target: 'ALL',
      };
      await adminController.broadcast(broadcastDto);
      expect(service.broadcast).toHaveBeenCalledWith(broadcastDto);
    });
  });
});
