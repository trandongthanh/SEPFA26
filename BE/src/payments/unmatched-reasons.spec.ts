import {
  addonUnmatchedReason,
  depositUnmatchedReason,
  isProviderMoney,
} from './unmatched-reasons';

describe('unmatched-reasons', () => {
  it('nhánh add-on: thiếu tiền → ADDON_INSUFFICIENT, còn lại → ADDON_NOT_PAYABLE', () => {
    expect(addonUnmatchedReason('INSUFFICIENT_AMOUNT')).toBe(
      'ADDON_INSUFFICIENT',
    );
    expect(addonUnmatchedReason('ADDON_NOT_PAYABLE')).toBe('ADDON_NOT_PAYABLE');
  });

  it('nhánh tiền bảo đảm: trễ / thiếu / không còn chờ', () => {
    expect(depositUnmatchedReason('SECURITY_DEPOSIT_EXPIRED')).toBe(
      'DEPOSIT_EXPIRED',
    );
    expect(depositUnmatchedReason('INSUFFICIENT_AMOUNT')).toBe(
      'DEPOSIT_INSUFFICIENT',
    );
    expect(depositUnmatchedReason('SECURITY_DEPOSIT_NOT_PENDING')).toBe(
      'DEPOSIT_NOT_PENDING',
    );
  });

  it('chỉ tiền bảo đảm là tiền của vườn', () => {
    expect(isProviderMoney('DEPOSIT_EXPIRED')).toBe(true);
    expect(isProviderMoney('INSUFFICIENT_AMOUNT')).toBe(false);
    expect(isProviderMoney('NO_CODE')).toBe(false);
    expect(isProviderMoney(null)).toBe(false);
  });
});
