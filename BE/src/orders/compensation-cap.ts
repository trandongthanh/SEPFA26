/**
 * Mức đền của MỘT cây — toán thuần. Có khai giá = giá khách khai; không khai = 2 × giá gói.
 * Tổng mức đền các cây vườn nhận = tiền bảo đảm vườn phải nộp lúc nhận cây.
 * Đơn mẫu giá gói 200.000: cây A khai 3.000.000 → 3.000.000; cây B không khai → 400.000; tổng 3.400.000.
 * (isValueDeclared mà thiếu declaredValue là dữ liệu cũ — coi như không khai.)
 */
export interface CompensationCapPlant {
  isValueDeclared: boolean;
  declaredValue: string | null;
}

export function compensationCapFor(
  plant: CompensationCapPlant,
  basePrice: bigint,
): bigint {
  return plant.isValueDeclared && plant.declaredValue !== null
    ? BigInt(plant.declaredValue)
    : 2n * basePrice;
}

export function sumCompensationCaps(
  plants: CompensationCapPlant[],
  basePrice: bigint,
): bigint {
  return plants.reduce(
    (sum, plant) => sum + compensationCapFor(plant, basePrice),
    0n,
  );
}
