import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { CareReportsService } from './care-reports.service';
import type { CareReport } from './entities/care-report.entity';
import type { CreateCareReportDto } from './dto/create-care-report.dto';
import type { ServiceOrder } from '../orders/entities/service-order.entity';
import type { ProviderProfile } from '../providers/entities/provider-profile.entity';
import type { CustomerProfile } from '../customers/entities/customer-profile.entity';
import {
  checkCareActivity,
  checkPlantPhotos,
  checkReportPlants,
} from './care-report.rules';

const DAY = 24 * 60 * 60 * 1000;
const CARE_START = new Date('2026-12-01T01:00:00Z');

describe('care-report.rules', () => {
  it('tưới/bón: cờ và dữ liệu đi kèm phải khớp', () => {
    expect(
      checkCareActivity({
        watered: true,
        waterAmountMl: 500,
        fertilized: false,
      }),
    ).toBeNull();
    expect(checkCareActivity({ watered: true, fertilized: false })).toBe(
      'CARE_ACTIVITY_INVALID',
    );
    expect(
      checkCareActivity({
        watered: false,
        waterAmountMl: 100,
        fertilized: false,
      }),
    ).toBe('CARE_ACTIVITY_INVALID');
    expect(checkCareActivity({ watered: false, fertilized: true })).toBe(
      'CARE_ACTIVITY_INVALID',
    );
    expect(
      checkCareActivity({
        watered: false,
        fertilized: true,
        fertilizerType: 'NPK',
      }),
    ).toBeNull();
  });

  it('cây gửi lên phải khớp đúng cây đang chăm', () => {
    expect(checkReportPlants(['a', 'b'], ['b', 'a'])).toBeNull();
    expect(checkReportPlants(['a'], ['a', 'b'])).toBe('REPORT_PLANTS_MISMATCH');
    expect(checkReportPlants(['a', 'b', 'c'], ['a', 'b'])).toBe(
      'REPORT_PLANTS_MISMATCH',
    );
    expect(checkReportPlants(['a', 'a'], ['a', 'b'])).toBe(
      'REPORT_PLANTS_MISMATCH',
    );
    // cây bị REJECT không nằm trong danh sách đang chăm → gửi lên là thừa
    expect(checkReportPlants(['a', 'rejected'], ['a'])).toBe(
      'REPORT_PLANTS_MISMATCH',
    );
  });

  const healthy = {
    leafCondition: 'GOOD' as const,
    stemCondition: 'GOOD' as const,
    rootCondition: 'NORMAL' as const,
    hasPestDisease: false,
  };

  it('ảnh: bắt buộc toàn cảnh', () => {
    expect(
      checkPlantPhotos({ ...healthy, photos: [{ evidenceType: 'OVERVIEW' }] }),
    ).toBeNull();
    expect(
      checkPlantPhotos({ ...healthy, photos: [{ evidenceType: 'LEAF' }] }),
    ).toBe('PLANT_PHOTO_REQUIRED');
  });

  it('ảnh: bộ phận Xấu phải có ảnh bộ phận đó', () => {
    const photos = [{ evidenceType: 'OVERVIEW' as const }];
    expect(
      checkPlantPhotos({ ...healthy, leafCondition: 'POOR', photos }),
    ).toBe('PLANT_PHOTO_REQUIRED');
    expect(
      checkPlantPhotos({ ...healthy, stemCondition: 'POOR', photos }),
    ).toBe('PLANT_PHOTO_REQUIRED');
    expect(
      checkPlantPhotos({ ...healthy, rootCondition: 'POOR', photos }),
    ).toBe('PLANT_PHOTO_REQUIRED');
    expect(
      checkPlantPhotos({
        ...healthy,
        rootCondition: 'POOR',
        photos: [...photos, { evidenceType: 'ROOT' }],
      }),
    ).toBeNull();
  });

  it('ảnh: có sâu bệnh phải có ít nhất 1 ảnh cận', () => {
    expect(
      checkPlantPhotos({
        ...healthy,
        hasPestDisease: true,
        photos: [{ evidenceType: 'OVERVIEW' }],
      }),
    ).toBe('PLANT_PHOTO_REQUIRED');
    expect(
      checkPlantPhotos({
        ...healthy,
        hasPestDisease: true,
        photos: [{ evidenceType: 'OVERVIEW' }, { evidenceType: 'STEM' }],
      }),
    ).toBeNull();
  });
});

describe('CareReportsService.createCareReport', () => {
  const providerRepo = { findOne: jest.fn() };
  const orderRepo = { find: jest.fn() };
  const customerRepo = { findOne: jest.fn() };
  const careReportRepo = { findOne: jest.fn(), find: jest.fn() };

  const managerOrderRepo = { findOne: jest.fn() };
  const managerReportRepo = {
    count: jest.fn(),
    create: jest.fn((v: object) => v),
    save: jest.fn((v: object) => ({ id: 'report-1', ...v })),
  };
  const managerPlantRepo = { find: jest.fn() };
  const managerReportPlantRepo = { create: jest.fn((v: object) => v) };
  const manager = {
    getRepository: jest.fn((entity: { name: string }) => {
      switch (entity.name) {
        case 'ServiceOrder':
          return managerOrderRepo;
        case 'CareReport':
          return managerReportRepo;
        case 'Plant':
          return managerPlantRepo;
        case 'CareReportPlant':
          return managerReportPlantRepo;
        default:
          throw new Error(`repo ngoài dự kiến: ${entity.name}`);
      }
    }),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };

  let service: CareReportsService;

  const dto = (
    overrides: Partial<CreateCareReportDto> = {},
  ): CreateCareReportDto => ({
    serviceOrderId: 'order-1',
    airTemperature: 27.5,
    airHumidity: 72,
    lightIntensity: 18000,
    watered: true,
    waterAmountMl: 500,
    fertilized: false,
    plants: ['plant-1', 'plant-2'].map((plantId) => ({
      plantId,
      substrateMoisture: 'MEDIUM' as const,
      leafCondition: 'GOOD' as const,
      rootCondition: 'NORMAL' as const,
      stemCondition: 'GOOD' as const,
      hasPestDisease: false,
      overallHealth: 'GOOD' as const,
      photos: [
        {
          evidenceType: 'OVERVIEW' as const,
          photoUrl: 'https://example.com/a.jpg',
        },
      ],
    })),
    ...overrides,
  });

  const inCareOrder = {
    id: 'order-1',
    providerId: 'provider-1',
    status: 'IN_CARE',
    careStartedAt: CARE_START,
    careDueAt: new Date(CARE_START.getTime() + 30 * DAY),
    reportFrequencySnapshot: 7,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: new Date(CARE_START.getTime() + 2 * DAY) });
    providerRepo.findOne.mockResolvedValue({
      id: 'provider-1',
      verificationStatus: 'APPROVED',
    });
    managerOrderRepo.findOne.mockResolvedValue(inCareOrder);
    managerReportRepo.count.mockResolvedValue(0);
    managerPlantRepo.find.mockResolvedValue([
      { id: 'plant-1' },
      { id: 'plant-2' },
    ]);
    // Repo giả chỉ có các hàm service gọi tới (mẫu care-reports cũ dùng `as any` tương tự).
    service = new CareReportsService(
      careReportRepo as unknown as Repository<CareReport>,
      orderRepo as unknown as Repository<ServiceOrder>,
      providerRepo as unknown as Repository<ProviderProfile>,
      customerRepo as unknown as Repository<CustomerProfile>,
      dataSource as unknown as DataSource,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('kỳ 1 hợp lệ → lưu periodIndex 1, kỳ dài 7 ngày, không trễ; khóa dòng đơn', async () => {
    const result = await service.createCareReport('acc-1', 'PROVIDER', dto());
    expect(result).toMatchObject({
      id: 'report-1',
      periodIndex: 1,
      isLate: false,
    });
    expect(result.periodStart).toEqual(CARE_START);
    expect(result.periodEnd).toEqual(new Date(CARE_START.getTime() + 7 * DAY));
    expect(managerOrderRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
  });

  it('nộp sau hạn kỳ → isLate = true', async () => {
    jest.setSystemTime(new Date(CARE_START.getTime() + 9 * DAY));
    const result = await service.createCareReport('acc-1', 'PROVIDER', dto());
    expect(result.isLate).toBe(true);
  });

  it('kỳ kế tiếp chưa bắt đầu → 409 REPORT_PERIOD_NOT_STARTED', async () => {
    managerReportRepo.count.mockResolvedValue(1);
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(new ConflictException('REPORT_PERIOD_NOT_STARTED'));
  });

  it('đã nộp đủ 5 kỳ → 409 ALL_PERIODS_SUBMITTED', async () => {
    jest.setSystemTime(new Date(CARE_START.getTime() + 40 * DAY));
    managerReportRepo.count.mockResolvedValue(5);
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(new ConflictException('ALL_PERIODS_SUBMITTED'));
  });

  it('kỳ cuối ngắn (kỳ 5) vẫn nộp được, kết thúc đúng hạn chăm', async () => {
    jest.setSystemTime(new Date(CARE_START.getTime() + 40 * DAY));
    managerReportRepo.count.mockResolvedValue(4);
    const result = await service.createCareReport('acc-1', 'PROVIDER', dto());
    expect(result.periodIndex).toBe(5);
    expect(result.periodEnd).toEqual(inCareOrder.careDueAt);
  });

  it('sai vai trò hoặc vườn chưa duyệt → 403', async () => {
    await expect(
      service.createCareReport('acc-1', 'CUSTOMER', dto()),
    ).rejects.toThrow(ForbiddenException);
    providerRepo.findOne.mockResolvedValue({
      id: 'provider-1',
      verificationStatus: 'PENDING',
    });
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('đơn không thuộc vườn → 404; đơn không IN_CARE → 400', async () => {
    managerOrderRepo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(new NotFoundException('SERVICE_ORDER_NOT_FOUND'));
    managerOrderRepo.findOne.mockResolvedValueOnce({
      ...inCareOrder,
      status: 'RETURN_IN_PROGRESS',
    });
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(new BadRequestException('ORDER_NOT_IN_CARE'));
  });

  it('hoạt động / ảnh / cây sai → 400 trước khi lưu', async () => {
    await expect(
      service.createCareReport(
        'acc-1',
        'PROVIDER',
        dto({ waterAmountMl: undefined }),
      ),
    ).rejects.toThrow(new BadRequestException('CARE_ACTIVITY_INVALID'));

    const plants = dto().plants;
    plants[0].leafCondition = 'POOR';
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto({ plants })),
    ).rejects.toThrow(new BadRequestException('PLANT_PHOTO_REQUIRED'));

    managerPlantRepo.find.mockResolvedValue([{ id: 'plant-1' }]);
    await expect(
      service.createCareReport('acc-1', 'PROVIDER', dto()),
    ).rejects.toThrow(new BadRequestException('REPORT_PLANTS_MISMATCH'));
    expect(managerReportRepo.save).not.toHaveBeenCalled();
  });
});
