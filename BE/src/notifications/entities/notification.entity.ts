import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from '../../accounts/entities/account.entity';
import {
  NOTIFICATION_REF_ENTITIES,
  NOTIFICATION_TYPES,
  type NotificationRefEntity,
  type NotificationType,
} from '../notification.constants';

@Entity({ name: 'notifications' })
@Check(`"type" IN (${NOTIFICATION_TYPES.map((type) => `'${type}'`).join(',')})`)
@Check(
  `"ref_entity" IS NULL OR "ref_entity" IN (${NOTIFICATION_REF_ENTITIES.map((entity) => `'${entity}'`).join(',')})`,
)
@Check(
  `("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL)`,
)
@Index('IDX_notifications_account_created', ['accountId', 'createdAt'])
@Index('IDX_notifications_account_unread', ['accountId'], {
  where: `"is_read" = false`,
})
@Index('IDX_notifications_ref', ['refEntity', 'refId'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'varchar', length: 60 })
  type!: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({
    type: 'varchar',
    length: 40,
    name: 'ref_entity',
    nullable: true,
  })
  refEntity!: NotificationRefEntity | null;

  @Column({ type: 'uuid', name: 'ref_id', nullable: true })
  refId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'boolean', name: 'is_read', default: false })
  isRead!: boolean;

  @Column({ type: 'timestamptz', name: 'read_at', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
