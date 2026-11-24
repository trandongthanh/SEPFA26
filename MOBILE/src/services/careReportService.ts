import { apiClient } from '../config/api';

export type SubstrateMoisture = 'LOW' | 'MEDIUM' | 'HIGH';
export type PartCondition = 'GOOD' | 'NORMAL' | 'POOR';
export type OverallHealth = 'GOOD' | 'AVERAGE' | 'POOR';
export type CareEvidenceType = 'OVERVIEW' | 'LEAF' | 'STEM' | 'ROOT';

export interface CareReportPhotoItem {
  id: string;
  evidenceType: CareEvidenceType;
  photoUrl: string;
  caption?: string | null;
}

export interface CareReportPlantItem {
  id: string;
  plant: {
    id: string;
    name: string | null;
    speciesName: string | null;
  };
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note?: string | null;
  leafLengthCm?: number | null;
  leafCount?: number | null;
  newRootLengthCm?: number | null;
  newShootCount?: number | null;
  flowerSpikeCount?: number | null;
  budCount?: number | null;
  flowerCount?: number | null;
  photos: CareReportPhotoItem[];
}

export interface CareReportItem {
  id: string;
  serviceOrderId: string;
  periodIndex: number;
  periodStart: string;
  periodEnd: string;
  submittedAt: string;
  isLate: boolean;
  airTemperature: number;
  airHumidity: number;
  lightIntensity: number;
  watered: boolean;
  waterAmountMl?: number | null;
  fertilized: boolean;
  fertilizerType?: string | null;
  otherCareNote?: string | null;
  waterPh?: number | null;
  waterEc?: number | null;
  plants: CareReportPlantItem[];
}

export const careReportService = {
  async listByOrder(serviceOrderId: string): Promise<CareReportItem[]> {
    // BE trả { data, total, page, limit }; theo 1 đơn thì xếp kỳ 1→n. limit 50 (tối đa của BE) đủ mọi kỳ của một đơn.
    const response = await apiClient.get<{ data?: CareReportItem[] }>('/care-reports', {
      params: { serviceOrderId, limit: 50 },
    });
    return Array.isArray(response.data?.data) ? response.data.data : [];
  },

  async getDetail(id: string): Promise<CareReportItem> {
    const response = await apiClient.get<CareReportItem>(`/care-reports/${id}`);
    return response.data;
  },
};

