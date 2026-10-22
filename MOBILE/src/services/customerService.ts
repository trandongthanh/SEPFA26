import { apiClient } from '../config/api';
import { CustomerProfileResponse, UpdateCustomerProfilePayload } from '../types/customer';

export const customerService = {
  async getMyProfile(): Promise<CustomerProfileResponse> {
    const response = await apiClient.get<CustomerProfileResponse>('/customers/me/profile');
    return response.data;
  },

  async updateMyProfile(payload: UpdateCustomerProfilePayload): Promise<CustomerProfileResponse> {
    const response = await apiClient.put<CustomerProfileResponse>('/customers/me/profile', payload);
    return response.data;
  },
};
