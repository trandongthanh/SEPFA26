import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import type {
  BroadcastNotificationResponseDto,
  DeleteNotificationResponseDto,
  DeleteReadNotificationsResponseDto,
  MarkAllReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationListResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { Notification } from './entities/notification.entity';
import {
  NOTIFICATION_WS_EVENTS,
  type NotificationRefEntity,
  type NotificationType,
} from './notification.constants';
import { toNotificationView } from './notification.mapper';
import { RealtimeEmitter } from './realtime-emitter.service';

export interface CreateNotificationInput {
  accountId: string;
  type: NotificationType;
  title: string;
  body: string;
  refEntity?: NotificationRefEntity | null;
  refId?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SAVE_CHUNK_SIZE = 200;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    private readonly realtime: RealtimeEmitter,
  ) {}

  // ======================== USER INBOX ========================

  async listForAccount(
    accountId: string,
    query: QueryNotificationsDto,
  ): Promise<NotificationListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<string, unknown> = { accountId };
    if (query.isRead !== undefined) {
      where.isRead = query.isRead;
    }
    if (query.type !== undefined) {
      where.type = query.type;
    }
    if (query.refEntity !== undefined) {
      where.refEntity = query.refEntity;
    }

    const [[rows, total], unreadCount] = await Promise.all([
      this.notificationRepo.findAndCount({
        where,
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.notificationRepo.count({ where: { accountId, isRead: false } }),
    ]);

    return {
      data: rows.map(toNotificationView),
      total,
      unreadCount,
      page,
      limit,
    };
  }

  async countUnread(accountId: string): Promise<UnreadCountResponseDto> {
    const unreadCount = await this.notificationRepo.count({
      where: { accountId, isRead: false },
    });
    return { unreadCount };
  }

  async getById(
    accountId: string,
    id: string,
  ): Promise<NotificationResponseDto> {
    const row = await this.notificationRepo.findOne({
      where: { id, accountId },
    });
    if (!row) {
      throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    }
    return toNotificationView(row);
  }

  async markAsRead(
    accountId: string,
    id: string,
  ): Promise<MarkNotificationReadResponseDto> {
    const row = await this.notificationRepo.findOne({
      where: { id, accountId },
    });
    if (!row) {
      throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    }

    let saved = row;
    if (!row.isRead) {
      row.isRead = true;
      row.readAt = new Date();
      saved = await this.notificationRepo.save(row);
    }

    const unreadCount = await this.notificationRepo.count({
      where: { accountId, isRead: false },
    });
    this.realtime.emitToAccount(accountId, NOTIFICATION_WS_EVENTS.READ, {
      notificationId: id,
      unreadCount,
    });

    return {
      ...toNotificationView(saved),
      unreadCount,
    };
  }

  async markAllAsRead(accountId: string): Promise<MarkAllReadResponseDto> {
    const result = await this.notificationRepo.update(
      { accountId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    const updatedCount = result.affected ?? 0;

    if (updatedCount > 0) {
      this.realtime.emitToAccount(accountId, NOTIFICATION_WS_EVENTS.READ_ALL, {
        unreadCount: 0,
      });
    }

    return {
      updatedCount,
      unreadCount: 0,
    };
  }

  async deleteOne(
    accountId: string,
    id: string,
  ): Promise<DeleteNotificationResponseDto> {
    const result = await this.notificationRepo.delete({ id, accountId });
    if (!result.affected) {
      throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    }

    const unreadCount = await this.notificationRepo.count({
      where: { accountId, isRead: false },
    });
    this.realtime.emitToAccount(accountId, NOTIFICATION_WS_EVENTS.DELETED, {
      notificationId: id,
      unreadCount,
    });

    return {
      deleted: true,
      id,
      unreadCount,
    };
  }

  async deleteRead(
    accountId: string,
  ): Promise<DeleteReadNotificationsResponseDto> {
    const result = await this.notificationRepo.delete({
      accountId,
      isRead: true,
    });
    return {
      deletedCount: result.affected ?? 0,
    };
  }

  // ======================== DISPATCH & HELPERS ========================

  async createAndEmit(
    input: CreateNotificationInput,
  ): Promise<NotificationResponseDto> {
    const entity = this.notificationRepo.create({
      accountId: input.accountId,
      type: input.type,
      title: input.title,
      body: input.body,
      refEntity: input.refEntity ?? null,
      refId: input.refId ?? null,
      metadata: input.metadata ?? null,
      isRead: false,
      readAt: null,
    });
    const saved = await this.notificationRepo.save(entity);
    const unreadCount = await this.notificationRepo.count({
      where: { accountId: input.accountId, isRead: false },
    });
    const view = toNotificationView(saved);

    this.realtime.emitToAccount(input.accountId, NOTIFICATION_WS_EVENTS.NEW, {
      notification: view,
      unreadCount,
    });

    return view;
  }

  async createManyAndEmit(
    inputs: readonly CreateNotificationInput[],
  ): Promise<NotificationResponseDto[]> {
    if (inputs.length === 0) {
      return [];
    }

    const entities = inputs.map((input) =>
      this.notificationRepo.create({
        accountId: input.accountId,
        type: input.type,
        title: input.title,
        body: input.body,
        refEntity: input.refEntity ?? null,
        refId: input.refId ?? null,
        metadata: input.metadata ?? null,
        isRead: false,
        readAt: null,
      }),
    );

    const savedRows: Notification[] = [];
    for (let i = 0; i < entities.length; i += SAVE_CHUNK_SIZE) {
      const chunk = entities.slice(i, i + SAVE_CHUNK_SIZE);
      const savedChunk = await this.notificationRepo.save(chunk);
      savedRows.push(...savedChunk);
    }

    const distinctIds = [...new Set(savedRows.map((row) => row.accountId))];
    const unreadMap = await this.countUnreadByAccounts(distinctIds);

    const views: NotificationResponseDto[] = [];
    for (const row of savedRows) {
      const view = toNotificationView(row);
      views.push(view);
      this.realtime.emitToAccount(row.accountId, NOTIFICATION_WS_EVENTS.NEW, {
        notification: view,
        unreadCount: unreadMap.get(row.accountId) ?? 0,
      });
    }

    return views;
  }

  async sendSafe(input: CreateNotificationInput): Promise<void> {
    try {
      await this.createAndEmit(input);
    } catch (err) {
      this.logger.warn(
        `Không gửi được thông báo ${input.type} tới ${input.accountId}: ${String(err)}`,
      );
    }
  }

  async sendManySafe(
    inputs: readonly CreateNotificationInput[],
  ): Promise<void> {
    if (inputs.length === 0) {
      return;
    }
    try {
      await this.createManyAndEmit(inputs);
    } catch (err) {
      this.logger.warn(
        `Không gửi được lô ${inputs.length} thông báo: ${String(err)}`,
      );
    }
  }

  async resolveOrderAccounts(order: {
    customerId: string;
    providerId: string;
  }): Promise<{
    customerAccountId: string | null;
    providerAccountId: string | null;
  }> {
    const [customer, provider] = await Promise.all([
      this.customerRepo.findOne({
        where: { id: order.customerId },
        select: { id: true, accountId: true },
      }),
      this.providerRepo.findOne({
        where: { id: order.providerId },
        select: { id: true, accountId: true },
      }),
    ]);
    return {
      customerAccountId: customer?.accountId ?? null,
      providerAccountId: provider?.accountId ?? null,
    };
  }

  async notifyOrderCustomerSafe(
    order: { customerId: string },
    payload: Omit<CreateNotificationInput, 'accountId'>,
  ): Promise<void> {
    try {
      const customer = await this.customerRepo.findOne({
        where: { id: order.customerId },
        select: { id: true, accountId: true },
      });
      if (!customer?.accountId) {
        return;
      }
      await this.sendSafe({ ...payload, accountId: customer.accountId });
    } catch (err) {
      this.logger.warn(
        `Không tra được tài khoản khách ${order.customerId} để gửi thông báo ${payload.type}: ${String(err)}`,
      );
    }
  }

  async notifyOrderProviderSafe(
    order: { providerId: string },
    payload: Omit<CreateNotificationInput, 'accountId'>,
  ): Promise<void> {
    try {
      const provider = await this.providerRepo.findOne({
        where: { id: order.providerId },
        select: { id: true, accountId: true },
      });
      if (!provider?.accountId) {
        return;
      }
      await this.sendSafe({ ...payload, accountId: provider.accountId });
    } catch (err) {
      this.logger.warn(
        `Không tra được tài khoản vườn ${order.providerId} để gửi thông báo ${payload.type}: ${String(err)}`,
      );
    }
  }

  async notifyOrderPartiesSafe(
    order: { customerId: string; providerId: string },
    build: {
      customer?: Omit<CreateNotificationInput, 'accountId'>;
      provider?: Omit<CreateNotificationInput, 'accountId'>;
    },
  ): Promise<void> {
    try {
      const { customerAccountId, providerAccountId } =
        await this.resolveOrderAccounts(order);
      const inputs: CreateNotificationInput[] = [];
      if (build.customer && customerAccountId) {
        inputs.push({ ...build.customer, accountId: customerAccountId });
      }
      if (build.provider && providerAccountId) {
        inputs.push({ ...build.provider, accountId: providerAccountId });
      }
      if (inputs.length > 0) {
        await this.sendManySafe(inputs);
      }
    } catch (err) {
      this.logger.warn(
        `Không gửi được thông báo cho hai bên đơn: ${String(err)}`,
      );
    }
  }

  async notifyAdminsSafe(
    payload: Omit<CreateNotificationInput, 'accountId'>,
  ): Promise<void> {
    try {
      const admins = await this.accountRepo.find({
        where: { role: 'ADMIN', status: 'ACTIVE' },
        select: { id: true },
      });
      if (admins.length === 0) {
        return;
      }
      await this.sendManySafe(
        admins.map((admin) => ({ ...payload, accountId: admin.id })),
      );
    } catch (err) {
      this.logger.warn(
        `Không gửi được thông báo cho admin (${payload.type}): ${String(err)}`,
      );
    }
  }

  // ======================== ADMIN BROADCAST ========================

  async broadcast(
    dto: BroadcastNotificationDto,
  ): Promise<BroadcastNotificationResponseDto> {
    if (
      dto.target === 'ACCOUNT' &&
      (!dto.accountIds || dto.accountIds.length === 0)
    ) {
      throw new BadRequestException('TARGET_ACCOUNTS_REQUIRED');
    }

    const baseWhere: Record<string, unknown> = {
      status: In(['ACTIVE', 'PENDING']),
    };
    if (dto.target === 'CUSTOMER' || dto.target === 'PROVIDER') {
      baseWhere.role = dto.target;
    } else if (dto.target === 'ACCOUNT' && dto.accountIds) {
      baseWhere.id = In([...new Set(dto.accountIds)]);
    }

    const recipients = await this.accountRepo.find({
      where: baseWhere,
      select: { id: true },
    });

    if (recipients.length === 0) {
      return { sentCount: 0 };
    }

    const created = await this.createManyAndEmit(
      recipients.map((account) => ({
        accountId: account.id,
        type: 'SYSTEM_ANNOUNCEMENT',
        title: dto.title,
        body: dto.body,
        refEntity: dto.refEntity ?? 'SYSTEM',
        refId: dto.refId ?? null,
        metadata: { target: dto.target },
      })),
    );

    return { sentCount: created.length };
  }

  private async countUnreadByAccounts(
    accountIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const raw = await this.notificationRepo
      .createQueryBuilder('n')
      .select('n.account_id', 'accountId')
      .addSelect('COUNT(*)::int', 'count')
      .where('n.account_id IN (:...ids)', { ids: accountIds })
      .andWhere('n.is_read = false')
      .groupBy('n.account_id')
      .getRawMany<{ accountId: string; count: number | string }>();

    return new Map(raw.map((row) => [row.accountId, Number(row.count) || 0]));
  }
}
