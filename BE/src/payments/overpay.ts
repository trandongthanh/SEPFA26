import { EntityManager } from 'typeorm';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { EscrowBook, EscrowLedger } from './entities/escrow-ledger.entity';
import { escrowBalance } from './escrow-balance';
import {
  createCustomerDisbursement,
  createProviderDisbursement,
} from './settle-order';

/**
 * Thối tiền chuyển dư — người chuyển đưa thừa bao nhiêu thì trả lại bấy nhiêu NGAY, không chờ hết đơn.
 * Tiền dư không phải tiền của nền tảng (Điều 579 BLDS), trả mọi đồng, không ngưỡng.
 * Ghi 1 bút toán OVERPAY_RETURN (âm) vào ĐÚNG sổ đang giữ phần dư + 1 lệnh chi OVERPAY_RETURN chi ngay.
 * Gọi bên trong transaction của nơi gọi (webhook tiền vào, chia tiền cuối đơn, huỷ đơn).
 * Đơn mẫu: cần 484.000, khách chuyển 500.000 → sổ ORDER DEPOSIT +500.000 rồi OVERPAY_RETURN −16.000 → 484.000;
 * lệnh chi 16.000 cho khách. Vườn nộp bảo đảm 3.450.000 thay vì 3.400.000 → sổ SECURITY trả vườn 50.000.
 * amount ≤ 0 → không làm gì.
 */
export async function returnOverpay(
  manager: EntityManager,
  order: ServiceOrder,
  book: EscrowBook,
  amount: bigint,
  recipient: 'CUSTOMER' | 'PROVIDER',
  now: Date,
  transactionId: string | null,
): Promise<void> {
  if (amount <= 0n) return;
  const balance = await escrowBalance(manager, order.id, book);
  await manager.save(
    manager.create(EscrowLedger, {
      serviceOrderId: order.id,
      transactionId,
      book,
      entryType: 'OVERPAY_RETURN' as const,
      amount: (-amount).toString(),
      balanceAfter: (balance - amount).toString(),
      note: `Trả lại ${recipient === 'CUSTOMER' ? 'khách' : 'vườn'} tiền chuyển dư ${amount}đ của đơn ${order.orderCode}`,
    }),
  );
  if (recipient === 'CUSTOMER') {
    await createCustomerDisbursement(
      manager,
      order,
      'OVERPAY_RETURN',
      amount,
      now,
    );
  } else {
    await createProviderDisbursement(
      manager,
      order,
      'OVERPAY_RETURN',
      amount,
      now,
    );
  }
}
