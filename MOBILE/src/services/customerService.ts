import { apiClient } from '../config/api';
import { CustomerProfileResponse } from '../types/customer';

export const customerService = {
  async getMyProfile(): Promise<CustomerProfileResponse> {
    const response = await apiClient.get<CustomerProfileResponse>('/customers/me/profile');
    return response.data;
  },
};
