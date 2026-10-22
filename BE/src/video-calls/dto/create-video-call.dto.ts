import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// POST /video-calls — người nhận do BE suy ra từ đơn (bên còn lại), client chỉ gửi đơn.
export class CreateVideoCallDto {
  @ApiProperty({ example: '3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b' })
  @IsUUID()
  orderId!: string;
}
