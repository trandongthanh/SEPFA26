import { ForbiddenException } from '@nestjs/common';
import type { CryptoService } from '../crypto/crypto.service';
import type { CustomerProfile } from '../customers/entities/customer-profile.entity';
import type { EkycRecord } from '../ekyc/entities/ekyc-record.entity';
import type { ProviderProfile } from '../providers/entities/provider-profile.entity';
import type { ContractParty } from './contract-template.service';

// Thông tin 2 bên đóng băng trong termsSnapshot.parties lúc vườn ACCEPT (bản 2 bên sẽ ký).
// v3: Tuân thủ quy định bảo vệ dữ liệu cá nhân — KHÔNG lưu số CCCD hay ảnh giấy tờ/chân dung.
// Chỉ đóng băng: Họ tên, Ngày tháng năm sinh, Quê quán, Địa chỉ thường trú, SĐT (mã hoá).
// v2 cũ (nếu có trong DB): đọc SĐT/Họ tên/Địa chỉ và loại bỏ số CCCD + link ảnh cũ.
export const PARTY_SNAPSHOT_VERSION = 3;
const MISSING = 'Chưa cung cấp';

interface StoredPartyV3 {
  fullName: string;
  dateOfBirth: string | null;
  placeOfOrigin: string | null;
  address: string;
  phoneEnc: string | null;
}

export interface PartySnapshotV3 {
  version: typeof PARTY_SNAPSHOT_VERSION;
  customer: StoredPartyV3;
  provider: StoredPartyV3;
}

interface LegacyStoredPartyV2 {
  fullName?: string;
  address?: string;
  phoneEnc?: string | null;
}

interface LegacyPartySnapshotV2 {
  version: 2;
  customer: LegacyStoredPartyV2;
  provider: LegacyStoredPartyV2;
}

// Giải mã cột nhạy cảm (SĐT). Dữ liệu seed cũ có thể còn là bản rõ → decrypt ném lỗi authTag;
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

// Nguồn là ciphertext (account.phone) hoặc bản rõ (seed cũ) → chuẩn hoá thành ciphertext mới.
function reencrypt(
  crypto: CryptoService,
  value: string | null | undefined,
): string | null {
  const plain = safeDecrypt(crypto, value);
  return plain ? crypto.encrypt(plain) : null;
}

export function buildPartySnapshot(
  input: {
    customer: CustomerProfile | null;
    provider: ProviderProfile | null;
    customerEkyc?: Pick<
      EkycRecord,
      'fullNameExtracted' | 'dateOfBirth' | 'placeOfOrigin' | 'placeOfResidence'
    > | null;
  },
  crypto: CryptoService,
): PartySnapshotV3 {
  const { customer, provider, customerEkyc } = input;
  return {
    version: PARTY_SNAPSHOT_VERSION,
    customer: {
      fullName:
        customer?.account?.fullName ??
        customerEkyc?.fullNameExtracted ??
        MISSING,
      dateOfBirth: customer?.dateOfBirth ?? customerEkyc?.dateOfBirth ?? null,
      placeOfOrigin:
        customer?.placeOfOrigin ?? customerEkyc?.placeOfOrigin ?? null,
      address:
        customer?.address ??
        customer?.defaultPickupAddress ??
        customerEkyc?.placeOfResidence ??
        MISSING,
      phoneEnc: reencrypt(crypto, customer?.account?.phone),
    },
    provider: {
      fullName: provider?.account?.fullName ?? provider?.displayName ?? MISSING,
      dateOfBirth: provider?.dateOfBirth ?? null,
      placeOfOrigin: provider?.placeOfOrigin ?? null,
      address: provider?.address ?? MISSING,
      phoneEnc: reencrypt(crypto, provider?.account?.phone),
    },
  };
}

function isPartySnapshotV3(parties: unknown): parties is PartySnapshotV3 {
  return (
    typeof parties === 'object' &&
    parties !== null &&
    (parties as { version?: unknown }).version === PARTY_SNAPSHOT_VERSION
  );
}

function isLegacyPartySnapshotV2(
  parties: unknown,
): parties is LegacyPartySnapshotV2 {
  return (
    typeof parties === 'object' &&
    parties !== null &&
    (parties as { version?: unknown }).version === 2
  );
}

function toPartyV3(crypto: CryptoService, party: StoredPartyV3): ContractParty {
  return {
    fullName: party.fullName || MISSING,
    dateOfBirth: party.dateOfBirth || MISSING,
    placeOfOrigin: party.placeOfOrigin || MISSING,
    address: party.address || MISSING,
    phone: safeDecrypt(crypto, party.phoneEnc) ?? MISSING,
  };
}

function toPartyFromV2(
  crypto: CryptoService,
  party: LegacyStoredPartyV2 | undefined,
): ContractParty {
  return {
    fullName: party?.fullName || MISSING,
    dateOfBirth: MISSING,
    placeOfOrigin: MISSING,
    address: party?.address || MISSING,
    phone: safeDecrypt(crypto, party?.phoneEnc) ?? MISSING,
  };
}

// Snapshot v3 → trả 5 trường hợp lệ đã giải mã SĐT.
// Snapshot v2 cũ → trả Họ tên, Địa chỉ, SĐT đã giải mã (bỏ hoàn toàn số CCCD và ảnh cũ).
export function readPartySnapshot(
  parties: unknown,
  crypto: CryptoService,
): { customer: ContractParty; provider: ContractParty } | null {
  if (isPartySnapshotV3(parties)) {
    return {
      customer: toPartyV3(crypto, parties.customer),
      provider: toPartyV3(crypto, parties.provider),
    };
  }
  if (isLegacyPartySnapshotV2(parties)) {
    return {
      customer: toPartyFromV2(crypto, parties.customer),
      provider: toPartyFromV2(crypto, parties.provider),
    };
  }
  return null;
}

// Vườn bấm ACCEPT tạo hợp đồng ngay → phải có đủ SĐT, Địa chỉ thường trú, Ngày sinh, Quê quán để in Bên B.
export function assertProviderIdentityComplete(
  provider: ProviderProfile,
): void {
  if (
    !provider.account?.phone ||
    !provider.address ||
    !provider.dateOfBirth ||
    !provider.placeOfOrigin
  ) {
    throw new ForbiddenException('PROVIDER_IDENTITY_INCOMPLETE');
  }
}
