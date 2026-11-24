import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import { PaymentTransaction } from './payment-transaction.entity';

export const ESCROW_BOOKS = ['ORDER', 'SECURITY', 'DECLARED'] as const;
export type EscrowBook = (typeof ESCROW_BOOKS)[number];

/**
 * Sổ cái ký quỹ — append-only, mỗi dòng 1 bút toán, balance_after cộng dồn
 * để kiểm toán tái dựng dòng tiền. DEPOSIT tại PAID = nạp ĐỦ toàn bộ tiền đơn
 * (KHÔNG phải cọc); lúc COMPLETED chia tiền: REFUND (hoàn khách phần cây bị từ chối
 * lúc nhận / tiền công hoàn, kèm 6% tương ứng), PLATFORM_FEE (nền tảng giữ phần phí còn lại)
 * rồi PAYOUT (phần phải trả vườn) → số dư về 0.
 * Ba sổ cho mỗi đơn (cột `book`), số dư và balance_after tính RIÊNG từng sổ:
 *   ORDER    — tiền khách trả (DEPOSIT, REFUND, PLATFORM_FEE, PAYOUT).
 *   SECURITY — tiền bảo đảm vườn nộp lúc nhận cây: SECURITY_IN (+), cuối đơn COMPENSATION (đền khách)
 *              và SECURITY_RETURN (trả lại vườn) → về 0. Đơn mẫu: +3.400.000 → −3.000.000, −400.000.
 *   DECLARED — tiền bảo đảm khai giá khách nộp cùng tiền đơn: DECLARED_IN (+), cuối đơn DECLARED_RETURN
 *              (trả khách) và DECLARED_FORFEIT (sang vườn khi admin phán cây đó vườn không lỗi) → về 0.
 *              Đơn mẫu: +300.000 → −300.000.
 * Số dư hiện tại = SUM(amount) theo sổ (escrow-balance.ts), không lấy dòng mới nhất.
 * Đây là sổ LOGIC — tiền thật nằm ở tài khoản ngân hàng nhận, admin đối soát tay.
 */
@Entity({ name: 'escrow_ledger' })
@Check(
  'CHK_escrow_ledger_entry_type',
  `"entry_type" IN ('DEPOSIT','REFUND','PAYOUT','PLATFORM_FEE','SECURITY_IN','SECURITY_RETURN','COMPENSATION','DECLARED_IN','DECLARED_RETURN','DECLARED_FORFEIT','OVERPAY_RETURN')`,
)
@Check('CHK_escrow_ledger_book', `"book" IN ('ORDER','SECURITY','DECLARED')`)
export class EscrowLedger extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'service_order_id' })
  serviceOrderId!: string;

  @ManyToOne(() => ServiceOrder, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder;

  @Column({ type: 'uuid', name: 'transaction_id', nullable: true })
  transactionId!: string | null;

  @ManyToOne(() => PaymentTransaction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: PaymentTransaction | null;

  @Column({ type: 'varchar', length: 20, name: 'entry_type' })
  entryType!:
    | 'DEPOSIT'
    | 'REFUND'
    | 'PAYOUT'
    | 'PLATFORM_FEE'
    | 'SECURITY_IN'
    | 'SECURITY_RETURN'
    | 'COMPENSATION'
    | 'DECLARED_IN'
    | 'DECLARED_RETURN'
    | 'DECLARED_FORFEIT'
    // Thối tiền chuyển dư cho người chuyển ngay lúc tiền về (overpay.ts) — sổ ORDER hoặc SECURITY.
    | 'OVERPAY_RETURN';

  // Sổ của bút toán. Mặc định ORDER để mọi dòng cũ (trước khi có tiền bảo đảm) thuộc sổ đơn.
  @Column({ type: 'varchar', length: 10, default: 'ORDER' })
  book!: EscrowBook;

  // Dương = tiền vào escrow, âm = tiền ra.
  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'bigint', name: 'balance_after' })
  balanceAfter!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
