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

// ===== Self-hosted AI Service Endpoints =====
// Thay thế FPT.AI bằng Python/FastAPI microservice chạy local.
// Sử dụng: EasyOCR (Vietnamese OCR), DeepFace (Face Matching), OpenCV (Anti-Fraud).

// Ngưỡng Face Match — tương đương FPT.AI mặc định 80%.
const FACE_MATCH_THRESHOLD = 80;

// Ngưỡng Anti-Fraud — document fraud score < 50 = genuine.
const FRAUD_SCORE_THRESHOLD = 50;

// Ngưỡng Liveness — selfie liveness score >= 50 = real.
const LIVENESS_SCORE_THRESHOLD = 50;

// Cloudinary folder chuyên dụng cho eKYC — tách hẳn khỏi ảnh thông thường.
const EKYC_CLOUDINARY_FOLDER = 'lancare-hub/ekyc-documents';

// ===== AI Service Response Interfaces =====
interface AiOcrResponse {
  success: boolean;
  data: {
    id_number: string | null;
    full_name: string | null;
    date_of_birth: string | null;
    gender: string | null;
    nationality: string | null;
    place_of_origin: string | null;
    place_of_residence: string | null;
    expiry_date: string | null;
    id_doc_type: string;
    raw_texts: string[];
    confidence: number;
  };
  processing_time_ms: number;
}

interface AiFaceMatchResponse {
  success: boolean;
  data: {
    isMatch: boolean;
    similarity: number;
    distance: number;
    model: string;
    detector: string;
    error: string | null;
  };
  processing_time_ms: number;
}

interface AiAntiFraudResponse {
  success: boolean;
  overall_passed: boolean;
  data: {
    document_fraud?: {
      fraud_score: number;
      passed: boolean;
      verdict: string;
      details: Record<string, unknown>;
      error: string | null;
    };
    selfie_liveness?: {
      liveness_score: number;
      is_live: boolean;
      verdict: string;
      details: Record<string, unknown>;
      error: string | null;
    };
  };
  processing_time_ms: number;
}

@Injectable()
export class EkycService {
  private readonly logger = new Logger(EkycService.name);
  private readonly aiServiceUrl: string;
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
    this.aiServiceUrl = this.config.get<string>('AI_SERVICE_URL', 'http://localhost:8000');

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
  //  1. OCR — Bóc tách thông tin CCCD (EasyOCR via AI Service)
  // ================================================================

  async ocrIdCard(accountId: string, files: Express.Multer.File[]) {
    this.ensureAiService();
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

    // 2. Gọi AI Service OCR (EasyOCR - Vietnamese)
    const { data: ocrResult, error: ocrError } = await this.callAiOcr(frontFile.buffer);
    if (!ocrResult) {
      throw new BadRequestException(ocrError || 'EKYC_OCR_FAILED');
    }

    // 3. Chạy Anti-Fraud Detection trên ảnh CCCD (phát hiện thẻ giả mạo)
    const fraudResult = await this.callAiAntiFraud(frontFile.buffer, null);
    const fraudScore = fraudResult?.data?.document_fraud?.fraud_score ?? null;
    const fraudPassed = fraudResult?.data?.document_fraud?.passed ?? true;

    if (!fraudPassed) {
      this.logger.warn(
        `Document fraud detected for account ${accountId}: score=${fraudScore}`,
      );
    }

    // 4. Lưu vào DB (lưu Cloudinary public_id, không lưu URL trực tiếp)
    const saveData: Partial<EkycRecord> = {
      status: 'PROCESSING',
      idDocType: ocrResult.id_doc_type || 'CCCD',
      idDocNumberEnc: ocrResult.id_number ? this.crypto.encrypt(ocrResult.id_number) : null,
      fullNameExtracted: ocrResult.full_name,
      dateOfBirth: ocrResult.date_of_birth,
      gender: ocrResult.gender,
      nationality: ocrResult.nationality || 'Việt Nam',
      placeOfOrigin: ocrResult.place_of_origin,
      frontImageUrl: frontUpload.public_id,
      backImageUrl: backUpload?.public_id ?? null,
      fraudScore: fraudScore?.toFixed(2) ?? null,
      antifraudDetails: fraudResult?.data ? (fraudResult.data as unknown as Record<string, unknown>) : null,
    };

    if (existing) {
      await this.ekycRepo.update(existing.id, saveData as any);
    } else {
      await this.ekycRepo.save(this.ekycRepo.create({ accountId, ...saveData } as any));
    }

    return {
      success: true,
      extracted: {
        fullName: ocrResult.full_name,
        idNumber: ocrResult.id_number ? this.maskIdNumber(ocrResult.id_number) : null,
        dateOfBirth: ocrResult.date_of_birth,
        gender: ocrResult.gender,
        nationality: ocrResult.nationality,
        placeOfOrigin: ocrResult.place_of_origin,
        idDocType: ocrResult.id_doc_type,
        confidence: ocrResult.confidence,
      },
      antiFraud: {
        fraudScore,
        passed: fraudPassed,
        verdict: fraudResult?.data?.document_fraud?.verdict ?? 'UNKNOWN',
      },
      message: fraudPassed
        ? 'OCR thành công. Vui lòng tiếp tục bước Face Matching.'
        : 'OCR thành công nhưng phát hiện dấu hiệu nghi ngờ thẻ giả mạo. Vui lòng sử dụng ảnh CCCD gốc.',
    };
  }

  // ================================================================
  //  2. Face Matching — So khớp khuôn mặt (DeepFace via AI Service)
  // ================================================================

  async faceMatch(accountId: string, files: Express.Multer.File[]) {
    this.ensureAiService();
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

    // 2. Chạy Anti-Fraud: Liveness Detection trên selfie (phát hiện ảnh giả mạo / deepfake)
    const fraudResult = await this.callAiAntiFraud(null, selfieFile.buffer);
    const livenessScore = fraudResult?.data?.selfie_liveness?.liveness_score ?? null;
    const isLive = fraudResult?.data?.selfie_liveness?.is_live ?? true;

    // Lưu kết quả liveness
    await this.ekycRepo.update(record.id, {
      livenessScore: livenessScore?.toFixed(2) ?? null,
      antifraudDetails: {
        ...(record.antifraudDetails ?? {}),
        selfie_liveness: fraudResult?.data?.selfie_liveness ?? null,
      },
    } as any);

    if (!isLive) {
      await this.ekycRepo.update(record.id, {
        status: 'REJECTED',
        rejectionReason: `Phát hiện ảnh selfie giả mạo (liveness_score=${livenessScore?.toFixed(1)}%). Vui lòng chụp ảnh khuôn mặt thật.`,
        faceMatch: false,
      });

      this.logger.warn(`Selfie spoof detected for account ${accountId}: liveness_score=${livenessScore}`);

      return {
        success: false,
        status: 'REJECTED',
        liveness: { score: livenessScore, isLive: false, verdict: 'SPOOF' },
        message: 'Phát hiện ảnh selfie giả mạo. Vui lòng chụp ảnh khuôn mặt thật (không chụp từ màn hình hoặc ảnh in).',
      };
    }

    // 3. Gọi AI Service Face Match (DeepFace + ArcFace)
    const { result: matchResult, error: matchError } = await this.callAiFaceMatch(
      idCardFile.buffer,
      selfieFile.buffer,
    );

    if (!matchResult) {
      await this.ekycRepo.update(record.id, {
        status: 'REJECTED',
        rejectionReason: matchError || 'Không thể so khớp khuôn mặt — lỗi AI Service.',
        faceMatch: false,
      });
      throw new BadRequestException(matchError || 'EKYC_FACE_MATCH_API_ERROR');
    }

    const { isMatch, similarity } = matchResult;

    await this.ekycRepo.update(record.id, {
      faceMatch: isMatch,
      faceSimilarity: similarity.toFixed(2),
    });

    // 4. Kiểm tra tổng hợp: Face Match + Document Fraud + Liveness
    const docFraudPassed = !record.fraudScore || Number(record.fraudScore) < FRAUD_SCORE_THRESHOLD;

    if (isMatch && similarity >= FACE_MATCH_THRESHOLD && docFraudPassed) {
      await this.ekycRepo.update(record.id, {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      });

      // Reload record với data mới nhất để sync
      const updatedRecord = await this.ekycRepo.findOneOrFail({ where: { id: record.id } });
      await this.syncToCustomerProfile(accountId, updatedRecord);

      this.logger.log(
        `eKYC VERIFIED for account ${accountId} (similarity=${similarity.toFixed(1)}%, ` +
        `fraudScore=${record.fraudScore ?? 'N/A'}, livenessScore=${livenessScore?.toFixed(1) ?? 'N/A'})`,
      );

      return {
        success: true,
        status: 'VERIFIED',
        similarity: Number(similarity.toFixed(2)),
        liveness: { score: livenessScore, isLive: true, verdict: 'REAL' },
        message: 'Xác thực eKYC thành công!',
      };
    }

    // Xác định lý do từ chối
    const reasons: string[] = [];
    if (!isMatch || similarity < FACE_MATCH_THRESHOLD) {
      reasons.push(`Khuôn mặt không khớp (similarity=${similarity.toFixed(1)}%, yêu cầu ≥ ${FACE_MATCH_THRESHOLD}%)`);
    }
    if (!docFraudPassed) {
      reasons.push(`Phát hiện dấu hiệu thẻ giả mạo (fraud_score=${record.fraudScore})`);
    }

    const reason = reasons.join('. ') + '.';
    await this.ekycRepo.update(record.id, {
      status: 'REJECTED',
      rejectionReason: reason,
    });

    this.logger.log(`eKYC REJECTED for account ${accountId}: ${reason}`);

    return {
      success: false,
      status: 'REJECTED',
      similarity: Number(similarity.toFixed(2)),
      liveness: { score: livenessScore, isLive: true, verdict: 'REAL' },
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
      // Anti-fraud results
      fraudScore: record.fraudScore ? Number(record.fraudScore) : null,
      livenessScore: record.livenessScore ? Number(record.livenessScore) : null,
      antifraudDetails: record.antifraudDetails,
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
      fraudScore: null,
      livenessScore: null,
      antifraudDetails: null,
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

    // Tương thích ngược: Nếu dữ liệu cũ được lưu dạng chuỗi giả lập "ekyc/..." trước khi tích hợp Cloudinary
    if (publicId.startsWith('ekyc/')) {
      return {
        url: null,
        expiresInSeconds: 0,
        message: 'Bản ghi eKYC này được xác thực từ phiên bản cũ (trước khi tích hợp Cloudinary), chưa có file ảnh lưu trên Cloud.',
      };
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

  private ensureAiService() {
    if (!this.aiServiceUrl) {
      throw new InternalServerErrorException(
        'AI_SERVICE_URL_NOT_CONFIGURED — Vui lòng cấu hình AI_SERVICE_URL trong .env (mặc định: http://localhost:8000)',
      );
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

  // ---- AI Service Calls ----

  /**
   * Gọi AI Service OCR (EasyOCR — Vietnamese + English).
   * Thay thế FPT.AI Vision IDR OCR.
   */
  private async callAiOcr(
    imageBuffer: Buffer,
  ): Promise<{ data: AiOcrResponse['data'] | null; error?: string }> {
    try {
      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('file', blob, 'id_card.jpg');

      const res = await fetch(`${this.aiServiceUrl}/api/ocr`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60_000), // OCR cần thời gian xử lý hơn API cloud
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`AI Service OCR error: ${res.status} ${text}`);
        return { data: null, error: `AI Service OCR lỗi HTTP ${res.status}: ${text}` };
      }

      const json = (await res.json()) as AiOcrResponse;

      if (!json.success || !json.data) {
        return { data: null, error: 'AI Service OCR không nhận diện được ảnh CCCD. Vui lòng chụp lại rõ hơn.' };
      }

      this.logger.log(`AI OCR completed in ${json.processing_time_ms}ms (confidence=${(json.data.confidence * 100).toFixed(1)}%)`);

      return { data: json.data };
    } catch (err) {
      this.logger.error(`AI Service OCR exception: ${(err as Error).message}`);

      if ((err as Error).name === 'TimeoutError' || (err as Error).message.includes('timeout')) {
        return { data: null, error: 'AI Service OCR quá thời gian xử lý. Vui lòng thử lại.' };
      }
      if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message.includes('fetch failed')) {
        return {
          data: null,
          error: `AI Service không khả dụng tại ${this.aiServiceUrl}. Vui lòng kiểm tra AI Service đã chạy chưa (cd AI && python main.py).`,
        };
      }

      return { data: null, error: `AI Service OCR lỗi: ${(err as Error).message}` };
    }
  }

  /**
   * Gọi AI Service Face Match (DeepFace + ArcFace model).
   * Thay thế FPT.AI Face Match v4.
   */
  private async callAiFaceMatch(
    idCardBuffer: Buffer,
    selfieBuffer: Buffer,
  ): Promise<{ result: { isMatch: boolean; similarity: number } | null; error?: string }> {
    try {
      const formData = new FormData();
      const idBlob = new Blob([idCardBuffer], { type: 'image/jpeg' });
      const selfieBlob = new Blob([selfieBuffer], { type: 'image/jpeg' });
      formData.append('id_card', idBlob, 'id_card.jpg');
      formData.append('selfie', selfieBlob, 'selfie.jpg');

      const res = await fetch(`${this.aiServiceUrl}/api/face-match`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`AI Service FaceMatch error: ${res.status} ${text}`);
        return { result: null, error: `AI Service FaceMatch lỗi HTTP ${res.status}: ${text}` };
      }

      const json = (await res.json()) as AiFaceMatchResponse;

      if (json.data?.error) {
        this.logger.warn(`AI Service FaceMatch returned error: ${json.data.error}`);
        return { result: null, error: `AI Service FaceMatch: ${json.data.error}` };
      }

      this.logger.log(
        `AI FaceMatch completed in ${json.processing_time_ms}ms ` +
        `(similarity=${json.data.similarity.toFixed(1)}%, model=${json.data.model})`,
      );

      return {
        result: {
          isMatch: json.data.isMatch,
          similarity: json.data.similarity,
        },
      };
    } catch (err) {
      this.logger.error(`AI Service FaceMatch exception: ${(err as Error).message}`);

      if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message.includes('fetch failed')) {
        return {
          result: null,
          error: `AI Service không khả dụng tại ${this.aiServiceUrl}. Vui lòng kiểm tra AI Service đã chạy chưa.`,
        };
      }

      return { result: null, error: `AI Service FaceMatch lỗi: ${(err as Error).message}` };
    }
  }

  /**
   * Gọi AI Service Anti-Fraud (ELA + Moiré + LBP Liveness).
   * Tính năng MỚI — không có trong FPT.AI cũ.
   * 
   * @param documentBuffer  Ảnh CCCD (để kiểm tra document fraud) — hoặc null nếu chỉ check selfie
   * @param selfieBuffer    Ảnh selfie (để kiểm tra liveness) — hoặc null nếu chỉ check document
   */
  private async callAiAntiFraud(
    documentBuffer: Buffer | null,
    selfieBuffer: Buffer | null,
  ): Promise<AiAntiFraudResponse | null> {
    try {
      const formData = new FormData();

      if (documentBuffer) {
        const docBlob = new Blob([documentBuffer], { type: 'image/jpeg' });
        formData.append('document', docBlob, 'document.jpg');
      }

      if (selfieBuffer) {
        const selfieBlob = new Blob([selfieBuffer], { type: 'image/jpeg' });
        formData.append('selfie', selfieBlob, 'selfie.jpg');
      }

      const res = await fetch(`${this.aiServiceUrl}/api/anti-fraud`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        this.logger.warn(`AI Service Anti-Fraud error: ${res.status}`);
        return null; // Non-blocking — don't fail eKYC if anti-fraud fails
      }

      const json = (await res.json()) as AiAntiFraudResponse;

      this.logger.log(
        `AI Anti-Fraud completed in ${json.processing_time_ms}ms ` +
        `(overall_passed=${json.overall_passed})`,
      );

      return json;
    } catch (err) {
      // Anti-fraud is supplementary — log warning but don't block the flow
      this.logger.warn(`AI Service Anti-Fraud exception (non-blocking): ${(err as Error).message}`);
      return null;
    }
  }

  // ---- Utilities ----

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
        verificationNote: 'eKYC tự động xác thực qua Self-hosted AI Service (EasyOCR + DeepFace + Anti-Fraud)',
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
