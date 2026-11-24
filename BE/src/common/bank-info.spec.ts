import { BadRequestException } from '@nestjs/common';
import {
  applyBankPatch,
  hasBankInfo,
  pickBank,
  type BankFields,
} from './bank-info';

const FULL = {
  bankName: 'MBBank',
  bankAccount: '0123456789',
  bankHolder: 'NGUYEN VAN MINH',
};

const empty = (): BankFields => ({
  bankName: null,
  bankAccount: null,
  bankHolder: null,
  bankBin: null,
});

const saved = (): BankFields => ({ ...FULL, bankBin: '970422' });

const expectCode = (fn: () => void, code: string) => {
  try {
    fn();
    throw new Error('không ném lỗi');
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(code);
  }
};

describe('pickBank / hasBankInfo', () => {
  it('đủ 3 trường → có tài khoản, bankBin rỗng về null', () => {
    expect(pickBank({ ...FULL, bankBin: '' })).toEqual({
      ...FULL,
      bankBin: null,
    });
    expect(hasBankInfo({ ...FULL, bankBin: null })).toBe(true);
  });

  it('thiếu 1 trường → không có tài khoản', () => {
    expect(
      pickBank({ ...FULL, bankHolder: null, bankBin: '970422' }),
    ).toBeNull();
    expect(hasBankInfo({ ...FULL, bankAccount: '', bankBin: null })).toBe(
      false,
    );
  });
});

describe('applyBankPatch — cho sửa, cấm xoá', () => {
  it('không gửi trường ngân hàng nào → giữ nguyên', () => {
    const target = saved();
    applyBankPatch(target, {});
    expect(target).toEqual(saved());
  });

  it('gửi đủ bộ 3 + BIN → ghi đè cả bộ', () => {
    const target = empty();
    applyBankPatch(target, { ...FULL, bankBin: '970422' });
    expect(target).toEqual(saved());
  });

  it('gửi đủ bộ 3 không kèm BIN → BIN cũ về null', () => {
    const target = saved();
    applyBankPatch(target, { ...FULL, bankName: 'Vietcombank' });
    expect(target).toEqual({ ...FULL, bankName: 'Vietcombank', bankBin: null });
  });

  it.each([
    ['chuỗi rỗng', { ...FULL, bankAccount: '' }],
    ['null', { ...FULL, bankHolder: null }],
    ['một trường rỗng gửi riêng', { bankName: '' }],
  ])(
    'gửi %s → 400 BANK_INFO_CANNOT_BE_CLEARED, hồ sơ không đổi',
    (_, patch) => {
      const target = saved();
      expectCode(
        () => applyBankPatch(target, patch),
        'BANK_INFO_CANNOT_BE_CLEARED',
      );
      expect(target).toEqual(saved());
    },
  );

  it.each([
    ['chỉ số tài khoản', { bankAccount: '0123456789' }],
    ['thiếu chủ tài khoản', { bankName: 'MBBank', bankAccount: '0123456789' }],
    ['chỉ BIN', { bankBin: '970422' }],
  ])('gửi %s → 400 BANK_INFO_INCOMPLETE', (_, patch) => {
    const target = saved();
    expectCode(() => applyBankPatch(target, patch), 'BANK_INFO_INCOMPLETE');
    expect(target).toEqual(saved());
  });
});
