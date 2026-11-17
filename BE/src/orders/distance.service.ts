import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GpsPoint, haversineKm, ROAD_FACTOR } from './shipping-fee';

// Google Routes API (thay Distance Matrix đã thành Legacy). Chỉ đo 1 cặp điểm → computeRoutes.
export const ROUTES_API_URL =
  'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_TIMEOUT_MS = 5_000;

// Shape tối thiểu của response (FieldMask chỉ xin routes.distanceMeters).
// Không có đường đi → Google trả `{}` (không có `routes`).
interface ComputeRoutesResponse {
  routes?: Array<{ distanceMeters?: number }>;
}

const toWaypoint = (p: GpsPoint) => ({
  location: { latLng: { latitude: p.lat, longitude: p.lng } },
});

/**
 * Khoảng cách đường bộ giữa 2 điểm GPS (km, 2 số lẻ) — dùng tính phí đi lấy cây.
 * - Có GOOGLE_MAPS_API_KEY → Google Routes API, đi ô tô (DRIVE), không tính kẹt xe (TRAFFIC_UNAWARE)
 *   để cùng 2 điểm luôn ra cùng quãng đường → phí xem trước khớp phí lúc tạo đơn.
 * - Thiếu key → chim bay × 1.3. Chỉ xảy ra ở development/test: production thiếu key thì BE không
 *   khởi động (env.validation.ts) — không bao giờ âm thầm tính sai phí trên môi trường thật.
 * - Google lỗi → 503 (không đoán phí); không có đường đi → 422 (vị trí khách ghim sai chỗ).
 */
@Injectable()
export class DistanceService {
  private readonly logger = new Logger(DistanceService.name);

  constructor(private readonly config: ConfigService) {}

  async getKm(from: GpsPoint, to: GpsPoint): Promise<number> {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'Thiếu GOOGLE_MAPS_API_KEY — dùng đường chim bay × 1.3 (chỉ dev/test)',
      );
      return roundKm(haversineKm(from, to) * ROAD_FACTOR);
    }

    let body: ComputeRoutesResponse;
    try {
      const res = await fetch(ROUTES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body: JSON.stringify({
          origin: toWaypoint(from),
          destination: toWaypoint(to),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
        }),
        signal: AbortSignal.timeout(ROUTES_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Body lỗi của Google có status/message (vd PERMISSION_DENIED) — không chứa key.
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${detail.slice(0, 300)}`);
      }
      body = (await res.json()) as ComputeRoutesResponse;
    } catch (err) {
      // Không đoán phí khi không đo được — phí lệch âm thầm khó lần hơn lỗi rõ ràng.
      this.logger.error(`Routes API lỗi: ${(err as Error).message}`);
      throw new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE');
    }

    const meters = body.routes?.[0]?.distanceMeters;
    if (meters === undefined) {
      if (!body.routes?.length) {
        throw new UnprocessableEntityException('PICKUP_ROUTE_NOT_FOUND');
      }
      // 2 điểm trùng nhau: Google bỏ field 0 (proto3 không gửi giá trị mặc định).
      return 0;
    }
    return roundKm(meters / 1000);
  }
}

// Làm tròn 2 số lẻ — khớp cột numeric(6,2).
function roundKm(km: number): number {
  return Math.round(km * 100) / 100;
}
