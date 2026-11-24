import type { CryptoService } from '../crypto/crypto.service';
import type { Account } from './entities/account.entity';

// Shape account an toàn để lồng vào response của module khác (hồ sơ provider/customer, màn admin).
// KHÔNG spread entity Account ra response: `{ ...account }` biến instance thành object thường,
// ClassSerializerInterceptor không còn thấy @Exclude → lộ passwordHash/phoneHash.
export interface AccountSummary {
  id: string;
  email: string;
  fullName: string;
  role: Account['role'];
  status: Account['status'];
  phone: string | null; // đã giải mã
}

export function toAccountSummary(
  account: Account,
  crypto: CryptoService,
): AccountSummary {
  return {
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    role: account.role,
    status: account.status,
    phone: account.phone ? crypto.decrypt(account.phone) : null,
  };
}
