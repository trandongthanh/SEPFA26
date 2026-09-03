import { ApiProperty } from '@nestjs/swagger';

export class TokenResponseDto {
  @ApiProperty({ description: 'GetStream user token, scoped to the current account.' })
  token!: string;
}
