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
 * Ảnh khách đính kèm ý kiến phản đối biên bản nhận cây — append-only.
 * Khách vẫn giao cây nhưng không đồng ý với kết quả vườn khám (vd vườn ghi "lá vàng sẵn",
 * khách chụp lại lá còn xanh) → ảnh khoá cùng biên bản, làm bằng chứng nếu tranh chấp lúc trả cây.
 */
@Entity({ name: 'handover_objection_photos' })
export class HandoverObjectionPhoto extends AppendOnlyEntity {
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

  @Column({ type: 'varchar', length: 500, nullable: true })
  caption!: string | null;
}
