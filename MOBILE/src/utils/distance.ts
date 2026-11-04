/**
 * Tiện ích tính khoảng cách định vị bản đồ và đường bộ cho Mobile LanCare Hub.
 * Hệ số bù đường bộ ROAD_FACTOR = 1.3 khớp với đặc tả chuẩn hệ thống.
 */

export interface LatLngPoint {
  lat?: number | string | null;
  lng?: number | string | null;
}

/**
 * Tính khoảng cách đường chim bay (Haversine) nhân hệ số đường bộ 1.3
 * @returns số km làm tròn 1 chữ số thập phân (hoặc null nếu thiếu toạ độ)
 */
export function calculateRoadDistanceKm(
  lat1?: number | string | null,
  lon1?: number | string | null,
  lat2?: number | string | null,
  lon2?: number | string | null,
): number | null {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return null;
  // Bỏ qua toạ độ 0,0 (chưa ghim vị trí)
  if (Math.abs(nLat1) < 0.0001 && Math.abs(nLon1) < 0.0001) return null;
  if (Math.abs(nLat2) < 0.0001 && Math.abs(nLon2) < 0.0001) return null;

  const R = 6371; // Bán kính Trái Đất (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLon = toRad(nLon2 - nLon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const haversineKm = R * c;

  // Nhân hệ số đường bộ 1.3
  const roadKm = haversineKm * 1.3;
  return Math.round(roadKm * 10) / 10;
}
