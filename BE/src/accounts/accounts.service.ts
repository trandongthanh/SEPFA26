import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  // ACTIVE luôn cho phép. PENDING cho phép Customer/Provider đăng nhập để upload giấy tờ chờ duyệt.
  // Chỉ SUSPENDED mới bị chặn hoàn toàn.
  isAllowedToAuthenticate(
    account: Pick<Account, 'role' | 'status'> | null | undefined,
  ): boolean {
    return Boolean(
      account &&
      (account.status === 'ACTIVE' || account.status === 'PENDING'),
    );
  }

  async findAuthenticatableById(id: string): Promise<Account | null> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!this.isAllowedToAuthenticate(account)) {
      return null;
    }
    return account;
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const account = await this.accounts.findOne({ where: { id } });
    if (!account) throw new NotFoundException('ACCOUNT_NOT_FOUND');

    const valid = await this.passwords.compare(
      currentPassword,
      account.passwordHash,
    );
    if (!valid) throw new BadRequestException('CURRENT_PASSWORD_INCORRECT');

    account.passwordHash = await this.passwords.hash(newPassword);
    await this.accounts.save(account);
  }

  // Thông tin account hiện tại; giải mã phone, không bao giờ kèm passwordHash.
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
}
