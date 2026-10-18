import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';
import type {
  VideoCallEndReason,
  VideoCallStatus,
} from '../video-call.constants';

/**
 * Một cuộc gọi video 1-1 giữa hai bên của một đơn — mỗi cuộc gọi 1 dòng (B6).
 * BE giữ trạng thái RINGING/ACTIVE/ENDED; GetStream chỉ lo hình/tiếng.
 * Không lưu nhật ký vào/rời, không lưu giờ hết chuông (tính từ created_at + env).
 */
@Entity({ name: 'video_calls' })
@Check(`"status" IN ('RINGING','ACTIVE','ENDED')`)
@Check(
  `"end_reason" IS NULL OR "end_reason" IN ('COMPLETED','DECLINED','CANCELLED','MISSED','DROPPED','TIMEOUT')`,
)
@Check(`"caller_account_id" <> "callee_account_id"`)
// Đã kết thúc ⇔ có đủ lý do và giờ kết thúc.
@Check(
  `("status" = 'ENDED') = ("end_reason" IS NOT NULL AND "ended_at" IS NOT NULL)`,
)
// Đang đổ chuông thì chưa có giờ nghe; đang nói thì phải có (không có thì không bao giờ TIMEOUT).
@Check(
  `("status" <> 'RINGING' OR "answered_at" IS NULL) AND ("status" <> 'ACTIVE' OR "answered_at" IS NOT NULL)`,
)
// L4: mỗi đơn tối đa 1 cuộc gọi đang sống — lưới cuối khi hai request tạo cùng lúc.
@Index('UQ_video_calls_order_live', ['orderId'], {
  unique: true,
  where: `"status" IN ('RINGING','ACTIVE')`,
})
// L5: tra máy bận theo từng vai.
@Index('IDX_video_calls_caller_status', ['callerAccountId', 'status'])
@Index('IDX_video_calls_callee_status', ['calleeAccountId', 'status'])
// Lịch sử cuộc gọi của đơn, mới nhất trước.
@Index('IDX_video_calls_order_created', ['orderId', 'createdAt'])
export class VideoCall extends BaseEntity {
  // App sinh (K13 cần id trước khi insert); đồng thời là id cuộc gọi trên GetStream.
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id' })
  orderId!: string;

  // CASCADE như báo cáo chăm sóc: lịch sử gọi không phải bằng chứng (B5).
  @ManyToOne(() => ServiceOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: ServiceOrder;

  // Theo ACCOUNT (không theo profile): socket, JWT, user id GetStream đều theo account.
  @Column({ type: 'uuid', name: 'caller_account_id' })
  callerAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'caller_account_id' })
  caller!: Account;

  @Column({ type: 'uuid', name: 'callee_account_id' })
  calleeAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'callee_account_id' })
  callee!: Account;

  @Column({ type: 'varchar', length: 20 })
  status!: VideoCallStatus;

  @Column({ type: 'varchar', length: 20, name: 'end_reason', nullable: true })
  endReason!: VideoCallEndReason | null;

  // Tài khoản bấm cúp/từ chối/hủy. Null = hệ thống đóng (hết hạn, đơn bị đóng lúc đổ chuông).
  @Column({ type: 'uuid', name: 'ended_by', nullable: true })
  endedBy!: string | null;

  // Lúc người nhận bấm nghe — mốc tính thời lượng tối đa (L2).
  @Column({ type: 'timestamptz', name: 'answered_at', nullable: true })
  answeredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'ended_at', nullable: true })
  endedAt!: Date | null;

  // L3: lúc cuộc gọi đang nói bắt đầu thiếu người. Null = đang đủ hai bên.
  @Column({ type: 'timestamptz', name: 'short_handed_since', nullable: true })
  shortHandedSince!: Date | null;

  // L6: thiết bị đang giữ cuộc gọi của mỗi bên (máy vào sau giữ cuộc gọi).
  @Column({ type: 'uuid', name: 'caller_device_session_id', nullable: true })
  callerDeviceSessionId!: string | null;

  @Column({ type: 'uuid', name: 'callee_device_session_id', nullable: true })
  calleeDeviceSessionId!: string | null;
}
