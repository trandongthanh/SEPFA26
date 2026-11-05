import { Injectable } from '@nestjs/common';

/** Hệ số bồi thường: 120% giá trị định giá cây. */
export const COMPENSATION_RATE = 1.2;
export const COMPENSATION_PERCENT = '120%';

/* ------------------------------------------------------------------ */
/*  Interfaces                                                        */
/* ------------------------------------------------------------------ */

export interface ContractParty {
  fullName: string;
  address: string;
  phone: string;
  identityNumber: string;
  identityDocuments: string[];
}

export interface ContractPlant {
  index: number;
  name: string;
  speciesName: string | null;
  declaredValue: string | null;
  isValueDeclared: boolean;
  /** 120% × declaredValue — null nếu chưa khai giá. */
  compensationAmount: string | null;
  initialPhotos: string[];
}

export interface ContractPricing {
  basePricePerPlant: string;
  plantCount: number;
  provisionalTotal: string;
  pickupFee: string;
  grandTotal: string;
}

export interface ContractSignature {
  role: 'CUSTOMER' | 'PROVIDER';
  fullName: string;
  signedAt: string | null;
  signatureHash: string | null;
  ipAddress: string | null;
}

export interface ContractCompensationPolicy {
  rate: number;
  ratePercent: string;
  careConditions: string[];
  transportConditions: string[];
}

export interface ContractData {
  agreementNo: string;
  title: string;
  createdAt: string;
  status: 'PENDING' | 'SIGNED' | 'CANCELLED';
  handoverConfirmationStatement: string;
  parties: {
    customer: ContractParty;
    provider: ContractParty;
  };
  orderSummary: {
    orderCode: string;
    servicePackageName: string;
    durationDays: number;
    reportFrequencyDays: number;
    scheduledPickupAt: string;
    pickupAddress: string | null;
  };
  plants: ContractPlant[];
  pricing: ContractPricing;
  clauses: string[];
  compensationPolicy: ContractCompensationPolicy;
  signatures: ContractSignature[];
  contractHtml: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

@Injectable()
export class ContractTemplateService {
  /* ========================= ĐIỀU KHOẢN ========================== */

  /**
   * 9 điều khoản hợp đồng chăm sóc cây — bao gồm bồi thường 120%.
   * Được snapshot vào `termsSnapshot.clauses` khi provider ACCEPT đơn.
   */
  generateClauses(): string[] {
    return [
      'Điều 1 – Phạm vi dịch vụ: '
        + 'Bên B (Nhà vườn) cam kết thực hiện dịch vụ chăm sóc cây xanh theo đúng gói dịch vụ đã chọn, '
        + 'bao gồm tưới nước, bón phân, phòng trừ sâu bệnh và các hoạt động chăm sóc chuyên biệt phù hợp với từng loài cây.',

      'Điều 2 – Xác nhận tiếp nhận cây tại địa điểm bàn giao: '
        + 'Bên B (Nhà vườn) xác nhận cây do Bên A (Khách hàng) giao nhận tại địa chỉ đã hẹn đúng với thực tế hình ảnh chụp ban đầu '
        + 'và video call khảo sát trước đó — bao gồm tên cây, loài cây, số lượng và hiện trạng tại thời điểm bàn giao.',

      'Điều 3 – Trách nhiệm trong quá trình vận chuyển: '
        + 'Trong quá trình vận chuyển cây (từ địa chỉ nhận về vườn và khi bàn giao trả cây), nếu xảy ra tình trạng cây bị thất lạc '
        + `hoặc hư hỏng dẫn đến hậu quả nghiêm trọng, Bên B sẽ chịu bồi thường bằng ${COMPENSATION_PERCENT} giá trị định giá cây.`,

      'Điều 4 – Trách nhiệm trong quá trình chăm sóc: '
        + 'Trong suốt thời gian chăm sóc tại nhà vườn, nếu xảy ra bất kỳ tình trạng nào sau đây: '
        + '(a) Cây suy yếu hơn so với thời điểm tiếp nhận bàn giao; '
        + '(b) Cây chết; '
        + '(c) Cây bị thất lạc '
        + `— Bên B sẽ chịu trách nhiệm bồi thường cho Bên A với mức bằng ${COMPENSATION_PERCENT} giá trị định giá cây `
        + 'đã được hai bên thống nhất tại thời điểm ký hợp đồng.',

      'Điều 5 – Cam kết của Bên A: '
        + 'Bên A cam kết cây, chủng loại, số lượng, giá trị khai báo, ảnh ban đầu và tình trạng thực tế '
        + 'khi bàn giao là trung thực và chính xác. Nếu thông tin không đúng sự thật, Bên A chịu mọi trách nhiệm phát sinh.',

      'Điều 6 – Quyền từ chối nhận cây: '
        + 'Nếu cây hoặc tình trạng thực tế khác biệt đáng kể so với ảnh ban đầu hoặc nội dung đã trao đổi qua video call, '
        + 'Bên B có quyền từ chối nhận cây và hủy đơn. Phí dịch vụ đã thanh toán sẽ được hoàn lại cho Bên A; '
        + 'phí vận chuyển do Bên A chịu.',

      'Điều 7 – Báo cáo định kỳ: '
        + 'Bên B có nghĩa vụ gửi báo cáo tình trạng cây định kỳ theo tần suất ghi trong gói dịch vụ, '
        + 'kèm hình ảnh minh chứng qua hệ thống LanCare Hub.',

      'Điều 8 – Giải quyết tranh chấp: '
        + 'Hai bên ưu tiên trao đổi và cung cấp bằng chứng (ảnh ban đầu, video call, biên bản bàn giao) qua hệ thống LanCare Hub. '
        + 'Mọi tranh chấp được xử lý theo quy trình tranh chấp của nền tảng. '
        + 'Nếu không giải quyết được, hai bên có quyền khiếu nại lên Ban quản trị hoặc cơ quan có thẩm quyền.',

      'Điều 9 – Hiệu lực hợp đồng: '
        + 'Hợp đồng có hiệu lực kể từ khi cả hai bên ký xác nhận giao nhận cây trên hệ thống (chữ ký điện tử) '
        + 'và có giá trị trong suốt thời gian thực hiện dịch vụ chăm sóc theo gói đã chọn.',
    ];
  }

  /* ===================== CHÍNH SÁCH BỒI THƯỜNG =================== */

  generateCompensationPolicy(): ContractCompensationPolicy {
    return {
      rate: COMPENSATION_RATE,
      ratePercent: COMPENSATION_PERCENT,
      careConditions: [
        'Cây suy yếu hơn so với thời điểm tiếp nhận bàn giao',
        'Cây chết trong quá trình chăm sóc',
        'Cây bị thất lạc trong quá trình chăm sóc hoặc lưu giữ',
      ],
      transportConditions: [
        'Cây bị thất lạc trong quá trình vận chuyển',
        'Cây bị hư hỏng nghiêm trọng trong quá trình vận chuyển',
      ],
    };
  }

  /* ====================== TÍNH TIỀN BỒI THƯỜNG =================== */

  /**
   * Tính số tiền bồi thường 120% cho từng cây.
   * Nếu cây chưa khai giá trị → trả null (dùng giá gói mặc định).
   */
  calculateCompensation(declaredValue: string | null): string | null {
    if (!declaredValue) return null;
    const value = BigInt(declaredValue);
    // 120% = value × 12 / 10 — tính bằng BigInt để tránh mất chính xác.
    const compensation = (value * 12n) / 10n;
    return compensation.toString();
  }

  /* =================== BUILD CONTRACT DATA ======================== */

  /**
   * Build toàn bộ dữ liệu hợp đồng điện tử — dùng bởi endpoint
   * `GET /orders/:id/agreement/contract`.
   */
  buildContractData(params: {
    agreement: {
      agreementNo: string;
      status: 'PENDING' | 'SIGNED' | 'CANCELLED';
      termsSnapshot: Record<string, unknown>;
      createdAt: Date;
    };
    order: {
      orderCode: string;
      basePriceSnapshot: string;
      pickupFeeSnapshot: string;
      plantCount: number;
      provisionalTotal: string;
      durationDaysSnapshot: number;
      reportFrequencySnapshot: number;
      scheduledPickupAt: Date;
      pickupAddress: string | null;
    };
    plants: Array<{
      name: string;
      speciesName: string | null;
      declaredValue: string | null;
      isValueDeclared: boolean;
      initialPhotos?: string[];
    }>;
    servicePackageName: string;
    customerParty: ContractParty;
    providerParty: ContractParty;
    signatures: Array<{
      signerRole: 'CUSTOMER' | 'PROVIDER';
      signedAt: Date;
      signatureHash: string;
      ipAddress: string | null;
    }>;
  }): ContractData {
    const { agreement, order, plants, servicePackageName, customerParty, providerParty, signatures } = params;

    const contractPlants: ContractPlant[] = plants.map((p, i) => ({
      index: i + 1,
      name: p.name,
      speciesName: p.speciesName,
      declaredValue: p.declaredValue,
      isValueDeclared: p.isValueDeclared,
      compensationAmount: this.calculateCompensation(p.declaredValue),
      initialPhotos: p.initialPhotos ?? [],
    }));

    const grandTotal = (
      BigInt(order.provisionalTotal) + BigInt(order.pickupFeeSnapshot)
    ).toString();

    const clauses = (agreement.termsSnapshot.clauses as string[] | undefined)
      ?? this.generateClauses();

    const contractSignatures: ContractSignature[] = [
      {
        role: 'CUSTOMER',
        fullName: customerParty.fullName,
        signedAt: signatures.find(s => s.signerRole === 'CUSTOMER')?.signedAt?.toISOString() ?? null,
        signatureHash: signatures.find(s => s.signerRole === 'CUSTOMER')?.signatureHash ?? null,
        ipAddress: signatures.find(s => s.signerRole === 'CUSTOMER')?.ipAddress ?? null,
      },
      {
        role: 'PROVIDER',
        fullName: providerParty.fullName,
        signedAt: signatures.find(s => s.signerRole === 'PROVIDER')?.signedAt?.toISOString() ?? null,
        signatureHash: signatures.find(s => s.signerRole === 'PROVIDER')?.signatureHash ?? null,
        ipAddress: signatures.find(s => s.signerRole === 'PROVIDER')?.ipAddress ?? null,
      },
    ];

    const handoverConfirmationStatement =
      `Tôi, ${providerParty.fullName} (Đại diện Nhà vườn), xác nhận cây do người dùng ${customerParty.fullName} (Khách hàng) giao nhận tại địa chỉ bàn giao đúng với thực tế hình ảnh (đã chụp thẩm định) và video call (đã khảo sát trực tiếp) cung cấp — bao gồm tên cây, loài cây, số lượng và hiện trạng tại thời điểm tiếp nhận.`;

    const data: ContractData = {
      agreementNo: agreement.agreementNo,
      title: 'HỢP ĐỒNG DỊCH VỤ CHĂM SÓC CÂY XANH',
      createdAt: agreement.createdAt.toISOString(),
      status: agreement.status,
      handoverConfirmationStatement,
      parties: {
        customer: customerParty,
        provider: providerParty,
      },
      orderSummary: {
        orderCode: order.orderCode,
        servicePackageName,
        durationDays: order.durationDaysSnapshot,
        reportFrequencyDays: order.reportFrequencySnapshot,
        scheduledPickupAt: order.scheduledPickupAt.toISOString(),
        pickupAddress: order.pickupAddress,
      },
      plants: contractPlants,
      pricing: {
        basePricePerPlant: order.basePriceSnapshot,
        plantCount: order.plantCount,
        provisionalTotal: order.provisionalTotal,
        pickupFee: order.pickupFeeSnapshot,
        grandTotal,
      },
      clauses,
      compensationPolicy: this.generateCompensationPolicy(),
      signatures: contractSignatures,
      contractHtml: '', // placeholder — gán bên dưới
    };

    data.contractHtml = this.generateHtml(data);
    return data;
  }

  /* =================== GENERATE HTML ============================== */

  /**
   * Sinh HTML hợp đồng điện tử — dùng để hiển thị trên FE/Mobile
   * hoặc in ra PDF. Styling inline để không phụ thuộc CSS ngoài.
   */
  generateHtml(data: ContractData): string {
    const fmtMoney = (val: string) => {
      const num = BigInt(val);
      return num.toLocaleString?.('vi-VN') ?? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    };

    const plantRows = data.plants
      .map(
        (p) => `
          <tr>
            <td style="${TD}">${p.index}</td>
            <td style="${TD}">
              <strong>${esc(p.name)}</strong>
              ${p.initialPhotos && p.initialPhotos.length > 0 ? `<div style="margin-top:4px;"><a href="${esc(p.initialPhotos[0])}" target="_blank" style="color:#6025D2;font-size:12px;text-decoration:none;">📷 Xem ảnh chụp ban đầu (${p.initialPhotos.length} ảnh)</a></div>` : ''}
            </td>
            <td style="${TD}">${p.speciesName ? esc(p.speciesName) : '<em>Chưa xác định</em>'}</td>
            <td style="${TD} text-align:right;">${p.declaredValue ? fmtMoney(p.declaredValue) + ' ₫' : 'Chưa khai báo'}</td>
            <td style="${TD} text-align:right; color:#c0392b; font-weight:600;">${p.compensationAmount ? fmtMoney(p.compensationAmount) + ' ₫' : '—'}</td>
          </tr>`,
      )
      .join('');

    const clauseItems = data.clauses
      .map((c) => `<li style="margin-bottom:8px;line-height:1.6;">${esc(c)}</li>`)
      .join('');

    const sigCustomer = data.signatures.find(s => s.role === 'CUSTOMER');
    const sigProvider = data.signatures.find(s => s.role === 'PROVIDER');

    const fmtDate = (iso: string | null) => {
      if (!iso) return '<em style="color:#999;">Chưa ký</em>';
      const d = new Date(iso);
      return `${d.toLocaleDateString('vi-VN')} ${d.toLocaleTimeString('vi-VN')}`;
    };

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(data.title)} — ${esc(data.agreementNo)}</title>
  <style>
    @media print { body { margin: 0; } }
    * { box-sizing: border-box; }
  </style>
</head>
<body style="font-family:'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;max-width:800px;margin:0 auto;padding:32px 24px;color:#222;line-height:1.7;font-size:14px;">

  <!-- HEADER -->
  <div style="text-align:center;border-bottom:3px double #6025D2;padding-bottom:16px;margin-bottom:24px;">
    <h3 style="margin:0;color:#6025D2;font-size:13px;letter-spacing:1px;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h3>
    <p style="margin:4px 0 16px;font-size:13px;">Độc lập — Tự do — Hạnh phúc</p>
    <h1 style="margin:0;font-size:22px;color:#2c3e50;">${esc(data.title)}</h1>
    <p style="margin:8px 0 0;font-size:14px;color:#555;">Số hợp đồng: <strong>${esc(data.agreementNo)}</strong></p>
    <p style="margin:4px 0 0;font-size:13px;color:#777;">Mã đơn hàng: ${esc(data.orderSummary.orderCode)}</p>
  </div>

  <!-- THÔNG TIN CÁC BÊN -->
  <h2 style="${H2}">I. THÔNG TIN CÁC BÊN</h2>

  <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px;">
    <!-- Bên A -->
    <div style="flex:1;min-width:280px;background:#f8f6ff;border-radius:8px;padding:16px;border-left:4px solid #6025D2;">
      <h3 style="margin:0 0 8px;color:#6025D2;font-size:15px;">BÊN A — KHÁCH HÀNG</h3>
      <p style="${P}"><strong>Họ và tên:</strong> ${esc(data.parties.customer.fullName)}</p>
      <p style="${P}"><strong>Địa chỉ:</strong> ${esc(data.parties.customer.address)}</p>
      <p style="${P}"><strong>Số điện thoại:</strong> ${esc(data.parties.customer.phone)}</p>
      <p style="${P}"><strong>Số CCCD/CMND:</strong> ${esc(data.parties.customer.identityNumber)}</p>
    </div>

    <!-- Bên B -->
    <div style="flex:1;min-width:280px;background:#f0faf0;border-radius:8px;padding:16px;border-left:4px solid #27ae60;">
      <h3 style="margin:0 0 8px;color:#27ae60;font-size:15px;">BÊN B — NHÀ VƯỜN</h3>
      <p style="${P}"><strong>Họ và tên:</strong> ${esc(data.parties.provider.fullName)}</p>
      <p style="${P}"><strong>Địa chỉ:</strong> ${esc(data.parties.provider.address)}</p>
      <p style="${P}"><strong>Số điện thoại:</strong> ${esc(data.parties.provider.phone)}</p>
      <p style="${P}"><strong>Số CCCD/CMND:</strong> ${esc(data.parties.provider.identityNumber)}</p>
    </div>
  </div>

  <!-- THÔNG TIN DỊCH VỤ -->
  <h2 style="${H2}">II. THÔNG TIN DỊCH VỤ</h2>
  <table style="${TABLE}">
    <tr><td style="${TH}">Gói dịch vụ</td><td style="${TD}">${esc(data.orderSummary.servicePackageName)}</td></tr>
    <tr><td style="${TH}">Thời gian chăm sóc</td><td style="${TD}">${data.orderSummary.durationDays} ngày</td></tr>
    <tr><td style="${TH}">Tần suất báo cáo</td><td style="${TD}">Mỗi ${data.orderSummary.reportFrequencyDays} ngày</td></tr>
    <tr><td style="${TH}">Ngày hẹn lấy cây</td><td style="${TD}">${fmtDate(data.orderSummary.scheduledPickupAt)}</td></tr>
    <tr><td style="${TH}">Địa chỉ lấy cây</td><td style="${TD}">${data.orderSummary.pickupAddress ? esc(data.orderSummary.pickupAddress) : '<em>Chưa cung cấp</em>'}</td></tr>
  </table>

  <!-- CAM KẾT XÁC NHẬN GIAO NHẬN THỰC ĐỊA -->
  <div style="background:#eef6ff;border-left:4px solid #3498db;border-radius:8px;padding:16px;margin:24px 0 16px;">
    <h3 style="margin:0 0 6px;color:#2980b9;font-size:14px;letter-spacing:0.5px;">XÁC NHẬN TIẾP NHẬN CÂY TẠI ĐỊA ĐIỂM BÀN GIAO</h3>
    <p style="margin:0;font-size:14px;line-height:1.6;font-style:italic;color:#2c3e50;">
      &ldquo;${esc(data.handoverConfirmationStatement)}&rdquo;
    </p>
  </div>

  <!-- DANH SÁCH CÂY -->
  <h2 style="${H2}">III. DANH SÁCH CÂY GIAO NHẬN</h2>
  <table style="${TABLE}">
    <thead>
      <tr style="background:#6025D2;color:#fff;">
        <th style="${TH_HEAD}">STT</th>
        <th style="${TH_HEAD}">Tên cây</th>
        <th style="${TH_HEAD}">Loài</th>
        <th style="${TH_HEAD} text-align:right;">Giá trị khai báo</th>
        <th style="${TH_HEAD} text-align:right;">Mức đền bù (${data.compensationPolicy.ratePercent})</th>
      </tr>
    </thead>
    <tbody>
      ${plantRows}
    </tbody>
  </table>

  <!-- CHI PHÍ -->
  <h2 style="${H2}">IV. CHI PHÍ DỊCH VỤ</h2>
  <table style="${TABLE}">
    <tr><td style="${TH}">Giá gói / cây</td><td style="${TD} text-align:right;">${fmtMoney(data.pricing.basePricePerPlant)} ₫</td></tr>
    <tr><td style="${TH}">Số lượng cây</td><td style="${TD} text-align:right;">${data.pricing.plantCount}</td></tr>
    <tr><td style="${TH}">Phí dịch vụ tạm tính</td><td style="${TD} text-align:right;">${fmtMoney(data.pricing.provisionalTotal)} ₫</td></tr>
    <tr><td style="${TH}">Phí vận chuyển</td><td style="${TD} text-align:right;">${fmtMoney(data.pricing.pickupFee)} ₫</td></tr>
    <tr style="background:#fef9e7;"><td style="${TH} font-weight:700;">TỔNG CỘNG</td><td style="${TD} text-align:right;font-weight:700;color:#c0392b;font-size:16px;">${fmtMoney(data.pricing.grandTotal)} ₫</td></tr>
  </table>

  <!-- CHÍNH SÁCH BỒI THƯỜNG -->
  <h2 style="${H2}">V. CHÍNH SÁCH BỒI THƯỜNG</h2>
  <div style="background:#fdf2f2;border-left:4px solid #e74c3c;border-radius:8px;padding:16px;margin-bottom:20px;">
    <p style="margin:0 0 8px;font-weight:700;color:#c0392b;">⚠️ Mức bồi thường: ${data.compensationPolicy.ratePercent} giá trị định giá cây</p>
    <p style="margin:0 0 8px;font-weight:600;">Áp dụng khi xảy ra trong quá trình chăm sóc:</p>
    <ul style="margin:0 0 12px;padding-left:20px;">
      ${data.compensationPolicy.careConditions.map(c => `<li style="margin-bottom:4px;">${esc(c)}</li>`).join('')}
    </ul>
    <p style="margin:0 0 8px;font-weight:600;">Áp dụng khi xảy ra trong quá trình vận chuyển:</p>
    <ul style="margin:0;padding-left:20px;">
      ${data.compensationPolicy.transportConditions.map(c => `<li style="margin-bottom:4px;">${esc(c)}</li>`).join('')}
    </ul>
  </div>

  <!-- ĐIỀU KHOẢN HỢP ĐỒNG -->
  <h2 style="${H2}">VI. ĐIỀU KHOẢN HỢP ĐỒNG</h2>
  <ol style="padding-left:20px;margin:0 0 20px;">
    ${clauseItems}
  </ol>

  <!-- CHỮ KÝ ĐIỆN TỬ -->
  <h2 style="${H2}">VII. CHỮ KÝ ĐIỆN TỬ</h2>
  <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px;">
    <!-- Chữ ký Bên A -->
    <div style="flex:1;min-width:280px;border:2px solid ${sigCustomer?.signedAt ? '#27ae60' : '#bdc3c7'};border-radius:8px;padding:16px;text-align:center;">
      <p style="margin:0 0 4px;font-weight:700;color:#6025D2;">BÊN A — KHÁCH HÀNG</p>
      <p style="margin:0 0 8px;font-size:15px;">${esc(sigCustomer?.fullName ?? '_______________')}</p>
      ${sigCustomer?.signedAt
        ? `<p style="margin:0;color:#27ae60;font-weight:600;">✅ Đã ký: ${fmtDate(sigCustomer.signedAt)}</p>
           <p style="margin:4px 0 0;font-size:11px;color:#999;word-break:break-all;">Hash: ${sigCustomer.signatureHash ?? ''}</p>`
        : '<p style="margin:0;color:#e74c3c;">⏳ Chưa ký</p>'}
    </div>

    <!-- Chữ ký Bên B -->
    <div style="flex:1;min-width:280px;border:2px solid ${sigProvider?.signedAt ? '#27ae60' : '#bdc3c7'};border-radius:8px;padding:16px;text-align:center;">
      <p style="margin:0 0 4px;font-weight:700;color:#27ae60;">BÊN B — NHÀ VƯỜN</p>
      <p style="margin:0 0 8px;font-size:15px;">${esc(sigProvider?.fullName ?? '_______________')}</p>
      ${sigProvider?.signedAt
        ? `<p style="margin:0;color:#27ae60;font-weight:600;">✅ Đã ký: ${fmtDate(sigProvider.signedAt)}</p>
           <p style="margin:4px 0 0;font-size:11px;color:#999;word-break:break-all;">Hash: ${sigProvider.signatureHash ?? ''}</p>`
        : '<p style="margin:0;color:#e74c3c;">⏳ Chưa ký</p>'}
    </div>
  </div>

  <!-- FOOTER -->
  <div style="text-align:center;border-top:1px solid #ddd;padding-top:16px;margin-top:32px;">
    <p style="margin:0;font-size:12px;color:#999;">Hợp đồng điện tử được tạo và quản lý bởi nền tảng <strong>LanCare Hub</strong></p>
    <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Trạng thái: ${data.status === 'SIGNED' ? '✅ ĐÃ KÝ' : data.status === 'PENDING' ? '⏳ CHỜ KÝ' : '❌ ĐÃ HỦY'} | Ngày tạo: ${fmtDate(data.createdAt)}</p>
  </div>

</body>
</html>`;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Style constants — inline CSS cho HTML hợp đồng. */
const H2 = 'font-size:16px;color:#2c3e50;border-bottom:2px solid #eee;padding-bottom:6px;margin:24px 0 12px;';
const P = 'margin:4px 0;font-size:14px;';
const TABLE = 'width:100%;border-collapse:collapse;margin-bottom:20px;';
const TH = 'border:1px solid #ddd;padding:8px 12px;background:#f9f9f9;text-align:left;font-size:13px;';
const TH_HEAD = 'padding:10px 12px;text-align:left;font-size:13px;';
const TD = 'border:1px solid #ddd;padding:8px 12px;font-size:13px;';

/** Escape HTML entities. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
