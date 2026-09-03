import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsService } from './payments.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly paymentsService: PaymentsService) {}

  // @Public vì SePay không có JWT — tự bảo vệ bằng header Apikey trong service.
  // KHÔNG khai @Body: pipe toàn cục (forbidNonWhitelisted) sẽ 400 khi SePay thêm
  // field mới → mất webhook không dấu vết. Nhận @Req để cầm body THÔ nguyên văn:
  // vừa làm bằng chứng gốc ghi log, vừa để service tự validate với luật mềm hơn.
  @Public()
  @Post('sepay')
  @HttpCode(200)
  @ApiOperation({ summary: 'SePay báo tiền vào (Authorization: Apikey <key>)' })
  handleSepay(
    @Headers('authorization') authorization: string | undefined,
    @Req() req: Request,
  ) {
    const rawBody =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    return this.paymentsService.handleSepayWebhook(authorization, rawBody);
  }
}
