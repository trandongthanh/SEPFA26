import { ConflictException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import {
  AddonExpiredReason,
  assertAddonTransition,
  overdueReason,
} from './addon-rules';
import { AddonProposal } from './entities/addon-proposal.entity';

/**
 * Đóng đề xuất add-on — chỉ nhận `manager` (không DI) để chạy trong transaction của nơi gọi,
 * giống settle-order.ts. Dùng chung cho route add-on, webhook tiền vào và lúc vườn bắt đầu trả cây.
 */

// Ghi EXPIRED cho một đề xuất đang PENDING / ACCEPTED.
export async function expireAddon(
  manager: EntityManager,
  proposal: AddonProposal,
  reason: AddonExpiredReason,
  now: Date,
): Promise<AddonProposal> {
  assertAddonTransition(proposal.status, 'EXPIRED');
  proposal.status = 'EXPIRED';
  proposal.expiredReason = reason;
  proposal.expiredAt = now;
  return manager.save(proposal);
}

/**
 * Kiểm hạn lúc chạm: chưa có tác vụ hẹn giờ, nên mỗi lần có ai đọc / ghi đề xuất của đơn thì
 * chuyển các đề xuất đã quá hạn (48 giờ chưa trả lời, 24 giờ chưa trả tiền) sang EXPIRED.
 * Sau này tác vụ quét hạn chỉ việc gọi lại hàm này cho từng đơn.
 */
export async function expireOverdueAddons(
  manager: EntityManager,
  orderId: string,
  now: Date,
): Promise<void> {
  const waiting = await manager.find(AddonProposal, {
    where: { serviceOrderId: orderId, status: In(['PENDING', 'ACCEPTED']) },
  });
  for (const proposal of waiting) {
    const reason = overdueReason(proposal, now);
    if (reason) {
      await expireAddon(manager, proposal, reason, now);
    }
  }
}

/**
 * Vườn bắt đầu trả cây — gọi BÊN TRONG transaction đã khoá dòng đơn.
 * - Còn add-on khách đã trả tiền mà vườn chưa báo xong → 409 ADDON_OPEN (phải làm xong rồi mới trả cây,
 *   vì tiền add-on chia cùng đơn và phí chỉ tính trên việc đã làm).
 * - Đề xuất còn chờ trả lời / chờ trả tiền → đóng thành EXPIRED (ORDER_RETURNING): cây sắp về nhà khách,
 *   không còn làm thêm được nữa.
 */
export async function closeAddonsForReturn(
  manager: EntityManager,
  orderId: string,
  now: Date,
): Promise<void> {
  const open = await manager.find(AddonProposal, {
    where: {
      serviceOrderId: orderId,
      status: In(['PENDING', 'ACCEPTED', 'PAID']),
    },
    lock: { mode: 'pessimistic_write' },
  });
  if (open.some((proposal) => proposal.status === 'PAID')) {
    throw new ConflictException('ADDON_OPEN');
  }
  for (const proposal of open) {
    await expireAddon(
      manager,
      proposal,
      overdueReason(proposal, now) ?? 'ORDER_RETURNING',
      now,
    );
  }
}
