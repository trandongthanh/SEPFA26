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
  IdcardOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
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
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [cccdFrontUrl, setCccdFrontUrl] = useState<string>('');
  const [cccdBackUrl, setCccdBackUrl] = useState<string>('');
  const [selfieUrl, setSelfieUrl] = useState<string>('');
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
      setCccdFrontUrl(data.cccdFrontUrl || '');
      setCccdBackUrl(data.cccdBackUrl || '');
      setSelfieUrl(data.selfieUrl || '');
      setBusinessLicenseUrl(data.businessLicenseUrl || '');

      form.setFieldsValue({
        providerType: data.providerType || 'NURSERY',
        displayName: data.displayName || '',
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
      // Chưa có profile (mới đăng ký)
      setProfile(null);
      form.setFieldsValue({
        providerType: 'NURSERY',
        displayName: user?.fullName || '',
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

  // Upload tài liệu xác thực lên Cloudinary qua BE
  const handleUploadFile = async (
    field: 'cccdFrontUrl' | 'cccdBackUrl' | 'selfieUrl' | 'businessLicenseUrl',
    file: File
  ) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      message.error('Chỉ hỗ trợ file ảnh dạng JPG, PNG hoặc WEBP.');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      message.error('Kích thước ảnh tối đa là 5MB.');
      return false;
    }

    setUploadingDoc(field);
    try {
      const res = await providerApi.uploadDocument(file);
      if (field === 'cccdFrontUrl') setCccdFrontUrl(res.url);
      else if (field === 'cccdBackUrl') setCccdBackUrl(res.url);
      else if (field === 'selfieUrl') setSelfieUrl(res.url);
      else if (field === 'businessLicenseUrl') setBusinessLicenseUrl(res.url);
      message.success('Tải ảnh lên thành công!');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } }; message?: string };
      const rawMsg = axiosErr?.response?.data?.message || axiosErr?.message || 'Có lỗi xảy ra khi tải ảnh';
      message.error(Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg);
    } finally {
      setUploadingDoc(null);
    }
    return false;
  };

  // Nộp form hồ sơ
  const onFinish = async (values: Record<string, any>) => {
    setSaving(true);
    try {
      const payload: UpsertProfilePayload = {
        providerType: values.providerType,
        displayName: values.displayName?.trim(),
        bio: values.bio?.trim() || undefined,
        licenseInfo: values.licenseInfo?.trim() || undefined,
        portfolioUrl: values.portfolioUrl?.trim() || undefined,
        selfieUrl: selfieUrl || undefined,
        cccdFrontUrl: cccdFrontUrl || undefined,
        cccdBackUrl: cccdBackUrl || undefined,
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
      const axiosErr = err as { response?: { data?: { message?: string | string[] } }; message?: string };
      const rawMsg = axiosErr?.response?.data?.message || axiosErr?.message || 'Lỗi khi lưu hồ sơ.';
      message.error(Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg);
    } finally {
      setSaving(false);
    }
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
                Hoàn thiện thông tin cơ sở và hồ sơ pháp lý (CCCD, vị trí) để Ban quản trị LanCare kiểm duyệt và kích hoạt gói dịch vụ.
              </p>
            </div>

            <Button
              type="primary"
              size="large"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => form.submit()}
              className="!bg-[#6027D2] hover:!bg-[#4F1FA9] !rounded-xl !h-11 px-6 font-semibold shadow-[0_8px_20px_rgba(96,39,210,0.25)]"
            >
              Lưu & Nộp hồ sơ xét duyệt
            </Button>
          </div>

          {/* BANNER THÔNG BÁO TRẠNG THÁI */}
          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang nạp dữ liệu hồ sơ...</p>
            </div>
          ) : (
            <div className="space-y-6 max-w-5xl">
              {profile?.verificationStatus === 'APPROVED' && (
                <Alert
                  type="success"
                  showIcon
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

              {profile?.verificationStatus === 'PENDING' && (
                <Alert
                  type="warning"
                  showIcon
                  icon={<ClockCircleFilled className="text-lg text-[#F59E0B]" />}
                  message={<span className="font-semibold text-[#92400E]">Hồ sơ đang trong hàng đợi chờ xét duyệt</span>}
                  description={
                    <span className="text-xs text-[#B45309]">
                      Hồ sơ của bạn đã được gửi tới Ban quản trị LanCare Hub. Quá trình kiểm tra CCCD và thông tin nhà vườn thường diễn ra trong vòng 24 giờ làm việc. Bạn vẫn có thể chỉnh sửa và lưu lại thông tin.
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
                  message={<span className="font-semibold text-[#991B1B]">Hồ sơ chưa được duyệt: {profile.verificationNote || 'Vui lòng kiểm tra lại ảnh giấy tờ'}</span>}
                  description={
                    <span className="text-xs text-[#B91C1C]">
                      Lý do từ chối: {profile.verificationNote || 'Ảnh CCCD bị mờ hoặc thông tin chưa trùng khớp. Vui lòng chụp lại ảnh rõ nét và bấm Lưu & Nộp lại.'}
                    </span>
                  }
                  className="!rounded-2xl !border-[#FECACA] !bg-[#FEF2F2]"
                />
              )}

              {!profile && (
                <Alert
                  type="info"
                  showIcon
                  icon={<InfoCircleOutlined className="text-lg text-[#6027D2]" />}
                  message={<span className="font-semibold text-[#4C1D95]">Vui lòng hoàn tất hồ sơ nhà vườn</span>}
                  description={
                    <span className="text-xs text-[#5B21B6]">
                      Bạn vừa đăng ký tài khoản thành công. Hãy điền Tên hiển thị, Địa chỉ và tải lên ảnh CCCD (mặt trước/mặt sau) để Admin tiến hành xét duyệt nhà vườn.
                    </span>
                  }
                  className="!rounded-2xl !border-[#DDD6FE] !bg-[#F5F3FF]"
                />
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

                    <Col xs={24} md={16}>
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
                        label={<span className="font-semibold text-xs text-[#4B4764]">Địa chỉ cụ thể của vườn / cơ sở</span>}
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

                {/* KHỐI 3: GIẤY TỜ XÁC MINH & PHÁP LÝ (CCCD & CHÂN DUNG) */}
                <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6 shadow-xs">
                  <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#F0EDF9]">
                    <div className="w-8 h-8 rounded-lg bg-[#FEF3C7] flex items-center justify-center text-[#D97706]">
                      <IdcardOutlined className="text-base" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#1E1B2E]">Giấy tờ xác minh danh tính & Pháp lý</h2>
                      <p className="text-xs text-[#6E6A8A]">
                        Bắt buộc tải lên ảnh CCCD (2 mặt) và ảnh chân dung thật để Admin có căn cứ xét duyệt hồ sơ
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* 1. Mặt trước CCCD */}
                    <div className="p-4 rounded-xl border border-dashed border-[#D1C9E9] bg-[#FAF8FE] flex flex-col justify-between items-center text-center">
                      <span className="text-xs font-semibold text-[#1E1B2E] mb-2">
                        Mặt trước CCCD <span className="text-red-500">*</span>
                      </span>

                      {cccdFrontUrl ? (
                        <div className="relative group w-full mb-3">
                          <Image
                            src={cccdFrontUrl}
                            alt="Mặt trước CCCD"
                            className="w-full h-32 object-cover rounded-lg shadow-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setCccdFrontUrl('')}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 shadow-md"
                          >
                            <DeleteOutlined className="text-xs" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-32 flex flex-col items-center justify-center bg-white rounded-lg border border-[#ECE7FA] mb-3 text-[#A098C2]">
                          <IdcardOutlined className="text-3xl mb-1" />
                          <span className="text-[11px]">Chưa tải ảnh</span>
                        </div>
                      )}

                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadFile('cccdFrontUrl', file)}
                        accept="image/png,image/jpeg,image/webp"
                      >
                        <Button
                          icon={uploadingDoc === 'cccdFrontUrl' ? <LoadingOutlined /> : <UploadOutlined />}
                          disabled={uploadingDoc === 'cccdFrontUrl'}
                          size="small"
                          className="!rounded-lg font-medium text-xs text-[#6027D2] !border-[#C4B5FD]"
                        >
                          {cccdFrontUrl ? 'Đổi ảnh khác' : 'Tải ảnh lên'}
                        </Button>
                      </Upload>
                    </div>

                    {/* 2. Mặt sau CCCD */}
                    <div className="p-4 rounded-xl border border-dashed border-[#D1C9E9] bg-[#FAF8FE] flex flex-col justify-between items-center text-center">
                      <span className="text-xs font-semibold text-[#1E1B2E] mb-2">
                        Mặt sau CCCD <span className="text-red-500">*</span>
                      </span>

                      {cccdBackUrl ? (
                        <div className="relative group w-full mb-3">
                          <Image
                            src={cccdBackUrl}
                            alt="Mặt sau CCCD"
                            className="w-full h-32 object-cover rounded-lg shadow-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setCccdBackUrl('')}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 shadow-md"
                          >
                            <DeleteOutlined className="text-xs" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-32 flex flex-col items-center justify-center bg-white rounded-lg border border-[#ECE7FA] mb-3 text-[#A098C2]">
                          <IdcardOutlined className="text-3xl mb-1" />
                          <span className="text-[11px]">Chưa tải ảnh</span>
                        </div>
                      )}

                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadFile('cccdBackUrl', file)}
                        accept="image/png,image/jpeg,image/webp"
                      >
                        <Button
                          icon={uploadingDoc === 'cccdBackUrl' ? <LoadingOutlined /> : <UploadOutlined />}
                          disabled={uploadingDoc === 'cccdBackUrl'}
                          size="small"
                          className="!rounded-lg font-medium text-xs text-[#6027D2] !border-[#C4B5FD]"
                        >
                          {cccdBackUrl ? 'Đổi ảnh khác' : 'Tải ảnh lên'}
                        </Button>
                      </Upload>
                    </div>

                    {/* 3. Ảnh chân dung (Selfie) */}
                    <div className="p-4 rounded-xl border border-dashed border-[#D1C9E9] bg-[#FAF8FE] flex flex-col justify-between items-center text-center">
                      <span className="text-xs font-semibold text-[#1E1B2E] mb-2">
                        Ảnh chân dung (Selfie) <span className="text-red-500">*</span>
                      </span>

                      {selfieUrl ? (
                        <div className="relative group w-full mb-3">
                          <Image
                            src={selfieUrl}
                            alt="Ảnh chân dung"
                            className="w-full h-32 object-cover rounded-lg shadow-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setSelfieUrl('')}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center hover:bg-red-700 shadow-md"
                          >
                            <DeleteOutlined className="text-xs" />
                          </button>
                        </div>
                      ) : (
                        <div className="w-full h-32 flex flex-col items-center justify-center bg-white rounded-lg border border-[#ECE7FA] mb-3 text-[#A098C2]">
                          <CameraOutlined className="text-3xl mb-1" />
                          <span className="text-[11px]">Chưa tải ảnh</span>
                        </div>
                      )}

                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadFile('selfieUrl', file)}
                        accept="image/png,image/jpeg,image/webp"
                      >
                        <Button
                          icon={uploadingDoc === 'selfieUrl' ? <LoadingOutlined /> : <UploadOutlined />}
                          disabled={uploadingDoc === 'selfieUrl'}
                          size="small"
                          className="!rounded-lg font-medium text-xs text-[#6027D2] !border-[#C4B5FD]"
                        >
                          {selfieUrl ? 'Đổi ảnh khác' : 'Tải ảnh lên'}
                        </Button>
                      </Upload>
                    </div>

                    {/* 4. Giấy phép kinh doanh / Chứng chỉ */}
                    <div className="p-4 rounded-xl border border-dashed border-[#D1C9E9] bg-[#FAF8FE] flex flex-col justify-between items-center text-center">
                      <span className="text-xs font-semibold text-[#1E1B2E] mb-2">
                        Giấy phép KD / Chứng chỉ
                      </span>

                      {businessLicenseUrl ? (
                        <div className="relative group w-full mb-3">
                          <Image
                            src={businessLicenseUrl}
                            alt="Giấy phép kinh doanh"
                            className="w-full h-32 object-cover rounded-lg shadow-xs"
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
                        <div className="w-full h-32 flex flex-col items-center justify-center bg-white rounded-lg border border-[#ECE7FA] mb-3 text-[#A098C2]">
                          <FileProtectOutlined className="text-3xl mb-1" />
                          <span className="text-[11px]">Tuỳ chọn bổ sung</span>
                        </div>
                      )}

                      <Upload
                        showUploadList={false}
                        beforeUpload={(file) => handleUploadFile('businessLicenseUrl', file)}
                        accept="image/png,image/jpeg,image/webp"
                      >
                        <Button
                          icon={uploadingDoc === 'businessLicenseUrl' ? <LoadingOutlined /> : <UploadOutlined />}
                          disabled={uploadingDoc === 'businessLicenseUrl'}
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
                      <p className="text-xs text-[#6E6A8A]">Hệ thống sẽ đối soát và giải ngân doanh thu chăm sóc lan vào tài khoản này</p>
                    </div>
                  </div>

                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item
                        name="bankName"
                        label={<span className="font-semibold text-xs text-[#4B4764]">Tên ngân hàng</span>}
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
                        label={<span className="font-semibold text-xs text-[#4B4764]">Số tài khoản ngân hàng</span>}
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
                        label={<span className="font-semibold text-xs text-[#4B4764]">Tên chủ tài khoản (In hoa không dấu)</span>}
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
