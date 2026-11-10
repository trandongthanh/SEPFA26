import { ForbiddenException } from '@nestjs/common';
import type { CryptoService } from '../crypto/crypto.service';
import type { CustomerProfile } from '../customers/entities/customer-profile.entity';
import type { ProviderProfile } from '../providers/entities/provider-profile.entity';
import type { ContractParty } from './contract-template.service';

// Thông tin 2 bên đóng băng trong termsSnapshot.parties lúc vườn ACCEPT (bản 2 bên sẽ ký).
// v2: SĐT + số CCCD lưu dạng MÃ HOÁ (JSONB không được chứa PII dạng rõ), giải mã khi trả API.
// Snapshot cũ (không có version) giữ nguyên — KHÔNG backfill (sửa hợp đồng đã ký = sai lịch sử).
export const PARTY_SNAPSHOT_VERSION = 2;
const MISSING = 'Chưa cung cấp';

interface StoredParty {
  fullName: string;
  address: string;
  phoneEnc: string | null;
  identityNumberEnc: string | null;
  identityDocuments: string[];
}

export interface PartySnapshotV2 {
  version: typeof PARTY_SNAPSHOT_VERSION;
  customer: StoredParty;
  provider: StoredParty;
}

// Giải mã cột nhạy cảm. Dữ liệu seed cũ có thể còn là bản rõ → decrypt ném lỗi authTag;
// khi đó trả nguyên giá trị thay vì làm hỏng cả hợp đồng.
export function safeDecrypt(
  crypto: CryptoService,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  try {
    return crypto.decrypt(value);
  } catch {
    return value;
  }
}

// Nguồn là ciphertext (hồ sơ/eKYC) hoặc bản rõ (seed cũ) → chuẩn hoá thành ciphertext mới.
function reencrypt(
  crypto: CryptoService,
  value: string | null | undefined,
): string | null {
  const plain = safeDecrypt(crypto, value);
  return plain ? crypto.encrypt(plain) : null;
}

const presentUrls = (urls: Array<string | null | undefined>): string[] =>
  urls.filter((url): url is string => Boolean(url));

// Số CCCD: ưu tiên hồ sơ (khai tay, admin đã đối chiếu), fallback bản đọc từ eKYC.
export function buildPartySnapshot(
  input: {
    customer: CustomerProfile | null;
    provider: ProviderProfile | null;
    customerEkycIdNumberEnc?: string | null;
    providerEkycIdNumberEnc?: string | null;
  },
  crypto: CryptoService,
): PartySnapshotV2 {
  const { customer, provider } = input;
  return {
    version: PARTY_SNAPSHOT_VERSION,
    customer: {
      fullName: customer?.account?.fullName ?? MISSING,
      address: customer?.address ?? customer?.defaultPickupAddress ?? MISSING,
      phoneEnc: reencrypt(crypto, customer?.account?.phone),
      identityNumberEnc: reencrypt(
        crypto,
        customer?.cccdNumber ?? input.customerEkycIdNumberEnc,
      ),
      identityDocuments: presentUrls([
        customer?.cccdFrontUrl,
        customer?.cccdBackUrl,
        customer?.selfieWithIdUrl,
      ]),
    },
    provider: {
      fullName: provider?.account?.fullName ?? provider?.displayName ?? MISSING,
      address: provider?.address ?? MISSING,
      phoneEnc: reencrypt(crypto, provider?.account?.phone),
      identityNumberEnc: reencrypt(
        crypto,
        provider?.cccdNumber ?? input.providerEkycIdNumberEnc,
      ),
      identityDocuments: presentUrls([
        provider?.cccdFrontUrl,
        provider?.cccdBackUrl,
      ]),
    },
  };
}

function isPartySnapshotV2(parties: unknown): parties is PartySnapshotV2 {
  return (
    typeof parties === 'object' &&
    parties !== null &&
    (parties as { version?: unknown }).version === PARTY_SNAPSHOT_VERSION
  );
}

function toParty(crypto: CryptoService, party: StoredParty): ContractParty {
  return {
    fullName: party.fullName,
    address: party.address,
    phone: safeDecrypt(crypto, party.phoneEnc) ?? MISSING,
    identityNumber: safeDecrypt(crypto, party.identityNumberEnc) ?? MISSING,
    identityDocuments: party.identityDocuments,
  };
}

// Snapshot v2 → 2 bên đã giải mã (bỏ *Enc). Không phải v2 (snapshot cũ) → null để caller xử lý.
export function readPartySnapshot(
  parties: unknown,
  crypto: CryptoService,
): { customer: ContractParty; provider: ContractParty } | null {
  if (!isPartySnapshotV2(parties)) return null;
  return {
    customer: toParty(crypto, parties.customer),
    provider: toParty(crypto, parties.provider),
  };
}

// Vườn bấm ACCEPT tạo hợp đồng ngay → phải có SĐT + số CCCD để in Bên B (vườn APPROVED cũ chưa khai
// sẽ bị chặn ở đây cho tới khi bổ sung + admin duyệt lại). Cần provider load kèm relation account.
export function assertProviderIdentityComplete(
  provider: ProviderProfile,
): void {
  if (!provider.cccdNumber || !provider.account?.phone) {
    throw new ForbiddenException('PROVIDER_IDENTITY_INCOMPLETE');
  }
}
