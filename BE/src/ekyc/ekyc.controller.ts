import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { EkycService } from './ekyc.service';

// 20 MB — camera điện thoại thật chụp ảnh nặng 8-12 MB.
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;

// Cho phép mọi ảnh và cả application/octet-stream (một số điện thoại gửi kiểu này).
const imageFileFilter = (_req: unknown, file: Express.Multer.File, cb: (err: Error | null, accept: boolean) => void) => {
  const isImage = /^image\//i.test(file.mimetype) || file.mimetype === 'application/octet-stream';
  cb(null, isImage);
};

@ApiTags('eKYC')
@Controller('ekyc')
export class EkycController {
  constructor(private readonly ekycService: EkycService) {}

  /**
   * Bước 1: Upload ảnh CCCD mặt trước (bắt buộc) + mặt sau (tuỳ chọn).
   * Ảnh được upload lên Cloudinary (authenticated — không công khai).
   * Backend gọi FPT.AI OCR → trả dữ liệu bóc tách.
   */
  @Post('ocr')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 1: OCR ảnh CCCD — bóc tách thông tin bằng FPT.AI',
    description:
      'Chọn 1 hoặc 2 file ảnh (tối đa 20MB/ảnh). File 1 = mặt trước CCCD (bắt buộc), File 2 = mặt sau (tuỳ chọn). ' +
      'Ảnh được lưu bảo mật trên Cloudinary (type: authenticated). Nếu ảnh > 4MB, server tự động resize trước khi gửi FPT.AI.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'File 1 = mặt trước CCCD (bắt buộc), File 2 = mặt sau (tuỳ chọn)',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 2, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  async ocr(
    @CurrentUser() user: CurrentUserData,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Vui lòng upload ít nhất 1 ảnh CCCD mặt trước.');
    }
    return this.ekycService.ocrIdCard(user.accountId, files);
  }

  /**
   * Bước 2: Upload ảnh CCCD mặt trước + ảnh selfie.
   * Backend gọi FPT.AI Face Match → nếu khớp (>= 80%) → VERIFIED.
   */
  @Post('face-match')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 2: So khớp khuôn mặt CCCD vs Selfie — FPT.AI',
    description:
      'Chọn đúng 2 file ảnh (tối đa 20MB/ảnh). File 1 = ảnh CCCD mặt trước, File 2 = ảnh selfie khuôn mặt thật. ' +
      'Server tự động resize nếu quá nặng. Kết quả: VERIFIED (khớp ≥ 80%) hoặc REJECTED.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: '2 file ảnh: File 1 = CCCD mặt trước, File 2 = selfie',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 2, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      fileFilter: imageFileFilter,
    }),
  )
  async faceMatch(
    @CurrentUser() user: CurrentUserData,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length < 2) {
      throw new BadRequestException('Vui lòng chọn đủ 2 ảnh: File 1 là CCCD mặt trước, File 2 là ảnh selfie.');
    }
    return this.ekycService.faceMatch(user.accountId, files);
  }

  /**
   * Kiểm tra trạng thái eKYC hiện tại.
   */
  @Get('status')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem trạng thái xác thực eKYC hiện tại' })
  async getStatus(@CurrentUser() user: CurrentUserData) {
    return this.ekycService.getStatus(user.accountId);
  }

  /**
   * Reset để gửi lại (nếu bị REJECTED).
   */
  @Post('retry')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset eKYC để thử lại (khi đã bị từ chối)' })
  async retry(@CurrentUser() user: CurrentUserData) {
    return this.ekycService.resetForRetry(user.accountId);
  }

  /**
   * Xem ảnh eKYC bảo mật (Signed URL tạm thời).
   * Customer chỉ xem được ảnh của chính mình.
   * Admin cần tạo endpoint riêng nếu muốn xem ảnh Customer khác.
   */
  @Get('documents/:field')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy link ảnh eKYC bảo mật (signed URL)',
    description: 'Trả về URL có chữ ký để xem ảnh CCCD/selfie. URL chỉ dùng để hiển thị, không lưu cache.',
  })
  @ApiParam({
    name: 'field',
    enum: ['front', 'back', 'selfie'],
    description: 'Loại ảnh: front = mặt trước CCCD, back = mặt sau, selfie = ảnh chân dung',
  })
  async getDocumentImage(
    @CurrentUser() user: CurrentUserData,
    @Param('field') field: string,
  ) {
    return this.ekycService.getSignedImageUrl(user.accountId, field);
  }
}
