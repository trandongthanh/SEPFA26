import { EntityManager } from 'typeorm';
import { type EscrowBook, EscrowLedger } from './entities/escrow-ledger.entity';

// Số dư MỘT sổ của đơn = tổng mọi bút toán của sổ đó (dương vào, âm ra). Mặc định sổ đơn (ORDER);
// sổ bảo đảm (SECURITY) phải truyền rõ — hai sổ không bao giờ cộng lẫn
// (đơn mẫu: sổ đơn 484.000, sổ bảo đảm 3.400.000, không có số 3.884.000 nào cả).
// Không lấy "balance_after của dòng mới nhất": 2 bút toán ghi trong cùng transaction
// có cùng created_at nên thứ tự "mới nhất" không chắc chắn.
export async function escrowBalance(
  manager: EntityManager,
  orderId: string,
  book: EscrowBook = 'ORDER',
): Promise<bigint> {
  const row = await manager
    .getRepository(EscrowLedger)
    .createQueryBuilder('l')
    .select('COALESCE(SUM(l.amount), 0)', 'balance')
    .where('l.serviceOrderId = :orderId', { orderId })
    .andWhere('l.book = :book', { book })
    .getRawOne<{ balance: string }>();
  return BigInt(row?.balance ?? '0');
}
