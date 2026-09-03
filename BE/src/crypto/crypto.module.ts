import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { PasswordService } from './password.service';

// Global: nhiều module (auth, accounts) đều cần crypto/password, khai báo 1 lần dùng chung.
@Global()
@Module({
  providers: [CryptoService, PasswordService],
  exports: [CryptoService, PasswordService],
})
export class CryptoModule {}
