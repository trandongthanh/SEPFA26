'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Checkbox, App } from 'antd';
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  LockOutlined,
  ArrowRightOutlined,
  CheckCircleFilled,
} from '@ant-design/icons';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';
import { useAgreementStore } from '@/stores/agreement.store';
import type { CheckboxChangeEvent } from 'antd/es/checkbox';

interface RegisterFormValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword?: string;
  agree?: boolean;
}

export default function RegisterPage() {
  const router = useRouter();
  const [form] = Form.useForm<RegisterFormValues>();
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Agreement store
  const termsAgreed = useAgreementStore((state) => state.termsAgreed);
  const privacyAgreed = useAgreementStore((state) => state.privacyAgreed);
  const registerDraft = useAgreementStore((state) => state.registerDraft);
  const setRegisterDraft = useAgreementStore((state) => state.setRegisterDraft);
  const setBothAgreed = useAgreementStore((state) => state.setBothAgreed);
  const resetAgreements = useAgreementStore((state) => state.resetAgreements);

  const bothAgreed = termsAgreed && privacyAgreed;

  // Khôi phục bản nháp nếu người dùng vừa quay lại từ trang điều khoản/chính sách
  useEffect(() => {
    if (registerDraft) {
      form.setFieldsValue(registerDraft);
    }
  }, [registerDraft, form]);

  // Đồng bộ trạng thái ô tick đồng ý với store
  useEffect(() => {
    form.setFieldValue('agree', bothAgreed);
  }, [bothAgreed, form]);

  // Guard: đã đăng nhập → về coming-soon
  useEffect(() => {
    if (isAuthenticated) router.replace('/coming-soon');
  }, [isAuthenticated, router]);

  const navigateToTerms = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRegisterDraft(form.getFieldsValue());
    router.push('/auth/terms');
  };

  const navigateToPrivacy = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRegisterDraft(form.getFieldsValue());
    router.push('/auth/privacy');
  };

  const handleAgreeCheckboxChange = (e: CheckboxChangeEvent) => {
    const checked = e?.target ? Boolean(e.target.checked) : Boolean(e);
    setBothAgreed(checked);
  };

  const onFinish = async (values: RegisterFormValues) => {
    if (!bothAgreed) {
      message.error('Vui lòng đọc và đồng ý cả Điều khoản dịch vụ và Chính sách bảo mật trước khi tiếp tục!');
      return;
    }

    try {
      setLoading(true);
      await authApi.register({
        fullName: values.fullName.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        password: values.password,
        role: 'PROVIDER',
        providerType: 'NURSERY',
        gpsLat: 10.762622,
        gpsLng: 106.660172,
      });

      // Đăng ký thành công → xóa bản nháp và reset trạng thái đồng ý
      resetAgreements();

      message.success('Đăng ký tài khoản thành công! Vui lòng đăng nhập.');
      router.push('/auth/login');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] }; status?: number } };
      const rawMsg = axiosErr.response?.data?.message;
      let errorMsg = Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg;

      if (rawMsg === 'EMAIL_EXISTS') {
        errorMsg = 'Email này đã được sử dụng. Vui lòng chọn email khác hoặc đăng nhập.';
      } else if (rawMsg === 'PHONE_EXISTS') {
        errorMsg = 'Số điện thoại này đã được sử dụng. Vui lòng kiểm tra lại.';
      } else if (!errorMsg) {
        errorMsg =
          axiosErr.response?.status === 409
            ? 'Email hoặc số điện thoại này đã được sử dụng.'
            : 'Đăng ký không thành công, vui lòng thử lại sau.';
      }

      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-3 sm:p-4 bg-[#F6F4FC]">
      <div className="w-full max-w-[880px] bg-white rounded-[24px] shadow-[0_20px_60px_rgba(96,39,210,0.08)] overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_1.15fr] border border-[#ECE7FA]">

        {/* ===== CỘT TRÁI: ẢNH HOA LAN TRÀN VIỀN ===== */}
        <div className="relative min-h-[300px] md:min-h-[540px] hidden md:block overflow-hidden select-none">
          <Image
            src="/Login-image.webp"
            alt="LanCare Hub"
            fill
            priority
            className="object-cover object-center"
            sizes="(max-width: 768px) 100vw, 50vw"
          />
        </div>

        {/* ===== CỘT PHẢI: FORM ĐĂNG KÝ (ĐÃ XÓA LOGO TRÙNG LẶP, VỪA VẶN 100% MÀN HÌNH) ===== */}
        <div className="py-6 px-6 sm:px-8 flex flex-col justify-center bg-white">

          {/* Tiêu đề & Giới thiệu */}
          <div className="mb-3">
            <h1 className="text-[22px] sm:text-[24px] font-bold text-[#1E1B2E] tracking-tight leading-tight">
              Đăng ký Provider
            </h1>
            <p className="text-[12.5px] text-[#6E6A8A] mt-1 leading-snug">
              Tạo tài khoản để trải nghiệm dịch vụ chăm sóc hoa lan cao cấp.
            </p>
          </div>

          {/* Form 5 fields chuẩn Ant Design */}
          <Form
            form={form}
            name="register_form"
            layout="vertical"
            onFinish={onFinish}
            autoComplete="off"
            requiredMark={false}
          >
            {/* 1. Họ và tên */}
            <Form.Item
              label={
                <span className="text-[12px] font-medium text-[#1E1B2E] leading-none flex items-center">
                  Họ và tên <span className="text-red-500 font-bold ml-1">*</span>
                </span>
              }
              name="fullName"
              rules={[
                { required: true, message: 'Vui lòng nhập họ và tên!' },
                { min: 2, message: 'Tối thiểu 2 ký tự!' },
              ]}
              className="!mb-2"
            >
              <Input
                id="register-fullname"
                prefix={<UserOutlined className="text-[#A098C2] mr-2 text-[14px]" />}
                placeholder="Nhập họ và tên của bạn"
                className="h-[41px] text-[13.5px] [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* 2. Email */}
            <Form.Item
              label={
                <span className="text-[12px] font-medium text-[#1E1B2E] leading-none flex items-center">
                  Email <span className="text-red-500 font-bold ml-1">*</span>
                </span>
              }
              name="email"
              rules={[
                { required: true, message: 'Vui lòng nhập email!' },
                { type: 'email', message: 'Email không hợp lệ!' },
              ]}
              className="!mb-2"
            >
              <Input
                id="register-email"
                prefix={<MailOutlined className="text-[#A098C2] mr-2 text-[14px]" />}
                placeholder="ví dụ: ten@email.com"
                className="h-[41px] text-[13.5px] [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* 3. Số điện thoại */}
            <Form.Item
              label={
                <span className="text-[12px] font-medium text-[#1E1B2E] leading-none flex items-center">
                  Số điện thoại <span className="text-red-500 font-bold ml-1">*</span>
                </span>
              }
              name="phone"
              rules={[
                { required: true, message: 'Vui lòng nhập số điện thoại!' },
                {
                  pattern: /^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/,
                  message: 'SĐT Việt Nam không hợp lệ!',
                },
              ]}
              className="!mb-2"
            >
              <Input
                id="register-phone"
                prefix={<PhoneOutlined className="text-[#A098C2] mr-2 text-[14px]" />}
                placeholder="Nhập số điện thoại"
                className="h-[41px] text-[13.5px] [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* 4. Mật khẩu */}
            <Form.Item
              label={
                <span className="text-[12px] font-medium text-[#1E1B2E] leading-none flex items-center">
                  Mật khẩu <span className="text-red-500 font-bold ml-1">*</span>
                </span>
              }
              name="password"
              rules={[
                { required: true, message: 'Vui lòng nhập mật khẩu!' },
                { min: 8, message: 'Mật khẩu từ 8 ký tự!' },
              ]}
              className="!mb-2"
            >
              <Input.Password
                id="register-password"
                prefix={<LockOutlined className="text-[#A098C2] mr-2 text-[14px]" />}
                placeholder="Tạo mật khẩu an toàn"
                className="h-[41px] text-[13.5px] [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* 5. Xác nhận mật khẩu */}
            <Form.Item
              label={
                <span className="text-[12px] font-medium text-[#1E1B2E] leading-none flex items-center">
                  Xác nhận mật khẩu <span className="text-red-500 font-bold ml-1">*</span>
                </span>
              }
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Vui lòng xác nhận mật khẩu!' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('Mật khẩu không khớp!'));
                  },
                }),
              ]}
              className="!mb-2.5"
            >
              <Input.Password
                id="register-confirm-password"
                prefix={<LockOutlined className="text-[#A098C2] mr-2 text-[14px]" />}
                placeholder="Nhập lại mật khẩu"
                className="h-[41px] text-[13.5px] [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* Điều khoản */}
            <Form.Item
              name="agree"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, value) =>
                    value && bothAgreed
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error('Vui lòng đọc và đồng ý cả Điều khoản dịch vụ và Chính sách bảo mật!')
                        ),
                },
              ]}
              className="!mb-3"
            >
              <Checkbox onChange={handleAgreeCheckboxChange}>
                <span className="text-[11.5px] text-[#6E6A8A] select-none">
                  Tôi đồng ý với{' '}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={navigateToTerms}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigateToTerms(e);
                    }}
                    className="font-semibold text-[#6027D2] hover:underline cursor-pointer inline"
                  >
                    Điều khoản dịch vụ
                  </span>
                  {' '}và{' '}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={navigateToPrivacy}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigateToPrivacy(e);
                    }}
                    className="font-semibold text-[#6027D2] hover:underline cursor-pointer inline"
                  >
                    Chính sách bảo mật
                  </span>
                </span>
              </Checkbox>
            </Form.Item>

            {/* Nút Tạo tài khoản */}
            <Form.Item className="!mb-2.5">
              <Button
                id="register-submit-btn"
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                className="!h-[42px] text-[14.5px] font-medium rounded-full flex items-center justify-center gap-1.5"
              >
                Tạo tài khoản <ArrowRightOutlined className="text-xs" />
              </Button>
            </Form.Item>

            {/* Badge thông báo màu xanh */}
            <div className="py-1.5 px-3 mb-2.5 rounded-xl bg-[#ecfdf5] border border-emerald-200/80 flex items-center justify-center gap-1.5 text-[11px] text-emerald-700 font-medium">
              <CheckCircleFilled className="text-emerald-500 text-xs shrink-0" />
              <span>Bạn có thể bắt đầu tìm dịch vụ ngay sau khi đăng ký</span>
            </div>

            {/* Link chuyển Đăng nhập */}
            <div className="text-center text-[12px] text-[#6E6A8A]">
              Đã có tài khoản?{' '}
              <Link
                href="/auth/login"
                className="font-semibold text-[#6027D2] hover:underline transition"
              >
                Đăng nhập
              </Link>
            </div>
          </Form>
        </div>
      </div>
    </main>
  );
}
