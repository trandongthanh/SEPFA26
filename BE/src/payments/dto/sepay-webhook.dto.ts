import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Chuẩn hoá field số của SePay về CHUỖI số nguyên (tiền không đi qua kiểu number):
 * - number an toàn (≤ 2^53) → String(); number mất chính xác → giữ nguyên cho validate fail;
 * - string → trim rồi để @Matches(^\d+$) quyết định.
 */
const toIntegerString = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return value;
};

/**
 * Payload webhook SePay — khai ĐỦ MỌI field SePay gửi (docs.sepay.vn).
 * Field lạ ngoài danh sách sẽ bị whitelist bỏ qua (không 400) — xem pipe riêng
 * của route webhook; bằng chứng gốc lưu từ req.body thô, không phải DTO này.
 */
export class SepayWebhookDto {
  // ID giao dịch trên SePay — chốt idempotency.
  @Transform(toIntegerString)
  @Matches(/^\d+$/)
  id!: string;

  // Brand name ngân hàng (VD "MBBank").
  @IsString()
  gateway!: string;

  // Thời gian giao dịch phía ngân hàng, "YYYY-MM-DD HH:mm:ss".
  @IsString()
  transactionDate!: string;

  // Số tài khoản nhận — PHẢI đối chiếu với BANK_ACCOUNT_NUMBER (P6).
  @IsString()
  accountNumber!: string;

  // Mã code thanh toán do SePay tự nhận diện (nullable).
  @IsOptional()
  @IsString()
  code?: string | null;

  // Nội dung chuyển khoản — nơi tìm orderCode LANCARExxxxxxxx.
  @IsOptional()
  @IsString()
  content?: string;

  // "in" = tiền vào, "out" = tiền ra.
  @IsIn(['in', 'out'])
  transferType!: 'in' | 'out';

  // Số tiền giao dịch (VNĐ) — chuỗi số nguyên, service đọc bằng BigInt.
  @Transform(toIntegerString)
  @Matches(/^\d+$/)
  transferAmount!: string;

  // Số dư lũy kế của tài khoản (SePay gửi kèm) — không dùng nghiệp vụ.
  @Transform(toIntegerString)
  @Matches(/^\d+$/)
  accumulated!: string;

  // Tài khoản phụ (nullable).
  @IsOptional()
  @IsString()
  subAccount?: string | null;

  // Mã tham chiếu của ngân hàng.
  @IsOptional()
  @IsString()
  referenceCode?: string;

  // Mô tả bổ sung.
  @IsOptional()
  @IsString()
  description?: string;
}
