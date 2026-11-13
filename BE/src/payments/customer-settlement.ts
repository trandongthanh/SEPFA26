import { EntityManager } from 'typeorm';
import { EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';

// Phần tiền của đơn mà KHÁCH được thấy (số là chuỗi đồng).
export interface CustomerSettlement {
  packageAmount: string;
  customerFee: string;
  pickupFee: string;
  // Tổng giá các add-on khách đã trả tiền (chưa gồm 6%; phần 6% nằm chung trong customerFee).
  addonAmount: string;
  customerTotal: string;
  refundAmount: string;
}

/**
 * ĐỌC số đã lưu (hoá đơn + sổ ký quỹ), không tính lại — để màn hình khớp tiền thật đã thu,
 * kể cả đơn có cây bị từ chối lúc nhận. Chưa có hoá đơn (chưa đủ 2 chữ ký) → null.
 * Dùng chung cho chi tiết đơn và response khách xác nhận nhận lại cây: hai chỗ luôn cùng một hình dạng
 * và không chỗ nào lộ phần của vườn (phí 12%, số vườn nhận) cho khách.
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000: 400.000 + 24.000 + 60.000 = 484.000.
 * Thêm add-on 100.000 đã trả: addonAmount 100.000, customerFee 30.000, customerTotal 590.000.
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
  // Bút toán REFUND ghi số âm → đổi dấu thành số tiền đã hoàn cho khách.
  const refundRow = await manager
    .createQueryBuilder(EscrowLedger, 'ledger')
    .select('COALESCE(SUM(ledger.amount), 0)', 'sum')
    .where('ledger.service_order_id = :orderId', { orderId })
    .andWhere('ledger.entry_type = :type', { type: 'REFUND' })
    .getRawOne<{ sum: string }>();
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
    refundAmount: (-BigInt(refundRow?.sum ?? '0')).toString(),
  };
}
