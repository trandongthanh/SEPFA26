import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { VideoCall } from './video-call.entity';

@Entity('video_call_events')
export class VideoCallEvent extends BaseEntity {

  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => VideoCall, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'video_call_id' })
  videoCall!: VideoCall;

  @Column({
    name: 'video_call_id',
    type: 'uuid',
  })
  videoCallId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType!: string;

  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload?: any;

  @Column({ name: 'origin_account_id', type: 'uuid', nullable: true })
  originAccountId?: string;
}