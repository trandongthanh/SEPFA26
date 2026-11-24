'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BankOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Segmented,
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { getApiErrorCode } from '@/lib/api';
import {
  DisbursementItem,
  DisbursementStatus,
  DisbursementType,
  adminApi,
} from '@/lib/admin.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

type FilterStatus = 'ALL' | DisbursementStatus;

// Nhãn từng loại lệnh chi. Đơn bình thường sinh PAYOUT + SECURITY_RETURN (vườn) + DECLARED_RETURN (khách);
// sau tranh chấp có thêm REFUND / COMPENSATION (khách) hoặc DECLARED_FORFEIT (vườn).
const TYPE_LABELS: Record<DisbursementType, string> = {
  PAYOUT: 'Tiền công cho vườn',
  SECURITY_RETURN: 'Trả lại tiền bảo đảm cho vườn',
  DECLARED_FORFEIT: 'Tiền khai giá của khách chuyển cho vườn',
  REFUND: 'Hoàn tiền công cho khách',
  COMPENSATION: 'Đền giá trị cây cho khách',
  DECLARED_RETURN: 'Trả lại tiền khai giá cho khách',
  // Hai loại chi ngay (không chờ 3 ngày): thối tiền chuyển dư và hoàn khoản tiền chưa khớp.
  OVERPAY_RETURN: 'Trả lại tiền chuyển dư',
  UNMATCHED_REFUND: 'Hoàn tiền chưa khớp',
};

const RECIPIENT_LABELS = { CUSTOMER: 'Khách hàng', PROVIDER: 'Nhà vườn', OTHER: 'Người ngoài' } as const;
const RECIPIENT_COLORS = { CUSTOMER: 'blue', PROVIDER: 'green', OTHER: 'default' } as const;

// Người nhận chưa khai tài khoản: khách bổ sung trên app, nhà vườn bổ sung ở web Hồ sơ.
// BE tự lấy tài khoản mới trong hồ sơ khi admin bấm xác nhận, không cần thao tác gì thêm.
const MISSING_BANK = {
  CUSTOMER: { label: 'Khách chưa khai tài khoản', hint: 'Chờ khách bổ sung trên app' },
  PROVIDER: { label: 'Nhà vườn chưa khai tài khoản', hint: 'Chờ nhà vườn bổ sung ở trang Hồ sơ' },
  // BE luôn lưu tài khoản cho lệnh OTHER; dòng này chỉ để phòng dữ liệu lỗi.
  OTHER: { label: 'Lệnh chi thiếu tài khoản nhận', hint: 'Kiểm tra lại khoản tiền chưa khớp gốc' },
} as const;

const MARK_PAID_ERRORS: Record<string, string> = {
  DISBURSEMENT_NOT_ELIGIBLE: 'Chưa hết thời gian chờ 3 ngày khiếu nại nên chưa thể giải ngân.',
  DISBURSEMENT_BANK_INFO_MISSING:
    'Khách chưa khai tài khoản ngân hàng nên chưa thể xác nhận đã chuyển. Đợi khách bổ sung trên app rồi thử lại.',
  PROVIDER_BANK_INFO_MISSING:
    'Nhà vườn chưa khai tài khoản ngân hàng nên chưa thể xác nhận đã chuyển. Nhắc nhà vườn bổ sung ở trang Hồ sơ rồi thử lại.',
  DISBURSEMENT_ALREADY_PAID: 'Lệnh chi này đã được xác nhận thanh toán trước đó.',
};

const recipientOf = (record: DisbursementItem) =>
  record.recipient ?? (record.customerId ? 'CUSTOMER' : record.providerId ? 'PROVIDER' : 'OTHER');

// Người ngoài không có hồ sơ → lấy tên chủ tài khoản ngân hàng admin đã nhập.
const recipientNameOf = (record: DisbursementItem) =>
  record.recipientName ?? record.providerName ?? record.bank?.bankHolder ?? 'Chưa rõ tên';

// Mã đơn để hiện; khoản tiền chưa khớp có thể không gắn đơn nào.
const orderLabelOf = (record: DisbursementItem) =>
  record.orderCode ? `#${record.orderCode}` : 'Không gắn đơn';

export default function AdminDisbursementsPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DisbursementItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');

  const [payModalOpen, setPayModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<DisbursementItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<{ transferCode: string; note?: string }>();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  const fetchDisbursements = useCallback(
    async (targetPage = page, targetStatus = statusFilter) => {
      setLoading(true);
      try {
        const res = await adminApi.listDisbursements({
          status: targetStatus === 'ALL' ? undefined : targetStatus,
          page: targetPage,
          limit,
        });
        setItems(res.data || []);
        setTotal(res.total || 0);
      } catch (err: any) {
        message.error(
          err?.response?.data?.message || 'Không thể tải danh sách lệnh giải ngân.'
        );
      } finally {
        setLoading(false);
      }
    },
    [page, statusFilter, limit, message]
  );

  useEffect(() => {
    if (mounted && isAuthenticated && user?.role === 'ADMIN') {
      fetchDisbursements(page, statusFilter);
    }
  }, [mounted, isAuthenticated, user, page, statusFilter, fetchDisbursements]);

  const handleOpenPayModal = (record: DisbursementItem) => {
    setSelectedItem(record);
    form.resetFields();
    setPayModalOpen(true);
  };

  const handleConfirmPaid = async () => {
    if (!selectedItem) return;
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await adminApi.markDisbursementPaid(selectedItem.id, {
        transferCode: values.transferCode.trim(),
        note: values.note?.trim() || undefined,
      });
      message.success(
        selectedItem.orderCode
          ? `Đã xác nhận chuyển khoản cho đơn #${selectedItem.orderCode}`
          : 'Đã xác nhận chuyển khoản',
      );
      setPayModalOpen(false);
      setSelectedItem(null);
      await fetchDisbursements(page, statusFilter);
    } catch (err: any) {
      if (err?.errorFields) return;
      // Interceptor đã đổi data.message thành câu tiếng Việt → rẽ nhánh theo mã gốc (rawCode).
      const code = getApiErrorCode(err);
      const friendly =
        (code && MARK_PAID_ERRORS[code]) ||
        err?.response?.data?.message ||
        'Xác nhận chuyển khoản thất bại.';
      message.error(friendly);
      // Lệnh vừa được người khác xác nhận / hồ sơ ngân hàng vừa đổi → tải lại cho đúng trạng thái.
      if (code && MARK_PAID_ERRORS[code]) {
        setPayModalOpen(false);
        await fetchDisbursements(page, statusFilter);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const pendingEligibleCount = items.filter(
    (i) => i.status === 'PENDING' && i.isEligible
  ).length;
  const paidCount = items.filter((i) => i.status === 'PAID').length;

  const columns: ColumnsType<DisbursementItem> = [
    {
      title: 'Đơn hàng',
      key: 'orderCode',
      render: (_, record) => (
        <div>
          {record.orderCode ? (
            <span className="font-bold text-[#6027D2] font-mono text-xs">#{record.orderCode}</span>
          ) : (
            <span className="font-semibold text-[#8B86A4] text-xs">Không gắn đơn</span>
          )}
          <div className="text-[11px] text-[#6E6A8A] mt-0.5">
            {TYPE_LABELS[record.type] ?? record.type}
          </div>
        </div>
      ),
    },
    {
      title: 'Người nhận',
      key: 'recipient',
      render: (_, record) => {
        return (
          <div className="flex flex-col items-start gap-1">
            <span className="font-semibold text-[#1E1B2E] text-xs">{recipientNameOf(record)}</span>
            <Tag
              color={RECIPIENT_COLORS[recipientOf(record)]}
              className="!m-0 !rounded-md !text-[10px] !leading-4"
            >
              {RECIPIENT_LABELS[recipientOf(record)]}
            </Tag>
          </div>
        );
      },
    },
    {
      title: 'Số tiền giải ngân',
      dataIndex: 'amount',
      key: 'amount',
      render: (val: string | number) => (
        <span className="font-extrabold text-[#4E1BA8] text-sm">
          {Number(val || 0).toLocaleString('vi-VN')} VNĐ
        </span>
      ),
    },
    {
      title: 'Tài khoản ngân hàng',
      key: 'bank',
      render: (_, record) =>
        record.bank ? (
          <div className="text-xs leading-snug">
            <div className="font-semibold text-[#1E1B2E] flex items-center gap-1">
              <BankOutlined className="text-[#6027D2]" />
              <span>{record.bank.bankName}</span>
            </div>
            <div className="font-mono text-[#4B4764]">{record.bank.bankAccount}</div>
            <div className="text-[11px] text-[#6E6A8A] uppercase">
              {record.bank.bankHolder}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <Tag color="orange" className="!m-0 !rounded-lg text-[11px]">
              ⚠ {MISSING_BANK[recipientOf(record)].label}
            </Tag>
            <span className="text-[11px] text-[#6E6A8A]">{MISSING_BANK[recipientOf(record)].hint}</span>
          </div>
        ),
    },
    {
      title: 'Ngày đủ điều kiện',
      dataIndex: 'eligibleAt',
      key: 'eligibleAt',
      render: (val: string, record) => (
        <div className="text-xs">
          <div className="font-medium text-[#1E1B2E]">
            {dayjs(val).format('DD/MM/YYYY HH:mm')}
          </div>
          {record.status === 'PENDING' && (
            <Tag
              color={record.isEligible ? 'purple' : 'default'}
              className="!mt-1 !rounded-md text-[10px]"
            >
              {record.isEligible ? 'Đủ điều kiện chi' : 'Đang chờ 3 ngày'}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      render: (_, record) =>
        record.status === 'PAID' ? (
          <div className="text-xs">
            <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-lg">
              Đã chuyển
            </Tag>
            {record.transferCode && (
              <div className="text-[11px] font-mono text-[#4B4764] mt-1">
                Mã GD: {record.transferCode}
              </div>
            )}
            {record.paidAt && (
              <div className="text-[10px] text-[#8B86A4]">
                {dayjs(record.paidAt).format('DD/MM/YYYY HH:mm')}
              </div>
            )}
          </div>
        ) : (
          <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-lg">
            Chờ chuyển khoản
          </Tag>
        ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      align: 'right',
      render: (_, record) => {
        if (record.status === 'PAID') {
          return (
            <span className="text-xs text-[#8B86A4] italic">
              {record.note || 'Đã hoàn tất'}
            </span>
          );
        }

        // Chưa đủ 3 ngày chờ khiếu nại: hiện số ngày còn lại thay cho nút bị khoá (nút tím khoá rất khó đọc).
        if (!record.isEligible) {
          const hoursLeft = Math.max(1, dayjs(record.eligibleAt).diff(dayjs(), 'hour'));
          const remaining = hoursLeft < 24 ? `${hoursLeft} giờ` : `${Math.ceil(hoursLeft / 24)} ngày`;
          return (
            <Tooltip title={`Chưa hết 3 ngày chờ khiếu nại · đủ điều kiện lúc ${dayjs(record.eligibleAt).format('DD/MM/YYYY HH:mm')}`}>
              <Tag icon={<ClockCircleOutlined />} className="!rounded-lg !m-0 !text-xs !bg-[#F3F2F7] !border-[#E2DFEC] !text-[#4B4764]">
                Còn {remaining}
              </Tag>
            </Tooltip>
          );
        }

        if (!record.bank) {
          return (
            <Tooltip title={`${MISSING_BANK[recipientOf(record)].hint}, rồi mới xác nhận được.`}>
              <Button size="small" disabled icon={<SendOutlined />} className="!rounded-xl !text-xs whitespace-nowrap">
                Xác nhận đã chuyển
              </Button>
            </Tooltip>
          );
        }

        return (
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            onClick={() => handleOpenPayModal(record)}
            className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs whitespace-nowrap"
          >
            Xác nhận đã chuyển
          </Button>
        );
      },
    },
  ];

  if (!mounted || !isAuthenticated || user?.role !== 'ADMIN') {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader />

        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">
                Quản lý giải ngân (Payout)
              </h1>
              <p className="text-xs text-[#6E6A8A] mt-1">
                Lệnh chi khi đơn hoàn tất: tiền cho khách chi ngay, tiền cho nhà vườn chi sau 3 ngày chờ khiếu nại.
                Tiền chuyển dư và tiền chưa khớp được hoàn cũng hiện ở đây, chi ngay.
              </p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchDisbursements(page, statusFilter)}
              className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
            >
              Làm mới
            </Button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-[#ECE7FA] flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#F3EFFF] text-[#6027D2] flex items-center justify-center text-xl">
                <DollarOutlined />
              </div>
              <div>
                <p className="text-xs text-[#6E6A8A]">Tổng lệnh chi (theo bộ lọc)</p>
                <p className="text-xl font-extrabold text-[#1E1B2E]">{total}</p>
              </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#ECE7FA] flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center text-xl">
                <ClockCircleOutlined />
              </div>
              <div>
                <p className="text-xs text-[#6E6A8A]">Đủ điều kiện chi (trang này)</p>
                <p className="text-xl font-extrabold text-[#D97706]">
                  {pendingEligibleCount}
                </p>
              </div>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-[#ECE7FA] flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#ECFDF5] text-[#059669] flex items-center justify-center text-xl">
                <CheckCircleOutlined />
              </div>
              <div>
                <p className="text-xs text-[#6E6A8A]">Đã chuyển (trang này)</p>
                <p className="text-xl font-extrabold text-[#059669]">{paidCount}</p>
              </div>
            </div>
          </div>

          {/* Filter & Table */}
          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 shadow-xs flex flex-col gap-4">
            <Segmented
              value={statusFilter}
              onChange={(val) => {
                setPage(1);
                setStatusFilter(val as FilterStatus);
              }}
              options={[
                { label: 'Tất cả', value: 'ALL' },
                { label: 'Chờ chuyển khoản', value: 'PENDING' },
                { label: 'Đã chuyển', value: 'PAID' },
              ]}
              className="!bg-[#F6F4FC] font-semibold text-xs"
            />

            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={loading}
              pagination={{
                current: page,
                pageSize: limit,
                total,
                onChange: (p) => setPage(p),
                showSizeChanger: false,
              }}
              locale={{ emptyText: 'Chưa có lệnh giải ngân nào.' }}
            />
          </div>
        </main>
      </div>

      {/* Confirm Paid Modal */}
      <Modal
        title={
          <span className="font-bold text-[#1E1B2E]">
            Xác nhận đã chuyển khoản — {selectedItem ? orderLabelOf(selectedItem) : ''}
          </span>
        }
        open={payModalOpen}
        onCancel={() => !submitting && setPayModalOpen(false)}
        onOk={handleConfirmPaid}
        okText="Xác nhận đã chuyển"
        cancelText="Hủy"
        confirmLoading={submitting}
        okButtonProps={{
          className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl',
        }}
        cancelButtonProps={{ className: '!rounded-xl' }}
        centered
      >
        {selectedItem && (
          <div className="flex flex-col gap-4 pt-2">
            <div className="p-3.5 rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#6E6A8A]">Loại lệnh chi:</span>
                <span className="font-semibold text-[#1E1B2E]">
                  {TYPE_LABELS[selectedItem.type] ?? selectedItem.type}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E6A8A]">
                  {RECIPIENT_LABELS[recipientOf(selectedItem)]} nhận:
                </span>
                <span className="font-bold text-[#1E1B2E]">{recipientNameOf(selectedItem)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6E6A8A]">Số tiền:</span>
                <span className="font-extrabold text-[#6027D2]">
                  {Number(selectedItem.amount || 0).toLocaleString('vi-VN')} VNĐ
                </span>
              </div>
              {selectedItem.bank && (
                <div className="flex justify-between">
                  <span className="text-[#6E6A8A]">Tài khoản nhận:</span>
                  <span className="font-semibold text-[#1E1B2E]">
                    {selectedItem.bank.bankName} · {selectedItem.bank.bankAccount} (
                    {selectedItem.bank.bankHolder})
                  </span>
                </div>
              )}
            </div>

            <Form form={form} layout="vertical">
              <Form.Item
                name="transferCode"
                label="Mã giao dịch chuyển khoản ngân hàng"
                rules={[
                  { required: true, message: 'Vui lòng nhập mã giao dịch ngân hàng' },
                  { max: 100, message: 'Tối đa 100 ký tự' },
                ]}
              >
                <Input placeholder="Ví dụ: FT26317123456" className="!rounded-xl" />
              </Form.Item>
              <Form.Item
                name="note"
                label="Ghi chú (tuỳ chọn)"
                rules={[{ max: 1000, message: 'Tối đa 1000 ký tự' }]}
              >
                <Input.TextArea
                  rows={2}
                  placeholder="Ví dụ: Chuyển qua MBBank lúc 10:15"
                  className="!rounded-xl"
                />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </div>
  );
}

