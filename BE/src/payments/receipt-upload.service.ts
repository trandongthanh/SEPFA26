import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

export const RECEIPT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const RECEIPT_MIME_PATTERN = /^image\/(jpeg|png|webp)$/i;
const RECEIPT_FOLDER = 'lancare-hub/payment-receipts';

// Kiểm chữ ký đầu file: client có thể gửi mimetype image/png cho file bất kỳ.
function hasImageSignature(buffer: Buffer | undefined) {
  if (!buffer) return false;
  const jpeg =
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const png =
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpeg || png || webp;
}

/**
 * Ảnh biên lai admin đính lúc bấm "Đã chuyển" — lưu Cloudinary thư mục riêng `payment-receipts`.
 * Bám logic dịch vụ tải ảnh của module uploads (mã lỗi trùng tên để FE xử lý một kiểu) nhưng là code
 * riêng của payments: route đó chỉ cho khách / vườn và lưu vào thư mục hồ sơ vườn.
 */
@Injectable()
export class ReceiptUploadService {
  constructor(private readonly config: ConfigService) {
    // SDK Cloudinary dùng cấu hình toàn cục trong tiến trình; đặt đúng các giá trị như UploadsService
    // (cùng CLOUDINARY_URL) nên service nào khởi tạo sau cũng không làm lệch cấu hình của bên kia.
    const cloudinaryUrl = this.config.get<string>('CLOUDINARY_URL');
    if (cloudinaryUrl) {
      const parsed = new URL(cloudinaryUrl);
      cloudinary.config({
        cloud_name: parsed.hostname,
        api_key: decodeURIComponent(parsed.username),
        api_secret: decodeURIComponent(parsed.password),
        secure: true,
      });
    }
  }

  async uploadReceipt(file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('IMAGE_FILE_REQUIRED');
    if (
      !RECEIPT_MIME_PATTERN.test(file.mimetype) ||
      !hasImageSignature(file.buffer)
    ) {
      throw new BadRequestException('IMAGE_FILE_INVALID');
    }
    if (file.size > RECEIPT_MAX_SIZE_BYTES) {
      throw new BadRequestException('IMAGE_FILE_TOO_LARGE');
    }
    if (!this.config.get<string>('CLOUDINARY_URL')) {
      throw new ServiceUnavailableException('CLOUDINARY_NOT_CONFIGURED');
    }

    const upload = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: RECEIPT_FOLDER,
          resource_type: 'image',
          overwrite: false,
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        },
        (error, result) => {
          if (error || !result) {
            reject(
              error instanceof Error
                ? error
                : new Error('CLOUDINARY_UPLOAD_FAILED'),
            );
            return;
          }
          resolve(result);
        },
      );
      stream.end(file.buffer);
    });

    return { url: upload.secure_url };
  }
}
