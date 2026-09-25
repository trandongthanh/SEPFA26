import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { CryptoService } from '../crypto/crypto.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { EkycRecord } from './entities/ekyc-record.entity';

// ===== FPT.AI API Endpoints =====
const FPTAI_OCR_URL = 'https://api.fpt.ai/vision/idr/vnm';
const FPTAI_FACE_MATCH_URL = 'https://api.fpt.ai/vision/ekyc/facematch/v4';

// ===== FPT.AI Response Interfaces =====
interface FptAiOcrItem {
  id?: string;
  name?: string;
  dob?: string;
  sex?: string;
  nationality?: string;
  home?: string;
  address?: string;
  doe?: string;            // date of expiry
  type_new?: string;       // "Căn cước công dân" hoặc "Chứng minh nhân dân"
  type?: string;
  id_number?: string;
  full_name?: string;
  date_of_birth?: string;
  gender?: string;
  place_of_origin?: string;
  // FPT.AI trả nhiều field khác tùy phiên bản — lấy những field chính.
}

interface FptAiOcrResponse {
  errorCode: number;
  errorMessage: string;
  data: FptAiOcrItem[];
}

interface FptAiFaceMatchResponse {
  code: string;
  message: string;
  data: {
    isMatch: boolean;
    similarity: number;
    isBothImgIDCard: boolean;
  };
}

// Ngưỡng tối thiểu để coi là khớp khuôn mặt (FPT.AI mặc định 80%, ta dùng 80%).
const FACE_MATCH_THRESHOLD = 80;

@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly apiKey: string;

  constructor(
    @InjectRepository(EkycRecord)
    private readonly ekycRepo: Repository<EkycRecord>,
    @InjectRepository(CustomerProfile)
    private readonly customerProfileRepo: Repository<CustomerProfile>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
  ) {
    this.apiKey = this.config.get<string>('FPTAI_API_KEY', '');
  }

  // ========================
  // 1. OCR — Bóc tách thông tin CCCD
  // ========================

  /**
   * POST /api/v1/ekyc/ocr
   * Mobile gửi ảnh CCCD mặt trước → backend gọi FPT.AI OCR → lưu kết quả.
   * Trả kết quả OCR để Mobile hiển thị xác nhận trước khi face-match.
   */
  async ocrIdCard(
    accountId: string,
    frontImageBuffer: Buffer,
    frontImageUrl: string,
    backImageBuffer: Buffer | null,
    backImageUrl: string | null,
  ) {
    this.ensureApiKey();

    // Kiểm tra đã verify rồi chưa
    const existing = await this.ekycRepo.findOne({ where: { accountId } });
    if (existing?.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    // Gọi FPT.AI OCR mặt trước
    const ocrResult = await this.callFptOcr(frontImageBuffer);
    if (!ocrResult) {
      throw new BadRequestException('EKYC_OCR_FAILED');
    }

    // Parse dữ liệu từ FPT.AI response
    const extracted = this.parseOcrData(ocrResult);

    // Upsert eKYC record
    if (existing) {
      await this.ekycRepo.update(existing.id, {
        status: 'PROCESSING',
        idDocType: extracted.idDocType,
        idDocNumberEnc: extracted.idNumber ? this.crypto.encrypt(extracted.idNumber) : null,
        fullNameExtracted: extracted.fullName,
        dateOfBirth: extracted.dob,
        gender: extracted.gender,
        nationality: extracted.nationality,
        placeOfOrigin: extracted.placeOfOrigin,
        frontImageUrl,
        backImageUrl,
      });
    } else {
      await this.ekycRepo.save(
        this.ekycRepo.create({
          accountId,
          status: 'PROCESSING',
          idDocType: extracted.idDocType,
          idDocNumberEnc: extracted.idNumber ? this.crypto.encrypt(extracted.idNumber) : null,
          fullNameExtracted: extracted.fullName,
          dateOfBirth: extracted.dob,
          gender: extracted.gender,
          nationality: extracted.nationality,
          placeOfOrigin: extracted.placeOfOrigin,
          frontImageUrl,
          backImageUrl,
        }),
      );
    }

    return {
      success: true,
      extracted: {
        fullName: extracted.fullName,
        idNumber: extracted.idNumber ? this.maskIdNumber(extracted.idNumber) : null,
        dateOfBirth: extracted.dob,
        gender: extracted.gender,
        nationality: extracted.nationality,
        placeOfOrigin: extracted.placeOfOrigin,
        idDocType: extracted.idDocType,
      },
      message: 'OCR thành công. Vui lòng tiếp tục bước Face Matching.',
    };
  }

  // ========================
  // 2. Face Matching — So khớp khuôn mặt
  // ========================

  /**
   * POST /api/v1/ekyc/face-match
   * Mobile gửi ảnh CCCD (mặt trước) + ảnh selfie → backend gọi FPT.AI Face Match.
   * Nếu khớp → cập nhật trạng thái VERIFIED + đồng bộ hồ sơ Customer.
   */
  async faceMatch(
    accountId: string,
    idCardImageBuffer: Buffer,
    selfieImageBuffer: Buffer,
    selfieImageUrl: string,
  ) {
    this.ensureApiKey();

    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      throw new BadRequestException('EKYC_OCR_NOT_COMPLETED');
    }
    if (record.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    // Gọi FPT.AI Face Match
    const matchResult = await this.callFptFaceMatch(idCardImageBuffer, selfieImageBuffer);

    // Lưu selfie URL
    await this.ekycRepo.update(record.id, { selfieImageUrl });

    if (!matchResult) {
      await this.ekycRepo.update(record.id, {
        status: 'REJECTED',
        rejectionReason: 'Không thể so khớp khuôn mặt — lỗi API.',
        faceMatch: false,
      });
      throw new BadRequestException('EKYC_FACE_MATCH_API_ERROR');
    }

    const { isMatch, similarity } = matchResult;

    await this.ekycRepo.update(record.id, {
      faceMatch: isMatch,
      faceSimilarity: similarity.toFixed(2),
    });

    if (isMatch && similarity >= FACE_MATCH_THRESHOLD) {
      // ===== VERIFIED =====
      await this.ekycRepo.update(record.id, {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      });

      // Đồng bộ thông tin sang CustomerProfile + Account
      await this.syncToCustomerProfile(accountId, record);

      this.logger.log(`eKYC VERIFIED for account ${accountId} (similarity=${similarity.toFixed(1)}%)`);

      return {
        success: true,
        status: 'VERIFIED',
        similarity: Number(similarity.toFixed(2)),
        message: 'Xác thực eKYC thành công!',
      };
    }

    // ===== REJECTED — khuôn mặt không khớp =====
    const reason = `Khuôn mặt không khớp (similarity=${similarity.toFixed(1)}%, yêu cầu ≥ ${FACE_MATCH_THRESHOLD}%).`;
    await this.ekycRepo.update(record.id, {
      status: 'REJECTED',
      rejectionReason: reason,
    });

    this.logger.log(`eKYC REJECTED for account ${accountId}: ${reason}`);

    return {
      success: false,
      status: 'REJECTED',
      similarity: Number(similarity.toFixed(2)),
      message: reason,
    };
  }

  // ========================
  // 3. Trạng thái eKYC
  // ========================

  /**
   * GET /api/v1/ekyc/status
   */
  async getStatus(accountId: string) {
    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      return { status: 'NOT_STARTED' };
    }
    return {
      status: record.status,
      verifiedAt: record.verifiedAt,
      fullName: record.fullNameExtracted,
      dateOfBirth: record.dateOfBirth,
      gender: record.gender,
      nationality: record.nationality,
      idDocType: record.idDocType,
      hasIdDocNumber: !!record.idDocNumberEnc,
      faceMatch: record.faceMatch,
      faceSimilarity: record.faceSimilarity ? Number(record.faceSimilarity) : null,
      rejectionReason: record.rejectionReason,
    };
  }

  /**
   * POST /api/v1/ekyc/retry
   * Cho phép customer gửi lại ảnh nếu bị REJECTED.
   */
  async resetForRetry(accountId: string) {
    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      throw new BadRequestException('EKYC_NOT_FOUND');
    }
    if (record.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    await this.ekycRepo.update(record.id, {
      status: 'PENDING',
      faceMatch: null,
      faceSimilarity: null,
      rejectionReason: null,
    });

    return { success: true, message: 'Đã reset. Vui lòng gửi lại ảnh CCCD.' };
  }

  // ================================================================
  //                      PRIVATE HELPERS
  // ================================================================

  private ensureApiKey() {
    if (!this.apiKey) {
      throw new InternalServerErrorException('FPTAI_API_KEY_NOT_CONFIGURED');
    }
  }

  /**
   * Gọi FPT.AI Vision OCR để bóc tách thông tin CCCD.
   */
  private async callFptOcr(imageBuffer: Buffer): Promise<FptAiOcrItem | null> {
    try {
      // Tạo FormData thủ công (Node.js 18+ built-in)
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('image', blob, 'id_card.jpg');

      const res = await fetch(FPTAI_OCR_URL, {
        method: 'POST',
        headers: { 'api-key': this.apiKey },
        body: formData,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`FPT.AI OCR error: ${res.status} ${text}`);
        return null;
      }

      const json = (await res.json()) as FptAiOcrResponse;

      if (json.errorCode !== 0 || !json.data?.length) {
        this.logger.warn(`FPT.AI OCR returned errorCode=${json.errorCode}: ${json.errorMessage}`);
        return null;
      }

      return json.data[0];
    } catch (err) {
      this.logger.error(`FPT.AI OCR exception: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Gọi FPT.AI Face Match so sánh ảnh CCCD với selfie.
   */
  private async callFptFaceMatch(
    idCardBuffer: Buffer,
    selfieBuffer: Buffer,
  ): Promise<{ isMatch: boolean; similarity: number } | null> {
    try {
      const formData = new FormData();
      const idBlob = new Blob([idCardBuffer], { type: 'image/jpeg' });
      const selfieBlob = new Blob([selfieBuffer], { type: 'image/jpeg' });
      formData.append('file[]', idBlob, 'id_card.jpg');
      formData.append('file[]', selfieBlob, 'selfie.jpg');

      const res = await fetch(FPTAI_FACE_MATCH_URL, {
        method: 'POST',
        headers: { 'api_key': this.apiKey },
        body: formData,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`FPT.AI FaceMatch error: ${res.status} ${text}`);
        return null;
      }

      const json = (await res.json()) as FptAiFaceMatchResponse;

      if (json.code !== '200' || !json.data) {
        this.logger.warn(`FPT.AI FaceMatch returned code=${json.code}: ${json.message}`);
        return null;
      }

      return {
        isMatch: json.data.isMatch,
        similarity: json.data.similarity,
      };
    } catch (err) {
      this.logger.error(`FPT.AI FaceMatch exception: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Parse kết quả OCR từ FPT.AI thành format chuẩn.
   * FPT.AI trả field khác nhau tùy phiên bản API/loại giấy tờ.
   */
  private parseOcrData(item: FptAiOcrItem) {
    return {
      idDocType: item.type_new || item.type || 'CCCD',
      idNumber: item.id || item.id_number || null,
      fullName: item.name || item.full_name || null,
      dob: item.dob || item.date_of_birth || null,
      gender: item.sex || item.gender || null,
      nationality: item.nationality || 'Việt Nam',
      placeOfOrigin: item.home || item.place_of_origin || null,
    };
  }

  /**
   * Che bớt số CCCD khi trả về cho mobile hiển thị (ví dụ: 001***000123).
   */
  private maskIdNumber(idNumber: string): string {
    if (idNumber.length <= 6) return '***' + idNumber.slice(-3);
    return idNumber.slice(0, 3) + '***' + idNumber.slice(-3);
  }

  /**
   * Đồng bộ thông tin KYC đã verify sang CustomerProfile + Account.
   */
  private async syncToCustomerProfile(accountId: string, record: EkycRecord) {
    const profile = await this.customerProfileRepo.findOne({ where: { accountId } });
    if (profile) {
      const updateData: Partial<CustomerProfile> = {
        verificationStatus: 'APPROVED',
        verificationNote: 'eKYC tự động xác thực qua FPT.AI',
      };

      // Giải mã số CCCD từ ekyc_records để lưu vào customer_profiles theo chuẩn dự án.
      if (record.idDocNumberEnc) {
        const rawIdNumber = this.crypto.decrypt(record.idDocNumberEnc);
        updateData.cccdNumber = record.idDocNumberEnc; // Đã mã hóa sẵn, dùng lại.
        updateData.cccdNumberHash = createHash('sha256').update(rawIdNumber).digest('hex');
      }

      if (record.frontImageUrl) updateData.cccdFrontUrl = record.frontImageUrl;
      if (record.backImageUrl) updateData.cccdBackUrl = record.backImageUrl;
      if (record.selfieImageUrl) updateData.selfieWithIdUrl = record.selfieImageUrl;

      await this.customerProfileRepo.update(profile.id, updateData);
    }

    // Cập nhật họ tên chuẩn từ CCCD vào Account.
    if (record.fullNameExtracted) {
      await this.accountRepo.update(accountId, {
        fullName: record.fullNameExtracted,
      });
    }
  }
}
