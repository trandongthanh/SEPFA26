import { apiClient } from '../config/api';
import {
  ProviderDetail,
  ProviderListResponse,
  QueryProviderParams,
  ServicePackage,
} from '../types/provider';

export const providerService = {
  async getProviders(params: QueryProviderParams): Promise<ProviderListResponse> {
    const cleanParams: Record<string, any> = {};

    if (params.type) cleanParams.type = params.type;
    if (params.minRating && params.minRating > 0) cleanParams.minRating = params.minRating;
    if (params.keyword && params.keyword.trim()) cleanParams.keyword = params.keyword.trim();
    cleanParams.page = params.page || 1;
    cleanParams.limit = params.limit || 10;

    const response = await apiClient.get<ProviderListResponse>('/providers', {
      params: cleanParams,
    });
    return response.data;
  },

  async getProviderById(id: string): Promise<ProviderDetail> {
    const response = await apiClient.get<ProviderDetail>(`/providers/${id}`);
    return response.data;
  },

  async getProviderPackages(id: string): Promise<ServicePackage[]> {
    const response = await apiClient.get<ServicePackage[]>(`/providers/${id}/packages`);
    return response.data;
  },
};
