import { CreateDateColumn } from 'typeorm';

// Base entity riêng cho bảng append-only (chỉ INSERT, KHÔNG UPDATE/DELETE) —
// vd bằng chứng số, sổ ghi chép. Không có updatedAt/deletedAt/version như
// BaseEntity vì các cột đó chỉ có ý nghĩa khi dữ liệu có thể bị sửa/xóa.
export abstract class AppendOnlyEntity {
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
