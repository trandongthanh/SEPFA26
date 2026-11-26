'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  App,
  Button,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  FileDoneOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import {
  PaymentClaimItem,
  PaymentClaimStatus,
  paymentClaimsApi,
} from '@/lib/payment-claims.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

const STATUS_TAGS: Record<PaymentClaimStatus, { color: string; label: string; icon: React.ReactNode }> = {
  OPEN: { color: 'gold', label: 'Chờ đối soát', icon: <ClockCircleOutlined /> },
  RESOLVED: { color: 'green', label: 'Đã hoàn tất', icon: <CheckCircleOutlined /> },
  REJECTED: { color: 'red', label: 'Đã từ chối', icon: <CloseCircleOutlined /> },
};

export default function AdminPaymentClaimsPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PaymentClaimItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [statusFilter, setStatusFilter] = useState<'ALL' | PaymentClaimStatus>('ALL');
  const [searchAmount, setSearchAmount] = useState<number | undefined>(undefined);

  // Modal Từ chối
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingClaim, setRejectingClaim] = useState<PaymentClaimItem | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectForm] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await paymentClaimsApi.listForAdmin({
        page,
        limit,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        amount: searchAmount || undefined,
      });
      setItems(res.data);
      setTotal(res.total);
    } catch {
      message.error('Không thể tải danh sách phiếu báo chuyển tiền.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && user?.role === 'ADMIN') {
      fetchData();
    }
  }, [isAuthenticated, user, page, limit, statusFilter, searchAmount]);

  const handleOpenReject = (claim: PaymentClaimItem) => {
    setRejectingClaim(claim);
    rejectForm.resetFields();
    setRejectModalOpen(true);
  };

  const handleConfirmReject = async (values: { reason: string }) => {
    if (!rejectingClaim) return;
    setRejectSubmitting(true);
    try {
      await paymentClaimsApi.reject(rejectingClaim.id, values.reason.trim());
      message.success('Đã từ chối phiếu báo chuyển tiền.');
      setRejectModalOpen(false);
      setRejectingClaim(null);
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Từ chối phiếu thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setRejectSubmitting(false);
    }
  };

  const columns: ColumnsType<PaymentClaimItem> = [
    {
      title: 'Mã đơn',
      key: 'orderCode',
      width: 130,
      render: (_, r) => (
        <div>
          {r.orderCode ? (
            <span className="font-bold text-sm text-[#6027D2]">#{r.orderCode}</span>
          ) : (
            <span className="text-xs text-[#8B86A4]">Không rõ đơn</span>
          )}
          {r.orderStatus && (
            <span className="block text-[11px] text-[#8B86A4]">{r.orderStatus}</span>
          )}
        </div>
      ),
    },
    {
      title: 'Đối tượng & Người gửi',
      key: 'party',
      width: 170,
      render: (_, r) => (
        <div className="space-y-1">
          <Tag color={r.party === 'CUSTOMER' ? 'blue' : 'green'} className="!rounded-md !m-0 !text-xs">
            {r.party === 'CUSTOMER' ? 'Khách hàng' : 'Nhà vườn'}
          </Tag>
          <p className="text-xs font-semibold text-[#1E1B2E] m-0">
            {r.submittedBy?.fullName || 'Chưa cập nhật tên'}
          </p>
        </div>
      ),
    },
    {
      title: 'Số tiền khai',
      key: 'amount',
      width: 140,
      render: (_, r) => (
        <span className="font-extrabold text-sm text-[#1E1B2E]">
          {Number(r.amount).toLocaleString('vi-VN')} đ
        </span>
      ),
    },
    {
      title: 'Giờ chuyển & Ghi chú',
      key: 'note',
      render: (_, r) => (
        <div className="space-y-1 text-xs">
          {r.transferredAt ? (
            <p className="text-[#4A4568] m-0">
              🕒 Giờ chuyển: <strong>{dayjs(r.transferredAt).format('DD/MM/YYYY HH:mm')}</strong>
            </p>
          ) : (
            <span className="text-[#8B86A4] block">Chưa ghi giờ chuyển</span>
          )}
          {r.note && (
            <p className="text-[#1E1B2E] m-0 bg-[#F9F7FE] p-2 rounded-lg border border-[#ECE7FA] line-clamp-2">
              {r.note}
            </p>
          )}
        </div>
      ),
    },
    {
      title: 'Ảnh sao kê',
      key: 'photos',
      width: 130,
      render: (_, r) => (
        <Image.PreviewGroup>
          <div className="flex flex-wrap gap-1.5">
            {r.photos?.map((p, idx) => (
              <Image
                key={p.id || idx}
                src={p.photoUrl}
                alt="Sao kê"
                width={42}
                height={42}
                className="rounded-lg object-cover border border-[#DDD6FE]"
              />
            ))}
          </div>
        </Image.PreviewGroup>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 140,
      render: (_, r) => {
        const info = STATUS_TAGS[r.status];
        return (
          <div className="space-y-1">
            <Tag color={info.color} icon={info.icon} className="!rounded-md !m-0 !text-xs">
              {info.label}
            </Tag>
            {r.rejectReason && (
              <Tooltip title={r.rejectReason}>
                <p className="text-[11px] text-rose-600 line-clamp-2 m-0 cursor-pointer">
                  Lý do: {r.rejectReason}
                </p>
              </Tooltip>
            )}
            {r.refund?.receiptUrl && (
              <div className="pt-1">
                <Image
                  src={r.refund.receiptUrl}
                  alt="Biên lai hoàn"
                  width={36}
                  height={36}
                  className="rounded object-cover border border-emerald-300"
                />
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Thời gian',
      key: 'createdAt',
      width: 130,
      render: (_, r) => (
        <span className="text-xs text-[#8B86A4]">
          {dayjs(r.createdAt).format('DD/MM/YYYY HH:mm')}
        </span>
      ),
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_, r) => (
        <div>
          {r.status === 'OPEN' ? (
            <Button
              danger
              size="small"
              onClick={() => handleOpenReject(r)}
              className="!rounded-lg text-xs"
            >
              Từ chối
            </Button>
          ) : (
            <span className="text-xs text-[#A098C2]">Đã xong</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-screen bg-[#F6F4FC] overflow-hidden">
      <AdminSidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <AdminHeader searchPlaceholder="Tìm kiếm giao dịch, người dùng..." />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-4">
          {/* Header Title */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#1E1B2E] flex items-center gap-2">
                <FileDoneOutlined className="text-[#6027D2]" />
                Phiếu báo đã chuyển tiền
              </h1>
              <p className="text-xs text-[#6E6A8A] mt-1">
                Danh sách khiếu nại chuyển khoản từ khách hàng và nhà vườn khi tiền chưa tự động nhận diện.
              </p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchData}
              className="!rounded-xl self-start sm:self-auto"
            >
              Làm mới
            </Button>
          </div>

          {/* Filters Bar */}
          <div className="p-4 bg-white rounded-2xl border border-[#ECE7FA] flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={statusFilter}
              onChange={(val) => {
                setStatusFilter(val as any);
                setPage(1);
              }}
              options={[
                { label: 'Tất cả', value: 'ALL' },
                { label: 'Chờ đối soát (OPEN)', value: 'OPEN' },
                { label: 'Đã hoàn tất (RESOLVED)', value: 'RESOLVED' },
                { label: 'Đã từ chối (REJECTED)', value: 'REJECTED' },
              ]}
              className="!bg-[#F6F4FC]"
            />

            <div className="w-64">
              <InputNumber
                placeholder="Lọc đúng số tiền khai (VNĐ)"
                className="!w-full !rounded-xl"
                value={searchAmount}
                onChange={(val) => {
                  setSearchAmount(val ?? undefined);
                  setPage(1);
                }}
                formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(val) => Number(val?.replace(/\$\s?|(,*)/g, '') || 0)}
                prefix={<SearchOutlined className="text-gray-400 mr-1" />}
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-[#ECE7FA] overflow-hidden">
            <Table
              dataSource={items}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={{
                current: page,
                pageSize: limit,
                total,
                onChange: (p) => setPage(p),
                showTotal: (tot) => `Tổng cộng ${tot} phiếu`,
              }}
              scroll={{ x: 1000 }}
            />
          </div>
        </main>
      </div>

      {/* Modal: Từ chối phiếu */}
      <Modal
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        title={
          <div className="text-base font-bold text-rose-600 flex items-center gap-1.5">
            <CloseCircleOutlined />
            <span>Từ chối phiếu báo chuyển tiền</span>
          </div>
        }
        footer={null}
        className="!rounded-2xl"
      >
        <Form form={rejectForm} layout="vertical" onFinish={handleConfirmReject} className="pt-2">
          <p className="text-xs text-[#6E6A8A] mb-3">
            Vui lòng nhập lý do từ chối rõ ràng (5 – 500 ký tự) để người nộp có thể nắm thông tin và
            nộp lại biên lai hợp lệ nếu cần.
          </p>

          <Form.Item
            name="reason"
            label="Lý do từ chối"
            rules={[
              { required: true, message: 'Vui lòng nhập lý do từ chối' },
              { min: 5, message: 'Tối thiểu 5 ký tự' },
              { max: 500, message: 'Tối đa 500 ký tự' },
            ]}
          >
            <Input.TextArea
              rows={4}
              placeholder="VD: Ảnh sao kê không rõ số tiền hoặc thời gian chuyển khoản..."
              className="!rounded-xl"
            />
          </Form.Item>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#ECE7FA]">
            <Button onClick={() => setRejectModalOpen(false)} disabled={rejectSubmitting}>
              Hủy
            </Button>
            <Button
              danger
              type="primary"
              htmlType="submit"
              loading={rejectSubmitting}
              className="!rounded-xl"
            >
              Xác nhận từ chối
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}

