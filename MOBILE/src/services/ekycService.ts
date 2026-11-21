import { Platform } from 'react-native';
import { apiClient } from '../config/api';

export interface EkycStatusResponse {
  status: 'NOT_STARTED' | 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
  verifiedAt?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  idDocType?: string;
  hasIdDocNumber?: boolean;
  faceMatch?: boolean | null;
  faceSimilarity?: number | null;
  rejectionReason?: string | null;
  fraudScore?: number | null;
  livenessScore?: number | null;
  antifraudDetails?: any;
}

export interface EkycExtractedData {
  fullName: string | null;
  idNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  nationality: string | null;
  placeOfOrigin: string | null;
  idDocType: string;
  confidence: number;
}

export interface EkycOcrResponse {
  success: boolean;
  extracted: EkycExtractedData;
  antiFraud: {
    fraudScore: number | null;
    passed: boolean;
    verdict: string;
  };
  message: string;
}

export interface EkycFaceMatchResponse {
  success: boolean;
  status: 'VERIFIED' | 'REJECTED';
  similarity: number;
  liveness?: {
    score: number | null;
    isLive: boolean;
    verdict: string;
  };
  message: string;
}

function appendFileToFormData(
  formData: FormData,
  fieldName: string,
  uri: string,
  defaultName: string
) {
  const filename = uri.split('/').pop() || defaultName;
  const match = /\.(\w+)$/.exec(filename);
  const ext = match ? match[1].toLowerCase() : 'jpg';
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';

  // @ts-ignore
  formData.append(fieldName, {
    uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
    name: filename,
    type,
  });
}

export const ekycService = {
  /**
   * Lấy trạng thái xác thực eKYC hiện tại của tài khoản
   */
  async getStatus(): Promise<EkycStatusResponse> {
    const response = await apiClient.get<EkycStatusResponse>('/ekyc/status');
    return response.data;
  },

  /**
   * Bước 1: Gửi ảnh CCCD lên AI EasyOCR & Anti-Fraud
   */
  async ocrIdCard(frontUri: string, backUri?: string): Promise<EkycOcrResponse> {
    const formData = new FormData();
    appendFileToFormData(formData, 'files', frontUri, 'cccd_front.jpg');
    if (backUri) {
      appendFileToFormData(formData, 'files', backUri, 'cccd_back.jpg');
    }

    const response = await apiClient.post<EkycOcrResponse>('/ekyc/ocr', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000, // 60s timeout cho AI xử lý hình ảnh
    });

    return response.data;
  },

  /**
   * Bước 2: So khớp ảnh CCCD mặt trước vs ảnh chân dung Selfie (DeepFace ArcFace) + Liveness
   */
  async faceMatch(frontUri: string, selfieUri: string): Promise<EkycFaceMatchResponse> {
    const formData = new FormData();
    appendFileToFormData(formData, 'files', frontUri, 'cccd_front.jpg');
    appendFileToFormData(formData, 'files', selfieUri, 'selfie.jpg');

    const response = await apiClient.post<EkycFaceMatchResponse>('/ekyc/face-match', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 60000,
    });

    return response.data;
  },

  /**
   * Reset trạng thái eKYC để gửi lại khi bị từ chối
   */
  async retry(): Promise<{ success: boolean; message: string }> {
    const response = await apiClient.post<{ success: boolean; message: string }>('/ekyc/retry');
    return response.data;
  },

  /**
   * Lấy Signed URL xem ảnh CCCD/Selfie bảo mật có thời hạn
   */
  async getDocumentUrl(field: 'front' | 'back' | 'selfie'): Promise<{ url: string }> {
    const response = await apiClient.get<{ url: string }>(`/ekyc/documents/${field}`);
    return response.data;
  },
};
