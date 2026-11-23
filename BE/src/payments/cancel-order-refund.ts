import { InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { escrowBalance } from './escrow-balance';
import { returnOverpay } from './overpay';
import {
  createCustomerDisbursement,
  createProviderDisbursement,
  DISBURSE_HOLD_DAYS,
  writeLedgerEntries,
} from './settle-order';
import { computeHandoverCancelSettlement } from './settlement';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hai cách chia sổ đơn khi đơn huỷ TRƯỚC khi vào kỳ chăm (chưa có add-on, chưa có tiền bảo đảm của vườn):
 *   FULL            — khách nhận lại toàn bộ, kể cả phí lấy cây (đơn mẫu 484.000);
 *   KEEP_PICKUP_FEE — vườn giữ phí lấy cây, khách nhận lại giá gói + 6% (đơn mẫu 424.000 / 60.000).
 * Nền tảng không thu đồng nào ở cả hai.
 */
export type CancelRefundMode = 'FULL' | 'KEEP_PICKUP_FEE';

export interface CancelRefundAmounts {
  // Số dư sổ đơn trước khi chia.
  orderBalance: bigint;
  customerRefund: bigint;
  providerReceives: bigint;
  // Số dư sổ bảo đảm khai giá — luôn trả hết cho khách.
  declaredReturn: bigint;
}

/**
 * Tính (CHỈ đọc) số tiền mỗi bên nhận nếu đơn huỷ theo `mode`. Dùng cho cả lúc huỷ thật lẫn màn
 * "huỷ bây giờ nhận lại bao nhiêu" của khách → hai nơi luôn ra cùng số.
 * Sổ đơn thiếu tiền so với các dòng hoá đơn đã trả → 500 ESCROW_BALANCE_INSUFFICIENT (sổ lệch, chờ admin).
 */
export async function computeCancelRefund(
  manager: EntityManager,
  order: ServiceOrder,
  mode: CancelRefundMode,
): Promise<CancelRefundAmounts> {
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

  const orderBalance = await escrowBalance(manager, order.id);
  if (orderBalance < packagePaid + packageFeeCollected + pickupFee) {
    throw new InternalServerErrorException('ESCROW_BALANCE_INSUFFICIENT');
  }
  const { customerRefund, providerReceives } = computeHandoverCancelSettlement({
    // Công thức gốc đặt tên theo bên chịu phí lấy cây: khách chịu = vườn giữ phí.
    cancelledBy: mode === 'KEEP_PICKUP_FEE' ? 'CUSTOMER' : 'PROVIDER',
    packagePaid,
    packageFeeCollected,
    pickupFee,
    orderBalance,
  });
  const declaredReturn = await escrowBalance(manager, order.id, 'DECLARED');
  return { orderBalance, customerRefund, providerReceives, declaredReturn };
}

/**
 * Trả tiền sổ đơn khi đơn huỷ trước kỳ chăm — gọi BÊN TRONG transaction đã khoá dòng đơn và
 * vừa đổi đơn sang CANCELLED. Chỉ dùng `manager` (không DI), giống settle-order.ts.
 * Công thức ở `computeHandoverCancelSettlement` (settlement.ts). Đơn mẫu sổ đơn 484.000:
 *   KEEP_PICKUP_FEE (khách không giao cây, khách vắng nhà, khách huỷ trong 3 giờ cuối, khách im lặng với
 *     biên bản): REFUND −424.000, PAYOUT −60.000 → 0; hoá đơn PACKAGE_PRICE → REFUNDED, PICKUP_FEE → RELEASED;
 *     lệnh chi REFUND 424.000 cho khách (chi ngay) + PAYOUT 60.000 cho vườn (chờ 3 ngày, phí lấy cây = 0
 *     thì không tạo).
 *   FULL (vườn không nộp tiền bảo đảm, vườn huỷ / không tới / không nhận, khách huỷ sớm): REFUND −484.000 → 0;
 *     mọi dòng hoá đơn → REFUNDED; 1 lệnh chi REFUND 484.000 cho khách.
 * Lúc này chưa có tiền bảo đảm nào trong sổ SECURITY nên không đụng sổ đó.
 * Sổ bảo đảm khai giá (DECLARED): cả hai nhánh đều trả HẾT cho khách — chưa ai kết luận khách sai.
 *   Đơn mẫu khách đã nộp 300.000: DECLARED_RETURN −300.000 → 0, lệnh chi DECLARED_RETURN chi ngay,
 *   dòng hoá đơn DECLARED_DEPOSIT → REFUNDED.
 * `label` = lý do huỷ viết cho người đọc sổ (vd "khách không giao cây"), ghi vào ghi chú bút toán.
 * Trả về số tiền hoàn cho khách (route của khách được hiện đúng số của khách).
 */
export async function refundCancelledOrder(
  manager: EntityManager,
  order: ServiceOrder,
  now: Date,
  mode: CancelRefundMode,
  label: string,
): Promise<{ customerRefund: bigint; declaredReturn: bigint }> {
  const { orderBalance, customerRefund, providerReceives, declaredReturn } =
    await computeCancelRefund(manager, order, mode);

  const orderLeftover = await writeLedgerEntries(
    manager,
    order.id,
    'ORDER',
    orderBalance,
    [
      {
        type: 'REFUND',
        amount: customerRefund,
        note:
          mode === 'KEEP_PICKUP_FEE'
            ? `Hoàn khách đơn ${order.orderCode} (${label}): giá gói + phí 6%, vườn giữ phí lấy cây`
            : `Hoàn khách toàn bộ đơn ${order.orderCode} (${label}), kể cả phí lấy cây`,
      },
      {
        type: 'PAYOUT',
        amount: providerReceives,
        note: `Phí lấy cây trả vườn cho đơn ${order.orderCode} (${label}), chi sau ${DISBURSE_HOLD_DAYS} ngày`,
      },
    ],
  );
  // Lưới quét (KEEP_PICKUP_FEE chỉ hoàn đúng giá gói + 6%): sổ đơn còn thừa = tiền chuyển dư cũ → trả khách.
  // FULL đã hoàn cả số dư nên orderLeftover = 0, không ghi gì.
  await returnOverpay(
    manager,
    order,
    'ORDER',
    orderLeftover,
    'CUSTOMER',
    now,
    null,
  );

  const eligibleAt = new Date(now.getTime() + DISBURSE_HOLD_DAYS * DAY_MS);
  if (mode === 'KEEP_PICKUP_FEE') {
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

  // Sổ bảo đảm khai giá: trả hết cho khách (đơn không có khoản này → số dư 0, không ghi gì).
  await writeLedgerEntries(manager, order.id, 'DECLARED', declaredReturn, [
    {
      type: 'DECLARED_RETURN',
      amount: declaredReturn,
      note: `Trả lại tiền bảo đảm khai giá cho khách đơn ${order.orderCode} (${label})`,
    },
  ]);
  await manager.update(
    PaymentComponent,
    { serviceOrderId: order.id, componentType: 'DECLARED_DEPOSIT' },
    { status: 'REFUNDED', disburseBufferUntilAt: null },
  );
  await createCustomerDisbursement(
    manager,
    order,
    'DECLARED_RETURN',
    declaredReturn,
    now,
  );
  return { customerRefund, declaredReturn };
}
