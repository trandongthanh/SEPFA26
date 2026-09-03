import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { CareReport } from './entities/care-report.entity';
import { CareReportEvidence } from './entities/care-report-evidence.entity';
import { CreateCareReportDto } from './dto/create-care-report.dto';
import { QueryCareReportDto } from './dto/query-care-report.dto';

@Injectable()
export class CareReportsService {
  constructor(
    @InjectRepository(CareReport)
    private readonly careReportRepo: Repository<CareReport>,
    @InjectRepository(CareReportEvidence)
    private readonly evidenceRepo: Repository<CareReportEvidence>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(ProviderProfile)
    private readonly providerRepo: Repository<ProviderProfile>,
    @InjectRepository(CustomerProfile)
    private readonly customerRepo: Repository<CustomerProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async createCareReport(accountId: string, role: string, dto: CreateCareReportDto) {
    if (role !== 'PROVIDER') {
      throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
    }

    const provider = await this.providerRepo.findOne({ where: { accountId } });
    if (!provider || provider.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
    }

    const order = await this.orderRepo.findOne({
      where: { id: dto.serviceOrderId, providerId: provider.id },
    });
    if (!order) {
      throw new NotFoundException('SERVICE_ORDER_NOT_FOUND');
    }

    if (order.status !== 'IN_CARE') {
      throw new BadRequestException('ORDER_NOT_IN_CARE');
    }

    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('INVALID_PERIOD');
    }

    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new BadRequestException('PERIOD_END_MUST_BE_AFTER_START');
    }

    if (
      dto.temperatureMin > dto.temperatureMax ||
      dto.humidityMin > dto.humidityMax
    ) {
      throw new BadRequestException('CARE_MEASUREMENT_RANGE_INVALID');
    }

    if (order.careStartedAt && periodStart.getTime() < order.careStartedAt.getTime()) {
      throw new BadRequestException('REPORT_PERIOD_BEFORE_CARE_START');
    }

    if (order.careDueAt && periodEnd.getTime() > order.careDueAt.getTime()) {
      throw new BadRequestException('REPORT_PERIOD_AFTER_CARE_DUE');
    }

    const diffMs = periodEnd.getTime() - periodStart.getTime();
    const expectedMs = order.reportFrequencySnapshot * 24 * 60 * 60 * 1000;
    if (diffMs !== expectedMs) {
      throw new BadRequestException('PERIOD_MUST_MATCH_REPORT_FREQUENCY');
    }

    const evidenceTypes = dto.evidences.map((item) => item.evidenceType);
    const required = ['OVERVIEW', 'ROOT', 'LEAF_OR_SHOOT'] as const;
    const normalized = new Set<string>(evidenceTypes);
    if (
      evidenceTypes.length !== 3 ||
      !required.every((type) => normalized.has(type)) ||
      required.length !== normalized.size
    ) {
      throw new BadRequestException('EVIDENCE_TYPES_MUST_BE_EXACTLY_3');
    }

    if (
      dto.rootStatus === 'ROOTS_AFFECTED' &&
      (dto.rootAffectedCount === undefined || dto.rootAffectedCount < 1)
    ) {
      throw new BadRequestException('ROOT_AFFECTED_COUNT_REQUIRED');
    }

    const duplicate = await this.careReportRepo.findOne({
      where: {
        serviceOrderId: order.id,
        periodStart: periodStart,
        periodEnd: periodEnd,
      },
    });
    if (duplicate) {
      throw new ConflictException('CARE_REPORT_DUPLICATE');
    }

    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.getRepository(CareReport).findOne({
        where: {
          serviceOrderId: order.id,
          periodStart: periodStart,
          periodEnd: periodEnd,
        },
      });
      if (existing) {
        throw new ConflictException('CARE_REPORT_DUPLICATE');
      }

      const overlapping = await manager
        .getRepository(CareReport)
        .createQueryBuilder('report')
        .where('report.service_order_id = :serviceOrderId', {
          serviceOrderId: order.id,
        })
        .andWhere('report.period_start < :periodEnd', { periodEnd })
        .andWhere('report.period_end > :periodStart', { periodStart })
        .getExists();
      if (overlapping) {
        throw new ConflictException('CARE_REPORT_PERIOD_OVERLAP');
      }

      const report = manager.getRepository(CareReport).create({
        serviceOrderId: order.id,
        periodStart,
        periodEnd,
        plantNameSnapshot: dto.plantNameSnapshot,
        plantCodeSnapshot: dto.plantCodeSnapshot,
        plotPositionSnapshot: dto.plotPositionSnapshot,
        weather: dto.weather,
        temperatureMin: dto.temperatureMin,
        temperatureMax: dto.temperatureMax,
        humidityMin: dto.humidityMin,
        humidityMax: dto.humidityMax,
        substrateStatus: dto.substrateStatus,
        rootStatus: dto.rootStatus,
        rootAffectedCount: dto.rootAffectedCount ?? null,
        leafStatus: dto.leafStatus,
        shootStatus: dto.shootStatus,
        wateringCount: dto.wateringCount,
        nutritionNote: dto.nutritionNote ?? null,
        diseasePrevention: dto.diseasePrevention,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      });

      const saved = await manager.getRepository(CareReport).save(report);

      const evidences = dto.evidences.map((item) =>
        manager.getRepository(CareReportEvidence).create({
          careReportId: saved.id,
          evidenceType: item.evidenceType,
          photoUrl: item.photoUrl,
          caption: item.caption ?? null,
        }),
      );

      await manager.getRepository(CareReportEvidence).save(evidences);

      return {
        id: saved.id,
        serviceOrderId: saved.serviceOrderId,
        periodStart: saved.periodStart,
        periodEnd: saved.periodEnd,
        status: saved.status,
      };
    });
  }

  async getCareReport(accountId: string, role: string, id: string) {
    const report = await this.careReportRepo.findOne({
      where: { id },
      relations: { evidences: true },
    });
    if (!report) {
      throw new NotFoundException('CARE_REPORT_NOT_FOUND');
    }

    if (role === 'ADMIN') {
      return report;
    }

    if (role === 'PROVIDER') {
      const provider = await this.providerRepo.findOne({ where: { accountId } });
      if (!provider || provider.verificationStatus !== 'APPROVED') {
        throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
      }

      const order = await this.orderRepo.findOne({ where: { id: report.serviceOrderId } });
      if (!order || order.providerId !== provider.id) {
        throw new NotFoundException('CARE_REPORT_NOT_FOUND');
      }

      return report;
    }

    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({ where: { accountId } });
      if (!customer) {
        throw new ForbiddenException('CUSTOMER_NOT_ALLOWED');
      }

      const order = await this.orderRepo.findOne({ where: { id: report.serviceOrderId } });
      if (!order || order.customerId !== customer.id) {
        throw new NotFoundException('CARE_REPORT_NOT_FOUND');
      }

      return report;
    }

    throw new ForbiddenException('ROLE_NOT_ALLOWED');
  }

  async listCareReports(accountId: string, role: string, query: QueryCareReportDto) {
    if (role === 'ADMIN') {
      return this.findReports(query.serviceOrderId);
    }

    if (role === 'PROVIDER') {
      const provider = await this.providerRepo.findOne({ where: { accountId } });
      if (!provider || provider.verificationStatus !== 'APPROVED') {
        throw new ForbiddenException('PROVIDER_NOT_ALLOWED');
      }

      const providerOrderIds = await this.orderRepo.find({
        where: { providerId: provider.id },
        select: { id: true },
      });
      return this.findReports(
        query.serviceOrderId,
        providerOrderIds.map((order) => order.id),
      );
    }

    if (role === 'CUSTOMER') {
      const customer = await this.customerRepo.findOne({ where: { accountId } });
      if (!customer) {
        throw new ForbiddenException('CUSTOMER_NOT_ALLOWED');
      }

      const customerOrderIds = await this.orderRepo.find({
        where: { customerId: customer.id },
        select: { id: true },
      });
      return this.findReports(
        query.serviceOrderId,
        customerOrderIds.map((order) => order.id),
      );
    }

    throw new ForbiddenException('ROLE_NOT_ALLOWED');
  }

  private findReports(serviceOrderId?: string, allowedOrderIds?: string[]) {
    if (allowedOrderIds && allowedOrderIds.length === 0) {
      return Promise.resolve([]);
    }

    const where = serviceOrderId
      ? { serviceOrderId }
      : allowedOrderIds
        ? { serviceOrderId: In(allowedOrderIds) }
        : {};

    if (
      serviceOrderId &&
      allowedOrderIds &&
      !allowedOrderIds.includes(serviceOrderId)
    ) {
      return Promise.resolve([]);
    }

    return this.careReportRepo.find({
      where,
      relations: { evidences: true },
      order: { createdAt: 'DESC' },
    });
  }
}
