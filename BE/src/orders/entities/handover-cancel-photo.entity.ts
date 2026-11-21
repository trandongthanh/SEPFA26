import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Handover } from './handover.entity';

/**
 * Ảnh vườn chụp tại chỗ khi báo "khách vắng nhà" (huỷ tại cửa) — append-only.
 * Toạ độ là vị trí ĐIỆN THOẠI CỦA VƯỜN lúc chụp, app gửi kèm; được phép rỗng (vườn tắt định vị, mất sóng GPS).
 * `distance_m` = khoảng cách đường chim bay tới điểm lấy cây của đơn, server tự tính lúc lưu.
 * CHỈ để tham khảo, không chặn và không phạt: GPS giả được và lệch 5–50 m, ghim địa chỉ của khách cũng lệch.
 */
@Entity({ name: 'handover_cancel_photos' })
export class HandoverCancelPhoto extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'handover_id' })
  handoverId!: string;

  @ManyToOne(() => Handover, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'handover_id' })
  handover!: Handover;

  @Column({ type: 'varchar', length: 500, name: 'photo_url' })
  photoUrl!: string;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    name: 'gps_lat',
    nullable: true,
  })
  gpsLat!: string | null;

  @Column({
    type: 'numeric',
    precision: 9,
    scale: 6,
    name: 'gps_lng',
    nullable: true,
  })
  gpsLng!: string | null;

  @Column({ type: 'integer', name: 'distance_m', nullable: true })
  distanceM!: number | null;
}
