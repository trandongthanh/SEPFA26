import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, QueryFailedError, Repository } from 'typeorm';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { Plant } from '../orders/entities/plant.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CareReport } from './entities/care-report.entity';
import { CareReportPlant } from './entities/care-report-plant.entity';
import { CreateCareReportDto } from './dto/create-care-report.dto';
import { QueryCareReportDto } from './dto/query-care-report.dto';
import { computeCarePeriod, countTotalPeriods } from './care-period';
import {
  checkCareActivity,
  checkPlantPhotos,
  checkReportPlants,
} from './care-report.rules';

const READ_RELATIONS = { plants: { plant: true, photos: true } } as const;

@Injectable()
export class CareReportsService {
  constructor(
    @InjectRepository(CareReport)
    private readonly careReportRepo: Repository<CareReport>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Vườn nộp báo cáo kỳ kế tiếp. Server tự gán kỳ = số báo cáo đã có + 1
   * (khóa dòng đơn để 2 yêu cầu đồng thời không cùng lấy một kỳ).
   */
  async createCareReport(
    accountId: string,
    role: string,
    dto: CreateCareReportDto,
  ) {
    const provider = await this.approvedProvider(accountId, role);

    const activityError = checkCareActivity(dto);
    if (activityError) {
      throw new BadRequestException(activityError);
    }
    for (const plant of dto.plants) {
      const photoError = checkPlantPhotos(plant);
      if (photoError) {
        throw new BadRequestException(photoError);
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const order = await manager.getRepository(ServiceOrder).findOne({
          where: { id: dto.serviceOrderId, providerId: provider.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!order) {
          throw new NotFoundException('SERVICE_ORDER_NOT_FOUND');
        }
        if (
          order.status !== 'IN_CARE' ||
          !order.careStartedAt ||
          !order.careDueAt
        ) {
          throw new BadRequestException('ORDER_NOT_IN_CARE');
        }

        const window = {
          careStartedAt: order.careStartedAt,
          careDueAt: order.careDueAt,
          reportFrequencyDays: order.reportFrequencySnapshot,
        };
        const submitted = await manager
          .getRepository(CareReport)
          .count({ where: { serviceOrderId: order.id } });
        const periodIndex = submitted + 1;
        if (periodIndex > countTotalPeriods(window)) {
          throw new ConflictException('ALL_PERIODS_SUBMITTED');
        }
        const period = computeCarePeriod(window, periodIndex)!;
        const now = new Date();
        if (now.getTime() < period.start.getTime()) {
          throw new ConflictException('REPORT_PERIOD_NOT_STARTED');
        }

        const inCarePlants = await manager.getRepository(Plant).find({
          where: { serviceOrderId: order.id, handoverDecision: Not('REJECT') },
          select: { id: true },
        });
        const plantError = checkReportPlants(
          dto.plants.map((plant) => plant.plantId),
          inCarePlants.map((plant) => plant.id),
        );
        if (plantError) {
          throw new BadRequestException(plantError);
        }

        const report = manager.getRepository(CareReport).create({
          serviceOrderId: order.id,
          periodIndex,
          periodStart: period.start,
          periodEnd: period.end,
          submittedAt: now,
          isLate: now.getTime() > period.end.getTime(),
          airTemperature: dto.airTemperature,
          airHumidity: dto.airHumidity,
          lightIntensity: dto.lightIntensity,
          watered: dto.watered,
          waterAmountMl: dto.waterAmountMl ?? null,
          fertilized: dto.fertilized,
          fertilizerType: dto.fertilizerType ?? null,
          otherCareNote: dto.otherCareNote ?? null,
          waterPh: dto.waterPh ?? null,
          waterEc: dto.waterEc ?? null,
          plants: dto.plants.map((plant) =>
            manager.getRepository(CareReportPlant).create({
              plantId: plant.plantId,
              substrateMoisture: plant.substrateMoisture,
              leafCondition: plant.leafCondition,
              rootCondition: plant.rootCondition,
              stemCondition: plant.stemCondition,
              hasPestDisease: plant.hasPestDisease,
              overallHealth: plant.overallHealth,
              note: plant.note ?? null,
              leafLengthCm: plant.leafLengthCm ?? null,
              leafCount: plant.leafCount ?? null,
              newRootLengthCm: plant.newRootLengthCm ?? null,
              newShootCount: plant.newShootCount ?? null,
              flowerSpikeCount: plant.flowerSpikeCount ?? null,
              budCount: plant.budCount ?? null,
              flowerCount: plant.flowerCount ?? null,
              photos: plant.photos.map((photo) => ({
                evidenceType: photo.evidenceType,
                photoUrl: photo.photoUrl,
                caption: photo.caption ?? null,
              })),
            }),
          ),
        });
        const saved = await manager.getRepository(CareReport).save(report);

        return {
          id: saved.id,
          serviceOrderId: saved.serviceOrderId,
          periodIndex: saved.periodIndex,
          periodStart: saved.periodStart,
          periodEnd: saved.periodEnd,
          isLate: saved.isLate,
          submittedAt: saved.submittedAt,
        };
      });
    } catch (error) {
      // Lưới an toàn: unique (đơn, kỳ) — đã khóa đơn nên hiếm khi tới đây.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23505'
      ) {
        throw new ConflictException('CARE_REPORT_DUPLICATE');
      }
      throw error;
    }
  }

  async getCareReport(accountId: string, role: string, id: string) {
    const report = await this.careReportRepo.findOne({
      where: { id },
      relations: READ_RELATIONS,
    });
    if (!report) {
      throw new NotFoundException('CARE_REPORT_NOT_FOUND');
    }

    if (role === 'ADMIN') {
      return toCareReportView(report);
    }

    const allowedOrderIds = await this.visibleOrderIds(accountId, role);
    if (!allowedOrderIds.includes(report.serviceOrderId)) {
      throw new NotFoundException('CARE_REPORT_NOT_FOUND');
    }
    return toCareReportView(report);
  }

  async listCareReports(
    accountId: string,
    role: string,
    query: QueryCareReportDto,
  ) {
    const allowedOrderIds =
      role === 'ADMIN'
        ? undefined
        : await this.visibleOrderIds(accountId, role);

    if (allowedOrderIds) {
      if (
        allowedOrderIds.length === 0 ||
        (query.serviceOrderId &&
          !allowedOrderIds.includes(query.serviceOrderId))
      ) {
        return [];
      }
    }

    const where = query.serviceOrderId
      ? { serviceOrderId: query.serviceOrderId }
      : allowedOrderIds
        ? { serviceOrderId: In(allowedOrderIds) }
        : {};

    const reports = await this.careReportRepo.find({
      where,
      relations: READ_RELATIONS,
      order: { serviceOrderId: 'ASC', periodIndex: 'ASC' },
    });
    return reports.map(toCareReportView);
  }

  private async approvedProvider(accountId: string, role: string) {
    if (role !== 'PROVIDER') {
      throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
    }
    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider || provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
    }
    return provider;
  }

  /** Đơn mà vườn / khách này được xem báo cáo. */
  private async visibleOrderIds(
    accountId: string,
    role: string,
  ): Promise<string[]> {
    if (role === 'PROVIDER') {
      const provider = await this.approvedProvider(accountId, role);
      const orders = await this.orderRepo.find({
        where: { providerId: provider.id },
        select: { id: true },
      });
      return orders.map((order) => order.id);
    }
    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({
        where: { accountId },
      });
      if (!customer) {
        throw new ForbiddenException('CUSTOMER_NOT_ALLOWED');
      }
      const orders = await this.orderRepo.find({
        where: { customerId: customer.id },
        select: { id: true },
      });
      return orders.map((order) => order.id);
    }
    throw new ForbiddenException('ROLE_NOT_ALLOWED');
  }
}

/** Dạng trả về: không spread entity Plant (chỉ id, tên, loài); cây xếp theo tên. */
export function toCareReportView(report: CareReport) {
  return {
    id: report.id,
    serviceOrderId: report.serviceOrderId,
    periodIndex: report.periodIndex,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
    submittedAt: report.submittedAt,
    isLate: report.isLate,
    airTemperature: report.airTemperature,
    airHumidity: report.airHumidity,
    lightIntensity: report.lightIntensity,
    watered: report.watered,
    waterAmountMl: report.waterAmountMl,
    fertilized: report.fertilized,
    fertilizerType: report.fertilizerType,
    otherCareNote: report.otherCareNote,
    waterPh: report.waterPh,
    waterEc: report.waterEc,
    plants: [...(report.plants ?? [])]
      .sort((a, b) => (a.plant?.name ?? '').localeCompare(b.plant?.name ?? ''))
      .map((entry) => ({
        id: entry.id,
        plant: entry.plant
          ? {
              id: entry.plant.id,
              name: entry.plant.name,
              speciesName: entry.plant.speciesName,
            }
          : { id: entry.plantId, name: null, speciesName: null },
        substrateMoisture: entry.substrateMoisture,
        leafCondition: entry.leafCondition,
        rootCondition: entry.rootCondition,
        stemCondition: entry.stemCondition,
        hasPestDisease: entry.hasPestDisease,
        overallHealth: entry.overallHealth,
        note: entry.note,
        leafLengthCm: entry.leafLengthCm,
        leafCount: entry.leafCount,
        newRootLengthCm: entry.newRootLengthCm,
        newShootCount: entry.newShootCount,
        flowerSpikeCount: entry.flowerSpikeCount,
        budCount: entry.budCount,
        flowerCount: entry.flowerCount,
        photos: (entry.photos ?? []).map((photo) => ({
          id: photo.id,
          evidenceType: photo.evidenceType,
          photoUrl: photo.photoUrl,
          caption: photo.caption,
        })),
      })),
  };
}
