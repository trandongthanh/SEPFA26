import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DistanceService, ROUTES_API_URL } from './distance.service';
import { haversineKm, ROAD_FACTOR } from './shipping-fee';

const HOME = { lat: 10.7769, lng: 106.7009 };
const GARDEN = { lat: 10.8231, lng: 106.6297 };

const makeService = (apiKey: string | undefined) =>
  new DistanceService({
    get: jest.fn((key: string) =>
      key === 'GOOGLE_MAPS_API_KEY' ? apiKey : undefined,
    ),
  } as unknown as ConfigService);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('DistanceService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('thiếu key (dev/test) → chim bay × 1.3, làm tròn 2 số lẻ, không gọi Google', async () => {
    const km = await makeService('').getKm(HOME, GARDEN);

    const expected =
      Math.round(haversineKm(HOME, GARDEN) * ROAD_FACTOR * 100) / 100;
    expect(km).toBe(expected);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('có key → gọi Routes API đúng header/body, 12.345 m → 12.35 km', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ routes: [{ distanceMeters: 12345 }] }),
    );

    const km = await makeService('test-key').getKm(HOME, GARDEN);

    expect(km).toBe(12.35);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ROUTES_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'X-Goog-Api-Key': 'test-key',
      'X-Goog-FieldMask': 'routes.distanceMeters',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      origin: {
        location: { latLng: { latitude: 10.7769, longitude: 106.7009 } },
      },
      destination: {
        location: { latLng: { latitude: 10.8231, longitude: 106.6297 } },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('Google trả {} (không có đường đi) → 422 PICKUP_ROUTE_NOT_FOUND', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));

    await expect(makeService('test-key').getKm(HOME, GARDEN)).rejects.toThrow(
      new UnprocessableEntityException('PICKUP_ROUTE_NOT_FOUND'),
    );
  });

  it('2 điểm trùng nhau: Google bỏ distanceMeters → 0 km', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ routes: [{}] }));

    await expect(makeService('test-key').getKm(HOME, HOME)).resolves.toBe(0);
  });

  it('HTTP 403 (key sai / chưa bật API) → 503 DISTANCE_SERVICE_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 403, status: 'PERMISSION_DENIED', message: 'x' } },
        403,
      ),
    );

    await expect(makeService('test-key').getKm(HOME, GARDEN)).rejects.toThrow(
      new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE'),
    );
  });

  it('timeout / lỗi mạng → 503 DISTANCE_SERVICE_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation timed out', 'TimeoutError'),
    );

    await expect(makeService('test-key').getKm(HOME, GARDEN)).rejects.toThrow(
      new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE'),
    );
  });

  it('body không phải JSON → 503', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));

    await expect(makeService('test-key').getKm(HOME, GARDEN)).rejects.toThrow(
      new ServiceUnavailableException('DISTANCE_SERVICE_UNAVAILABLE'),
    );
  });
});
