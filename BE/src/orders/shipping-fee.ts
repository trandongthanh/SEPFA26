/**
 * Toán thuần cho phí đi lấy cây — không import NestJS/TypeORM để unit-test không cần DB.
 * Khoảng cách (km) do DistanceService đo qua Google Distance Matrix; file này chỉ lo TIỀN.
 * Nghiệp vụ: docs/data-dictionary.md (SHIPPING_RATE) + sơ đồ orders-create.md.
 */

export interface GpsPoint {
  lat: number;
  lng: number;
}

// Hệ số bù "đường chim bay → đường thực tế" khi fallback không có Google key (SPEC_MASTER).
export const ROAD_FACTOR = 1.3;

// Khoảng cách đường chim bay (công thức haversine, bán kính Trái Đất 6371km).
export function haversineKm(from: GpsPoint, to: GpsPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) *
      Math.cos(toRad(to.lat)) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bậc giá dạng đã load từ DB (numeric/bigint của TypeORM trả string).
export interface ShippingTier {
  minKm: string;
  maxKm: string | null;
  baseFee: string;
  perKmFee: string;
  billingUnitKm?: string | null;
}

// Tìm bậc chứa km theo nửa khoảng [minKm, maxKm) — km rơi đúng ranh thuộc bậc TRÊN.
// (Công thức liền mạch nên phí tại ranh giới 2 bậc bằng nhau, chọn nửa khoảng nào không đổi tiền.)
export function pickTier<T extends ShippingTier>(
  tiers: T[],
  km: number,
): T | undefined {
  return tiers.find((tier) => {
    const min = Number(tier.minKm);
    const max = tier.maxKm === null ? Infinity : Number(tier.maxKm);
    return km >= min && km < max;
  });
}

// Phí = baseFee + (km − minKm) × perKmFee, làm tròn HALF_UP về đồng nguyên (NĐ 174/2016).
export function computeShippingFee(
  tier: ShippingTier,
  km: number,
  plantCount = 1,
): number {
  const exceeded = Math.max(0, km - Number(tier.minKm));
  const unitKm = Number(tier.billingUnitKm || 0);
  const extra =
    unitKm > 0
      ? Math.ceil(exceeded / unitKm) * Number(tier.perKmFee)
      : exceeded * Number(tier.perKmFee);
  return Math.round((Number(tier.baseFee) + extra) * plantCount);
}
