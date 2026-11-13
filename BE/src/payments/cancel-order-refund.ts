import { InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { escrowBalance } from './escrow-balance';
import {
  createCustomerDisbursement,
  createProviderDisbursement,
  DISBURSE_HOLD_DAYS,
  writeLedgerEntries,
} from './settle-order';
import { computeHandoverCancelSettlement } from './settlement';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Trả tiền sổ đơn khi đơn huỷ TẠI CHỖ lúc nhận cây — gọi BÊN TRONG transaction đã khoá dòng đơn và
 * vừa đổi đơn sang CANCELLED. Chỉ dùng `manager` (không DI), giống settle-order.ts.
 * Công thức ở `computeHandoverCancelSettlement` (settlement.ts). Đơn mẫu sổ đơn 484.000:
 *   CUSTOMER (khách không giao cây): REFUND −424.000, PAYOUT −60.000 → 0; hoá đơn PACKAGE_PRICE →
 *     REFUNDED, PICKUP_FEE → RELEASED; lệnh chi REFUND 424.000 cho khách (chi ngay) + PAYOUT 60.000
 *     cho vườn (chờ 3 ngày, phí lấy cây = 0 thì không tạo).
 *   PROVIDER (vườn không nộp tiền bảo đảm): REFUND −484.000 → 0; mọi dòng hoá đơn → REFUNDED;
 *     1 lệnh chi REFUND 484.000 cho khách.
 * Lúc này chưa có tiền bảo đảm nào trong sổ SECURITY nên không đụng sổ đó.
 * Trả về số tiền hoàn cho khách (route của khách được hiện đúng số của khách).
 */
export async function refundCancelledHandover(
  manager: EntityManager,
  order: ServiceOrder,
  now: Date,
  cancelledBy: 'CUSTOMER' | 'PROVIDER',
): Promise<{ customerRefund: bigint }> {
  const components = await manager.find(PaymentComponent, {
    where: { serviceOrderId: order.id, status: 'PAID' },
  });
  const packageComponent = components.find(
    (component) => component.componentType === 'PACKAGE_PRICE',
  );
  const pickupComponent = components.find(
    (component) => component.componentType === 'PICKUP_FEE',
  );
  const packagePaid = BigInt(packageComponent?.amount ?? '0');
  const packageFeeCollected = BigInt(packageComponent?.customerFee ?? '0');
  const pickupFee = BigInt(pickupComponent?.amount ?? '0');

  const balance = await escrowBalance(manager, order.id);
  if (balance < packagePaid + packageFeeCollected + pickupFee) {
    throw new InternalServerErrorException('ESCROW_BALANCE_INSUFFICIENT');
  }
  const { customerRefund, providerReceives } = computeHandoverCancelSettlement({
    cancelledBy,
    packagePaid,
    packageFeeCollected,
    pickupFee,
    orderBalance: balance,
  });

  await writeLedgerEntries(manager, order.id, 'ORDER', balance, [
    {
      type: 'REFUND',
      amount: customerRefund,
      note:
        cancelledBy === 'CUSTOMER'
          ? `Hoàn khách đơn ${order.orderCode} (khách không giao cây): giá gói ${packagePaid}đ + phí 6% ${packageFeeCollected}đ`
          : `Hoàn khách toàn bộ đơn ${order.orderCode} (vườn không nộp tiền bảo đảm), kể cả phí lấy cây`,
    },
    {
      type: 'PAYOUT',
      amount: providerReceives,
      note: `Phí lấy cây trả vườn cho đơn ${order.orderCode} (khách không giao cây), chi sau ${DISBURSE_HOLD_DAYS} ngày`,
    },
  ]);

  const eligibleAt = new Date(now.getTime() + DISBURSE_HOLD_DAYS * DAY_MS);
  if (cancelledBy === 'CUSTOMER') {
    await manager.update(
      PaymentComponent,
      { serviceOrderId: order.id, componentType: 'PACKAGE_PRICE' },
      { status: 'REFUNDED' },
    );
    await manager.update(
      PaymentComponent,
      { serviceOrderId: order.id, componentType: 'PICKUP_FEE' },
      { status: 'RELEASED', disburseBufferUntilAt: eligibleAt },
    );
  } else {
    await manager.update(
      PaymentComponent,
      { serviceOrderId: order.id },
      { status: 'REFUNDED' },
    );
  }

  await createCustomerDisbursement(
    manager,
    order,
    'REFUND',
    customerRefund,
    now,
  );
  await createProviderDisbursement(
    manager,
    order,
    'PAYOUT',
    providerReceives,
    eligibleAt,
  );
  return { customerRefund };
}
