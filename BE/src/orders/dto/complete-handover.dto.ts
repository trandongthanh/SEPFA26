import { IsOptional, Matches } from 'class-validator';

// D4: chuỗi SỐ NGUYÊN dương (VNĐ) — chặn "1500000.00" làm BigInt() ném (500).
const MONEY_INT = /^\d{1,15}$/;

/**
 * Body POST /orders/:id/handover/complete.
 * proposedFinalTotal CHỈ hợp lệ khi có cây ADJUST (service check 2 chiều) —
 * > 0 và không vượt trần do service check (D1-cap).
 */
export class CompleteHandoverDto {
  @IsOptional()
  @Matches(MONEY_INT, { message: 'proposedFinalTotal phải là số nguyên dương' })
  proposedFinalTotal?: string;
}
