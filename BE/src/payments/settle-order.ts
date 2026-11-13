import { InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { Disbursement } from './entities/disbursement.entity';
import { type EscrowBook, EscrowLedger } from './entities/escrow-ledger.entity';
import { PaymentComponent } from './entities/payment-component.entity';
import { escrowBalance } from './escrow-balance';
import { computeDisputeSettlement } from './settlement';

// Lệnh chi cho vườn chờ 3 ngày để admin đối soát sổ với tài khoản ngân hàng trước khi chuyển.
// KHÔNG phải cửa sổ khiếu nại: khách chỉ khiếu nại được trong 48 giờ sau khi vườn chốt trả cây,
// tức là TRƯỚC khi đơn COMPLETED — tới đây thì không ai mở tranh chấp được nữa.
export const DISBURSE_HOLD_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SettleOrderOptions {
  // R — tiền công hoàn cho khách (thoả thuận / admin phân xử). Mặc định 0.
  refund?: bigint;
  // C — tiền đền từ sổ bảo đảm. Mặc định 0.
  compensation?: bigint;
}

/**
 * Chia tiền khi đơn kết thúc — gọi BÊN TRONG transaction đã khoá dòng đơn
 * (khách xác nhận nhận lại cây; sau này tác vụ tự xác nhận 48 giờ và tranh chấp gọi lại đúng hàm này).
 * Chỉ dùng `manager` (không DI) để chạy cùng transaction với việc đổi trạng thái.
 * Công thức ở `computeDisputeSettlement` (settlement.ts); đơn bình thường là R = 0, C = 0.
 *
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000: sổ 484.000 → PLATFORM_FEE −72.000,
 * PAYOUT −412.000 → 0; hoá đơn RELEASED; 1 lệnh chi PAYOUT 412.000 sau 3 ngày.
 * Có add-on 100.000 đã làm xong: sổ 590.000 → PLATFORM_FEE −90.000, PAYOUT −500.000 → 0.
 * 1 cây bị từ chối lúc nhận: REFUND −212.000 (200.000 + 6%), PLATFORM_FEE −36.000,
 * PAYOUT −236.000 → 0; thêm 1 lệnh chi REFUND 212.000 cho khách, chi được ngay.
 * Sổ bảo đảm (đơn có tiền bảo đảm 3.400.000): không tranh chấp → SECURITY_RETURN −3.400.000 → 0,
 * 1 lệnh chi SECURITY_RETURN cho vườn sau 3 ngày. Có đền C = 3.000.000 → COMPENSATION −3.000.000,
 * SECURITY_RETURN −400.000 → 0; lệnh chi COMPENSATION cho khách chi được ngay.
 * Đơn cũ không có tiền bảo đảm: số dư sổ bảo đảm = 0 → không ghi dòng nào ở sổ đó, chia như trước.
 * Sổ không khớp tiền để chia → 500 ESCROW_BALANCE_INSUFFICIENT, cả transaction huỷ.
 * Cố ý KHÔNG trả về số nào: nơi gọi là route của khách, phần của vườn (phí 12%, số vườn nhận)
 * không được lọt vào response — màn hình đọc qua customer-settlement.ts / chi tiết đơn.
 */
export async function settleOrder(
  manager: EntityManager,
  order: ServiceOrder,
  now: Date,
  opts: SettleOrderOptions = {},
): Promise<void> {
  // Mọi dòng hoá đơn khách đã trả. Add-on lúc này đều đã làm xong: còn add-on dở thì vườn chưa
  // bắt đầu trả cây được.
  const components = await manager.find(PaymentComponent, {
    where: { serviceOrderId: order.id, status: 'PAID' },
  });
  const packageComponent = components.find(
    (component) => component.componentType === 'PACKAGE_PRICE',
  );
  const addonComponents = components.filter(
    (component) => component.componentType === 'ADD_ON',
  );
  const finalTotal = BigInt(order.finalTotal ?? order.provisionalTotal);
  // Số dư sổ bảo đảm = tiền vườn đã nộp lúc nhận cây (đơn cũ chưa có tiền bảo đảm → 0).
  const securityBalance = await escrowBalance(manager, order.id, 'SECURITY');
  const settlement = computeDisputeSettlement({
    // Đơn không có dòng gói (dữ liệu rất cũ) → coi như khách trả đúng giá chốt, không có phần chênh.
    packagePaid: packageComponent
      ? BigInt(packageComponent.amount)
      : finalTotal,
    packageFeeCollected: BigInt(packageComponent?.customerFee ?? '0'),
    finalTotal,
    addons: addonComponents.map((component) => ({
      amount: BigInt(component.amount),
      customerFee: BigInt(component.customerFee),
    })),
    pickupFee: BigInt(order.pickupFeeSnapshot),
    refund: opts.refund,
    compensation: opts.compensation,
    securityBalance,
  });
  const { customerRefund, platformFee, providerReceives } = settlement;

  // Số dư = SUM mọi bút toán (các dòng ghi cùng transaction có cùng created_at).
  const balance = await escrowBalance(manager, order.id);
  if (settlement.totalPaid > balance) {
    throw new InternalServerErrorException('ESCROW_BALANCE_INSUFFICIENT');
  }

  // Dòng 0đ không ghi (đơn giá dịch vụ 0 thì không có phí nền tảng). Mỗi sổ trừ dần số dư của riêng nó.
  await writeLedgerEntries(manager, order.id, 'ORDER', balance, [
    {
      type: 'REFUND',
      amount: customerRefund,
      note: `Hoàn khách đơn ${order.orderCode}: tiền công ${settlement.rejectedAmount + (opts.refund ?? 0n)}đ + phí 6% tương ứng ${settlement.customerFeeRefund}đ`,
    },
    {
      type: 'PLATFORM_FEE',
      amount: platformFee,
      note: `Nền tảng giữ phí 6% khách + 12% vườn của đơn ${order.orderCode}${addonComponents.length > 0 ? ' (gồm add-on)' : ''}`,
    },
    {
      type: 'PAYOUT',
      amount: providerReceives,
      note: `Phải trả vườn cho đơn ${order.orderCode}, chi sau ${DISBURSE_HOLD_DAYS} ngày`,
    },
  ]);
  // Sổ bảo đảm: đền cho khách C, phần còn lại trả vườn → về 0. Không dính phí nào.
  await writeLedgerEntries(manager, order.id, 'SECURITY', securityBalance, [
    {
      type: 'COMPENSATION',
      amount: settlement.compensation,
      note: `Đền giá trị cây cho khách đơn ${order.orderCode} từ tiền bảo đảm`,
    },
    {
      type: 'SECURITY_RETURN',
      amount: settlement.securityReturn,
      note: `Trả lại tiền bảo đảm cho vườn đơn ${order.orderCode}, chi sau ${DISBURSE_HOLD_DAYS} ngày`,
    },
  ]);

  const eligibleAt = new Date(now.getTime() + DISBURSE_HOLD_DAYS * DAY_MS);
  await manager.update(
    PaymentComponent,
    { serviceOrderId: order.id, status: 'PAID' },
    { status: 'RELEASED', disburseBufferUntilAt: eligibleAt },
  );
  // Phí vườn 12% chỉ tính trên giá dịch vụ → ghi vào dòng PACKAGE_PRICE (dòng gói có cây bị từ chối
  // vẫn RELEASED: phần chênh đã ra khỏi sổ bằng bút toán REFUND ở trên).
  await manager.update(
    PaymentComponent,
    { serviceOrderId: order.id, componentType: 'PACKAGE_PRICE' },
    { providerFee: settlement.packageProviderFee.toString() },
  );
  // Add-on: mỗi dòng ghi phí 12% của riêng nó.
  for (const [index, component] of addonComponents.entries()) {
    await manager.update(PaymentComponent, component.id, {
      providerFee: settlement.addonProviderFees[index].toString(),
    });
  }

  // Mỗi sổ một dòng lệnh chi để đối soát rõ sổ nào ra sổ đó. Khách được chi ngay (không chờ 3 ngày);
  // vườn chờ 3 ngày admin đối soát. Dòng 0đ không tạo.
  await createCustomerDisbursement(
    manager,
    order,
    'REFUND',
    customerRefund,
    now,
  );
  await createCustomerDisbursement(
    manager,
    order,
    'COMPENSATION',
    settlement.compensation,
    now,
  );
  await createProviderDisbursement(
    manager,
    order,
    'PAYOUT',
    providerReceives,
    eligibleAt,
  );
  await createProviderDisbursement(
    manager,
    order,
    'SECURITY_RETURN',
    settlement.securityReturn,
    eligibleAt,
  );
}

export interface LedgerEntryInput {
  type: EscrowLedger['entryType'];
  // Số tiền RA khỏi sổ (dương) — hàm tự ghi số âm.
  amount: bigint;
  note: string;
}

/**
 * Ghi các bút toán tiền RA của một sổ, trừ dần `balance` để điền balance_after của RIÊNG sổ đó.
 * Dòng 0đ không ghi. Ví dụ sổ đơn 484.000: REFUND 424.000 → 60.000, PAYOUT 60.000 → 0.
 */
export async function writeLedgerEntries(
  manager: EntityManager,
  orderId: string,
  book: EscrowBook,
  balance: bigint,
  entries: LedgerEntryInput[],
): Promise<bigint> {
  let remaining = balance;
  for (const entry of entries) {
    if (entry.amount === 0n) continue;
    remaining -= entry.amount;
    await manager.save(
      manager.create(EscrowLedger, {
        serviceOrderId: orderId,
        transactionId: null,
        book,
        entryType: entry.type,
        amount: (-entry.amount).toString(),
        balanceAfter: remaining.toString(),
        note: entry.note,
      }),
    );
  }
  return remaining;
}

/**
 * Lệnh chi cho KHÁCH (REFUND từ sổ đơn, COMPENSATION từ sổ bảo đảm). Chụp tài khoản khách lúc này;
 * chưa khai thì để null, admin thấy thiếu và chờ khách khai — cùng cách đang làm với vườn. 0đ → bỏ qua.
 */
export async function createCustomerDisbursement(
  manager: EntityManager,
  order: ServiceOrder,
  type: 'REFUND' | 'COMPENSATION',
  amount: bigint,
  eligibleAt: Date,
): Promise<void> {
  if (amount <= 0n) return;
  const customer = await manager.findOne(CustomerProfile, {
    where: { id: order.customerId },
  });
  await manager.save(
    manager.create(Disbursement, {
      serviceOrderId: order.id,
      customerId: order.customerId,
      providerId: null,
      type,
      amount: amount.toString(),
      eligibleAt,
      bankName: customer?.bankName ?? null,
      bankAccount: customer?.bankAccount ?? null,
      bankHolder: customer?.bankHolder ?? null,
      status: 'PENDING' as const,
    }),
  );
}

/**
 * Lệnh chi cho VƯỜN (PAYOUT từ sổ đơn, SECURITY_RETURN từ sổ bảo đảm). Chụp tài khoản nhận tiền lúc này;
 * vườn chưa khai thì để null, admin bổ sung lúc chuyển. 0đ → bỏ qua.
 */
export async function createProviderDisbursement(
  manager: EntityManager,
  order: ServiceOrder,
  type: 'PAYOUT' | 'SECURITY_RETURN',
  amount: bigint,
  eligibleAt: Date,
): Promise<void> {
  if (amount <= 0n) return;
  const provider = await manager.findOne(ProviderProfile, {
    where: { id: order.providerId },
  });
  await manager.save(
    manager.create(Disbursement, {
      serviceOrderId: order.id,
      customerId: null,
      providerId: order.providerId,
      type,
      amount: amount.toString(),
      eligibleAt,
      bankName: provider?.bankName ?? null,
      bankAccount: provider?.bankAccount ?? null,
      bankHolder: provider?.bankHolder ?? null,
      status: 'PENDING' as const,
    }),
  );
}
