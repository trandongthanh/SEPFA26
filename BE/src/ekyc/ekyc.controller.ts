import {
  BadRequestException,
  Controller,
  Get,
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
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { EkycService } from './ekyc.service';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

@ApiTags('eKYC')
@Controller('ekyc')
export class EkycController {
  constructor(private readonly ekycService: EkycService) {}

  /**
   * Bước 1: Upload ảnh CCCD mặt trước (bắt buộc) + mặt sau (tuỳ chọn).
   * Backend gọi FPT.AI OCR → trả dữ liệu bóc tách cho client hiển thị xác nhận.
   */
  @Post('ocr')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 1: OCR ảnh CCCD — bóc tách thông tin bằng FPT.AI',
    description:
      'Chọn 1 hoặc 2 file ảnh JPG/PNG (tối đa 5MB/ảnh). File đầu tiên là mặt trước CCCD, file thứ 2 (nếu có) là mặt sau.',
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
          description: 'Danh sách ảnh: file 1 = mặt trước CCCD, file 2 = mặt sau CCCD (tuỳ chọn)',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 2, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        cb(null, /^image\/(jpeg|png|jpg)$/i.test(file.mimetype));
      },
    }),
  )
  async ocr(
    @CurrentUser() user: CurrentUserData,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files?.length) {
      throw new BadRequestException('Vui lòng upload ít nhất 1 ảnh CCCD mặt trước (định dạng JPG/PNG).');
    }

    const frontFile = files[0];
    const backFile = files[1] ?? null;

    const frontUrl = `ekyc/${user.accountId}/front_${Date.now()}.jpg`;
    const backUrl = backFile ? `ekyc/${user.accountId}/back_${Date.now()}.jpg` : null;

    return this.ekycService.ocrIdCard(
      user.accountId,
      frontFile.buffer,
      frontUrl,
      backFile?.buffer ?? null,
      backUrl,
    );
  }

  /**
   * Bước 2: Upload ảnh CCCD mặt trước + ảnh selfie.
   * Backend gọi FPT.AI Face Match → nếu khớp (similarity >= 80%) → VERIFIED.
   */
  @Post('face-match')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bước 2: So khớp khuôn mặt CCCD vs Selfie — FPT.AI',
    description:
      'Chọn đúng 2 file ảnh: File 1 là ảnh mặt trước CCCD (chứa ảnh chân dung), File 2 là ảnh Selfie khuôn mặt thật.',
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
          description: '2 file ảnh: File 1 = ảnh CCCD mặt trước, File 2 = ảnh selfie trực tiếp',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', 2, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        cb(null, /^image\/(jpeg|png|jpg)$/i.test(file.mimetype));
      },
    }),
  )
  async faceMatch(
    @CurrentUser() user: CurrentUserData,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length < 2) {
      throw new BadRequestException('Vui lòng chọn đủ 2 ảnh: File 1 là CCCD mặt trước, File 2 là ảnh selfie.');
    }

    const idCardFile = files[0];
    const selfieFile = files[1];
    const selfieUrl = `ekyc/${user.accountId}/selfie_${Date.now()}.jpg`;

    return this.ekycService.faceMatch(
      user.accountId,
      idCardFile.buffer,
      selfieFile.buffer,
      selfieUrl,
    );
  }

  /**
   * Kiểm tra trạng thái eKYC hiện tại.
   */
  @Get('status')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xem trạng thái xác thực eKYC hiện tại của Customer' })
  async getStatus(@CurrentUser() user: CurrentUserData) {
    return this.ekycService.getStatus(user.accountId);
  }

  /**
   * Reset để gửi lại (nếu bị REJECTED).
   */
  @Post('retry')
  @Roles('CUSTOMER')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset trạng thái eKYC để thử lại (khi đã bị từ chối)' })
  async retry(@CurrentUser() user: CurrentUserData) {
    return this.ekycService.resetForRetry(user.accountId);
  }
}
