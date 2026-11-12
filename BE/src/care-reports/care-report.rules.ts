// Luật nghiệp vụ của báo cáo chăm sóc — hàm thuần, trả mã lỗi (null = hợp lệ).
import type { EvidenceType, PartCondition } from './care-report.constants';

/** Tưới thì phải ghi lượng nước, bón thì phải ghi loại phân; không làm thì không được gửi. */
export function checkCareActivity(input: {
  watered: boolean;
  waterAmountMl?: number | null;
  fertilized: boolean;
  fertilizerType?: string | null;
}): 'CARE_ACTIVITY_INVALID' | null {
  const hasWater =
    input.waterAmountMl !== undefined && input.waterAmountMl !== null;
  const hasFertilizer = !!input.fertilizerType;
  if (input.watered !== hasWater || input.fertilized !== hasFertilizer) {
    return 'CARE_ACTIVITY_INVALID';
  }
  return null;
}

/**
 * Danh sách cây gửi lên phải khớp ĐÚNG các cây đang chăm (không thiếu, không thừa, không trùng).
 * Cây đang chăm = cây của đơn có handover_decision khác REJECT.
 */
export function checkReportPlants(
  submittedPlantIds: string[],
  inCarePlantIds: string[],
): 'REPORT_PLANTS_MISMATCH' | null {
  const submitted = new Set(submittedPlantIds);
  if (
    submitted.size !== submittedPlantIds.length ||
    submitted.size !== inCarePlantIds.length ||
    !inCarePlantIds.every((id) => submitted.has(id))
  ) {
    return 'REPORT_PLANTS_MISMATCH';
  }
  return null;
}

const CLOSE_UP: EvidenceType[] = ['LEAF', 'STEM', 'ROOT'];

/**
 * Ảnh bắt buộc của một cây:
 * - luôn có ảnh toàn cảnh (OVERVIEW);
 * - lá/thân/rễ chấm Xấu (POOR) → phải có ảnh LEAF/STEM/ROOT tương ứng;
 * - có sâu bệnh → ít nhất 1 ảnh cận (LEAF/STEM/ROOT).
 */
export function checkPlantPhotos(plant: {
  leafCondition: PartCondition;
  stemCondition: PartCondition;
  rootCondition: PartCondition;
  hasPestDisease: boolean;
  photos: { evidenceType: EvidenceType }[];
}): 'PLANT_PHOTO_REQUIRED' | null {
  const types = new Set(plant.photos.map((photo) => photo.evidenceType));
  const required: EvidenceType[] = ['OVERVIEW'];
  if (plant.leafCondition === 'POOR') required.push('LEAF');
  if (plant.stemCondition === 'POOR') required.push('STEM');
  if (plant.rootCondition === 'POOR') required.push('ROOT');
  if (!required.every((type) => types.has(type))) {
    return 'PLANT_PHOTO_REQUIRED';
  }
  if (plant.hasPestDisease && !CLOSE_UP.some((type) => types.has(type))) {
    return 'PLANT_PHOTO_REQUIRED';
  }
  return null;
}
