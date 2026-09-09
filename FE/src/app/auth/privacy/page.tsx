'use client';

import { useRouter } from 'next/navigation';
import {
  SafetyOutlined,
  FileProtectOutlined,
  LockOutlined,
  ShareAltOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import LegalDocumentLayout, { DocumentSection } from '@/features/auth/components/LegalDocumentLayout';
import { useAgreementStore } from '@/stores/agreement.store';

const privacySections: DocumentSection[] = [
  {
    id: 'privacy-1',
    title: '1. Mục đích thu thập thông tin',
    icon: <SafetyOutlined className="text-[#6027D2]" />,
    rawText:
      'LanCare Hub thu thập thông tin cá nhân của người dùng nhằm mục đích cung cấp, duy trì, và cải thiện chất lượng dịch vụ kết nối giữa Khách hàng và Nhà vườn/Chuyên gia chăm sóc lan. Việc thu thập này giúp chúng tôi cá nhân hóa trải nghiệm, xử lý giao dịch an toàn và hỗ trợ giải quyết tranh chấp.',
    content: (
      <p>
        LanCare Hub thu thập thông tin cá nhân của người dùng nhằm mục đích cung cấp, duy trì, và
        cải thiện chất lượng dịch vụ kết nối giữa Khách hàng và Nhà vườn/Chuyên gia chăm sóc lan.
        Việc thu thập này giúp chúng tôi cá nhân hóa trải nghiệm, xử lý giao dịch an toàn và hỗ trợ
        giải quyết tranh chấp.
      </p>
    ),
  },
  {
    id: 'privacy-2',
    title: '2. Phạm vi thu thập (Dữ liệu thu thập)',
    icon: <DatabaseOutlined className="text-[#6027D2]" />,
    rawText:
      'Thông tin tài khoản: Họ tên, số điện thoại, địa chỉ email, địa chỉ liên hệ. Thông tin Nhà cung cấp (Provider): Giấy tờ tùy thân (CCCD/CMND), chứng chỉ chuyên môn, hình ảnh vườn lan, địa chỉ kinh doanh. Dữ liệu dịch vụ (Booking evidence): Hình ảnh tình trạng cây lan trước và sau khi chăm sóc, ghi chú dịch vụ, lịch sử đặt lịch. Dữ liệu thanh toán: Mã giao dịch (Transaction codes), lịch sử thanh toán. Lưu ý: Chúng tôi tuyệt đối KHÔNG lưu trữ thông tin thẻ ngân hàng của người dùng.',
    content: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li>
          <strong className="text-[#1E1B2E]">Thông tin tài khoản:</strong> Họ tên, số điện thoại,
          địa chỉ email, địa chỉ liên hệ.
        </li>
        <li>
          <strong className="text-[#1E1B2E]">Thông tin Nhà cung cấp (Provider):</strong> Giấy tờ tùy
          thân (CCCD/CMND), chứng chỉ chuyên môn, hình ảnh vườn lan, địa chỉ kinh doanh.
        </li>
        <li>
          <strong className="text-[#1E1B2E]">Dữ liệu dịch vụ (Booking evidence):</strong> Hình ảnh tình
          trạng cây lan trước và sau khi chăm sóc, ghi chú dịch vụ, lịch sử đặt lịch.
        </li>
        <li>
          <strong className="text-[#1E1B2E]">Dữ liệu thanh toán:</strong> Mã giao dịch (Transaction
          codes), lịch sử thanh toán.{' '}
          <span className="text-red-500 font-semibold">
            Lưu ý: Chúng tôi tuyệt đối KHÔNG lưu trữ thông tin thẻ ngân hàng của người dùng.
          </span>
        </li>
      </ul>
    ),
  },
  {
    id: 'privacy-3',
    title: '3. Sử dụng thông tin (Data usage)',
    rawText:
      'Xác thực (Verification): Xác minh danh tính người dùng và đánh giá năng lực của chuyên gia/nhà vườn. Vận hành dịch vụ (Booking): Điều phối, sắp xếp lịch chăm sóc và cập nhật tiến độ công việc. Giải quyết tranh chấp (Disputes): Sử dụng dữ liệu bằng chứng (hình ảnh, ghi chú) để xử lý các khiếu nại giữa Khách hàng và Nhà cung cấp. Thông báo (Notifications): Gửi cập nhật trạng thái đơn hàng, thông báo hệ thống và chính sách mới.',
    content: (
      <>
        <p className="mb-2">Thông tin thu thập được sử dụng cho các mục đích cụ thể sau:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-[#1E1B2E]">Xác thực (Verification):</strong> Xác minh danh tính
            người dùng và đánh giá năng lực của chuyên gia/nhà vườn.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Vận hành dịch vụ (Booking):</strong> Điều phối, sắp xếp
            lịch chăm sóc và cập nhật tiến độ công việc.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Giải quyết tranh chấp (Disputes):</strong> Sử dụng dữ
            liệu bằng chứng (hình ảnh, ghi chú) để xử lý các khiếu nại giữa Khách hàng và Nhà cung cấp.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Thông báo (Notifications):</strong> Gửi cập nhật trạng
            thái đơn hàng, thông báo hệ thống và chính sách mới.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'privacy-4',
    title: '4. Chia sẻ thông tin (Data sharing)',
    icon: <ShareAltOutlined className="text-[#6027D2]" />,
    rawText:
      'LanCare Hub chỉ chia sẻ thông tin cần thiết trong các trường hợp sau: Giữa Khách hàng và Nhà cung cấp: Chia sẻ thông tin liên lạc và địa chỉ (đối với dịch vụ tận nơi) khi một lịch hẹn được xác nhận. Với đối tác thanh toán VNPay: Chỉ chia sẻ mã giao dịch và số tiền để thực hiện việc thanh toán an toàn. Khi có yêu cầu hợp pháp từ cơ quan nhà nước có thẩm quyền.',
    content: (
      <>
        <p className="mb-2">LanCare Hub chỉ chia sẻ thông tin cần thiết trong các trường hợp sau:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-[#1E1B2E]">Giữa Khách hàng và Nhà cung cấp:</strong> Chia sẻ
            thông tin liên lạc và địa chỉ (đối với dịch vụ tận nơi) khi một lịch hẹn được xác nhận.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Với đối tác thanh toán VNPay:</strong> Chỉ chia sẻ mã
            giao dịch và số tiền để thực hiện việc thanh toán an toàn.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Yêu cầu pháp lý:</strong> Khi có yêu cầu hợp pháp từ cơ
            quan nhà nước có thẩm quyền.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'privacy-5',
    title: '5. Bảo mật dữ liệu (Data security)',
    icon: <LockOutlined className="text-[#6027D2]" />,
    rawText:
      'Chúng tôi áp dụng các tiêu chuẩn bảo mật nghiêm ngặt: Phân quyền truy cập (RBAC - Role-Based Access Control): Đảm bảo nhân viên chỉ tiếp cận dữ liệu phù hợp với vai trò công việc. Mã hóa (Encryption): Mọi dữ liệu truyền tải trên nền tảng đều được mã hóa bằng giao thức SSL/TLS chuẩn quốc tế.',
    content: (
      <>
        <p className="mb-2">Chúng tôi áp dụng các tiêu chuẩn bảo mật nghiêm ngặt:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-[#1E1B2E]">Phân quyền truy cập (RBAC - Role-Based Access Control):</strong>{' '}
            Đảm bảo nhân viên chỉ tiếp cận dữ liệu phù hợp với vai trò công việc.
          </li>
          <li>
            <strong className="text-[#1E1B2E]">Mã hóa (Encryption):</strong> Mọi dữ liệu truyền tải
            trên nền tảng đều được mã hóa bằng giao thức SSL/TLS chuẩn quốc tế.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'privacy-6',
    title: '6. Quyền của người dùng',
    icon: <FileProtectOutlined className="text-[#6027D2]" />,
    rawText:
      'Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xóa thông tin cá nhân của mình trên hệ thống LanCare Hub. Mọi yêu cầu vui lòng gửi về bộ phận hỗ trợ thông qua email hoặc tính năng Hỗ trợ trong ứng dụng.',
    content: (
      <p>
        Bạn có quyền yêu cầu truy cập, chỉnh sửa hoặc xóa thông tin cá nhân của mình trên hệ thống
        LanCare Hub. Mọi yêu cầu vui lòng gửi về bộ phận hỗ trợ thông qua email hoặc tính năng Hỗ trợ
        trong ứng dụng.
      </p>
    ),
  },
  {
    id: 'privacy-7',
    title: '7. Thời gian lưu trữ',
    rawText:
      'Thông tin tài khoản và dữ liệu giao dịch được lưu trữ trong suốt thời gian tài khoản hoạt động và tối thiểu 5 năm sau khi đóng tài khoản nhằm phục vụ mục đích kiểm toán và đối soát pháp lý.',
    content: (
      <p>
        Thông tin tài khoản và dữ liệu giao dịch được lưu trữ trong suốt thời gian tài khoản hoạt động
        và tối thiểu 5 năm sau khi đóng tài khoản nhằm phục vụ mục đích kiểm toán và đối soát pháp lý.
      </p>
    ),
  },
  {
    id: 'privacy-8',
    title: '8. Cookie và Tracking',
    rawText:
      'Chúng tôi sử dụng cookie phiên làm việc để duy trì trạng thái đăng nhập và phân tích lưu lượng truy cập ẩn danh nhằm nâng cao hiệu suất website.',
    content: (
      <p>
        Chúng tôi sử dụng cookie phiên làm việc để duy trì trạng thái đăng nhập và phân tích lưu lượng
        truy cập ẩn danh nhằm nâng cao hiệu suất website.
      </p>
    ),
  },
  {
    id: 'privacy-9',
    title: '9. Liên kết bên thứ ba',
    rawText:
      'Website có thể chứa liên kết đến dịch vụ bên thứ ba (như cổng thanh toán, bản đồ). Chúng tôi không chịu trách nhiệm về chính sách bảo mật của các trang web bên ngoài này.',
    content: (
      <p>
        Website có thể chứa liên kết đến dịch vụ bên thứ ba (như cổng thanh toán, bản đồ). Chúng tôi
        không chịu trách nhiệm về chính sách bảo mật của các trang web bên ngoài này.
      </p>
    ),
  },
  {
    id: 'privacy-10',
    title: '10. Thay đổi chính sách',
    rawText:
      'LanCare Hub có quyền cập nhật chính sách bảo mật bất cứ lúc nào. Khi có thay đổi quan trọng, chúng tôi sẽ thông báo trên trang chủ hoặc gửi email thông báo trước 15 ngày.',
    content: (
      <p>
        LanCare Hub có quyền cập nhật chính sách bảo mật bất cứ lúc nào. Khi có thay đổi quan trọng,
        chúng tôi sẽ thông báo trên trang chủ hoặc gửi email thông báo trước 15 ngày.
      </p>
    ),
  },
  {
    id: 'privacy-11',
    title: '11. Thông tin liên hệ',
    rawText:
      'Nếu bạn có bất kỳ thắc mắc nào về chính sách này, vui lòng liên hệ Ban Quản Trị LanCare Hub qua email: privacy@lancarehub.vn hoặc hotline: 1900 xxxx.',
    content: (
      <p>
        Nếu bạn có bất kỳ thắc mắc nào về chính sách này, vui lòng liên hệ Ban Quản Trị LanCare Hub
        qua email:{' '}
        <a href="mailto:privacy@lancarehub.vn" className="text-[#6027D2] font-semibold hover:underline">
          privacy@lancarehub.vn
        </a>{' '}
        hoặc hotline:{' '}
        <span className="text-[#6027D2] font-semibold">1900 xxxx</span>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  const router = useRouter();
  const termsAgreed = useAgreementStore((s) => s.termsAgreed);
  const privacyAgreed = useAgreementStore((s) => s.privacyAgreed);
  const setPrivacyAgreed = useAgreementStore((s) => s.setPrivacyAgreed);

  const handleAgree = () => {
    setPrivacyAgreed(true);
    // Luồng chuyển trang: nếu chưa đồng ý Điều khoản dịch vụ thì chuyển sang đó, nếu đã xong cả 2 thì về Đăng ký
    if (!termsAgreed) {
      router.push('/auth/terms');
    } else {
      router.push('/auth/register');
    }
  };

  const handleBack = () => {
    router.push('/auth/register');
  };

  return (
    <LegalDocumentLayout
      title="Chính sách bảo mật"
      lastUpdated="Cập nhật lần cuối: 24/10/2023"
      sections={privacySections}
      checkboxLabel="Tôi đã đọc và đồng ý với Chính sách bảo mật này"
      buttonLabel="Xác nhận đồng ý"
      initialChecked={privacyAgreed}
      onAgree={handleAgree}
      onBack={handleBack}
      onCheckboxChange={setPrivacyAgreed}
    />
  );
}
