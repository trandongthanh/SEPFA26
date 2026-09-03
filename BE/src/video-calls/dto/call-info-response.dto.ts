import { ApiProperty } from '@nestjs/swagger';

export class CallMemberDto {
  @ApiProperty({ description: 'accountId of the call member.' })
  userId!: string;

  @ApiProperty({
    description: 'Role of the member within the call.',
    required: false,
  })
  role?: string;
}

export class CallInfoResponseDto {
  @ApiProperty({ description: 'GetStream call id.' })
  callId!: string;

  @ApiProperty({
    description: 'accountId of the account that created the call.',
  })
  createdBy!: string;

  @ApiProperty({
    description: 'Provider account id for this call, if any.',
    nullable: true,
  })
  providerId!: string | null;

  @ApiProperty({
    description: 'Provider full name for this call, if any.',
    nullable: true,
  })
  providerName!: string | null;

  @ApiProperty({ description: 'Related order UUID, if this is an order call.', nullable: true })
  orderId!: string | null;

  @ApiProperty({
    description: 'Members currently part of the call.',
    type: [CallMemberDto],
  })
  members!: CallMemberDto[];
}
