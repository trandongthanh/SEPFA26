import { BadRequestException } from '@nestjs/common';
import { CareReportsService } from './care-reports.service';

describe('CareReportsService', () => {
  let service: CareReportsService;
  let careReportRepo: any;
  let evidenceRepo: any;
  let orderRepo: any;
  let providerRepo: any;
  let customerRepo: any;
  let dataSource: any;

  beforeEach(() => {
    careReportRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };
    evidenceRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };
    orderRepo = {
      findOne: jest.fn(),
    };
    providerRepo = {
      findOne: jest.fn(),
    };
    customerRepo = {
      findOne: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn(),
    };

    service = new CareReportsService(
      careReportRepo,
      evidenceRepo,
      orderRepo,
      providerRepo,
      customerRepo,
      dataSource,
    );
  });

  it('uses the order report frequency instead of a fixed 3-day window', async () => {
    providerRepo.findOne.mockResolvedValue({ id: 'provider-1', verificationStatus: 'APPROVED' });
    orderRepo.findOne.mockResolvedValue({
      id: 'order-1',
      providerId: 'provider-1',
      status: 'IN_CARE',
      reportFrequencySnapshot: 7,
    });
    careReportRepo.findOne.mockResolvedValue(null);

    const dto = {
      serviceOrderId: 'order-1',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-04T00:00:00.000Z',
      plantNameSnapshot: 'Cây test',
      plantCodeSnapshot: 'PLANT-1',
      plotPositionSnapshot: 'Khu A',
      weather: 'SUNNY',
      temperatureMin: 24,
      temperatureMax: 31,
      humidityMin: 60,
      humidityMax: 82,
      substrateStatus: 'MOIST_GOOD',
      rootStatus: 'ROOTS_HEALTHY_GROWING',
      leafStatus: 'LEAVES_FIRM_AND_HEALTHY',
      shootStatus: 'SHOOTS_UNIFORM',
      wateringCount: 2,
      diseasePrevention: 'NONE',
      evidences: [
        { evidenceType: 'OVERVIEW', photoUrl: 'https://example.com/1.jpg' },
        { evidenceType: 'ROOT', photoUrl: 'https://example.com/2.jpg' },
        { evidenceType: 'LEAF_OR_SHOOT', photoUrl: 'https://example.com/3.jpg' },
      ],
    } as any;

    await expect(service.createCareReport('account-1', 'PROVIDER', dto)).rejects.toThrow(
      BadRequestException,
    );

    await expect(service.createCareReport('account-1', 'PROVIDER', dto)).rejects.toThrow(
      'PERIOD_MUST_MATCH_REPORT_FREQUENCY',
    );
  });
});
