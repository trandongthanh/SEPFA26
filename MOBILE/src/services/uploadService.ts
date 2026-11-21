import { apiClient } from '../config/api';

export const uploadService = {
  /**
   * Upload ảnh CCCD / giấy tờ xác minh lên server / Cloudinary thông qua POST /uploads/provider-document
   */
  async uploadDocumentImage(fileUri: string): Promise<string> {
    const formData = new FormData();
    const filename = fileUri.split('/').pop() || 'cccd_image.jpg';
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : 'image/jpeg';

    // @ts-ignore
    formData.append('file', {
      uri: fileUri,
      name: filename,
      type: type === 'image/jpg' ? 'image/jpeg' : type,
    });

    const response = await apiClient.post<{ url: string }>('/uploads/provider-document', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.url;
  },
};
