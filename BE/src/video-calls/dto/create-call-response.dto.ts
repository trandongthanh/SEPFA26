import { ApiProperty } from '@nestjs/swagger';

export class CreateCallResponseDto {
  @ApiProperty({ description: 'GetStream call id.' })
  callId!: string;

  @ApiProperty({
    description: 'Shareable URL the client can use to join the call.',
  })
  joinUrl!: string;

  @ApiProperty({
    description: 'accountId of the account that created the call.',
  })
  createdBy!: string;

  @ApiProperty({ description: 'GetStream call type.' })
  callType!: string;
}
