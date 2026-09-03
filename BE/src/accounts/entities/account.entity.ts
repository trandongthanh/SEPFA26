import { Exclude } from 'class-transformer';
import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import type { AccountStatus, Role } from '../../common/constants/roles';

@Entity({ name: 'accounts' })
@Check(`"role" IN ('CUSTOMER','PROVIDER','ADMIN')`)
@Check(`"status" IN ('ACTIVE','SUSPENDED','PENDING')`)
export class Account extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Exclude({ toPlainOnly: true })
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  phone!: string | null;

  // Số điện thoại được mã hóa nên ciphertext không thể dùng để kiểm tra trùng.
  // Hash SHA-256 chỉ phục vụ ràng buộc duy nhất, không trả ra API.
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'phone_hash', nullable: true })
  phoneHash!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'full_name' })
  fullName!: string;

  @Column({ type: 'varchar', length: 20 })
  role!: Role;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status!: AccountStatus;
}
