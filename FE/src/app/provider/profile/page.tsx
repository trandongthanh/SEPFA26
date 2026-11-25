'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BankOutlined,
  CameraOutlined,
  CheckCircleFilled,
  ClockCircleFilled,
  CloseCircleFilled,
  CompassOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  FileProtectOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  ShopOutlined,
  UploadOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Image,
  Input,
  Radio,
  Row,
  Select,
  Spin,
  Tag,
  Upload,
} from 'antd';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';
import {
  ProviderProfileResponse,
  UpsertProfilePayload,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';

export default function ProviderProfilePage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [approvedBannerDismissed, setApprovedBannerDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setApprovedBannerDismissed(
        window.localStorage.getItem('lancare_provider_approved_banner_dismissed') === '1'
      );
    }
  }, []);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [businessLicenseUrl, setBusinessLicenseUrl] = useState<string>('');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Guard: chuyển hướng nếu chưa đăng nhập hoặc không phải PROVIDER
  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
      return;
    }
    if (user?.role && user.role !== 'PROVIDER') {
      message.error('Trang này chỉ dành cho tài khoản Nhà vườn / Chuyên gia.');
      router.replace('/');
    }
  }, [mounted, isAuthenticated, user, router, message]);

  // Load thông tin hồ sơ từ BE
  const fetchProfile = async () => {
    setLoading(true);
    try {
      const data = await providerApi.getProfile();
      setProfile(data);
      setBusinessLicenseUrl(data.businessLicenseUrl || '');

      form.setFieldsValue({
        providerType: data.providerType || 'NURSERY',
        displayName: data.displayName || '',
        phone: data.phone || data.account?.phone || '',
        fullName: data.account?.fullName || '',
        dateOfBirth: data.dateOfBirth || '',
        placeOfOrigin: data.placeOfOrigin || '',
        bio: data.bio || '',
        licenseInfo: data.licenseInfo || '',
        portfolioUrl: data.portfolioUrl || '',
        address: data.address || '',
        gpsLat: data.gpsLat ? Number(data.gpsLat) : 10.762622,
        gpsLng: data.gpsLng ? Number(data.gpsLng) : 106.660172,
        experience: data.experience || '',
        specialties: data.specialties || '',
        serviceAreas: data.serviceAreas || '',
        certificates: data.certificates || '',
        bankName: data.bankName || '',
        bankAccount: data.bankAccount || '',
        bankHolder: data.bankHolder || '',
      });
    } catch {
      // Chưa có profile (mới đăng ký) -> thử lấy SĐT từ tài khoản (/accounts/me)
      setProfile(null);
      let accountPhone = '';
      try {
        const accRes = await api.get<{ phone?: string | null; fullName?: string }>('/api/v1/accounts/me');
        accountPhone = accRes.data?.phone || '';
      } catch {
        // Ignore
      }
      form.setFieldsValue({
        providerType: 'NURSERY',
        displayName: user?.fullName || '',
        phone: accountPhone,
        fullName: user?.fullName || '',
        gpsLat: 10.762622,
        gpsLng: 106.660172,
        address: '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      fetchProfile();
    }
  }, [mounted, isAuthenticated]);

  // Lấy vị trí GPS hiện tại từ trình duyệt
  const handleGetLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      message.warning('Trình duyệt không hỗ trợ tự động xác định vị trí.');
      return;
    }
    message.loading({ content: 'Đang lấy tọa độ GPS...', key: 'geo' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setFieldsValue({
          gpsLat: Number(pos.coords.latitude.toFixed(6)),
          gpsLng: Number(pos.coords.longitude.toFixed(6)),
        });
        message.success({ content: 'Đã cập nhật tọa độ GPS chính xác!', key: 'geo' });
      },
      () => {
        message.warning({
          content: 'Không thể truy cập vị trí thiết bị. Vui lòng cấp quyền hoặc nhập tay.',
          key: 'geo',
        });
      },
      { timeout: 10000 }
    );
  };

  // Upload ảnh giấy phép kinh doanh / chứng chỉ lên Cloudinary qua BE
  const handleUploadFile = async (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      message.error('Chỉ hỗ trợ file ảnh dạng JPG, PNG hoặc WEBP.');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('Kích thước ảnh tối đa là 5MB.');
      return false;
    }

    setUploadingDoc(true);
    try {
      const res = await providerApi.uploadDocument(file);
      setBusinessLicenseUrl(res.url);
      message.success('Tải ảnh lên thành công!');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } }; message?: string };
      const rawMsg = axiosErr?.response?.data?.message || axiosErr?.message || 'Có lỗi xảy ra khi tải ảnh';
      message.error(Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg);
    } finally {
      setUploadingDoc(false);
    }
    return false;
  };

  // Nộp form hồ sơ
  const onFinish = async (values: Record<string, any>) => {
    setSaving(true);
    try {
      const cleanPhone = values.phone?.trim().replace(/[\s.()-]/g, '');
      const payload: UpsertProfilePayload = {
        providerType: values.providerType,
        displayName: values.displayName?.trim(),
        phone: cleanPhone || undefined,
        fullName: values.fullName?.trim() || undefined,
        dateOfBirth: values.dateOfBirth?.trim() || undefined,
        placeOfOrigin: values.placeOfOrigin?.trim() || undefined,
        bio: values.bio?.trim() || undefined,
        licenseInfo: values.licenseInfo?.trim() || undefined,
        portfolioUrl: values.portfolioUrl?.trim() || undefined,
        businessLicenseUrl: businessLicenseUrl || undefined,
        address: values.address?.trim() || undefined,
        gpsLat: values.gpsLat ? Number(values.gpsLat) : undefined,
        gpsLng: values.gpsLng ? Number(values.gpsLng) : undefined,
        experience: values.experience?.trim() || undefined,
        specialties: values.specialties?.trim() || undefined,
        serviceAreas: values.serviceAreas?.trim() || undefined,
        certificates: values.certificates?.trim() || undefined,
        bankName: values.bankName?.trim() || undefined,
        bankAccount: values.bankAccount?.trim() || undefined,
        bankHolder: values.bankHolder?.trim() || undefined,
      };

      const updated = await providerApi.upsertProfile(payload);
      setProfile(updated);
      message.success(
        'Đã lưu và gửi hồ sơ thành công! Ban quản trị sẽ tiến hành xét duyệt hồ sơ của bạn.'
      );
    } catch (err: unknown) {
      // Interceptor trong lib/api.ts đã đổi mã lỗi BE (PHONE_EXISTS, BANK_INFO_INCOMPLETE...) sang câu tiếng Việt.
      const axiosErr = err as { response?: { data?: { message?: string | string[] } }; message?: string };
      const rawMsg = axiosErr?.response?.data?.message || axiosErr?.message || 'Lỗi khi lưu hồ sơ.';
      message.error(Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg);
    } finally {
      setSaving(false);
    }
  };

  // 8 thông tin BE bắt buộc để Admin duyệt và để vườn nhận đơn (lập hợp đồng + nhận tiền).
  // Tính trên dữ liệu ĐÃ LƯU, không phải giá trị đang gõ trong form. Chưa có hồ sơ → thiếu cả 8.
  const requiredFields: { name: string; label: string; value: unknown }[] = [
    { name: 'fullName', label: 'Họ tên người đại diện', value: profile?.account?.fullName },
    { name: 'phone', label: 'Số điện thoại', value: profile?.phone || profile?.account?.phone },
    { name: 'address', label: 'Địa chỉ nhà vườn', value: profile?.address },
    { name: 'dateOfBirth', label: 'Ngày sinh', value: profile?.dateOfBirth },
    { name: 'placeOfOrigin', label: 'Quê quán', value: profile?.placeOfOrigin },
    { name: 'bankName', label: 'Tên ngân hàng', value: profile?.bankName },
    { name: 'bankAccount', label: 'Số tài khoản', value: profile?.bankAccount },
    { name: 'bankHolder', label: 'Tên chủ tài khoản', value: profile?.bankHolder },
  ];
  const missingRequired = requiredFields.filter((field) => !field.value);
  const filledCount = requiredFields.length - missingRequired.length;

  // Bấm mục còn thiếu → cuộn tới ô, đặt con trỏ vào ô và sáng viền 1,5 giây.
  const FLASH_CLASSES = ['!border-[#6027D2]', '!shadow-[0_0_0_4px_rgba(96,39,210,0.18)]'];
  const jumpToField = (name: string) => {
    form.scrollToField(name, { behavior: 'smooth', block: 'center' });
    const input = document.getElementById(name);
    if (!input) return;
    input.focus({ preventScroll: true });
    // Input có prefix (SĐT) được antd bọc trong span viền → làm sáng span đó.
    const target = input.closest('.ant-input-affix-wrapper') ?? input;
    target.classList.add(...FLASH_CLASSES);
    window.setTimeout(() => target.classList.remove(...FLASH_CLASSES), 1500);
  };

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} />

        <main className="flex-1 p-6 overflow-y-auto">
          {/* HEADER TRANG */}
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-[#1E1B2E]">Hồ sơ nhà vườn / Chuyên gia</h1>
                {profile?.verificationStatus === 'APPROVED' && (
                  <Tag color="success" icon={<CheckCircleFilled />}>
                    Đã được duyệt
                  </Tag>
                )}
                {profile?.verificationStatus === 'PENDING' && (
                  <Tag color="warning" icon={<ClockCircleFilled />}>
                    Đang chờ duyệt
                  </Tag>
                )}
                {profile?.verificationStatus === 'REJECTED' && (
                  <Tag color="error" icon={<CloseCircleFilled />}>
                    Bị từ chối
                  </Tag>
                )}
                {!profile && (
                  <Tag color="purple" icon={<InfoCircleOutlined />}>
                    Chưa gửi hồ sơ
                  </Tag>
                )}
              </div>
              <p className="text-sm text-[#6E6A8A] mt-1">
                Hoàn thiện thông tin nhà vườn, người đại diện và tài khoản nhận tiền để Ban quản trị LanCare kiểm duyệt và kích hoạt gói dịch vụ.
              </p>
            </div>
          </div>

          {/* BANNER THÔNG BÁO TRẠNG THÁI */}
          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang nạp dữ liệu hồ sơ...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 max-w-5xl">
              {/* Mỗi lúc chỉ một thông báo trạng thái: còn thiếu thì banner vàng thay cho banner xanh / chờ duyệt.
                  Riêng "bị từ chối" vẫn hiện kèm vì có lý do Admin ghi. */}
              {profile?.verificationStatus === 'APPROVED' && missingRequired.length === 0 && !approvedBannerDismissed && (
                <Alert
                  type="success"
                  showIcon
                  closable
                  onClose={() => {
                    setApprovedBannerDismissed(true);
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem('lancare_provider_approved_banner_dismissed', '1');
                    }
                  }}
                  icon={<CheckCircleFilled className="text-lg text-[#10B981]" />}
                  message={<span className="font-semibold text-[#065F46]">Hồ sơ đã được phê duyệt chính thức</span>}
                  description={
                    <span className="text-xs text-[#047857]">
                      Nhà vườn của bạn đã được chứng nhận và hiển thị công khai trên ứng dụng. Mọi gói dịch vụ kích hoạt sẽ sẵn sàng nhận lịch chăm sóc từ khách hàng.
                    </span>
                  }
                  className="!rounded-2xl !border-[#A7F3D0] !bg-[#ECFDF5]"
                />
              )}

              {profile?.verificationStatus === 'PENDING' && missingRequired.length === 0 && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<ClockCircleFilled className="text-lg text-[#F59E0B]" />}
                  message={<span className="font-semibold text-[#92400E]">Hồ sơ đang trong hàng đợi chờ xét duyệt</span>}
                  description={
                    <span className="text-xs text-[#B45309]">
                      Hồ sơ của bạn đã được gửi tới Ban quản trị LanCare Hub. Admin sẽ kiểm tra thông tin nhà vườn, người đại diện và tài khoản ngân hàng trong vòng 24 giờ làm việc. Bạn vẫn có thể chỉnh sửa và lưu lại thông tin.
                    </span>
                  }
                  className="!rounded-2xl !border-[#FDE68A] !bg-[#FFFBEB]"
                />
              )}

              {profile?.verificationStatus === 'REJECTED' && (
                <Alert
                  type="error"
                  showIcon
                  icon={<CloseCircleFilled className="text-lg text-[#EF4444]" />}
                  message={<span className="font-semibold text-[#991B1B]">Hồ sơ chưa được duyệt</span>}
                  description={
                    <span className="text-xs text-[#B91C1C]">
                      Lý do từ chối: {profile.verificationNote || 'Thông tin hồ sơ chưa chính xác.'} Vui lòng sửa lại thông tin rồi bấm Lưu & Nộp lại.
                    </span>
                  }
                  className="!rounded-2xl !border-[#FECACA] !bg-[#FEF2F2]"
                />
              )}

              {missingRequired.length > 0 && (
                <div
                  role="status"
                  className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-[18px] py-3.5 flex flex-col gap-2.5"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-[22px] h-[22px] rounded-full bg-[#F59E0B] text-white grid place-items-center text-[13px] font-extrabold shrink-0">
                      !
                    </span>
                    <b className="text-[15px] text-[#92400E]">Hoàn tất hồ sơ để nhận đơn</b>
                    <span className="ml-auto text-xs font-semibold text-[#B45309] tabular-nums">
                      {filledCount}/{requiredFields.length} đã điền
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-[#FEF3C7] overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={requiredFields.length}
                    aria-valuenow={filledCount}
                    aria-label="Tiến độ hoàn tất hồ sơ"
                  >
                    <div
                      className="h-full rounded-full bg-[#D97706] transition-[width] duration-300"
                      style={{ width: `${(filledCount / requiredFields.length) * 100}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <small className="text-xs text-[#B45309] mr-0.5">Còn thiếu:</small>
                    {missingRequired.map((field) => (
                      <button
                        key={field.name}
                        type="button"
                        onClick={() => jumpToField(field.name)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-white px-[11px] py-[3px] text-[12.5px] font-semibold text-[#92400E] cursor-pointer hover:border-[#D97706] hover:bg-[#FEF3C7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6027D2]"
                      >
                        {field.label}
                        <span aria-hidden className="text-[#D97706] font-bold">→</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* FORM HỒ SƠ */}
              <Form
                form={form}
                layout="vertical"
                onFinish={onFinish}
                requiredMark={false}
                className="space-y-6"
              >
                {/* KHỐI 1: THÔNG TIN ĐẠI DIỆN & CƠ SỞ */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="w-8 h-8 rounded-lg bg-[#F3E8FF] flex items-center justify-center text-[#6027D2]">
                      <ShopOutlined className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1E1B2E]">Thông tin nhà cung cấp</h2>
                      <p className="text-xs text-[#6E6A8A]">Loại hình hoạt động và thông tin định danh công khai</p>
                    </div>
                  </div>

                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="providerType"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Loại hình đối tác</span>}
                        rules={[{ required: true, message: 'Vui lòng chọn loại hình' }]}
                      >
                        <Select
                          size="large"
                          className="!rounded-xl"
                          options={[
                            { value: 'NURSERY', label: '🏡 Nhà vườn kiểng / Vườn lan' },
                            { value: 'EXPERT', label: '👨‍🌾 Chuyên gia / Nghệ nhân chăm sóc lan' },
                          ]}
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={9}>
                      <Form.Item
                        name="displayName"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Tên nhà vườn / Tên chuyên gia hiển thị <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, message: 'Vui lòng nhập tên nhà vườn' },
                          { min: 2, message: 'Tối thiểu 2 ký tự' },
                          { max: 255, message: 'Tối đa 255 ký tự' },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: Vườn Lan Thảo Mộc Sài Gòn"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={7}>
                      <Form.Item
                        name="phone"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Số điện thoại liên hệ <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, message: 'Vui lòng nhập số điện thoại liên hệ' },
                          {
                            pattern: /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/,
                            message: 'Số điện thoại Việt Nam chưa hợp lệ (VD: 0909123456)',
                          },
                        ]}
                      >
                        <Input
                          size="large"
                          prefix={<PhoneOutlined className="text-[#A098C2] mr-1" />}
                          placeholder="Ví dụ: 0909123456"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="experience"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Số năm kinh nghiệm</span>}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: 8 năm kinh nghiệm dưỡng lan đột biến"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name="specialties"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Chuyên môn / Dòng lan thế mạnh</span>}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: Lan Phi Điệp, Hồ Điệp mini, Vanda, Lan rừng quý"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item
                    name="bio"
                    label={<span className="font-semibold text-xs text-[#4B4764]">Giới thiệu ngắn (Bio)</span>}
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder="Mô tả tóm tắt về kỹ thuật, cơ sở vật chất giàn lan, năng lực tiếp nhận số lượng chậu chăm sóc..."
                      className="!rounded-xl"
                      maxLength={2000}
                      showCount
                    />
                  </Form.Item>

                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        name="portfolioUrl"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Website / Kênh Facebook / Fanpage</span>}
                      >
                        <Input
                          size="large"
                          placeholder="https://facebook.com/vuonlanthaomoc"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                      <Form.Item
                        name="licenseInfo"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Mã số thuế / Số ĐKKD (nếu có)</span>}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: 0314567890"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* KHỐI 1B: NGƯỜI ĐẠI DIỆN KÝ HỢP ĐỒNG — BE in vào Bên B của hợp đồng điện tử */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="w-8 h-8 rounded-lg bg-[#ECFEFF] flex items-center justify-center text-[#0E7490]">
                      <UserOutlined className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1E1B2E]">Người đại diện ký hợp đồng</h2>
                      <p className="text-xs text-[#6E6A8A]">
                        Ghi vào Hợp đồng điện tử (Bên B) khi bạn nhận đơn.
                      </p>
                    </div>
                  </div>

                  <Row gutter={16}>
                    <Col xs={24} md={10}>
                      <Form.Item
                        name="fullName"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Họ và tên người đại diện <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập họ tên người đại diện' },
                          { min: 2, message: 'Tối thiểu 2 ký tự' },
                          { max: 255, message: 'Tối đa 255 ký tự' },
                        ]}
                      >
                        <Input size="large" placeholder="Ví dụ: Nguyễn Văn Lan" className="!rounded-xl" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={6}>
                      <Form.Item
                        name="dateOfBirth"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Ngày sinh <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập ngày sinh' },
                          {
                            pattern: /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/(19|20)\d{2}$/,
                            message: 'Nhập theo dạng dd/mm/yyyy, ví dụ 15/08/1988',
                          },
                        ]}
                      >
                        <Input size="large" maxLength={10} placeholder="dd/mm/yyyy" className="!rounded-xl" />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
                      <Form.Item
                        name="placeOfOrigin"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Quê quán <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập quê quán' },
                          { max: 255, message: 'Tối đa 255 ký tự' },
                        ]}
                      >
                        <Input size="large" placeholder="Ví dụ: Bảo Lâm, Lâm Đồng" className="!rounded-xl" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* KHỐI 2: ĐỊA CHỈ & ĐỊNH VỊ GPS VƯỜN */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-[#E0E7FF] flex items-center justify-center text-[#4338CA]">
                        <EnvironmentOutlined className="text-base" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-[#1E1B2E]">Vị trí nhà vườn & Khu vực nhận chăm sóc</h2>
                        <p className="text-xs text-[#6E6A8A]">Tọa độ GPS dùng để tính khoảng cách và phí vận chuyển đơn hàng tự động</p>
                      </div>
                    </div>

                    <Button
                      icon={<CompassOutlined />}
                      onClick={handleGetLocation}
                      className="!rounded-xl text-xs font-semibold text-[#6027D2] !border-[#ECE7FA] hover:!border-[#6027D2]"
                    >
                      Lấy GPS tự động
                    </Button>
                  </div>

                  <Row gutter={16}>
                    <Col xs={24} md={16}>
                      <Form.Item
                        name="address"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Địa chỉ nhà vườn <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập địa chỉ nhà vườn' },
                          { max: 255, message: 'Tối đa 255 ký tự' },
                        ]}
                        extra={<span className="text-[11px] text-[#6E6A8A]">Địa chỉ này được ghi vào hợp đồng.</span>}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: 456 Xa Lộ Hà Nội, P. Linh Trung, TP. Thủ Đức, TP.HCM"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
                      <Form.Item
                        name="serviceAreas"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Khu vực phục vụ</span>}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: TP.HCM, Bình Dương"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col xs={12}>
                      <Form.Item
                        name="gpsLat"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Vĩ độ (GPS Latitude)</span>}
                      >
                        <Input
                          size="large"
                          type="number"
                          step="any"
                          placeholder="10.849889"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={12}>
                      <Form.Item
                        name="gpsLng"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Kinh độ (GPS Longitude)</span>}
                      >
                        <Input
                          size="large"
                          type="number"
                          step="any"
                          placeholder="106.771806"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* KHỐI 3: GIẤY PHÉP KINH DOANH / CHỨNG CHỈ (TUỲ CHỌN) — không thu CCCD hay ảnh chân dung */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="w-8 h-8 rounded-lg bg-[#FEF3C7] flex items-center justify-center text-[#D97706]">
                      <FileProtectOutlined className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1E1B2E]">Giấy phép kinh doanh / Chứng chỉ</h2>
                      <p className="text-xs text-[#6E6A8A]">Không bắt buộc. Giúp Ban quản trị tin tưởng hồ sơ của bạn hơn.</p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-dashed border-[#D1C9E9] bg-[#FAF8FE] flex flex-col sm:flex-row items-center gap-4">
                    {businessLicenseUrl ? (
                      <div className="relative group w-40 shrink-0">
                        <Image
                          src={businessLicenseUrl}
                          alt="Giấy phép kinh doanh"
                          className="w-full h-28 object-cover rounded-lg shadow-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setBusinessLicenseUrl('')}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 shadow-md"
                        >
                          <DeleteOutlined className="text-xs" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-40 h-28 shrink-0 flex flex-col items-center justify-center bg-white rounded-lg border border-[#ECE7FA] text-[#A098C2]">
                        <FileProtectOutlined className="text-3xl mb-1" />
                        <span className="text-[11px]">Chưa có ảnh</span>
                      </div>
                    )}

                    <div className="flex flex-col items-center sm:items-start gap-2 text-center sm:text-left">
                      <span className="text-xs text-[#6E6A8A]">Ảnh JPG, PNG hoặc WEBP, tối đa 5 MB.</span>
                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadFile(file)}
                        accept="image/png,image/jpeg,image/webp"
                      >
                        <Button
                          icon={uploadingDoc ? <LoadingOutlined /> : <UploadOutlined />}
                          disabled={uploadingDoc}
                          size="small"
                          className="!rounded-lg font-medium text-xs text-[#6027D2] !border-[#C4B5FD]"
                        >
                          {businessLicenseUrl ? 'Đổi ảnh khác' : 'Tải ảnh lên'}
                        </Button>
                      </Upload>
                    </div>
                  </div>
                </div>

                {/* KHỐI 4: TÀI KHOẢN NGÂN HÀNG NHẬN DOANH THU */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="w-8 h-8 rounded-lg bg-[#DCFCE7] flex items-center justify-center text-[#15803D]">
                      <BankOutlined className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1E1B2E]">Tài khoản ngân hàng nhận thanh toán</h2>
                      <p className="text-xs text-[#6E6A8A]">Bắt buộc trước khi được duyệt và nhận đơn. Chỉ đổi sang tài khoản khác được, không xoá được.</p>
                    </div>
                  </div>

                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="bankName"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Tên ngân hàng <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập tên ngân hàng' },
                          { max: 100, message: 'Tối đa 100 ký tự' },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: Vietcombank / Techcombank"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
                      <Form.Item
                        name="bankAccount"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Số tài khoản ngân hàng <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập số tài khoản' },
                          { max: 50, message: 'Tối đa 50 ký tự' },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: 0815556045"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>

                    <Col xs={24} md={8}>
                      <Form.Item
                        name="bankHolder"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Tên chủ tài khoản (In hoa không dấu) <span className="text-red-500">*</span></span>}
                        rules={[
                          { required: true, whitespace: true, message: 'Vui lòng nhập tên chủ tài khoản' },
                          { max: 100, message: 'Tối đa 100 ký tự' },
                        ]}
                      >
                        <Input
                          size="large"
                          placeholder="Ví dụ: TRAN DONG THANH"
                          className="!rounded-xl"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* NÚT SUBMIT Ở ĐÁY */}
                <div className="flex justify-end pt-2 pb-8">
                  <Button
                    type="primary"
                    size="large"
                    icon={<SaveOutlined />}
                    loading={saving}
                    onClick={() => form.submit()}
                    className="!bg-[#6027D2] hover:!bg-[#4F1FA9] !rounded-xl !h-12 px-8 font-semibold text-base shadow-[0_10px_25px_rgba(96,39,210,0.3)]"
                  >
                    Lưu & Nộp hồ sơ xét duyệt
                  </Button>
                </div>
              </Form>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
