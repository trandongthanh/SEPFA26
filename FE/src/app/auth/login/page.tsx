'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Form, Input, Button, Checkbox, App } from 'antd';
import {
  MailOutlined,
  LockOutlined,
  ArrowRightOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import { authApi, type LoginPayload } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((state) => state.setAuth);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { message } = App.useApp();

  // Guard: đã đăng nhập → về coming-soon
  useEffect(() => {
    if (isAuthenticated) router.replace('/coming-soon');
  }, [isAuthenticated, router]);

  const onFinish = async (values: LoginPayload) => {
    try {
      setLoading(true);
      const res = await authApi.login({
        email: values.email.trim(),
        password: values.password,
      });

      setAuth(res.account, {
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });

      message.success('Đăng nhập thành công!');
      router.push('/coming-soon');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string }; status?: number } };
      const rawMsg = axiosErr.response?.data?.message;
      let errorMsg = rawMsg;

      if (rawMsg === 'INVALID_CREDENTIALS') {
        errorMsg = 'Email hoặc mật khẩu không chính xác.';
      } else if (rawMsg === 'ACCOUNT_SUSPENDED') {
        errorMsg = 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.';
      } else if (rawMsg === 'ACCOUNT_INACTIVE') {
        errorMsg = 'Tài khoản chưa được kích hoạt hoặc đang chờ duyệt.';
      } else if (!errorMsg) {
        errorMsg =
          axiosErr.response?.status === 401
            ? 'Email hoặc mật khẩu không chính xác.'
            : 'Đăng nhập thất bại, vui lòng thử lại sau.';
      }

      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-[#F6F4FC]">
      <div className="w-full max-w-[940px] bg-white rounded-[26px] shadow-[0_20px_60px_rgba(96,39,210,0.1)] overflow-hidden grid grid-cols-1 md:grid-cols-2 border border-[#ECE7FA]">

        {/* ===== CỘT TRÁI: ẢNH HOA LAN (1:1 VUÔNG VỨC, NẰM TRỌN VẸN 100%) ===== */}
        <div className="relative min-h-[380px] md:min-h-[500px] flex flex-col justify-between p-6 md:p-7 text-white overflow-hidden select-none">
          
          {/* Ảnh gốc 1024x1024 tràn viền tự nhiên */}
          <Image
            src="/Login-image.webp"
            alt="LanCare Hub"
            fill
            priority
            className="object-cover object-[53%_center]"
            sizes="(max-width: 768px) 100vw, 50vw"
          />

          {/* Lớp gradient chân mượt mà làm nổi bật chữ trắng */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#1d0738]/95 via-[#2a0e52]/40 via-35% to-transparent" />

          {/* Top: Logo + Slogan */}
          <div className="relative z-10 flex items-center gap-2.5">
            <div className="relative w-9 h-9 rounded-full overflow-hidden border border-purple-200/80 shadow-sm bg-white/80 shrink-0">
              <Image
                src="/Login-image.webp"
                alt="Logo icon"
                fill
                sizes="36px"
                className="object-cover scale-150"
              />
            </div>
            <div>
              <h2 className="font-bold text-[17px] leading-tight text-[#6027D2] tracking-wide">
                LanCare Hub
              </h2>
              <p className="text-[11px] font-medium text-white">
                Kết nối người yêu lan &nbsp;·&nbsp; Chăm lan dễ dàng hơn
              </p>
            </div>
          </div>

          {/* Giữa: Thoáng đãng để lộ trọn vẹn hoa lan pha lê */}
          <div className="flex-1" />

          {/* Bottom: Tiêu đề + Giới thiệu + 3 badges */}
          <div className="relative z-10 space-y-2.5 pt-3">
            <div>
              <h3 className="text-[18px] font-bold text-white tracking-wide">
                LanCare Hub
              </h3>
              <p className="text-[12px] text-white/90 leading-relaxed max-w-[340px] mt-1 font-normal">
                Không chỉ là nơi chia sẻ, mà còn là người bạn đồng hành trên hành trình chăm sóc lan của bạn.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[11px] text-purple-100/90 pt-0.5">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-purple-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span>Chia sẻ kinh nghiệm</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-purple-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>Hỗ trợ chuyên môn</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-purple-200 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>Cộng đồng đam mê</span>
              </div>
            </div>
          </div>
        </div>

        {/* ===== CỘT PHẢI: FORM ĐĂNG NHẬP ===== */}
        <div className="p-6 sm:p-7 md:py-8 md:px-9 flex flex-col justify-center bg-white">

          {/* Logo icon bo góc */}
          <div className="mb-1">
            <div className="relative w-10 h-10 rounded-2xl overflow-hidden border border-[#ECE7FA] shadow-sm bg-[#F9F8FD]">
              <Image
                src="/Login-image.webp"
                alt="LanCare Hub logo"
                fill
                sizes="40px"
                className="object-cover scale-150"
              />
            </div>
          </div>

          <div className="mb-4 mt-2">
            <h1 className="text-[25px] sm:text-[27px] font-bold text-[#1E1B2E] tracking-tight leading-tight">
              Chào mừng trở lại
            </h1>
            <p className="text-[13px] text-[#6E6A8A] mt-1">
              Đăng nhập để tiếp tục hành trình cùng LanCare Hub
            </p>
          </div>

          <Form
            name="login_form"
            layout="vertical"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            autoComplete="off"
            requiredMark={false}
          >
            {/* Email / Username */}
            <Form.Item
              label={<span className="text-[13px] font-medium text-[#1E1B2E]">Email hoặc tên đăng nhập</span>}
              name="email"
              rules={[
                { required: true, message: 'Vui lòng nhập email hoặc tên đăng nhập!' },
              ]}
              className="!mb-3"
            >
              <Input
                id="login-email"
                prefix={<MailOutlined className="text-[#A098C2] mr-2 text-[15px]" />}
                placeholder="Nhập email hoặc tên đăng nhập"
                className="h-11 text-sm [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* Password */}
            <Form.Item
              label={<span className="text-[13px] font-medium text-[#1E1B2E]">Mật khẩu</span>}
              name="password"
              rules={[{ required: true, message: 'Vui lòng nhập mật khẩu!' }]}
              className="!mb-2.5"
            >
              <Input.Password
                id="login-password"
                prefix={<LockOutlined className="text-[#A098C2] mr-2 text-[15px]" />}
                placeholder="Nhập mật khẩu"
                className="h-11 text-sm [&>input]:!leading-normal"
              />
            </Form.Item>

            {/* Remember & Forgot Password */}
            <div className="flex items-center justify-between mb-4 mt-1">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox defaultChecked>
                  <span className="text-[12px] text-[#6E6A8A] select-none">
                    Ghi nhớ đăng nhập
                  </span>
                </Checkbox>
              </Form.Item>
              <button
                type="button"
                onClick={() => message.info('Tính năng quên mật khẩu đang được phát triển.')}
                className="text-[12px] font-semibold text-[#6027D2] hover:text-[#4e1ba8] transition-colors cursor-pointer bg-transparent border-none p-0"
              >
                Quên mật khẩu?
              </button>
            </div>

            {/* Submit Button */}
            <Form.Item className="!mb-3.5">
              <Button
                id="login-submit-btn"
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                className="!h-11 text-[15px] font-medium rounded-full flex items-center justify-center gap-2"
              >
                Đăng nhập <ArrowRightOutlined className="text-xs" />
              </Button>
            </Form.Item>

            {/* Divider */}
            <div className="relative my-3.5 text-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#ECE7FA]" />
              </div>
              <span className="relative bg-white px-3.5 text-[11px] text-[#A098C2] uppercase tracking-widest">
                Hoặc
              </span>
            </div>

            {/* Register Link */}
            <div className="flex items-center justify-center gap-1.5 text-[12px] text-[#6E6A8A]">
              <UserAddOutlined className="text-[#6027D2] text-[14px]" />
              <span>Bạn chưa có tài khoản?</span>
              <Link
                href="/auth/register"
                className="font-semibold text-[#6027D2] hover:text-[#4e1ba8] hover:underline transition"
              >
                Đăng ký ngay →
              </Link>
            </div>
          </Form>
        </div>
      </div>
    </main>
  );
}
