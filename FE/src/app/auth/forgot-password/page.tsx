'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Form, Input } from 'antd';
import { ArrowLeftOutlined, MailOutlined } from '@ant-design/icons';
import { authApi } from '@/lib/api';
import AuthShell from '@/features/auth/components/AuthShell';

const RESEND_SECONDS = 60;

export default function ForgotPasswordPage() {
  const [form] = Form.useForm<{ email: string }>();
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (email: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await authApi.forgotPassword(email.trim());
      setSentTo(email.trim());
      setCooldown(RESEND_SECONDS);
    } catch (err: any) {
      setError(
        err?.response?.status === 429
          ? 'Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.'
          : 'Không gửi được yêu cầu. Vui lòng kiểm tra kết nối và thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (sentTo) {
    return (
      <AuthShell>
        <div className="w-14 h-14 rounded-2xl bg-[#F1ECFD] text-[#6027D2] flex items-center justify-center text-2xl mb-4">
          <MailOutlined />
        </div>
        <h1 className="text-[25px] font-bold text-[#1E1B2E] tracking-tight m-0">Kiểm tra hộp thư</h1>
        <p className="text-[13px] text-[#6E6A8A] mt-2 mb-4 leading-relaxed">
          Nếu <b className="text-[#1E1B2E]">{sentTo}</b> có tài khoản LanCare Hub, link đặt lại mật khẩu đã
          được gửi tới email này. Link có hiệu lực 30 phút và chỉ dùng được một lần.
        </p>
        <Alert
          type="info"
          className="!rounded-xl !mb-4"
          message="Không thấy mail? Hãy xem thư mục Spam / Quảng cáo trước khi gửi lại."
        />
        {error && <Alert type="error" showIcon className="!rounded-xl !mb-4" message={error} />}
        <Button
          block
          size="large"
          disabled={cooldown > 0}
          loading={submitting}
          onClick={() => send(sentTo)}
          className="!rounded-xl !h-11 !font-semibold"
        >
          {cooldown > 0 ? `Gửi lại link sau ${cooldown} giây` : 'Gửi lại link'}
        </Button>
        <div className="text-center mt-4 space-x-3 text-[12.5px]">
          <button
            type="button"
            onClick={() => {
              setSentTo(null);
              setError(null);
            }}
            className="font-semibold text-[#6E6A8A] hover:text-[#6027D2] bg-transparent border-none p-0 cursor-pointer"
          >
            Dùng email khác
          </button>
          <span className="text-[#ECE7FA]">|</span>
          <Link href="/auth/login" className="font-semibold text-[#6027D2] hover:text-[#4e1ba8]">
            Quay lại đăng nhập
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <Link
        href="/auth/login"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#6027D2] hover:text-[#4e1ba8] mb-4 w-fit"
      >
        <ArrowLeftOutlined /> Quay lại đăng nhập
      </Link>
      <h1 className="text-[25px] sm:text-[27px] font-bold text-[#1E1B2E] tracking-tight leading-tight m-0">
        Quên mật khẩu?
      </h1>
      <p className="text-[13px] text-[#6E6A8A] mt-2 mb-5 leading-relaxed">
        Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi link đặt lại mật khẩu, link có hiệu lực trong{' '}
        <b>30 phút</b>.
      </p>
      {error && <Alert type="error" showIcon className="!rounded-xl !mb-4" message={error} />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => send(v.email)}>
        <Form.Item
          name="email"
          label={<span className="text-[12.5px] font-semibold text-[#1E1B2E]">Email</span>}
          rules={[
            { required: true, message: 'Vui lòng nhập email.' },
            { type: 'email', message: 'Email chưa đúng định dạng.' },
          ]}
        >
          <Input
            id="forgot-email"
            autoFocus
            autoComplete="email"
            prefix={<MailOutlined className="text-[#A098C2] mr-2" />}
            placeholder="email@vidu.com"
            className="h-11 text-sm"
          />
        </Form.Item>
        <Button
          id="forgot-submit-btn"
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={submitting}
          className="!rounded-xl !h-11 !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold"
        >
          Gửi link đặt lại
        </Button>
      </Form>
    </AuthShell>
  );
}
