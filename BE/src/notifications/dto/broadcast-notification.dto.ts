import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import {
  NOTIFICATION_REF_ENTITIES,
  type NotificationRefEntity,
} from '../notification.constants';

export const BROADCAST_TARGETS = [
  'ALL',
  'CUSTOMER',
  'PROVIDER',
  'ACCOUNT',
] as const;
export type BroadcastTarget = (typeof BROADCAST_TARGETS)[number];

export class BroadcastNotificationDto {
  @ApiProperty({ example: 'Thông báo bảo trì hệ thống', maxLength: 200 })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: 'Hệ thống sẽ bảo trì vào 02:00 ngày 22/11/2026 trong 15 phút.',
    maxLength: 2000,
  })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @ApiProperty({ enum: BROADCAST_TARGETS, example: 'ALL' })
  @IsIn(BROADCAST_TARGETS)
  target!: BroadcastTarget;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Bắt buộc khi target = ACCOUNT (tối đa 100 tài khoản)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  accountIds?: string[];

  @ApiPropertyOptional({ enum: NOTIFICATION_REF_ENTITIES, default: 'SYSTEM' })
  @IsOptional()
  @IsIn(NOTIFICATION_REF_ENTITIES)
  refEntity?: NotificationRefEntity;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  refId?: string;
}
