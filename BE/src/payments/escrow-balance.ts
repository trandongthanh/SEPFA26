import { EntityManager } from 'typeorm';
import { EscrowLedger } from './entities/escrow-ledger.entity';

// Số dư escrow của đơn = tổng mọi bút toán (dương vào, âm ra).
// Không lấy "balance_after của dòng mới nhất": 2 bút toán ghi trong cùng transaction
// có cùng created_at nên thứ tự "mới nhất" không chắc chắn.
export async function escrowBalance(
  manager: EntityManager,
  orderId: string,
): Promise<bigint> {
  const row = await manager
    .getRepository(EscrowLedger)
    .createQueryBuilder('l')
    .select('COALESCE(SUM(l.amount), 0)', 'balance')
    .where('l.serviceOrderId = :orderId', { orderId })
    .getRawOne<{ balance: string }>();
  return BigInt(row?.balance ?? '0');
}
