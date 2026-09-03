import { IsOptional, IsUUID } from 'class-validator';

export class QueryCareReportDto {
  @IsOptional()
  @IsUUID()
  serviceOrderId?: string;
}
