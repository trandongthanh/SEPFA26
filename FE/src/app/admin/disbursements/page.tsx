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
import {
  DisbursementItem,
  DisbursementStatus,
  adminApi,
} from '@/lib/admin.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

type FilterStatus = 'ALL' | DisbursementStatus;

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
      message.success(`Đã xác nhận chuyển khoản cho đơn #${selectedItem.orderCode}`);
      setPayModalOpen(false);
      setSelectedItem(null);
      await fetchDisbursements(page, statusFilter);
    } catch (err: any) {
      if (err?.errorFields) return;
      const raw = err?.response?.data?.message || '';
      const friendly =
        raw === 'DISBURSEMENT_NOT_ELIGIBLE'
          ? 'Chưa hết thời gian chờ 3 ngày khiếu nại nên chưa thể giải ngân.'
          : raw === 'PROVIDER_BANK_INFO_MISSING'
            ? 'Nhà vườn chưa cập nhật đầy đủ thông tin ngân hàng.'
            : raw === 'DISBURSEMENT_ALREADY_PAID'
              ? 'Lệnh chi này đã được xác nhận thanh toán trước đó.'
              : raw || 'Xác nhận chuyển khoản thất bại.';
      message.error(friendly);
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
          <span className="font-bold text-[#6027D2] font-mono text-xs">
            #{record.orderCode}
          </span>
          <div className="text-[11px] text-[#6E6A8A] mt-0.5">
            {record.type === 'PAYOUT' ? 'Chi trả nhà vườn' : 'Hoàn tiền khách'}
          </div>
        </div>
      ),
    },
    {
      title: 'Nhà vườn nhận',
      dataIndex: 'providerName',
      key: 'providerName',
      render: (name: string) => (
        <span className="font-semibold text-[#1E1B2E] text-xs">{name}</span>
      ),
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
          <Tag color="orange" className="!rounded-lg text-[11px]">
            Chưa có TK ngân hàng
          </Tag>
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

        const disabledReason = !record.isEligible
          ? 'Chưa hết 3 ngày chờ khiếu nại'
          : !record.bank
            ? 'Nhà vườn chưa khai báo đủ thông tin ngân hàng'
            : '';

        return (
          <Tooltip title={disabledReason}>
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              disabled={!record.isEligible || !record.bank}
              onClick={() => handleOpenPayModal(record)}
              className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs"
            >
              Đã chuyển
            </Button>
          </Tooltip>
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
                Danh sách lệnh chi cho nhà vườn sau khi đơn hoàn tất và qua 3 ngày chờ khiếu nại
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
          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 shadow-xs space-y-4">
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
            Xác nhận đã chuyển khoản — Đơn #{selectedItem?.orderCode}
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
          <div className="space-y-4 pt-2">
            <div className="p-3.5 rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#6E6A8A]">Nhà vườn:</span>
                <span className="font-bold text-[#1E1B2E]">{selectedItem.providerName}</span>
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

