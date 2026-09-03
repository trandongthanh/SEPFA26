import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export const VIDEO_CALL_TYPES = [
  'default',
  'livestream',
  'audio_room',
] as const;
export type VideoCallType = (typeof VIDEO_CALL_TYPES)[number];

export class CreateCallDto {
  @ApiPropertyOptional({
    description:
      'GetStream call type. Controls enabled features and permissions.',
    enum: VIDEO_CALL_TYPES,
    default: 'default',
  })
  @IsOptional()
  @IsIn(VIDEO_CALL_TYPES)
  type?: VideoCallType = 'default';

  @ApiPropertyOptional({
    description:
      'Optional target provider account id to notify about incoming call',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    description:
      'Order UUID to which this call belongs; required for authorization.',
  })
  @IsUUID()
  orderId!: string;
}
