import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

// Admin chỉ quyết APPROVED hoặc REJECTED (PENDING là trạng thái khởi tạo, không phải quyết định).
const DECISIONS = ['APPROVED', 'REJECTED'] as const;
type Decision = (typeof DECISIONS)[number];

export class VerifyProviderDto {
  @ApiProperty({ enum: DECISIONS, example: 'APPROVED' })
  @IsEnum(DECISIONS)
  decision!: Decision;

  @ApiPropertyOptional({
    example: 'Giấy phép không hợp lệ',
    description: 'Lý do (nên có khi REJECTED)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
