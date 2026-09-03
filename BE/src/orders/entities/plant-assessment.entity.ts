import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AppendOnlyEntity } from '../../common/entities/append-only.entity';
import { Account } from '../../accounts/entities/account.entity';
import { Handover } from './handover.entity';
import { Plant } from './plant.entity';

/**
 * Thẩm định cây tại bàn giao — append-only: re-assess tạo bản ghi MỚI,
 * PLANT.handoverDecision lấy bản mới nhất, chuỗi bằng chứng cũ giữ nguyên.
 * checklist jsonb thay bảng ASSESSMENT_ITEM (linh hoạt tiêu chí theo loài).
 */
@Entity({ name: 'plant_assessments' })
export class PlantAssessment extends AppendOnlyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Quan hệ CHÍNH: thẩm định gắn với cây.
  @Index()
  @Column({ type: 'uuid', name: 'plant_id' })
  plantId!: string;

  @ManyToOne(() => Plant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plant_id' })
  plant!: Plant;

  // FK phụ: trong phiên bàn giao nào (nullable — Phase 2 có thẩm định giữa kỳ).
  @Column({ type: 'uuid', name: 'handover_id', nullable: true })
  handoverId!: string | null;

  @ManyToOne(() => Handover, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'handover_id' })
  handover!: Handover | null;

  // Trỏ ACCOUNT (FK người-hành-động) — đúng quy ước FK toàn hệ thống.
  @Column({ type: 'uuid', name: 'assessor_id' })
  assessorId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'assessor_id' })
  assessor!: Account;

  @Column({ type: 'jsonb' })
  checklist!: Record<string, unknown>;

  @Column({ type: 'text', nullable: true })
  note!: string | null;
}
