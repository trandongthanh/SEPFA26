'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, App, Form, Input, Modal } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { authApi, getApiErrorCode, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/api';
import { useAuthStore } from '@/lib/auth.store';
import PasswordStrength from './PasswordStrength';

interface FormValues {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

// Đổi mật khẩu khi đang đăng nhập (admin + nhà vườn). PATCH /accounts/me/password.
// BE đăng xuất MỌI phiên kể cả máy hiện tại → đổi xong thì xoá phiên và về trang đăng nhập.
export default function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { message } = App.useApp();
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const [form] = Form.useForm<FormValues>();
  const newPassword = Form.useWatch('newPassword', form) ?? '';
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (submitting) return;
    form.resetFields();
    onClose();
  };

  const submit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSubmitting(true);
    try {
      await authApi.changePassword(values.currentPassword, values.newPassword);
      clearAuth();
      message.success('Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.');
      form.resetFields();
      onClose();
      router.replace('/auth/login');
    } catch (err: any) {
      const code = getApiErrorCode(err);
      if (code === 'CURRENT_PASSWORD_INCORRECT') {
        form.setFields([{ name: 'currentPassword', errors: ['Mật khẩu hiện tại không đúng.'] }]);
      } else {
        message.error('Không đổi được mật khẩu. Vui lòng thử lại.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={<span className="font-bold text-[#1E1B2E]">Đổi mật khẩu</span>}
      open={open}
      onCancel={close}
      onOk={submit}
      okText="Đổi mật khẩu"
      cancelText="Hủy"
      confirmLoading={submitting}
      okButtonProps={{ id: 'change-password-submit', className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl' }}
      cancelButtonProps={{ className: '!rounded-xl' }}
      forceRender
      centered
    >
      <Alert
        type="warning"
        showIcon
        className="!rounded-xl !mb-4"
        message={
          <>
            Sau khi đổi, bạn sẽ bị <b>đăng xuất trên mọi thiết bị</b> (kể cả máy này) và cần đăng nhập lại bằng
            mật khẩu mới.
          </>
        }
      />
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item
          name="currentPassword"
          label={<span className="text-[12.5px] font-semibold">Mật khẩu hiện tại</span>}
          rules={[{ required: true, message: 'Vui lòng nhập mật khẩu hiện tại.' }]}
        >
          <Input.Password
            id="change-current-password"
            autoComplete="current-password"
            prefix={<LockOutlined className="text-[#A098C2] mr-1" />}
            placeholder="Mật khẩu đang dùng (hoặc mật khẩu tạm admin gửi)"
          />
        </Form.Item>
        <Form.Item
          name="newPassword"
          extra={<PasswordStrength value={newPassword} />}
          label={<span className="text-[12.5px] font-semibold">Mật khẩu mới</span>}
          dependencies={['currentPassword']}
          rules={[
            { required: true, message: 'Vui lòng nhập mật khẩu mới.' },
            { min: PASSWORD_MIN, message: `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.` },
            { max: PASSWORD_MAX, message: `Mật khẩu tối đa ${PASSWORD_MAX} ký tự.` },
            ({ getFieldValue }) => ({
              validator: (_, v) =>
                !v || v !== getFieldValue('currentPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('Mật khẩu mới phải khác mật khẩu hiện tại.')),
            }),
          ]}
        >
          <Input.Password
            id="change-new-password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            prefix={<LockOutlined className="text-[#A098C2] mr-1" />}
            placeholder={`Ít nhất ${PASSWORD_MIN} ký tự`}
          />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={<span className="text-[12.5px] font-semibold">Nhập lại mật khẩu mới</span>}
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
            id="change-confirm-password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            prefix={<LockOutlined className="text-[#A098C2] mr-1" />}
            placeholder="Nhập lại để xác nhận"
          />
        </Form.Item>
        {/* Cho phép bấm Enter để gửi */}
        <button type="submit" hidden aria-hidden />
      </Form>
    </Modal>
  );
}
