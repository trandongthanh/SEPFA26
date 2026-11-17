import { halfUpPercent } from '../payments/settlement';
import type { CompensationCapPlant } from './compensation-cap';

/**
 * Tiền bảo đảm khai giá của MỘT cây — toán thuần. Khách khai giá vượt `minMultiplier` × giá gói thì nộp
 * thêm `percent`% giá khai (gộp vào QR tiền đơn), có hoàn; chỉ mất khi admin phán cây đó vườn không lỗi.
 * Khai bằng hoặc dưới ngưỡng thì mức đền không cao hơn cây không khai (2 × giá gói) → không thu.
 * Đơn mẫu giá gói 200.000, 10%, ngưỡng 2×: cây A khai 3.000.000 → 300.000; cây B không khai → 0.
 * percent = 0 là tắt hẳn tính năng (mọi cây → 0).
 * (isValueDeclared mà thiếu declaredValue là dữ liệu cũ — coi như không khai.)
 */
export interface DeclaredDepositRule {
  // Tỷ lệ % trên giá khai (env DECLARED_DEPOSIT_PERCENT, mặc định 10).
  percent: bigint;
  // Chỉ thu khi giá khai > minMultiplier × giá gói (env DECLARED_DEPOSIT_MIN_MULTIPLIER, mặc định 2).
  minMultiplier: bigint;
}

export function declaredDepositFor(
  plant: CompensationCapPlant,
  basePrice: bigint,
  rule: DeclaredDepositRule,
): bigint {
  if (basePrice < 0n || rule.percent < 0n || rule.minMultiplier < 0n) {
    throw new RangeError('declaredDepositFor chỉ nhận số không âm');
  }
  if (!plant.isValueDeclared || plant.declaredValue === null) return 0n;
  const declared = BigInt(plant.declaredValue);
  if (declared <= rule.minMultiplier * basePrice) return 0n;
  return halfUpPercent(declared, rule.percent);
}

export function sumDeclaredDeposits(
  plants: CompensationCapPlant[],
  basePrice: bigint,
  rule: DeclaredDepositRule,
): bigint {
  return plants.reduce(
    (sum, plant) => sum + declaredDepositFor(plant, basePrice, rule),
    0n,
  );
}
