import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { ReceiptUploadService } from './receipt-upload.service';

// Không gọi mạng: thay SDK Cloudinary bằng hàm giả.
jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn() },
  },
}));

const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const CLOUDINARY_URL = 'cloudinary://key:secret@demo-cloud';

const file = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File =>
  ({
    fieldname: 'file',
    originalname: 'bien-lai.png',
    mimetype: 'image/png',
    size: PNG_HEADER.length,
    buffer: PNG_HEADER,
    ...overrides,
  }) as Express.Multer.File;

describe('ReceiptUploadService', () => {
  const uploadStream = cloudinary.uploader.upload_stream as jest.Mock;
  const configure = cloudinary.config as jest.Mock;

  const build = (url: string | undefined) =>
    new ReceiptUploadService({
      get: jest.fn(() => url),
    } as unknown as ConfigService);

  beforeEach(() => jest.clearAllMocks());

  it('thiếu file → 400 IMAGE_FILE_REQUIRED', async () => {
    await expect(
      build(CLOUDINARY_URL).uploadReceipt(undefined),
    ).rejects.toThrow(new BadRequestException('IMAGE_FILE_REQUIRED'));
  });

  it('mimetype không phải jpg/png/webp, hoặc nội dung không phải ảnh → 400 IMAGE_FILE_INVALID', async () => {
    const service = build(CLOUDINARY_URL);
    await expect(
      service.uploadReceipt(file({ mimetype: 'application/pdf' })),
    ).rejects.toThrow(new BadRequestException('IMAGE_FILE_INVALID'));
    // Khai image/png nhưng đầu file là chữ thường.
    await expect(
      service.uploadReceipt(file({ buffer: Buffer.from('not an image') })),
    ).rejects.toThrow(new BadRequestException('IMAGE_FILE_INVALID'));
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it('quá 5 MB → 400 IMAGE_FILE_TOO_LARGE', async () => {
    await expect(
      build(CLOUDINARY_URL).uploadReceipt(file({ size: 5 * 1024 * 1024 + 1 })),
    ).rejects.toThrow(new BadRequestException('IMAGE_FILE_TOO_LARGE'));
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it('chưa cấu hình CLOUDINARY_URL → 503 CLOUDINARY_NOT_CONFIGURED, không đụng cấu hình SDK', async () => {
    const service = build(undefined);
    expect(configure).not.toHaveBeenCalled();
    await expect(service.uploadReceipt(file())).rejects.toThrow(
      new ServiceUnavailableException('CLOUDINARY_NOT_CONFIGURED'),
    );
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it('ảnh hợp lệ → tải vào lancare-hub/payment-receipts, trả { url } = secure_url', async () => {
    const end = jest.fn();
    uploadStream.mockImplementation(
      (
        _options: unknown,
        callback: (error: unknown, result: { secure_url: string }) => void,
      ) => {
        callback(undefined, {
          secure_url:
            'https://res.cloudinary.com/demo-cloud/lancare-hub/payment-receipts/bien-lai.png',
        });
        return { end };
      },
    );

    const service = build(CLOUDINARY_URL);
    // Cấu hình SDK giống hệt module uploads (cùng CLOUDINARY_URL → cùng giá trị).
    expect(configure).toHaveBeenCalledWith({
      cloud_name: 'demo-cloud',
      api_key: 'key',
      api_secret: 'secret',
      secure: true,
    });

    await expect(service.uploadReceipt(file())).resolves.toEqual({
      url: 'https://res.cloudinary.com/demo-cloud/lancare-hub/payment-receipts/bien-lai.png',
    });
    expect(uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'lancare-hub/payment-receipts',
        resource_type: 'image',
      }),
      expect.any(Function),
    );
    expect(end).toHaveBeenCalledWith(PNG_HEADER);
  });
});
