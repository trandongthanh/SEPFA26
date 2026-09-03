import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly saltRounds: number;
  // Hash "mồi" tính sẵn 1 lần — so bù khi email không tồn tại để thời gian
  // phản hồi login đồng đều (chống dò email qua timing). Xem B2.
  readonly dummyHash: string;

  constructor(config: ConfigService) {
    this.saltRounds = config.get<number>('BCRYPT_SALT_ROUNDS', 12);
    this.dummyHash = bcrypt.hashSync(
      'dummy-password-for-timing',
      this.saltRounds,
    );
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.saltRounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
