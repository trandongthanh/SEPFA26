import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

export const ADDON_DECISIONS = ['ACCEPT', 'REJECT'] as const;
export type AddonDecision = (typeof ADDON_DECISIONS)[number];

/** Body POST /orders/:orderId/addons/:addonId/respond — khách đồng ý hoặc từ chối đề xuất. */
export class RespondAddonDto {
  @ApiProperty({ enum: ADDON_DECISIONS, example: 'ACCEPT' })
  @IsIn(ADDON_DECISIONS)
  decision!: AddonDecision;

  @ApiPropertyOptional({ example: 'Tôi muốn tự thay khi nhận lại cây' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
