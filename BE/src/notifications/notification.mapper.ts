import type { NotificationResponseDto } from './dto/notification-response.dto';
import type { Notification } from './entities/notification.entity';

/** Map entity Notification sang DTO trả ra API/socket — tuyệt đối không spread entity hay lộ account. */
export function toNotificationView(
  entity: Notification,
): NotificationResponseDto {
  return {
    id: entity.id,
    type: entity.type,
    title: entity.title,
    body: entity.body,
    refEntity: entity.refEntity ?? null,
    refId: entity.refId ?? null,
    metadata: entity.metadata ?? null,
    isRead: entity.isRead,
    readAt: entity.readAt ?? null,
    createdAt: entity.createdAt,
  };
}
