import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GpsPoint, haversineKm, ROAD_FACTOR } from './shipping-fee';

// Shape tối thiểu của response Distance Matrix (chỉ khai field thật sự dùng).
interface DistanceMatrixResponse {
  status: string;
  rows?: Array<{
    elements?: Array<{
      status: string;
      distance?: { value: number }; // mét
    }>;
  }>;
}

interface OsrmRouteResponse {
  code: string;
  routes?: Array<{ distance?: number }>;
}

/**
 * Khoảng cách đường bộ giữa 2 điểm GPS (km, 2 số lẻ) — dùng tính phí đi lấy cây.
 * Có GOOGLE_MAPS_API_KEY → Google Distance Matrix (nguồn đo chính).
 * Thiếu key → fallback đường chim bay × 1.3 (SPEC_MASTER; 20/07 khôi phục vì chưa có
 * thẻ billing — dán key thật vào .env là tự chuyển sang Google, không sửa code).
 * Có key nhưng Google LỖI → vẫn 503 (không âm thầm đổi cách đo giữa chừng — phí phải nhất quán).
 */
@Injectable()
export class DistanceService {
  private readonly logger = new Logger(DistanceService.name);

  constructor(private readonly config: ConfigService) {}

  async getKm(from: GpsPoint, to: GpsPoint): Promise<number> {
    const routingProvider = this.config.get<string>('ROUTING_PROVIDER', 'google');
    if (routingProvider === 'osrm') return this.getOsrmKm(from, to);

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'Thiếu GOOGLE_MAPS_API_KEY — dùng fallback đường chim bay × 1.3',
      );
      return Math.round(haversineKm(from, to) * ROAD_FACTOR * 100) / 100;
    }

    const url = new URL(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
    );
    url.searchParams.set('origins', `${from.lat},${from.lng}`);
    url.searchParams.set('destinations', `${to.lat},${to.lng}`);
    url.searchParams.set('key', apiKey);

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as DistanceMatrixResponse;
      const element = body.rows?.[0]?.elements?.[0];
      if (
        body.status !== 'OK' ||
        element?.status !== 'OK' ||
        !element.distance
      ) {
        throw new Error(
          `Distance Matrix status=${body.status}, element=${element?.status}`,
        );
      }
      return Math.round((element.distance.value / 1000) * 100) / 100; // khớp cột numeric(6,2)
    } catch (err) {
      // Không đoán phí khi không đo được — phí lệch âm thầm khó lần hơn lỗi rõ ràng.
      this.logger.error(`Distance Matrix lỗi: ${(err as Error).message}`);
      throw new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE');
    }
  }

  private async getOsrmKm(from: GpsPoint, to: GpsPoint): Promise<number> {
    const baseUrl = this.config.get<string>('OSRM_BASE_URL');
    if (!baseUrl) {
      throw new ServiceUnavailableException('OSRM_NOT_CONFIGURED');
    }
    const url = new URL(
      `/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`,
      baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
    );
    url.searchParams.set('overview', 'false');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as OsrmRouteResponse;
      const meters = body.routes?.[0]?.distance;
      if (body.code !== 'Ok' || !meters) {
        throw new Error(`OSRM code=${body.code}`);
      }
      return Math.round((meters / 1000) * 100) / 100;
    } catch (err) {
      this.logger.error(`OSRM lỗi: ${(err as Error).message}`);
      throw new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE');
    }
  }
}
