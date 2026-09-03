import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Account } from '../../accounts/entities/account.entity';
import { ServiceOrder } from '../../orders/entities/service-order.entity';

/**
 * Local record of a GetStream video call.
 *
 * GetStream is the source of truth for real-time call state (members,
 * presence, recording, etc). This table only stores enough metadata to:
 *  - know which calls were created through our API,
 *  - know who created a call (for ownership / authorization checks),
 *  - keep an audit trail consistent with the rest of the schema
 *    (created_at/updated_at/deleted_at/version via BaseEntity).
 */
@Entity('video_calls')
export class VideoCall extends BaseEntity {
  @Column({ type: 'uuid', primary: true, default: () => 'gen_random_uuid()' })
  id!: string;

  /**
   * The GetStream call id (unique within a call type). We always use the
   * "default" call type unless extended later, so this id alone is enough
   * to look the call up again via the GetStream SDK.
   */
  @Index({ unique: true })
  @Column({ name: 'call_id', type: 'varchar', length: 255 })
  callId!: string;

  @Column({ name: 'call_type', type: 'varchar', length: 50, default: 'default' })
  callType!: string;

  @Index()
  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById!: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy!: Account;

  @Index()
  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId!: string | null;

  @ManyToOne(() => Account, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'provider_id' })
  provider!: Account | null;

  @Index()
  @Column({ name: 'service_order_id', type: 'uuid', nullable: true })
  serviceOrderId!: string | null;

  @ManyToOne(() => ServiceOrder, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_order_id' })
  serviceOrder!: ServiceOrder | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status!: 'OPEN' | 'CLOSED';

  @Column({ name: 'provider_joined_at', type: 'timestamptz', nullable: true })
  providerJoinedAt!: Date | null;

  @Column({ name: 'customer_joined_at', type: 'timestamptz', nullable: true })
  customerJoinedAt!: Date | null;

  @Column({ name: 'provider_left_at', type: 'timestamptz', nullable: true })
  providerLeftAt!: Date | null;

  @Column({ name: 'customer_left_at', type: 'timestamptz', nullable: true })
  customerLeftAt!: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt!: Date | null;
}
