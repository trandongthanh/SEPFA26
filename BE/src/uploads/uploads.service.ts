import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

function hasSupportedImageSignature(buffer: Buffer) {
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

@Injectable()
export class UploadsService {
  constructor(private readonly config: ConfigService) {
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

  async uploadProviderDocument(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('IMAGE_FILE_REQUIRED');
    if (
      !/^image\/(jpeg|png|webp)$/i.test(file.mimetype) ||
      !hasSupportedImageSignature(file.buffer)
    ) {
      throw new BadRequestException('IMAGE_FILE_INVALID');
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new BadRequestException('IMAGE_FILE_TOO_LARGE');
    }
    if (!this.config.get<string>('CLOUDINARY_URL')) {
      throw new ServiceUnavailableException('CLOUDINARY_NOT_CONFIGURED');
    }

    const upload = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'lancare-hub/provider-documents',
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

    return {
      url: upload.secure_url,
      publicId: upload.public_id,
      width: upload.width,
      height: upload.height,
      bytes: upload.bytes,
      format: upload.format,
    };
  }
}
