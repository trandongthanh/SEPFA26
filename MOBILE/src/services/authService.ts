import { apiClient } from '../config/api';
import {
  RegisterPayload,
  RegisterResponse,
  ApiErrorResponse,
  GoogleLoginPayload,
  GoogleLoginResponse,
  UserRole,
} from '../types/auth';
import axios from 'axios';

export const registerUser = async (payload: RegisterPayload): Promise<RegisterResponse> => {
  try {
    // Nếu là PROVIDER, bổ sung các trường mặc định nếu chưa có
    const finalPayload: RegisterPayload = {
      ...payload,
      email: payload.email.trim().toLowerCase(),
      fullName: payload.fullName.trim(),
      phone: payload.phone.trim(),
    };

    if (payload.role === 'PROVIDER') {
      if (!finalPayload.providerType) {
        finalPayload.providerType = 'EXPERT';
      }
      if (finalPayload.gpsLat === undefined || finalPayload.gpsLng === undefined) {
        // Tọa độ mặc định (TP.HCM) nếu chưa chọn trên bản đồ
        finalPayload.gpsLat = 10.762622;
        finalPayload.gpsLng = 106.660172;
      }
      if (!finalPayload.address) {
        finalPayload.address = 'TP. Hồ Chí Minh';
      }
    }

    const response = await apiClient.post<RegisterResponse>('/auth/register', finalPayload);
    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      const errorData = error.response.data as ApiErrorResponse;
      let rawMsg = errorData.message;
      
      if (Array.isArray(rawMsg)) {
        rawMsg = rawMsg.join('\n');
      }

      if (rawMsg === 'EMAIL_EXISTS') {
        throw new Error('Email này đã được sử dụng. Vui lòng chọn email khác.');
      }
      if (rawMsg === 'PHONE_EXISTS') {
        throw new Error('Số điện thoại này đã được sử dụng. Vui lòng kiểm tra lại.');
      }
      if (rawMsg === 'PROVIDER_TYPE_REQUIRED') {
        throw new Error('Vui lòng chọn loại hình nhà cung cấp dịch vụ.');
      }
      if (rawMsg === 'PROVIDER_LOCATION_REQUIRED') {
        throw new Error('Cần cung cấp thông tin vị trí cho Provider.');
      }

      throw new Error(rawMsg || 'Đăng ký thất bại. Vui lòng thử lại sau.');
    } else if (error instanceof Error) {
      throw error;
    }
    throw new Error('Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.');
  }
};

export interface GoogleAuthNotRegisteredError extends Error {
  code: 'GOOGLE_ACCOUNT_NOT_REGISTERED';
  email?: string;
  fullName?: string;
}

export const loginWithGoogle = async (
  idToken: string,
  role?: UserRole
): Promise<GoogleLoginResponse> => {
  try {
    const payload: GoogleLoginPayload = { idToken };
    if (role) {
      payload.role = role;
    }

    const response = await apiClient.post<GoogleLoginResponse>('/auth/google', payload);
    return response.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const data = error.response.data as any;

      if (status === 404 && data?.message === 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
        const notRegisteredErr = new Error('GOOGLE_ACCOUNT_NOT_REGISTERED') as GoogleAuthNotRegisteredError;
        notRegisteredErr.code = 'GOOGLE_ACCOUNT_NOT_REGISTERED';
        notRegisteredErr.email = data?.email;
        notRegisteredErr.fullName = data?.fullName;
        throw notRegisteredErr;
      }

      if (data?.message === 'INVALID_GOOGLE_TOKEN') {
        throw new Error('Mã xác thực Google không hợp lệ hoặc đã hết hạn.');
      }
      if (data?.message === 'GOOGLE_EMAIL_NOT_VERIFIED') {
        throw new Error('Email Google của bạn chưa được xác minh.');
      }
      if (data?.message === 'ACCOUNT_SUSPENDED') {
        throw new Error('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ hỗ trợ.');
      }
      if (data?.message === 'GOOGLE_AUTH_NOT_CONFIGURED') {
        throw new Error('Hệ thống chưa hoàn tất cấu hình Google OAuth.');
      }

      throw new Error(data?.message || 'Đăng nhập Google thất bại.');
    } else if (error instanceof Error) {
      throw error;
    }
    throw new Error('Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.');
  }
};
