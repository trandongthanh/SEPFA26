import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../crypto/password.service';
import { Account } from './entities/account.entity';
import { AccountResponseDto } from './dto/account-response.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
  ) {}

  // Nguồn DUY NHẤT cho luật "được đăng nhập" (login, Google, refresh, JWT guard).
  // PENDING vẫn được vào để nộp hồ sơ kích hoạt; chỉ SUSPENDED bị chặn.
  isAllowedToAuthenticate(
    account: Pick<Account, 'status'> | null | undefined,
  ): boolean {
    return (
      !!account && (account.status === 'ACTIVE' || account.status === 'PENDING')
    );
  }

  async findAuthenticatableById(id: string): Promise<Account | null> {
    const account = await this.accounts.findOne({ where: { id } });
    return account && this.isAllowedToAuthenticate(account) ? account : null;
  }

  async getProfile(id: string): Promise<AccountResponseDto> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }
    return {
      id: account.id,
      email: account.email,
      fullName: account.fullName,
      phone: account.phone ? this.crypto.decrypt(account.phone) : null,
      role: account.role,
      status: account.status,
    };
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) {
      throw new NotFoundException('ACCOUNT_NOT_FOUND');
    }
    const valid = await this.passwords.compare(
      currentPassword,
      account.passwordHash,
    );
    if (!valid) {
      throw new BadRequestException('CURRENT_PASSWORD_INCORRECT');
    }
    const passwordHash = await this.passwords.hash(newPassword);
    // Đổi mật khẩu + thu hồi MỌI phiên trong 1 transaction: mật khẩu cũ bị lộ thì
    // kẻ đang giữ refresh token cũng bị đẩy ra. Client phải đăng nhập lại bằng mật khẩu mới.
    // Ghi thẳng vào bảng refresh_tokens (entity của module auth) — cùng điều kiện với
    // AuthService.revokeAllSessions; đổi cách thu hồi phiên thì sửa cả 2 chỗ.
    await this.accounts.manager.transaction(async (manager) => {
      await manager.update(Account, { id }, { passwordHash });
      await manager.update(
        RefreshToken,
        { accountId: id, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });
  }
}
