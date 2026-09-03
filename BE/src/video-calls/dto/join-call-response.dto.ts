import { ApiProperty } from '@nestjs/swagger';

export class JoinCallResponseDto {
  @ApiProperty({ description: 'GetStream call id.' })
  callId!: string;

  @ApiProperty({ description: 'GetStream user token, scoped to the joining account.' })
  token!: string;

  @ApiProperty({ description: 'accountId of the account joining the call.' })
  userId!: string;

  @ApiProperty({ description: 'Display name of the account joining the call.' })
  userName!: string;
}
