import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NOTIFICATION_REF_ENTITIES,
  NOTIFICATION_TYPES,
  type NotificationRefEntity,
  type NotificationType,
} from '../notification.constants';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NOTIFICATION_TYPES, example: 'ORDER_SUBMITTED' })
  type!: NotificationType;

  @ApiProperty({ example: 'Có đơn đặt chăm sóc mới' })
  title!: string;

  @ApiProperty({ example: 'Đơn LCH-20261121-AB12 đang chờ nhà vườn phản hồi.' })
  body!: string;

  @ApiPropertyOptional({
    enum: NOTIFICATION_REF_ENTITIES,
    nullable: true,
    example: 'ORDER',
  })
  refEntity!: NotificationRefEntity | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  refId!: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ example: false })
  isRead!: boolean;

  @ApiPropertyOptional({ type: Date, nullable: true })
  readAt!: Date | null;

  @ApiProperty({ type: Date })
  createdAt!: Date;
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data!: NotificationResponseDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 5 })
  unreadCount!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

export class UnreadCountResponseDto {
  @ApiProperty({ example: 5 })
  unreadCount!: number;
}

export class MarkNotificationReadResponseDto extends NotificationResponseDto {
  @ApiProperty({ example: 4 })
  unreadCount!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty({ example: 5 })
  updatedCount!: number;

  @ApiProperty({ example: 0 })
  unreadCount!: number;
}

export class DeleteNotificationResponseDto {
  @ApiProperty({ example: true })
  deleted!: boolean;

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 4 })
  unreadCount!: number;
}

export class DeleteReadNotificationsResponseDto {
  @ApiProperty({ example: 12 })
  deletedCount!: number;
}

export class BroadcastNotificationResponseDto {
  @ApiProperty({ example: 25 })
  sentCount!: number;
}
