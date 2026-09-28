import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { CryptoService } from '../crypto/crypto.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { EkycRecord } from './entities/ekyc-record.entity';

// ===== FPT.AI API Endpoints =====
const FPTAI_OCR_URL = 'https://api.fpt.ai/vision/idr/vnm';
const FPTAI_FACE_MATCH_URL = 'https://api.fpt.ai/vision/ekyc/facematch/v4';

// Ngưỡng Face Match (FPT.AI mặc định 80%).
const FACE_MATCH_THRESHOLD = 80;

// Cloudinary folder chuyên dụng cho eKYC — tách hẳn khỏi ảnh thông thường.
const EKYC_CLOUDINARY_FOLDER = 'lancare-hub/ekyc-documents';

// Nếu ảnh gốc > 4 MB, tải phiên bản đã resize từ Cloudinary để gửi FPT.AI (giới hạn 5 MB).
const FPTAI_MAX_BYTES = 4 * 1024 * 1024;

// ===== FPT.AI Response Interfaces =====
interface FptAiOcrItem {
  id?: string;
  name?: string;
  dob?: string;
  sex?: string;
  nationality?: string;
  home?: string;
  address?: string;
  doe?: string;
  type_new?: string;
  type?: string;
  id_number?: string;
  full_name?: string;
  date_of_birth?: string;
  gender?: string;
  place_of_origin?: string;
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

@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly apiKey: string;
  private readonly cloudinaryConfigured: boolean;

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

    // Cấu hình Cloudinary (idempotent — nếu UploadsModule đã config thì ghi đè cùng giá trị).
    const cloudinaryUrl = this.config.get<string>('CLOUDINARY_URL');
    if (cloudinaryUrl) {
      const parsed = new URL(cloudinaryUrl);
      cloudinary.config({
        cloud_name: parsed.hostname,
        api_key: decodeURIComponent(parsed.username),
        api_secret: decodeURIComponent(parsed.password),
        secure: true,
      });
      this.cloudinaryConfigured = true;
    } else {
      this.cloudinaryConfigured = false;
    }
  }

  // ================================================================
  //  1. OCR — Bóc tách thông tin CCCD
  // ================================================================

  async ocrIdCard(accountId: string, files: Express.Multer.File[]) {
    this.ensureApiKey();
    this.ensureCloudinary();

    const existing = await this.ekycRepo.findOne({ where: { accountId } });
    if (existing?.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    const frontFile = files[0];
    const backFile = files[1] ?? null;

    // 1. Upload ảnh lên Cloudinary (type: 'authenticated' — không ai xem được nếu không có signed URL)
    const frontUpload = await this.uploadToCloudinary(
      frontFile.buffer,
      `${accountId}/front_${Date.now()}`,
    );
    const backUpload = backFile
      ? await this.uploadToCloudinary(backFile.buffer, `${accountId}/back_${Date.now()}`)
      : null;

    // 2. Lấy buffer tối ưu cho FPT.AI (nếu ảnh > 4MB thì tải bản đã resize từ Cloudinary)
    const ocrBuffer = await this.getOptimizedBuffer(frontFile.buffer, frontUpload.public_id);

    // 3. Gọi FPT.AI OCR
    const { item: ocrResult, error: ocrError } = await this.callFptOcr(ocrBuffer);
    if (!ocrResult) {
      throw new BadRequestException(ocrError || 'EKYC_OCR_FAILED');
    }

    const extracted = this.parseOcrData(ocrResult);

    // 4. Lưu vào DB (lưu Cloudinary public_id, không lưu URL trực tiếp)
    const saveData = {
      status: 'PROCESSING',
      idDocType: extracted.idDocType,
      idDocNumberEnc: extracted.idNumber ? this.crypto.encrypt(extracted.idNumber) : null,
      fullNameExtracted: extracted.fullName,
      dateOfBirth: extracted.dob,
      gender: extracted.gender,
      nationality: extracted.nationality,
      placeOfOrigin: extracted.placeOfOrigin,
      frontImageUrl: frontUpload.public_id,
      backImageUrl: backUpload?.public_id ?? null,
    };

    if (existing) {
      await this.ekycRepo.update(existing.id, saveData);
    } else {
      await this.ekycRepo.save(this.ekycRepo.create({ accountId, ...saveData }));
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

  // ================================================================
  //  2. Face Matching — So khớp khuôn mặt
  // ================================================================

  async faceMatch(accountId: string, files: Express.Multer.File[]) {
    this.ensureApiKey();
    this.ensureCloudinary();

    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      throw new BadRequestException('EKYC_OCR_NOT_COMPLETED');
    }
    if (record.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    const idCardFile = files[0];
    const selfieFile = files[1];

    // 1. Upload selfie lên Cloudinary (authenticated)
    const selfieUpload = await this.uploadToCloudinary(
      selfieFile.buffer,
      `${accountId}/selfie_${Date.now()}`,
    );
    await this.ekycRepo.update(record.id, { selfieImageUrl: selfieUpload.public_id });

    // 2. Lấy buffer tối ưu cho FPT.AI
    const idCardBuffer = await this.getOptimizedBuffer(idCardFile.buffer, null);
    const selfieBuffer = await this.getOptimizedBuffer(selfieFile.buffer, selfieUpload.public_id);

    // 3. Gọi FPT.AI Face Match
    const { result: matchResult, error: matchError } = await this.callFptFaceMatch(
      idCardBuffer,
      selfieBuffer,
    );

    if (!matchResult) {
      await this.ekycRepo.update(record.id, {
        status: 'REJECTED',
        rejectionReason: matchError || 'Không thể so khớp khuôn mặt — lỗi API.',
        faceMatch: false,
      });
      throw new BadRequestException(matchError || 'EKYC_FACE_MATCH_API_ERROR');
    }

    const { isMatch, similarity } = matchResult;

    await this.ekycRepo.update(record.id, {
      faceMatch: isMatch,
      faceSimilarity: similarity.toFixed(2),
    });

    if (isMatch && similarity >= FACE_MATCH_THRESHOLD) {
      await this.ekycRepo.update(record.id, {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      });

      // Reload record với data mới nhất để sync
      const updatedRecord = await this.ekycRepo.findOneOrFail({ where: { id: record.id } });
      await this.syncToCustomerProfile(accountId, updatedRecord);

      this.logger.log(`eKYC VERIFIED for account ${accountId} (similarity=${similarity.toFixed(1)}%)`);

      return {
        success: true,
        status: 'VERIFIED',
        similarity: Number(similarity.toFixed(2)),
        message: 'Xác thực eKYC thành công!',
      };
    }

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

  // ================================================================
  //  3. Trạng thái eKYC
  // ================================================================

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

  // ================================================================
  //  4. Retry — Reset để thử lại
  // ================================================================

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
  //  5. Xem ảnh bảo mật (Signed URL có thời hạn 10 phút)
  // ================================================================

  /**
   * Trả về signed URL tạm thời (sống 10 phút) để xem ảnh eKYC.
   * @param field  'front' | 'back' | 'selfie'
   */
  async getSignedImageUrl(accountId: string, field: string) {
    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      throw new NotFoundException('EKYC_NOT_FOUND');
    }

    let publicId: string | null = null;
    switch (field) {
      case 'front':
        publicId = record.frontImageUrl;
        break;
      case 'back':
        publicId = record.backImageUrl;
        break;
      case 'selfie':
        publicId = record.selfieImageUrl;
        break;
      default:
        throw new BadRequestException('INVALID_FIELD');
    }

    if (!publicId) {
      throw new NotFoundException('EKYC_IMAGE_NOT_FOUND');
    }

    // Tạo signed URL với chữ ký — chỉ có thể tạo bởi server sở hữu API secret.
    const signedUrl = cloudinary.url(publicId, {
      sign_url: true,
      type: 'authenticated',
      secure: true,
      format: 'jpg',
    });

    return {
      url: signedUrl,
      expiresInSeconds: 600,
      message: 'URL có chữ ký bảo mật. Chỉ dùng để hiển thị, không lưu cache.',
    };
  }

  // ================================================================
  //                      PRIVATE HELPERS
  // ================================================================

  private ensureApiKey() {
    if (!this.apiKey) {
      throw new InternalServerErrorException('FPTAI_API_KEY_NOT_CONFIGURED');
    }
  }

  private ensureCloudinary() {
    if (!this.cloudinaryConfigured) {
      throw new ServiceUnavailableException(
        'CLOUDINARY_NOT_CONFIGURED — Vui lòng cấu hình CLOUDINARY_URL trong .env',
      );
    }
  }

  // ---- Cloudinary ----

  /**
   * Upload ảnh lên Cloudinary với type: 'authenticated' (chặn truy cập công khai).
   */
  private uploadToCloudinary(buffer: Buffer, filename: string): Promise<UploadApiResponse> {
    return new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: EKYC_CLOUDINARY_FOLDER,
          public_id: filename,
          type: 'authenticated',
          resource_type: 'image',
          overwrite: true,
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        },
        (error, result) => {
          if (error || !result) {
            this.logger.error(`Cloudinary upload error: ${error?.message ?? 'unknown'}`);
            reject(error ?? new Error('CLOUDINARY_UPLOAD_FAILED'));
            return;
          }
          resolve(result);
        },
      );
      stream.end(buffer);
    });
  }

  /**
   * Nếu ảnh gốc quá nặng (> 4 MB), tải phiên bản đã resize từ Cloudinary.
   * Cloudinary tự động nén + resize, đảm bảo luôn < 5 MB để FPT.AI chấp nhận.
   * Nếu ảnh nhẹ, dùng luôn buffer gốc (tiết kiệm 1 vòng mạng).
   */
  private async getOptimizedBuffer(
    originalBuffer: Buffer,
    cloudinaryPublicId: string | null,
  ): Promise<Buffer> {
    if (originalBuffer.length <= FPTAI_MAX_BYTES) {
      return originalBuffer;
    }

    // Ảnh quá nặng → tải bản resize từ Cloudinary
    if (!cloudinaryPublicId) {
      // Nếu chưa upload (trường hợp idCard trong face-match),
      // upload tạm để lấy bản resize rồi xoá sau.
      const tempUpload = await this.uploadToCloudinary(
        originalBuffer,
        `temp_resize_${Date.now()}`,
      );
      cloudinaryPublicId = tempUpload.public_id;
    }

    const resizedUrl = cloudinary.url(cloudinaryPublicId, {
      sign_url: true,
      type: 'authenticated',
      secure: true,
      transformation: [
        { width: 1600, crop: 'limit', quality: 'auto:good', format: 'jpg' },
      ],
    });

    this.logger.log(`Downloading resized image from Cloudinary (original=${(originalBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

    const res = await fetch(resizedUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      this.logger.warn(`Cloudinary resize download failed: ${res.status}`);
      // Fallback: dùng ảnh gốc (FPT.AI có thể từ chối nếu quá lớn)
      return originalBuffer;
    }

    return Buffer.from(await res.arrayBuffer());
  }

  // ---- FPT.AI ----

  /**
   * Gọi FPT.AI OCR — trả cả kết quả lẫn thông báo lỗi chi tiết cho client.
   */
  private async callFptOcr(
    imageBuffer: Buffer,
  ): Promise<{ item: FptAiOcrItem | null; error?: string }> {
    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('image', blob, 'id_card.jpg');

      const res = await fetch(FPTAI_OCR_URL, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'api_key': this.apiKey },
        body: formData,
        signal: AbortSignal.timeout(20_000),
      });

      // Bắt HTTP 429 Rate limit
      if (res.status === 429) {
        return {
          item: null,
          error: 'API Key FPT.AI đã hết hạn ngạch gọi (HTTP 429 Rate limit exceeded). Vui lòng dán API Key mới từ https://console.fpt.ai vào file BE/.env.',
        };
      }

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`FPT.AI OCR error: ${res.status} ${text}`);
        return { item: null, error: `FPT.AI OCR lỗi HTTP ${res.status}: ${text}` };
      }

      const json = (await res.json()) as FptAiOcrResponse;

      if (json.errorCode !== 0 || !json.data?.length) {
        this.logger.warn(`FPT.AI OCR returned errorCode=${json.errorCode}: ${json.errorMessage}`);
        return { item: null, error: json.errorMessage || 'FPT.AI OCR không nhận diện được ảnh. Vui lòng chụp lại rõ hơn.' };
      }

      return { item: json.data[0] };
    } catch (err) {
      this.logger.error(`FPT.AI OCR exception: ${(err as Error).message}`);
      return { item: null, error: `FPT.AI OCR lỗi: ${(err as Error).message}` };
    }
  }

  /**
   * Gọi FPT.AI Face Match — trả cả kết quả lẫn thông báo lỗi chi tiết cho client.
   */
  private async callFptFaceMatch(
    idCardBuffer: Buffer,
    selfieBuffer: Buffer,
  ): Promise<{ result: { isMatch: boolean; similarity: number } | null; error?: string }> {
    try {
      const formData = new FormData();
      const idBlob = new Blob([idCardBuffer], { type: 'image/jpeg' });
      const selfieBlob = new Blob([selfieBuffer], { type: 'image/jpeg' });
      formData.append('file[]', idBlob, 'id_card.jpg');
      formData.append('file[]', selfieBlob, 'selfie.jpg');

      const res = await fetch(FPTAI_FACE_MATCH_URL, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'api_key': this.apiKey },
        body: formData,
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 429) {
        return {
          result: null,
          error: 'API Key FPT.AI đã hết hạn ngạch gọi (HTTP 429 Rate limit exceeded). Vui lòng dán API Key mới từ https://console.fpt.ai vào file BE/.env.',
        };
      }

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`FPT.AI FaceMatch error: ${res.status} ${text}`);
        return { result: null, error: `FPT.AI FaceMatch lỗi HTTP ${res.status}: ${text}` };
      }

      const json = (await res.json()) as FptAiFaceMatchResponse;

      if (json.code !== '200' || !json.data) {
        this.logger.warn(`FPT.AI FaceMatch returned code=${json.code}: ${json.message}`);
        return { result: null, error: json.message || 'FPT.AI FaceMatch không xử lý được ảnh.' };
      }

      return {
        result: {
          isMatch: json.data.isMatch,
          similarity: json.data.similarity,
        },
      };
    } catch (err) {
      this.logger.error(`FPT.AI FaceMatch exception: ${(err as Error).message}`);
      return { result: null, error: `FPT.AI FaceMatch lỗi: ${(err as Error).message}` };
    }
  }

  // ---- Utilities ----

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

  private maskIdNumber(idNumber: string): string {
    if (idNumber.length <= 6) return '***' + idNumber.slice(-3);
    return idNumber.slice(0, 3) + '***' + idNumber.slice(-3);
  }

  /**
   * Đồng bộ thông tin KYC đã verify sang CustomerProfile + Account.
   * Lưu Cloudinary public_id (không phải URL thô) vào cccdFrontUrl/cccdBackUrl/selfieWithIdUrl.
   */
  private async syncToCustomerProfile(accountId: string, record: EkycRecord) {
    const profile = await this.customerProfileRepo.findOne({ where: { accountId } });
    if (profile) {
      const updateData: Partial<CustomerProfile> = {
        verificationStatus: 'APPROVED',
        verificationNote: 'eKYC tự động xác thực qua FPT.AI (Cloudinary Authenticated)',
      };

      if (record.idDocNumberEnc) {
        const rawIdNumber = this.crypto.decrypt(record.idDocNumberEnc);
        updateData.cccdNumber = record.idDocNumberEnc;
        updateData.cccdNumberHash = createHash('sha256').update(rawIdNumber).digest('hex');
      }

      if (record.frontImageUrl) updateData.cccdFrontUrl = record.frontImageUrl;
      if (record.backImageUrl) updateData.cccdBackUrl = record.backImageUrl;
      if (record.selfieImageUrl) updateData.selfieWithIdUrl = record.selfieImageUrl;

      await this.customerProfileRepo.update(profile.id, updateData);
    }

    if (record.fullNameExtracted) {
      await this.accountRepo.update(accountId, { fullName: record.fullNameExtracted });
    }
  }
}
