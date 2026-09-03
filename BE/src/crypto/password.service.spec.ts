import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

const makeService = (saltRounds = 10): PasswordService => {
  // saltRounds=10 cho test chạy nhanh (mặc định app là 12).
  const config = {
    get: (_name: string, def?: unknown) => saltRounds ?? def,
  } as unknown as ConfigService;
  return new PasswordService(config);
};

describe('PasswordService', () => {
  let passwords: PasswordService;

  beforeEach(() => {
    passwords = makeService();
  });

  it('hash ra chuỗi khác bản gốc và compare khớp', async () => {
    const plain = 'matkhau123';
    const hashed = await passwords.hash(plain);
    expect(hashed).not.toBe(plain);
    expect(await passwords.compare(plain, hashed)).toBe(true);
  });

  it('compare trả false khi mật khẩu sai', async () => {
    const hashed = await passwords.hash('matkhau123');
    expect(await passwords.compare('saibet', hashed)).toBe(false);
  });

  it('hai lần hash cùng mật khẩu ra hash khác nhau (salt ngẫu nhiên)', async () => {
    const a = await passwords.hash('matkhau123');
    const b = await passwords.hash('matkhau123');
    expect(a).not.toBe(b);
    // nhưng cả hai vẫn compare khớp với bản gốc
    expect(await passwords.compare('matkhau123', a)).toBe(true);
    expect(await passwords.compare('matkhau123', b)).toBe(true);
  });
});
