import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  NOTIFICATION_REF_ENTITIES,
  NOTIFICATION_TYPES,
  type NotificationRefEntity,
  type NotificationType,
} from '../notification.constants';

export class QueryNotificationsDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: false,
    description: 'Lọc theo trạng thái đọc: true | false',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }): unknown =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  isRead?: boolean;

  @ApiPropertyOptional({ enum: NOTIFICATION_TYPES })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: NotificationType;

  @ApiPropertyOptional({ enum: NOTIFICATION_REF_ENTITIES })
  @IsOptional()
  @IsIn(NOTIFICATION_REF_ENTITIES)
  refEntity?: NotificationRefEntity;
}
