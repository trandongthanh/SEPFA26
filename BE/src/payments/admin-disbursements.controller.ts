import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { DisbursementsService } from './disbursements.service';
import { MarkDisbursementPaidDto } from './dto/mark-disbursement-paid.dto';
import { QueryDisbursementDto } from './dto/query-disbursement.dto';
import {
  RECEIPT_MAX_SIZE_BYTES,
  RECEIPT_MIME_PATTERN,
  ReceiptUploadService,
} from './receipt-upload.service';

@ApiTags('admin-disbursements')
@ApiBearerAuth()
@Roles('ADMIN') // cấp class: mọi route đều cần ADMIN
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/disbursements')
export class AdminDisbursementsController {
  constructor(
    private readonly disbursementsService: DisbursementsService,
    private readonly receiptUpload: ReceiptUploadService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin xem danh sách lệnh chi (tiền phải chuyển cho vườn hoặc hoàn cho khách, xem field recipient), lệnh tới hạn sớm nhất lên đầu',
  })
  @ApiResponse({
    status: 400,
    description: 'status không hợp lệ, page < 1, limit ngoài 1–50',
  })
  list(@Query() query: QueryDisbursementDto) {
    return this.disbursementsService.list(query);
  }

  // Path 1 đoạn, không đụng `:id/mark-paid` (2 đoạn).
  @Post('receipt-upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: RECEIPT_MAX_SIZE_BYTES, files: 1 },
      // Loại khác bị bỏ qua → service báo IMAGE_FILE_REQUIRED; service còn kiểm chữ ký file.
      fileFilter: (_request, file, callback) => {
        callback(null, RECEIPT_MIME_PATTERN.test(file.mimetype));
      },
    }),
  )
  @ApiOperation({
    summary:
      'Admin tải ảnh biên lai chuyển khoản (jpg / png / webp, tối đa 5 MB) — lấy url gửi kèm "Đã chuyển"',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, description: '{ url } (secure_url Cloudinary)' })
  @ApiResponse({
    status: 400,
    description:
      'IMAGE_FILE_REQUIRED (thiếu file hoặc không phải jpg/png/webp) | IMAGE_FILE_INVALID (nội dung không phải ảnh jpg/png/webp)',
  })
  @ApiResponse({
    status: 413,
    description:
      'File too large (multer chặn file > 5 MB trước khi vào service)',
  })
  @ApiResponse({ status: 503, description: 'CLOUDINARY_NOT_CONFIGURED' })
  uploadReceipt(@UploadedFile() file?: Express.Multer.File) {
    return this.receiptUpload.uploadReceipt(file);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Admin xác nhận đã chuyển khoản cho vườn hoặc cho khách (bấm "Đã chuyển")',
  })
  @ApiResponse({
    status: 400,
    description:
      'id không phải UUID, thiếu/trống transferCode, transferCode > 100 ký tự, note > 1000 ký tự, receiptUrl không phải URL hoặc > 500 ký tự',
  })
  @ApiResponse({ status: 404, description: 'DISBURSEMENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DISBURSEMENT_ALREADY_PAID' })
  @ApiResponse({
    status: 409,
    description:
      'DISBURSEMENT_NOT_ELIGIBLE (chưa tới ngày được chi: lệnh của vườn chờ 3 ngày đối soát)',
  })
  @ApiResponse({
    status: 409,
    description:
      'PROVIDER_BANK_INFO_MISSING (lệnh của vườn: vườn chưa khai đủ tên ngân hàng, số tài khoản, chủ tài khoản)',
  })
  @ApiResponse({
    status: 409,
    description:
      'DISBURSEMENT_BANK_INFO_MISSING (lệnh của khách: khách chưa khai đủ tên ngân hàng, số tài khoản, chủ tài khoản)',
  })
  markPaid(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkDisbursementPaidDto,
  ) {
    return this.disbursementsService.markPaid(user.accountId, id, dto);
  }
}
