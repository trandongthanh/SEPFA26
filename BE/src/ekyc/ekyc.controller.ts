import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
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

// 20 MB — camera điện thoại thật chụp ảnh nặng 8-12 MB (chỉ giữ trong RAM trong lúc gọi AI, sau đó giải phóng).
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
   * Bước 1: Quét OCR ảnh mặt trước trong RAM (Zero-Retention).
   * KHÔNG upload lên Cloud, KHÔNG lưu trữ ảnh, KHÔNG lưu số CCCD.
   * Chỉ trích xuất họ tên, ngày sinh, quê quán, địa chỉ thường trú.
   */
  @Post('ocr')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 1: OCR tức thời trong RAM — Trích xuất họ tên, ngày sinh, quê quán, địa chỉ (Không lưu ảnh & số CCCD)',
    description:
      'Gửi ảnh mặt trước thẻ để AI bóc tách tạm thời trong RAM (không lưu ảnh lên Cloud/DB, không thu giữ số CCCD).',
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
          description: 'Ảnh mặt trước thẻ (chỉ xử lý trong RAM, tự động hủy sau khi quét)',
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
      throw new BadRequestException('Vui lòng tải lên ảnh mặt trước thẻ để bóc tách thông tin.');
    }
    return this.ekycService.ocrIdCard(user.accountId, files);
  }

  /**
   * Bước 2: Đối chiếu khuôn mặt & kiểm tra Liveness trong RAM (Zero-Retention).
   * KHÔNG lưu trữ bất kỳ ảnh nào.
   */
  @Post('face-match')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 2: So khớp khuôn mặt & Liveness tức thời trong RAM (Không lưu ảnh)',
    description:
      'Chọn đúng 2 file ảnh trong RAM: File 1 = ảnh mặt trước thẻ, File 2 = ảnh chân dung trực tiếp. ' +
      'Mô hình AI đối chiếu tức thời và hủy ảnh ngay lập tức (không lưu trữ).',
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
          description: '2 file ảnh xử lý tạm thời trong RAM: File 1 = ảnh thẻ, File 2 = chân dung',
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
      throw new BadRequestException('Vui lòng chọn đủ 2 ảnh để đối chiếu khuôn mặt tức thời.');
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
   * Endpoint ngừng phục vụ vì hệ thống không lưu trữ ảnh giấy tờ tùy thân/chân dung.
   */
  @Get('documents/:field')
  @Roles('CUSTOMER', 'ADMIN')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Ngừng hỗ trợ (Hệ thống không lưu trữ ảnh CCCD & ảnh chân dung)',
    description: 'Vì tuân thủ quy định bảo vệ dữ liệu cá nhân, hệ thống không lưu trữ ảnh CCCD và ảnh chân dung.',
  })
  @ApiParam({
    name: 'field',
    enum: ['front', 'back', 'selfie'],
  })
  async getDocumentImage(
    @CurrentUser() user: CurrentUserData,
    @Param('field') field: string,
    @Query('targetAccountId') targetAccountId?: string,
  ) {
    const target = user.role === 'ADMIN' && targetAccountId ? targetAccountId : user.accountId;
    return this.ekycService.getSignedImageUrl(target, field);
  }
}
