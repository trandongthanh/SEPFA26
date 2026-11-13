import { EntityManager } from 'typeorm';
import type { ServiceOrder } from '../orders/entities/service-order.entity';
import { Disbursement } from './entities/disbursement.entity';
import { type EscrowBook, EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';

// Phần tiền của đơn mà KHÁCH được thấy (số là chuỗi đồng).
export interface CustomerSettlement {
  packageAmount: string;
  customerFee: string;
  pickupFee: string;
  // Tổng giá các add-on khách đã trả tiền (chưa gồm 6%; phần 6% nằm chung trong customerFee).
  addonAmount: string;
  customerTotal: string;
  // Tiền hoàn từ sổ đơn (cây bị từ chối lúc nhận, tiền công hoàn sau tranh chấp, đơn huỷ) — đã gồm 6%.
  refundAmount: string;
  // Tiền đền giá trị cây từ sổ bảo đảm (chỉ có sau tranh chấp vườn phải đền) — không dính phí.
  compensationAmount: string;
}

// Phần vườn thấy thêm khi đơn đã chia tiền (COMPLETED).
export interface ProviderSettlement extends CustomerSettlement {
  serviceAmount: string;
  providerFee: string;
  providerReceives: string;
  payout: {
    status: Disbursement['status'];
    eligibleAt: Date;
    paidAt: Date | null;
  } | null;
}

// Tổng tiền RA của một loại bút toán trong một sổ (bút toán ra ghi số âm → đổi dấu).
async function sumLedgerOut(
  manager: EntityManager,
  orderId: string,
  book: EscrowBook,
  type: EscrowLedger['entryType'],
): Promise<bigint> {
  const row = await manager
    .createQueryBuilder(EscrowLedger, 'ledger')
    .select('COALESCE(SUM(ledger.amount), 0)', 'sum')
    .where('ledger.service_order_id = :orderId', { orderId })
    .andWhere('ledger.book = :book', { book })
    .andWhere('ledger.entry_type = :type', { type })
    .getRawOne<{ sum: string }>();
  return -BigInt(row?.sum ?? '0');
}

/**
 * ĐỌC số đã lưu (hoá đơn + sổ ký quỹ), không tính lại — để màn hình khớp tiền thật đã thu,
 * kể cả đơn có cây bị từ chối lúc nhận. Chưa có hoá đơn (chưa đủ 2 chữ ký) → null.
 * Dùng chung cho chi tiết đơn, response khách xác nhận nhận lại cây và response kết thúc tranh chấp:
 * các chỗ luôn cùng một hình dạng và không chỗ nào lộ phần của vườn (phí 12%, số vườn nhận) cho khách.
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000: 400.000 + 24.000 + 60.000 = 484.000.
 * Thêm add-on 100.000 đã trả: addonAmount 100.000, customerFee 30.000, customerTotal 590.000.
 * Sau tranh chấp thoả thuận hoàn công 100.000 + đền 1.000.000: refundAmount 106.000, compensationAmount 1.000.000.
 */
export async function loadCustomerSettlement(
  manager: EntityManager,
  orderId: string,
): Promise<CustomerSettlement | null> {
  const components = await manager.find(PaymentComponent, {
    where: { serviceOrderId: orderId },
  });
  if (components.length === 0) {
    return null;
  }
  const amountOf = (type: PaymentComponent['componentType']) =>
    BigInt(
      components.find((component) => component.componentType === type)
        ?.amount ?? '0',
    );
  const packageAmount = amountOf('PACKAGE_PRICE');
  const pickupFee = amountOf('PICKUP_FEE');
  // Dòng ADD_ON chỉ sinh khi tiền add-on đã về → có dòng nào là khách đã trả dòng đó.
  const addonAmount = components
    .filter((component) => component.componentType === 'ADD_ON')
    .reduce((sum, component) => sum + BigInt(component.amount), 0n);
  // Cộng mọi dòng hoá đơn (PACKAGE_PRICE và ADD_ON có phí 6%, PICKUP_FEE = 0).
  const customerFee = components.reduce(
    (sum, component) => sum + BigInt(component.customerFee),
    0n,
  );
  // REFUND ghi lúc chia tiền cuối đơn và ĐÃ GỒM 6% tương ứng (1 cây 200.000 bị từ chối → 212.000);
  // trước lúc đó là 0. Chỉ sổ đơn: tiền đền từ sổ bảo đảm là khoản khác, không cộng vào tiền hoàn.
  const refundAmount = await sumLedgerOut(manager, orderId, 'ORDER', 'REFUND');
  // COMPENSATION chỉ có ở sổ bảo đảm, ghi lúc chia tiền sau tranh chấp (cây A mất giá trị → 3.000.000).
  const compensationAmount = await sumLedgerOut(
    manager,
    orderId,
    'SECURITY',
    'COMPENSATION',
  );
  return {
    packageAmount: packageAmount.toString(),
    customerFee: customerFee.toString(),
    pickupFee: pickupFee.toString(),
    addonAmount: addonAmount.toString(),
    customerTotal: (
      packageAmount +
      customerFee +
      pickupFee +
      addonAmount
    ).toString(),
    refundAmount: refundAmount.toString(),
    compensationAmount: compensationAmount.toString(),
  };
}

/**
 * Phần của VƯỜN sau khi đơn đã chia tiền — cũng chỉ ĐỌC số đã lưu (hoá đơn + lệnh chi PAYOUT).
 * Dùng chung cho chi tiết đơn (vườn xem đơn COMPLETED) và response vườn bấm đồng ý đề nghị tranh chấp.
 * Đơn mẫu: vườn bị trừ 48.000, nhận 412.000. Sau thoả thuận hoàn công 100.000: bị trừ 36.000, nhận 324.000.
 */
export async function loadProviderSettlement(
  manager: EntityManager,
  order: ServiceOrder,
  customerPart: CustomerSettlement,
): Promise<ProviderSettlement> {
  // Tuần tự (không Promise.all): `manager` có thể là transaction — một kết nối chỉ chạy một câu một lúc.
  const components = await manager.find(PaymentComponent, {
    where: { serviceOrderId: order.id },
  });
  const payout = await manager.findOne(Disbursement, {
    where: { serviceOrderId: order.id, type: 'PAYOUT' },
  });
  return {
    ...customerPart,
    // Giá dịch vụ đã làm = giá gói chốt + các add-on đã làm; phí 12% cộng từ từng dòng hoá đơn.
    serviceAmount: (
      BigInt(order.finalTotal ?? order.provisionalTotal) +
      BigInt(customerPart.addonAmount)
    ).toString(),
    providerFee: components
      .reduce((sum, component) => sum + BigInt(component.providerFee), 0n)
      .toString(),
    providerReceives: payout?.amount ?? '0',
    payout: payout
      ? {
          status: payout.status,
          eligibleAt: payout.eligibleAt,
          paidAt: payout.paidAt,
        }
      : null,
  };
}
