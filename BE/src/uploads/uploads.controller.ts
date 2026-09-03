import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Roles } from '../auth/decorators/roles.decorator';
import { UploadsService } from './uploads.service';

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Roles('CUSTOMER', 'PROVIDER')
  @Post('provider-document')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
      fileFilter: (_request, file, callback) => {
        callback(null, /^image\/(jpeg|png|webp)$/i.test(file.mimetype));
      },
    }),
  )
  @ApiOperation({
    summary:
      'Upload ảnh bằng chứng/hồ sơ đã xác thực lên Cloudinary (tối đa 5 MB)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async uploadProviderDocument(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('IMAGE_FILE_REQUIRED');
    return this.uploads.uploadProviderDocument(file);
  }
}
