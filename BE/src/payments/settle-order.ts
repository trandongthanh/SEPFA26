import { InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { Disbursement } from './entities/disbursement.entity';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { escrowBalance } from './escrow-balance';
import { computeSettlement } from './settlement';

// Khách có 3 ngày sau khi nhận lại cây để khiếu nại trước khi tiền được chuyển cho vườn.
export const DISBURSE_HOLD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Chia tiền khi đơn COMPLETED — gọi BÊN TRONG transaction đã khoá dòng đơn
 * (khách xác nhận nhận lại cây; sau này cron tự xác nhận 48h gọi lại đúng hàm này).
 * Chỉ dùng `manager` (không DI) để chạy cùng transaction với việc đổi trạng thái.
 *
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000: sổ 484.000 → PLATFORM_FEE −72.000,
 * PAYOUT −412.000 → 0; hoá đơn RELEASED; 1 lệnh chi PENDING 412.000 sau 3 ngày.
 * Sổ không đủ tiền để chia → 500 ESCROW_BALANCE_INSUFFICIENT, cả transaction huỷ.
 * Cố ý KHÔNG trả về số nào: nơi gọi là route của khách, phần của vườn (phí 12%, số vườn nhận)
 * không được lọt vào response — màn hình đọc qua customer-settlement.ts / chi tiết đơn.
 */
export async function settleCompletedOrder(
  manager: EntityManager,
  order: ServiceOrder,
  now: Date,
): Promise<void> {
  const settlement = computeSettlement({
    serviceAmount: BigInt(order.finalTotal ?? order.provisionalTotal),
    pickupFee: BigInt(order.pickupFeeSnapshot),
  });
  const { platformFee, providerReceives } = settlement;

  // Số dư = SUM mọi bút toán (2 dòng ghi cùng transaction có cùng created_at).
  let balance = await escrowBalance(manager, order.id);
  if (platformFee + providerReceives > balance) {
    throw new InternalServerErrorException('ESCROW_BALANCE_INSUFFICIENT');
  }

  // Dòng 0đ không ghi (đơn giá dịch vụ 0 thì không có phí nền tảng).
  const entries: {
    type: 'PLATFORM_FEE' | 'PAYOUT';
    amount: bigint;
    note: string;
  }[] = [
    {
      type: 'PLATFORM_FEE',
      amount: platformFee,
      note: `Nền tảng giữ phí 6% khách + 12% vườn của đơn ${order.orderCode}`,
    },
    {
      type: 'PAYOUT',
      amount: providerReceives,
      note: `Phải trả vườn cho đơn ${order.orderCode}, chi sau ${DISBURSE_HOLD_DAYS} ngày`,
    },
  ];
  for (const entry of entries) {
    if (entry.amount === 0n) continue;
    balance -= entry.amount;
    await manager.save(
      manager.create(EscrowLedger, {
        serviceOrderId: order.id,
        transactionId: null,
        entryType: entry.type,
        amount: (-entry.amount).toString(),
        balanceAfter: balance.toString(),
        note: entry.note,
      }),
    );
  }

  const eligibleAt = new Date(now.getTime() + DISBURSE_HOLD_DAYS * DAY_MS);
  await manager.update(
    PaymentComponent,
    { serviceOrderId: order.id, status: 'PAID' },
    { status: 'RELEASED', disburseBufferUntilAt: eligibleAt },
  );
  // Phí vườn 12% chỉ tính trên giá dịch vụ → ghi vào dòng PACKAGE_PRICE.
  await manager.update(
    PaymentComponent,
    { serviceOrderId: order.id, componentType: 'PACKAGE_PRICE' },
    { providerFee: settlement.providerFee.toString() },
  );

  if (providerReceives > 0n) {
    // Chụp tài khoản nhận tiền lúc này; vườn chưa khai thì để null, admin bổ sung lúc chuyển (CP4).
    const provider = await manager.findOne(ProviderProfile, {
      where: { id: order.providerId },
    });
    await manager.save(
      manager.create(Disbursement, {
        serviceOrderId: order.id,
        providerId: order.providerId,
        type: 'PAYOUT' as const,
        amount: providerReceives.toString(),
        eligibleAt,
        bankName: provider?.bankName ?? null,
        bankAccount: provider?.bankAccount ?? null,
        bankHolder: provider?.bankHolder ?? null,
        status: 'PENDING' as const,
      }),
    );
  }
}
