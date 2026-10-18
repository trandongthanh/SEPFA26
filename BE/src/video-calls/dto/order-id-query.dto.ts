import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// GET /video-calls/active?orderId=, GET /video-calls?orderId=
export class OrderIdQueryDto {
  @ApiProperty({ example: '3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b' })
  @IsUUID()
  orderId!: string;
}
