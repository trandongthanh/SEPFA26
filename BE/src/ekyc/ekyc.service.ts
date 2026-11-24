import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';
import { EkycRecord } from './entities/ekyc-record.entity';

// ===== Self-hosted AI Service Endpoints (Zero-Retention In-Memory eKYC) =====
// Ảnh chỉ được xử lý tức thời trong RAM để đối chiếu & bóc tách thông tin cơ bản
// (họ tên, ngày sinh, quê quán, địa chỉ thường trú).
// KHÔNG thu giữ, KHÔNG lưu trữ số CCCD, ảnh CCCD hay ảnh chân dung lên DB/Cloud.

// Ngưỡng Face Match — tương đương FPT.AI mặc định 80%.
const FACE_MATCH_THRESHOLD = 80;

// Ngưỡng Anti-Fraud — document fraud score < 50 = genuine.
const FRAUD_SCORE_THRESHOLD = 50;

// Ngưỡng Liveness — selfie liveness score >= 50 = real.
const LIVENESS_SCORE_THRESHOLD = 50;

// ===== AI Service Response Interfaces =====
interface AiOcrResponse {
  success: boolean;
  data: {
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

// Chu kỳ ping giữ ấm AI Service trên Hugging Face Spaces (10 phút).
const AI_KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class EkycService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EkycService.name);
  private readonly aiServiceUrl: string;
  private keepAliveTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(EkycRecord)
    private readonly ekycRepo: Repository<EkycRecord>,
    @InjectRepository(CustomerProfile)
    private readonly customerProfileRepo: Repository<CustomerProfile>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly config: ConfigService,
  ) {
    this.aiServiceUrl = this.config
      .get<string>('AI_SERVICE_URL', 'http://localhost:8000')
      .replace(/\/+$/, '');
  }

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;

    // Đánh thức AI Service ngay khi Backend khởi động và tự động ping mỗi 10 phút
    void this.pingAiService();
    this.keepAliveTimer = setInterval(() => {
      void this.pingAiService();
    }, AI_KEEP_ALIVE_INTERVAL_MS);
    this.keepAliveTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private async pingAiService(): Promise<void> {
    if (!this.aiServiceUrl) return;
    try {
      const res = await fetch(`${this.aiServiceUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        this.logger.debug(`AI Service keep-alive OK (${this.aiServiceUrl})`);
      }
    } catch (err) {
      this.logger.warn(`AI Service keep-alive failed: ${(err as Error).message}`);
    }
  }

  // ================================================================
  //  1. OCR — Bóc tách thông tin cho phép trong RAM (Không lưu ảnh / số CCCD)
  // ================================================================

  async ocrIdCard(accountId: string, files: Express.Multer.File[]) {
    this.ensureAiService();

    const existing = await this.ekycRepo.findOne({ where: { accountId } });
    if (existing?.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    const frontFile = files[0];

    // 1. Gọi AI Service OCR (EasyOCR - Vietnamese) trực tiếp từ buffer trong RAM
    const { data: ocrResult, error: ocrError } = await this.callAiOcr(frontFile.buffer);
    if (!ocrResult || !ocrResult.full_name) {
      throw new BadRequestException(ocrError || 'EKYC_OCR_FAILED');
    }

    // 2. Chạy Anti-Fraud Detection trên ảnh trong RAM (phát hiện thẻ giả mạo / chụp màn hình)
    const fraudResult = await this.callAiAntiFraud(frontFile.buffer, null);
    const fraudScore = fraudResult?.data?.document_fraud?.fraud_score ?? null;
    const fraudPassed = fraudResult?.data?.document_fraud?.passed ?? true;

    if (!fraudPassed) {
      this.logger.warn(
        `Document fraud detected for account ${accountId}: score=${fraudScore}`,
      );
    }

    // 3. Lưu kết quả trích xuất hợp lệ vào DB (KHÔNG lưu số CCCD, KHÔNG upload/lưu ảnh)
    const saveData: Partial<EkycRecord> = {
      status: 'PROCESSING',
      idDocType: ocrResult.id_doc_type || 'CCCD',
      fullNameExtracted: ocrResult.full_name,
      dateOfBirth: ocrResult.date_of_birth,
      gender: ocrResult.gender,
      nationality: ocrResult.nationality || 'Việt Nam',
      placeOfOrigin: ocrResult.place_of_origin,
      placeOfResidence: ocrResult.place_of_residence,
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
        dateOfBirth: ocrResult.date_of_birth,
        gender: ocrResult.gender,
        nationality: ocrResult.nationality,
        placeOfOrigin: ocrResult.place_of_origin,
        placeOfResidence: ocrResult.place_of_residence,
        idDocType: ocrResult.id_doc_type,
        confidence: ocrResult.confidence,
      },
      antiFraud: {
        fraudScore,
        passed: fraudPassed,
        verdict: fraudResult?.data?.document_fraud?.verdict ?? 'UNKNOWN',
      },
      message: fraudPassed
        ? 'Trích xuất thông tin thành công (ảnh không lưu trên hệ thống). Vui lòng tiếp tục bước đối chiếu khuôn mặt.'
        : 'Đọc thông tin thành công nhưng phát hiện dấu hiệu nghi ngờ ảnh chưa đạt chuẩn. Vui lòng sử dụng thẻ gốc.',
    };
  }

  // ================================================================
  //  2. Face Matching — Đối chiếu khuôn mặt trong RAM (Không lưu ảnh)
  // ================================================================

  async faceMatch(accountId: string, files: Express.Multer.File[]) {
    this.ensureAiService();

    const record = await this.ekycRepo.findOne({ where: { accountId } });
    if (!record) {
      throw new BadRequestException('EKYC_OCR_NOT_COMPLETED');
    }
    if (record.status === 'VERIFIED') {
      throw new ConflictException('EKYC_ALREADY_VERIFIED');
    }

    const idCardFile = files[0];
    const selfieFile = files[1];

    // 1. Chạy Anti-Fraud: Liveness Detection trên selfie trong RAM (phát hiện ảnh giả mạo / deepfake)
    const fraudResult = await this.callAiAntiFraud(null, selfieFile.buffer);
    const livenessScore = fraudResult?.data?.selfie_liveness?.liveness_score ?? null;
    const isLive = fraudResult?.data?.selfie_liveness?.is_live ?? true;

    // Lưu kết quả liveness (chỉ lưu điểm kiểm tra, không lưu ảnh)
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
        rejectionReason: `Phát hiện ảnh chân dung không phải người thật (liveness_score=${livenessScore?.toFixed(1)}%). Vui lòng chụp trực tiếp khuôn mặt.`,
        faceMatch: false,
      });

      this.logger.warn(`Selfie spoof detected for account ${accountId}: liveness_score=${livenessScore}`);

      return {
        success: false,
        status: 'REJECTED',
        liveness: { score: livenessScore, isLive: false, verdict: 'SPOOF' },
        message: 'Phát hiện ảnh chân dung giả mạo. Vui lòng chụp trực tiếp khuôn mặt thật (không chụp từ màn hình hoặc ảnh in).',
      };
    }

    // 2. Gọi AI Service Face Match (DeepFace + ArcFace) hoàn toàn trong RAM
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

    // 3. Kiểm tra tổng hợp: Face Match + Document Fraud + Liveness
    const docFraudPassed = !record.fraudScore || Number(record.fraudScore) < FRAUD_SCORE_THRESHOLD;

    if (isMatch && similarity >= FACE_MATCH_THRESHOLD && docFraudPassed) {
      await this.ekycRepo.update(record.id, {
        status: 'VERIFIED',
        verifiedAt: new Date(),
      });

      // Reload record với data mới nhất để sync thông tin hợp lệ sang CustomerProfile & Account
      const updatedRecord = await this.ekycRepo.findOneOrFail({ where: { id: record.id } });
      await this.syncToCustomerProfile(accountId, updatedRecord);

      this.logger.log(
        `eKYC VERIFIED (zero-retention) for account ${accountId} (similarity=${similarity.toFixed(1)}%, ` +
        `fraudScore=${record.fraudScore ?? 'N/A'}, livenessScore=${livenessScore?.toFixed(1) ?? 'N/A'})`,
      );

      return {
        success: true,
        status: 'VERIFIED',
        similarity: Number(similarity.toFixed(2)),
        liveness: { score: livenessScore, isLive: true, verdict: 'REAL' },
        message: 'Xác thực eKYC thành công! Dữ liệu hình ảnh đã được hủy ngay sau khi đối chiếu.',
      };
    }

    // Xác định lý do từ chối
    const reasons: string[] = [];
    if (!isMatch || similarity < FACE_MATCH_THRESHOLD) {
      reasons.push(`Khuôn mặt không khớp (similarity=${similarity.toFixed(1)}%, yêu cầu ≥ ${FACE_MATCH_THRESHOLD}%)`);
    }
    if (!docFraudPassed) {
      reasons.push(`Phát hiện dấu hiệu thẻ không hợp lệ (fraud_score=${record.fraudScore})`);
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
      placeOfOrigin: record.placeOfOrigin,
      placeOfResidence: record.placeOfResidence,
      idDocType: record.idDocType,
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

    return { success: true, message: 'Đã reset. Vui lòng thực hiện đối chiếu lại.' };
  }

  // ================================================================
  //  5. Ảnh eKYC (Không lưu trữ theo quy định bảo vệ dữ liệu cá nhân)
  // ================================================================

  async getSignedImageUrl(_accountId: string, _field: string): Promise<never> {
    throw new GoneException(
      'EKYC_IMAGES_NOT_STORED: Hệ thống không thu giữ hoặc lưu trữ hình ảnh giấy tờ tùy thân và ảnh chân dung người dùng.',
    );
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

  // ---- AI Service Calls ----

  /**
   * Gọi AI Service OCR (EasyOCR — Vietnamese + English).
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
        signal: AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`AI Service OCR error: ${res.status} ${text}`);
        return { data: null, error: `AI Service OCR lỗi HTTP ${res.status}: ${text}` };
      }

      const json = (await res.json()) as AiOcrResponse;

      if (!json.success || !json.data) {
        return { data: null, error: 'AI Service OCR không nhận diện được ảnh. Vui lòng chụp lại rõ hơn.' };
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
        return null; // Non-blocking
      }

      const json = (await res.json()) as AiAntiFraudResponse;

      this.logger.log(
        `AI Anti-Fraud completed in ${json.processing_time_ms}ms ` +
        `(overall_passed=${json.overall_passed})`,
      );

      return json;
    } catch (err) {
      this.logger.warn(`AI Service Anti-Fraud exception (non-blocking): ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Quy trình eKYC tự động trọn gói trong RAM (Zero-Retention) cho đăng ký tài khoản mới:
   * 1. Quét OCR -> Chỉ lấy họ tên, ngày sinh, quê quán, địa chỉ thường trú (KHÔNG lấy số CCCD)
   * 2. Anti-Fraud trên ảnh giấy tờ trong RAM
   * 3. Anti-Fraud Liveness trên ảnh khuôn mặt trong RAM
   * 4. Face Matching sinh trắc học trong RAM -> Kết thúc request là giải phóng bộ nhớ, KHÔNG lưu ảnh
   */
  async verifyAndProcessRegistrationEkyc(
    frontFile: Express.Multer.File,
    selfieFile: Express.Multer.File,
  ) {
    this.ensureAiService();

    if (!frontFile || !selfieFile) {
      throw new BadRequestException('Vui lòng cung cấp đủ ảnh đối chiếu thông tin và ảnh chân dung trực tiếp.');
    }

    // 1. Quét OCR trong RAM
    const { data: ocrResult, error: ocrError } = await this.callAiOcr(frontFile.buffer);
    if (!ocrResult || !ocrResult.full_name) {
      throw new BadRequestException(
        ocrError || 'Không thể đọc được họ tên trên thẻ. Vui lòng chụp rõ nét, đủ ánh sáng và không bị lóa.',
      );
    }

    // 2. Chạy Anti-Fraud trên ảnh giấy tờ trong RAM
    const docFraud = await this.callAiAntiFraud(frontFile.buffer, null);
    const fraudScore = docFraud?.data?.document_fraud?.fraud_score ?? null;
    const fraudPassed = docFraud?.data?.document_fraud?.passed ?? true;
    if (!fraudPassed || (fraudScore !== null && fraudScore >= FRAUD_SCORE_THRESHOLD)) {
      throw new BadRequestException(
        `Phát hiện dấu hiệu ảnh không hợp lệ hoặc chụp lại từ màn hình (điểm rủi ro: ${fraudScore}). Vui lòng chụp thẻ gốc trực tiếp.`,
      );
    }

    // 3. Chạy Anti-Fraud Liveness trên Selfie trong RAM
    const selfieFraud = await this.callAiAntiFraud(null, selfieFile.buffer);
    const livenessScore = selfieFraud?.data?.selfie_liveness?.liveness_score ?? null;
    const isLive = selfieFraud?.data?.selfie_liveness?.is_live ?? true;
    if (!isLive || (livenessScore !== null && livenessScore < LIVENESS_SCORE_THRESHOLD)) {
      throw new BadRequestException(
        `Ảnh chân dung không vượt qua kiểm tra người thật (liveness=${livenessScore?.toFixed(1) ?? 'N/A'}). Vui lòng chụp ảnh người thật trực tiếp từ camera.`,
      );
    }

    // 4. So khớp khuôn mặt trong RAM (KHÔNG upload Cloudinary, KHÔNG lưu URL ảnh)
    const matchRes = await this.callAiFaceMatch(frontFile.buffer, selfieFile.buffer);
    if (!matchRes.result) {
      throw new BadRequestException(matchRes.error || 'So khớp khuôn mặt eKYC thất bại.');
    }
    const { isMatch, similarity } = matchRes.result;
    if (!isMatch || similarity < FACE_MATCH_THRESHOLD) {
      throw new BadRequestException(
        `Khuôn mặt chưa trùng khớp (độ tương đồng: ${similarity.toFixed(1)}%, yêu cầu ≥ ${FACE_MATCH_THRESHOLD}%).`,
      );
    }

    return {
      fullName: ocrResult.full_name,
      dateOfBirth: ocrResult.date_of_birth,
      gender: ocrResult.gender,
      nationality: ocrResult.nationality || 'Việt Nam',
      placeOfOrigin: ocrResult.place_of_origin,
      placeOfResidence: ocrResult.place_of_residence,
      idDocType: ocrResult.id_doc_type || 'CCCD',
      similarity,
      fraudScore,
      livenessScore,
      antifraudDetails: {
        docFraud: docFraud?.data,
        selfieFraud: selfieFraud?.data,
      },
    };
  }

  /**
   * Đồng bộ các trường thông tin được phép (họ tên, ngày sinh, quê quán, địa chỉ thường trú)
   * sang CustomerProfile + Account. Tuyệt đối KHÔNG lưu ảnh hay số CCCD.
   */
  private async syncToCustomerProfile(accountId: string, record: EkycRecord) {
    let profile = await this.customerProfileRepo.findOne({ where: { accountId } });
    const note =
      'eKYC tự động xác thực tức thời qua AI (không lưu trữ hình ảnh và số CCCD)';

    if (!profile) {
      profile = await this.customerProfileRepo.save(
        this.customerProfileRepo.create({
          accountId,
          verificationStatus: 'APPROVED',
          verificationNote: note,
          dateOfBirth: record.dateOfBirth,
          placeOfOrigin: record.placeOfOrigin,
          address: record.placeOfResidence,
        }),
      );
    } else {
      const updateData: Partial<CustomerProfile> = {
        verificationStatus: 'APPROVED',
        verificationNote: note,
      };
      if (record.dateOfBirth) updateData.dateOfBirth = record.dateOfBirth;
      if (record.placeOfOrigin) updateData.placeOfOrigin = record.placeOfOrigin;
      if (record.placeOfResidence) updateData.address = record.placeOfResidence;

      await this.customerProfileRepo.update(profile.id, updateData);
    }

    const accountPatch: Partial<Account> = { status: 'ACTIVE' };
    if (record.fullNameExtracted) {
      accountPatch.fullName = record.fullNameExtracted;
    }
    await this.accountRepo.update(accountId, accountPatch);
  }
}
