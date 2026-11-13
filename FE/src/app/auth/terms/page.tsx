'use client';

import { useRouter } from 'next/navigation';
import {
  CameraOutlined,
  WarningOutlined,
  CreditCardOutlined,
  AuditOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import LegalDocumentLayout, { DocumentSection } from '@/features/auth/components/LegalDocumentLayout';
import { useAgreementStore } from '@/stores/agreement.store';

const termsSections: DocumentSection[] = [
  {
    id: 'section-1',
    title: '1. Vai trò của Nền tảng (Marketplace)',
    icon: <SafetyCertificateOutlined className="text-[#6027D2]" />,
    rawText:
      'LanCare Hub hoạt động như một nền tảng kết nối (marketplace) giữa người sở hữu hoa lan (Khách hàng) và các chuyên gia/nhà vườn chăm sóc lan (Nhà cung cấp dịch vụ). Chúng tôi cung cấp hạ tầng công nghệ để tạo điều kiện thuận lợi cho việc đặt lịch, thanh toán và theo dõi quá trình chăm sóc. Chúng tôi không trực tiếp cung cấp dịch vụ chăm sóc cây trồng và không phải là một bên trong hợp đồng dịch vụ giữa Khách hàng và Nhà cung cấp, trừ khi được nêu rõ khác đi.',
    content: (
      <>
        <p>
          LanCare Hub hoạt động như một nền tảng kết nối (marketplace) giữa người sở hữu hoa lan
          (Khách hàng) và các chuyên gia/nhà vườn chăm sóc lan (Nhà cung cấp dịch vụ). Chúng tôi cung
          cấp hạ tầng công nghệ để tạo điều kiện thuận lợi cho việc đặt lịch, thanh toán và theo dõi
          quá trình chăm sóc.
        </p>
        <p>
          Chúng tôi không trực tiếp cung cấp dịch vụ chăm sóc cây trồng và không phải là một bên trong
          hợp đồng dịch vụ giữa Khách hàng và Nhà cung cấp, trừ khi được nêu rõ khác đi.
        </p>
      </>
    ),
  },
  {
    id: 'section-2',
    title: '2. Trách nhiệm của Khách hàng',
    rawText:
      'Cung cấp thông tin chính xác, đầy đủ về tình trạng hiện tại của cây lan trước khi bàn giao. Đảm bảo quyền sở hữu hợp pháp đối với cây lan được gửi chăm sóc. Thanh toán đầy đủ và đúng hạn các khoản phí dịch vụ theo quy định. Phối hợp kịp thời với Nhà vườn khi có yêu cầu xác nhận các quyết định chăm sóc quan trọng.',
    content: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Cung cấp thông tin chính xác, đầy đủ về tình trạng hiện tại của cây lan trước khi bàn giao.</li>
        <li>Đảm bảo quyền sở hữu hợp pháp đối với cây lan được gửi chăm sóc.</li>
        <li>Thanh toán đầy đủ và đúng hạn các khoản phí dịch vụ theo quy định.</li>
        <li>Phối hợp kịp thời với Nhà vườn khi có yêu cầu xác nhận các quyết định chăm sóc quan trọng.</li>
      </ul>
    ),
  },
  {
    id: 'section-3',
    title: '3. Trách nhiệm của Nhà vườn (Provider)',
    rawText:
      'Cung cấp dịch vụ chăm sóc với chất lượng tốt nhất, đúng theo tiêu chuẩn đã cam kết trên nền tảng. Bảo quản tài sản (cây lan) của khách hàng cẩn thận trong suốt quá trình chăm sóc. Cập nhật báo cáo tình trạng thường xuyên và trung thực qua hệ thống của LanCare Hub. Bảo mật thông tin của khách hàng theo quy định của pháp luật.',
    content: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>Cung cấp dịch vụ chăm sóc với chất lượng tốt nhất, đúng theo tiêu chuẩn đã cam kết trên nền tảng.</li>
        <li>Bảo quản tài sản (cây lan) của khách hàng cẩn thận trong suốt quá trình chăm sóc.</li>
        <li>Cập nhật báo cáo tình trạng thường xuyên và trung thực qua hệ thống của LanCare Hub.</li>
        <li>Bảo mật thông tin của khách hàng theo quy định của pháp luật.</li>
      </ul>
    ),
  },
  {
    id: 'section-4',
    title: '4. Yêu cầu bắt buộc về Hình ảnh',
    icon: <CameraOutlined className="text-emerald-600" />,
    rawText:
      'Để đảm bảo tính minh bạch và làm căn cứ giải quyết tranh chấp (nếu có), cả hai bên BẮT BUỘC phải chụp và tải lên hình ảnh tình trạng cây: Quy chuẩn hình ảnh hợp lệ: Chụp rõ toàn bộ cây, bao gồm cả chậu và giá thể. Chụp cận cảnh (macro) các dấu hiệu bất thường (đốm lá, rễ hỏng, nấm bệnh) nếu có. Hình ảnh phải có metadata ghi nhận thời gian thực (hệ thống sẽ tự động trích xuất). Độ phân giải tối thiểu 1080p, ánh sáng rõ ràng.',
    content: (
      <div className="space-y-3">
        <p>
          Để đảm bảo tính minh bạch và làm căn cứ giải quyết tranh chấp (nếu có), cả hai bên{' '}
          <strong className="text-[#1E1B2E]">BẮT BUỘC</strong> phải chụp và tải lên hình ảnh tình
          trạng cây:
        </p>
        <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA]">
          <h4 className="text-[13px] font-bold text-[#1E1B2E] mb-2">Quy chuẩn hình ảnh hợp lệ:</h4>
          <ul className="list-disc pl-5 space-y-1 text-[#4A4660]">
            <li>Chụp rõ toàn bộ cây, bao gồm cả chậu và giá thể.</li>
            <li>Chụp cận cảnh (macro) các dấu hiệu bất thường (đốm lá, rễ hỏng, nấm bệnh) nếu có.</li>
            <li>Hình ảnh phải có metadata ghi nhận thời gian thực (hệ thống sẽ tự động trích xuất).</li>
            <li>Độ phân giải tối thiểu 1080p, ánh sáng rõ ràng.</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 'section-5',
    title: '5. Quy trình Check-in / Check-out',
    rawText:
      'Check-in (Bàn giao): Quá trình dịch vụ chỉ chính thức bắt đầu khi Nhà vườn xác nhận đã nhận cây và hoàn tất tải lên hình ảnh Check-in trên ứng dụng. Khách hàng có 24h để khiếu nại về báo cáo Check-in của nhà vườn. Check-out (Hoàn trả): Dịch vụ kết thúc khi Nhà vườn thực hiện Check-out trên hệ thống kèm hình ảnh minh chứng, và Khách hàng xác nhận đã nhận lại cây an toàn.',
    content: (
      <div className="space-y-2">
        <p>
          <strong className="text-[#1E1B2E]">Check-in (Bàn giao):</strong> Quá trình dịch vụ chỉ
          chính thức bắt đầu khi Nhà vườn xác nhận đã nhận cây và hoàn tất tải lên hình ảnh Check-in
          trên ứng dụng. Khách hàng có 24h để khiếu nại về báo cáo Check-in của nhà vườn.
        </p>
        <p>
          <strong className="text-[#1E1B2E]">Check-out (Hoàn trả):</strong> Dịch vụ kết thúc khi Nhà
          vườn thực hiện Check-out trên hệ thống kèm hình ảnh minh chứng, và Khách hàng xác nhận đã nhận
          lại cây an toàn.
        </p>
      </div>
    ),
  },
  {
    id: 'section-6',
    title: '6. Gắn cờ "Rủi ro cao" (High Risk Flag)',
    icon: <WarningOutlined className="text-amber-500" />,
    rawText:
      'Nhà vườn có quyền gắn cờ "Rủi ro cao" trong bước Check-in nếu phát hiện cây lan đang trong tình trạng nguy kịch (bệnh lý nặng, thối nhũn lan rộng, rễ hỏng hoàn toàn). Khi cờ này được kích hoạt, Khách hàng phải xác nhận đồng ý miễn trừ một phần hoặc toàn bộ trách nhiệm bồi thường cho Nhà vườn nếu cây không thể phục hồi, trước khi dịch vụ bắt đầu.',
    content: (
      <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200/80 text-amber-900">
        <p>
          Nhà vườn có quyền gắn cờ &ldquo;Rủi ro cao&rdquo; trong bước Check-in nếu phát hiện cây lan
          đang trong tình trạng nguy kịch (bệnh lý nặng, thối nhũn lan rộng, rễ hỏng hoàn toàn). Khi cờ
          này được kích hoạt, Khách hàng phải xác nhận đồng ý miễn trừ một phần hoặc toàn bộ trách nhiệm
          bồi thường cho Nhà vườn nếu cây không thể phục hồi, trước khi dịch vụ bắt đầu.
        </p>
      </div>
    ),
  },
  {
    id: 'section-7',
    title: '7. Báo cáo chăm sóc',
    rawText:
      'Nhà vườn có trách nhiệm cập nhật nhật ký chăm sóc định kỳ (tưới nước, bón phân, phòng trừ sâu bệnh) kèm hình ảnh thực tế theo gói dịch vụ mà khách hàng đã đăng ký.',
    content: (
      <p>
        Nhà vườn có trách nhiệm cập nhật nhật ký chăm sóc định kỳ (tưới nước, bón phân, phòng trừ sâu
        bệnh) kèm hình ảnh thực tế theo gói dịch vụ mà khách hàng đã đăng ký.
      </p>
    ),
  },
  {
    id: 'section-8',
    title: '8. Dịch vụ phát sinh (Add-ons)',
    rawText:
      'Mọi dịch vụ phát sinh ngoài gói ban đầu (thay chậu, xử lý thuốc đặc trị, giá thể mới) phải được tạo yêu cầu trên hệ thống và được Khách hàng phê duyệt trước khi thực hiện.',
    content: (
      <p>
        Mọi dịch vụ phát sinh ngoài gói ban đầu (thay chậu, xử lý thuốc đặc trị, giá thể mới) phải
        được tạo yêu cầu trên hệ thống và được Khách hàng phê duyệt trước khi thực hiện.
      </p>
    ),
  },
  {
    id: 'section-9',
    title: '9. Thanh toán & Cổng VNPay',
    icon: <CreditCardOutlined className="text-[#6027D2]" />,
    rawText:
      'Mọi giao dịch trên LanCare Hub được xử lý bảo mật thông qua cổng thanh toán VNPay. Khách hàng thanh toán trước 100% giá trị hợp đồng dịch vụ. Số tiền này sẽ được LanCare Hub giữ (Tạm giữ/Escrow) và chỉ giải ngân cho Nhà vườn sau khi dịch vụ hoàn tất thành công (Check-out).',
    content: (
      <p>
        Mọi giao dịch trên LanCare Hub được xử lý bảo mật thông qua cổng thanh toán VNPay. Khách hàng
        thanh toán trước 100% giá trị hợp đồng dịch vụ. Số tiền này sẽ được LanCare Hub giữ (Tạm
        giữ/Escrow) và chỉ giải ngân cho Nhà vườn sau khi dịch vụ hoàn tất thành công (Check-out).
      </p>
    ),
  },
  {
    id: 'section-10',
    title: '10. Phí nền tảng (Platform Fee)',
    rawText:
      'LanCare Hub thu phí nền tảng cố định là 18% trên tổng giá trị mỗi giao dịch thành công. Khoản phí này được khấu trừ trực tiếp từ khoản thanh toán chuyển cho Nhà vườn. Phí này bao gồm phí duy trì hệ thống, dịch vụ khách hàng, xử lý thanh toán và hỗ trợ giải quyết tranh chấp.',
    content: (
      <p>
        LanCare Hub thu phí nền tảng cố định là <strong className="text-[#1E1B2E]">18%</strong> trên
        tổng giá trị mỗi giao dịch thành công. Khoản phí này được khấu trừ trực tiếp từ khoản thanh
        toán chuyển cho Nhà vườn. Phí này bao gồm phí duy trì hệ thống, dịch vụ khách hàng, xử lý
        thanh toán và hỗ trợ giải quyết tranh chấp.
      </p>
    ),
  },
  {
    id: 'section-11',
    title: '11. Chính sách Hoàn tiền',
    rawText:
      'Khách hàng được hoàn tiền 100% nếu hủy lịch trước khi Nhà vườn Check-in tiếp nhận cây. Sau khi Check-in, số tiền hoàn lại sẽ được tính theo tỷ lệ dịch vụ thực tế đã thực hiện trừ đi chi phí phát sinh (nếu có).',
    content: (
      <p>
        Khách hàng được hoàn tiền 100% nếu hủy lịch trước khi Nhà vườn Check-in tiếp nhận cây. Sau khi
        Check-in, số tiền hoàn lại sẽ được tính theo tỷ lệ dịch vụ thực tế đã thực hiện trừ đi chi phí
        phát sinh (nếu có).
      </p>
    ),
  },
  {
    id: 'section-12',
    title: '12. Giải quyết Tranh chấp dựa trên Bằng chứng Kỹ thuật số',
    icon: <AuditOutlined className="text-[#6027D2]" />,
    rawText:
      'Trong trường hợp xảy ra tranh chấp giữa Khách hàng và Nhà vườn (ví dụ: cây bị hỏng, chết, hoặc không đúng tình trạng ban đầu), LanCare Hub sẽ đóng vai trò trung gian hòa giải. Nguyên tắc cốt lõi: Mọi quyết định phân xử của Ban Quản Trị LanCare Hub sẽ chỉ dựa trên các bằng chứng kỹ thuật số được ghi nhận hợp lệ trên hệ thống (Hình ảnh Check-in/Check-out, Báo cáo định kỳ, Tin nhắn nội bộ ứng dụng). Bất kỳ thỏa thuận hoặc bằng chứng nào nằm ngoài nền tảng (Zalo, gọi điện, tin nhắn SMS) sẽ KHÔNG được công nhận làm căn cứ giải quyết tranh chấp.',
    content: (
      <div className="space-y-3">
        <p>
          Trong trường hợp xảy ra tranh chấp giữa Khách hàng và Nhà vườn (ví dụ: cây bị hỏng, chết,
          hoặc không đúng tình trạng ban đầu), LanCare Hub sẽ đóng vai trò trung gian hòa giải.
        </p>
        <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA]">
          <h4 className="text-[13px] font-bold text-[#1E1B2E] mb-1">Nguyên tắc cốt lõi:</h4>
          <p className="text-[#4A4660]">
            Mọi quyết định phân xử của Ban Quản Trị LanCare Hub sẽ{' '}
            <strong className="text-[#1E1B2E]">chỉ dựa trên các bằng chứng kỹ thuật số</strong> được
            ghi nhận hợp lệ trên hệ thống (Hình ảnh Check-in/Check-out, Báo cáo định kỳ, Tin nhắn nội
            bộ ứng dụng). Bất kỳ thỏa thuận hoặc bằng chứng nào nằm ngoài nền tảng (Zalo, gọi điện, tin
            nhắn SMS) sẽ <strong className="text-[#1E1B2E]">KHÔNG</strong> được công nhận làm căn cứ
            giải quyết tranh chấp.
          </p>
        </div>
      </div>
    ),
  },
];

export default function TermsPage() {
  const router = useRouter();
  const termsAgreed = useAgreementStore((s) => s.termsAgreed);
  const privacyAgreed = useAgreementStore((s) => s.privacyAgreed);
  const setTermsAgreed = useAgreementStore((s) => s.setTermsAgreed);

  const handleAgree = () => {
    setTermsAgreed(true);
    // Luồng chuyển trang: nếu chưa đồng ý Chính sách bảo mật thì chuyển sang đó, nếu đã xong cả 2 thì về Đăng ký
    if (!privacyAgreed) {
      router.push('/auth/privacy');
    } else {
      router.push('/auth/register');
    }
  };

  const handleBack = () => {
    router.push('/auth/register');
  };

  return (
    <LegalDocumentLayout
      title="Điều khoản dịch vụ"
      lastUpdated="Cập nhật lần cuối: 24 Tháng 10, 2023"
      intro={
        <p>
          Chào mừng bạn đến với LanCare Hub. Vui lòng đọc kỹ các Điều khoản Dịch vụ này trước khi sử
          dụng nền tảng của chúng tôi. Việc bạn truy cập và sử dụng dịch vụ đồng nghĩa với việc bạn đã
          chấp nhận và đồng ý tuân thủ các điều khoản này.
        </p>
      }
      sections={termsSections}
      checkboxLabel="Tôi xác nhận rằng tôi đã đọc, hiểu rõ và đồng ý với tất cả các Điều khoản dịch vụ được nêu trong tài liệu này."
      buttonLabel="Tôi đã đọc và đồng ý"
      initialChecked={termsAgreed}
      onAgree={handleAgree}
      onBack={handleBack}
      onCheckboxChange={setTermsAgreed}
    />
  );
}
