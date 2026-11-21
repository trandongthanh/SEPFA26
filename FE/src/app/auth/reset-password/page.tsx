'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Form, Input, Spin } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, LockOutlined } from '@ant-design/icons';
import { authApi, getApiErrorCode, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';
import AuthShell from '@/features/auth/components/AuthShell';
import PasswordStrength from '@/features/auth/components/PasswordStrength';

// Trang mở từ link trong mail: /auth/reset-password?token=...
function ResetPasswordContent() {
  const router = useRouter();
  const token = useSearchParams()?.get('token') ?? '';
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [form] = Form.useForm<{ newPassword: string; confirm: string }>();
  const newPassword = Form.useWatch('newPassword', form) ?? '';
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<'form' | 'invalid' | 'done'>(token ? 'form' : 'invalid');
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: { newPassword: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await authApi.resetPassword(token, values.newPassword);
      // BE đã đăng xuất mọi phiên → xoá phiên cũ (nếu có) ở trình duyệt này.
      clearAuth();
      setState('done');
    } catch (err: any) {
      const code = getApiErrorCode(err);
      if (code === 'RESET_TOKEN_INVALID') setState('invalid');
      else if (err?.response?.status === 429) setError('Bạn thử quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.');
      else setError('Không đặt lại được mật khẩu. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  if (state === 'invalid') {
    return (
      <>
        <div className="w-14 h-14 rounded-2xl bg-[#FDECEC] text-[#C0262D] flex items-center justify-center text-2xl mb-4">
          <ClockCircleOutlined />
        </div>
        <h1 className="text-[25px] font-bold text-[#1E1B2E] tracking-tight m-0">Link không còn hiệu lực</h1>
        <p className="text-[13px] text-[#6E6A8A] mt-2 mb-5 leading-relaxed">
          Link đặt lại mật khẩu đã hết hạn (quá 30 phút), đã được dùng, hoặc bị thiếu. Hãy yêu cầu một link mới.
        </p>
        <Button
          type="primary"
          block
          size="large"
          onClick={() => router.push('/auth/forgot-password')}
          className="!rounded-xl !h-11 !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold"
        >
          Gửi link mới
        </Button>
        <Link href="/auth/login" className="text-center mt-4 text-[12.5px] font-semibold text-[#6027D2]">
          Quay lại đăng nhập
        </Link>
      </>
    );
  }

  if (state === 'done') {
    return (
      <>
        <div className="w-14 h-14 rounded-2xl bg-[#E7F6EC] text-[#15803D] flex items-center justify-center text-2xl mb-4">
          <CheckCircleOutlined />
        </div>
        <h1 className="text-[25px] font-bold text-[#1E1B2E] tracking-tight m-0">Đã đặt mật khẩu mới</h1>
        <p className="text-[13px] text-[#6E6A8A] mt-2 mb-5 leading-relaxed">
          Mật khẩu của bạn đã được đổi và mọi thiết bị đã bị đăng xuất. Hãy đăng nhập lại bằng mật khẩu mới.
        </p>
        <Button
          type="primary"
          block
          size="large"
          onClick={() => router.push('/auth/login')}
          className="!rounded-xl !h-11 !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold"
        >
          Đăng nhập
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[25px] sm:text-[27px] font-bold text-[#1E1B2E] tracking-tight leading-tight m-0">
        Đặt mật khẩu mới
      </h1>
      <p className="text-[13px] text-[#6E6A8A] mt-2 mb-5 leading-relaxed">
        Mật khẩu mới từ {PASSWORD_MIN} đến {PASSWORD_MAX} ký tự. Sau khi đổi, mọi thiết bị đang đăng nhập sẽ bị
        đăng xuất.
      </p>
      {error && <Alert type="error" showIcon className="!rounded-xl !mb-4" message={error} />}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item
          name="newPassword"
          extra={<PasswordStrength value={newPassword} />}
          label={<span className="text-[12.5px] font-semibold text-[#1E1B2E]">Mật khẩu mới</span>}
          rules={[
            { required: true, message: 'Vui lòng nhập mật khẩu mới.' },
            { min: PASSWORD_MIN, message: `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.` },
            { max: PASSWORD_MAX, message: `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.` },
          ]}
        >
          <Input.Password
            id="reset-new-password"
            autoFocus
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            prefix={<LockOutlined className="text-[#A098C2] mr-2" />}
            placeholder={`Ít nhất ${PASSWORD_MIN} ký tự`}
            className="h-11 text-sm"
          />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={<span className="text-[12.5px] font-semibold text-[#1E1B2E]">Nhập lại mật khẩu mới</span>}
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Vui lòng nhập lại mật khẩu mới.' },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || v === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('Hai mật khẩu chưa khớp.')),
            }),
          ]}
        >
          <Input.Password
            id="reset-confirm-password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            prefix={<LockOutlined className="text-[#A098C2] mr-2" />}
            placeholder="Nhập lại để xác nhận"
            className="h-11 text-sm"
          />
        </Form.Item>
        <Button
          id="reset-submit-btn"
          type="primary"
          htmlType="submit"
          block
          size="large"
          loading={submitting}
          className="!rounded-xl !h-11 !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold"
        >
          Đặt mật khẩu mới
        </Button>
      </Form>
    </>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams cần Suspense trong App Router.
  return (
    <AuthShell>
      <Suspense fallback={<div className="py-10 flex justify-center"><Spin /></div>}>
        <ResetPasswordContent />
      </Suspense>
    </AuthShell>
  );
}
