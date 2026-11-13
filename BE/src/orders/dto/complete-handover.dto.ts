/**
 * Body POST /orders/:id/handover/complete — KHÔNG còn field nào.
 * Giá công chốt = giá gói × số cây vườn nhận, server tự tính; gửi `proposedFinalTotal` (hay field
 * lạ bất kỳ) → 400 do ValidationPipe forbidNonWhitelisted.
 */
export class CompleteHandoverDto {}
