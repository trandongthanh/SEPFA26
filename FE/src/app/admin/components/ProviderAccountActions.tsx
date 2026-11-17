'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons';
import { Alert, App, Button, Input, Modal } from 'antd';
import { adminApi } from '@/lib/admin.api';
import { getApiErrorCode } from '@/lib/api';

interface Props {
  providerId: string;
  displayName: string;
  email?: string | null;
}

// Khung "Quản lý tài khoản" ở trang chi tiết nhà cung cấp:
// - Đặt lại mật khẩu: POST /admin/providers/:id/reset-password → { tempPassword } (chỉ hiện 1 lần)
// - Xóa nhà vườn:    DELETE /admin/providers/:id (xóa hồ sơ + gói + tài khoản)
export default function ProviderAccountActions({ providerId, displayName, email }: Props) {
  const router = useRouter();
  const { message } = App.useApp();

  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await adminApi.resetProviderPassword(providerId);
      setResetConfirmOpen(false);
      setTempPassword(res.tempPassword);
    } catch (err: any) {
      const code = getApiErrorCode(err);
      message.error(
        code === 'PROVIDER_NOT_FOUND'
          ? 'Không tìm thấy nhà vườn này.'
          : 'Đặt lại mật khẩu thất bại. Vui lòng thử lại.'
      );
    } finally {
      setResetting(false);
    }
  };

  const copyPassword = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      message.success('Đã sao chép mật khẩu tạm.');
    } catch {
      message.warning('Không sao chép được, hãy bôi đen mật khẩu và copy thủ công.');
    }
  };

  const openDelete = () => {
    setDeleteInput('');
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await adminApi.deleteProvider(providerId);
      message.success(`Đã xóa nhà vườn ${displayName}.`);
      setDeleteOpen(false);
      router.push('/admin/verify/providers');
    } catch (err: any) {
      const status = err?.response?.status;
      const code = getApiErrorCode(err);
      // BE chưa bắt lỗi khóa ngoại: nhà vườn đã có đơn hàng / dữ liệu liên quan → 500.
      setDeleteError(
        code === 'PROVIDER_NOT_FOUND'
          ? 'Nhà vườn này không còn tồn tại (có thể đã bị xóa trước đó).'
          : status === 500
            ? 'Không xóa được vì nhà vườn đã có đơn hàng hoặc dữ liệu liên quan trong hệ thống. Hãy từ chối hồ sơ hoặc tắt các gói dịch vụ thay vì xóa.'
            : 'Xóa nhà vườn thất bại. Vui lòng thử lại.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#ECE7FA] p-6">
      <h3 className="text-base font-semibold text-[#1E1B2E] mb-4">Quản lý tài khoản</h3>
      <div className="space-y-3">
        <div className="p-3 rounded-xl border border-[#ECE7FA] flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#1E1B2E] m-0">Đặt lại mật khẩu</p>
            <p className="text-xs text-[#6E6A8A] m-0 mt-0.5">
              Tạo mật khẩu tạm mới. Mật khẩu cũ hết hiệu lực ngay.
            </p>
          </div>
          <Button
            icon={<KeyOutlined />}
            onClick={() => setResetConfirmOpen(true)}
            className="!rounded-xl !border-[#ECE7FA] !text-[#6027D2] !font-semibold"
          >
            Đặt lại
          </Button>
        </div>

        <div className="p-3 rounded-xl border border-[#FCA5A5] bg-[#FFF7F7] flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[#C0262D] m-0">Xóa nhà vườn</p>
            <p className="text-xs text-[#6E6A8A] m-0 mt-0.5">
              Xóa vĩnh viễn hồ sơ, gói dịch vụ và tài khoản. Không xóa được nếu đã có đơn hàng.
            </p>
          </div>
          <Button danger icon={<DeleteOutlined />} onClick={openDelete} className="!rounded-xl !font-semibold">
            Xóa
          </Button>
        </div>
      </div>

      {/* Bước 1: xác nhận đặt lại mật khẩu */}
      <Modal
        title={<span className="font-bold text-[#1E1B2E]">Đặt lại mật khẩu cho {displayName}?</span>}
        open={resetConfirmOpen}
        onCancel={() => !resetting && setResetConfirmOpen(false)}
        onOk={handleReset}
        okText="Đặt lại mật khẩu"
        cancelText="Hủy"
        confirmLoading={resetting}
        okButtonProps={{ className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl' }}
        cancelButtonProps={{ className: '!rounded-xl' }}
        centered
      >
        <p className="text-sm text-[#4B4764]">
          Hệ thống tạo một mật khẩu tạm mới{email ? <> cho <b>{email}</b></> : null}. Mật khẩu hiện tại
          sẽ <b>không dùng được nữa</b>.
        </p>
      </Modal>

      {/* Bước 2: hiện mật khẩu tạm — chỉ một lần */}
      <Modal
        title={<span className="font-bold text-[#1E1B2E]">Đã đặt lại mật khẩu</span>}
        open={tempPassword !== null}
        closable={false}
        maskClosable={false}
        footer={
          <Button
            type="primary"
            onClick={() => setTempPassword(null)}
            className="!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl"
          >
            Tôi đã lưu mật khẩu
          </Button>
        }
        centered
      >
        <div className="space-y-3">
          <p className="text-sm text-[#4B4764] m-0">
            Mật khẩu tạm chỉ hiện <b>một lần</b>. Hãy sao chép và gửi cho nhà vườn qua kênh riêng (Zalo,
            điện thoại), nhắc họ đổi mật khẩu sau khi đăng nhập.
          </p>
          <div className="flex items-center gap-2 p-3 rounded-xl border border-dashed border-[#6027D2] bg-[#F6F4FC]">
            <code className="flex-1 font-mono text-lg tracking-wider text-[#4E1BA8] select-all break-all">
              {tempPassword}
            </code>
            <Button icon={<CopyOutlined />} onClick={copyPassword} className="!rounded-xl">
              Sao chép
            </Button>
          </div>
        </div>
      </Modal>

      {/* Xóa: phải gõ đúng tên nhà vườn */}
      <Modal
        title={<span className="font-bold text-[#C0262D]">Xóa vĩnh viễn nhà vườn này?</span>}
        open={deleteOpen}
        onCancel={() => !deleting && setDeleteOpen(false)}
        onOk={handleDelete}
        okText="Xóa vĩnh viễn"
        cancelText="Hủy"
        confirmLoading={deleting}
        okButtonProps={{
          danger: true,
          disabled: deleteInput.trim() !== displayName.trim(),
          className: '!rounded-xl',
        }}
        cancelButtonProps={{ className: '!rounded-xl' }}
        centered
      >
        <div className="space-y-3">
          <p className="text-sm text-[#4B4764] m-0">
            Sẽ xóa <b>hồ sơ, tất cả gói dịch vụ và tài khoản đăng nhập</b> của {displayName}. Thao tác{' '}
            <b>không thể hoàn tác</b>.
          </p>
          <div className="space-y-1">
            <label htmlFor="confirm-provider-name" className="text-xs text-[#1E1B2E]">
              Gõ <b>{displayName}</b> để xác nhận
            </label>
            <Input
              id="confirm-provider-name"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              autoComplete="off"
              className="!rounded-xl"
            />
          </div>
          {deleteError && <Alert type="error" showIcon message={deleteError} />}
        </div>
      </Modal>
    </div>
  );
}
