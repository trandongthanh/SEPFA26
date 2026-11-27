import { EntityManager } from 'typeorm';
import type { ServiceOrder } from '../orders/entities/service-order.entity';
import { Disbursement } from './entities/disbursement.entity';

// Một lệnh chi trả về cho KHÁCH của đơn — chỉ trạng thái, không lộ tài khoản / mã giao dịch / ghi chú admin.
export interface CustomerDisbursementView {
  id: string;
  type: Disbursement['type'];
  // Số là chuỗi đồng.
  amount: string;
  status: Disbursement['status'];
  // Lúc được chi (tiền của khách thường chi ngay = lúc tạo lệnh).
  eligibleAt: Date;
  // Lúc admin bấm "Đã chuyển"; chưa chuyển → null.
  paidAt: Date | null;
  // Ảnh biên lai admin đính lúc bấm "Đã chuyển" (null nếu chưa chuyển hoặc không đính).
  receiptUrl: string | null;
}

/**
 * ĐỌC các lệnh chi của đơn mà người nhận là KHÁCH của đơn — để khách biết tiền hoàn đã chuyển chưa.
 * Chỉ đọc bảng `disbursements`, không tính lại tiền, không ghi gì.
 * Lọc theo `customer_id` (không lọc theo loại): cùng một đơn còn có lệnh chi của VƯỜN (PAYOUT,
 * SECURITY_RETURN, DECLARED_FORFEIT, OVERPAY_RETURN của vườn) — khách không được thấy các dòng đó.
 * Xếp theo lúc tạo rồi id để thứ tự cố định giữa các lần gọi.
 * Đơn mẫu: khách huỷ sớm đơn 484.000 có cây khai giá (tiền bảo đảm khai giá 300.000) → 2 dòng PENDING:
 * REFUND 484.000 và DECLARED_RETURN 300.000, paidAt / receiptUrl null. Admin bấm "Đã chuyển" dòng
 * REFUND → dòng đó PAID, có paidAt + receiptUrl; dòng kia vẫn PENDING.
 * Không có lệnh chi nào (đơn chưa thanh toán, đơn đang chăm) → [].
 */
export async function loadCustomerDisbursements(
  manager: EntityManager,
  order: Pick<ServiceOrder, 'id' | 'customerId'>,
): Promise<CustomerDisbursementView[]> {
  const rows = await manager.find(Disbursement, {
    where: { serviceOrderId: order.id, customerId: order.customerId },
    order: { createdAt: 'ASC', id: 'ASC' },
  });
  // Chép từng field — không spread entity (lộ bankName/bankAccount/transferCode/note/paidByAccountId).
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    amount: row.amount,
    status: row.status,
    eligibleAt: row.eligibleAt,
    paidAt: row.paidAt,
    receiptUrl: row.receiptUrl,
  }));
}
