'use client';

// Tiền chưa khớp: tiền đã vào tài khoản LanCare nhưng BE không ghi được vào đơn nào
// (không mã, sai mã, về trễ, chuyển thiếu...). Admin bấm Hoàn tiền → BE tạo lệnh chi UNMATCHED_REFUND chi ngay,
// rồi admin chuyển khoản và bấm "Đã chuyển" ở trang Giải ngân như các lệnh chi khác.
import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ReloadOutlined, RollbackOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Modal, Radio, Segmented, Spin, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { getApiErrorCode } from '@/lib/api';
import {
  RefundUnmatchedPayload,
  UnmatchedReason,
  UnmatchedTransactionItem,
  adminApi,
} from '@/lib/admin.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

type FilterStatus = 'OPEN' | 'RESOLVED';
type BankChoice = 'SUGGESTED' | 'OTHER';

const PAGE_SIZE = 10;

const REASON_LABELS: Record<UnmatchedReason, { label: string; color: string }> = {
  NO_CODE: { label: 'Không có mã', color: 'default' },
  CODE_NOT_FOUND: { label: 'Mã không khớp', color: 'default' },
  ORDER_NOT_AWAITING_PAYMENT: { label: 'Đơn không còn chờ thanh toán', color: 'orange' },
  PAYMENT_DEADLINE_PASSED: { label: 'Về sau hạn thanh toán', color: 'orange' },
  INSUFFICIENT_AMOUNT: { label: 'Chuyển thiếu tiền đơn', color: 'gold' },
  ADDON_NOT_PAYABLE: { label: 'Add-on không còn nhận tiền', color: 'orange' },
  ADDON_INSUFFICIENT: { label: 'Chuyển thiếu tiền add-on', color: 'gold' },
  DEPOSIT_NOT_PENDING: { label: 'Tiền bảo đảm không còn chờ nộp', color: 'purple' },
  DEPOSIT_EXPIRED: { label: 'Tiền bảo đảm về trễ', color: 'purple' },
  DEPOSIT_INSUFFICIENT: { label: 'Nộp thiếu tiền bảo đảm', color: 'purple' },
  LEGACY_UNKNOWN: { label: 'Chưa rõ lý do', color: 'default' },
};

const RECIPIENT_LABELS = { CUSTOMER: 'khách', PROVIDER: 'nhà vườn' } as const;

const REFUND_ERRORS: Record<string, string> = {
  REFUND_BANK_INFO_REQUIRED: 'Chưa có tài khoản nhận tiền. Hãy nhập ngân hàng, số tài khoản và chủ tài khoản.',
  RESOLUTION_NOTE_REQUIRED: 'Cần ghi chú bằng chứng khi hoàn khoản không gắn đơn hoặc khi đổi tài khoản nhận.',
  BANK_INFO_INCOMPLETE: 'Thông tin tài khoản chưa đủ: cần cả ngân hàng, số tài khoản và chủ tài khoản.',
  BANK_INFO_CANNOT_BE_CLEARED: 'Thông tin tài khoản chưa đủ: cần cả ngân hàng, số tài khoản và chủ tài khoản.',
  TRANSACTION_ALREADY_RESOLVED: 'Khoản này đã được hoàn trước đó. Danh sách sẽ được tải lại.',
  TRANSACTION_NOT_REFUNDABLE: 'Khoản này đã được ghi vào đơn nên không hoàn ở đây.',
  UNMATCHED_TRANSACTION_NOT_FOUND: 'Không tìm thấy khoản tiền này. Danh sách sẽ được tải lại.',
};

const formatVnd = (value: string | number) => `${Number(value || 0).toLocaleString('vi-VN')} đ`;

interface RefundFormValues {
  bankChoice: BankChoice;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  bankBin?: string;
  note?: string;
}

export default function AdminUnmatchedTransactionsPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<UnmatchedTransactionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('OPEN');

  const [selected, setSelected] = useState<UnmatchedTransactionItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<RefundFormValues>();
  const bankChoice = Form.useWatch('bankChoice', form);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listUnmatchedTransactions({ status: statusFilter, page, limit: PAGE_SIZE });
      setItems(res.data || []);
      setTotal(res.total || 0);
    } catch {
      message.error('Không tải được danh sách tiền chưa khớp. Bấm Làm mới để thử lại.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, message]);

  useEffect(() => {
    if (mounted && isAuthenticated && user?.role === 'ADMIN') {
      fetchItems();
    }
  }, [mounted, isAuthenticated, user, fetchItems]);

  const suggestedBank = selected?.suggestedRecipient?.bank ?? null;
  // Không có tài khoản gợi ý → bắt buộc nhập tay.
  const usingOtherAccount = !suggestedBank || bankChoice === 'OTHER';
  // BE bắt ghi chú khi không gắn đơn hoặc đổi tài khoản khác gợi ý.
  const noteRequired = !selected?.order || (Boolean(suggestedBank) && bankChoice === 'OTHER');

  const openRefund = (record: UnmatchedTransactionItem) => {
    setSelected(record);
    form.resetFields();
    form.setFieldsValue({ bankChoice: record.suggestedRecipient?.bank ? 'SUGGESTED' : 'OTHER' });
  };

  const closeRefund = () => {
    if (submitting) return;
    setSelected(null);
  };

  const handleRefund = async () => {
    if (!selected) return;
    let values: RefundFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // lỗi đã hiện dưới từng ô
    }
    const payload: RefundUnmatchedPayload = {};
    if (usingOtherAccount) {
      payload.bankName = values.bankName?.trim();
      payload.bankAccount = values.bankAccount?.trim();
      payload.bankHolder = values.bankHolder?.trim();
      if (values.bankBin?.trim()) payload.bankBin = values.bankBin.trim();
    }
    if (values.note?.trim()) payload.note = values.note.trim();

    setSubmitting(true);
    try {
      await adminApi.refundUnmatchedTransaction(selected.id, payload);
      setSelected(null);
      message.success({
        content: (
          <span>
            Đã tạo lệnh hoàn {formatVnd(selected.amount)}. Chuyển khoản xong thì bấm “Đã chuyển” ở trang{' '}
            <a onClick={() => router.push('/admin/disbursements')} className="font-semibold underline">
              Giải ngân
            </a>
            .
          </span>
        ),
        duration: 6,
      });
      fetchItems();
    } catch (err) {
      const code = getApiErrorCode(err);
      message.error((code && REFUND_ERRORS[code]) || 'Không tạo được lệnh hoàn. Vui lòng thử lại.');
      if (code === 'TRANSACTION_ALREADY_RESOLVED' || code === 'UNMATCHED_TRANSACTION_NOT_FOUND') {
        setSelected(null);
        fetchItems();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<UnmatchedTransactionItem> = [
    {
      title: 'Nhận lúc',
      key: 'receivedAt',
      width: 150,
      render: (_, r) => (
        <div>
          <div className="text-xs font-semibold text-[#1E1B2E]">{dayjs(r.receivedAt).format('DD/MM/YYYY HH:mm')}</div>
          {r.sepayTxnId && <div className="text-[11px] text-[#8B86A4] font-mono">SePay #{r.sepayTxnId}</div>}
        </div>
      ),
    },
    {
      title: 'Nội dung chuyển khoản',
      key: 'transferContent',
      render: (_, r) => (
        <span className="text-xs font-mono text-[#1E1B2E] break-all">
          {r.transferContent || <span className="text-[#8B86A4] font-sans">(trống)</span>}
        </span>
      ),
    },
    {
      title: 'Lý do chưa khớp',
      key: 'reason',
      render: (_, r) => {
        const info = REASON_LABELS[r.reason] ?? { label: r.reason, color: 'default' };
        return (
          <div className="flex flex-col items-start gap-1">
            <Tag color={info.color} className="!m-0 !rounded-md !text-[11px]">
              {info.label}
            </Tag>
            {r.order ? (
              <span className="text-[11px] text-[#6E6A8A]">
                Đơn <b className="font-mono text-[#6027D2]">#{r.order.orderCode}</b>
              </span>
            ) : (
              <span className="text-[11px] text-[#8B86A4]">Không gắn đơn nào</span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Số tiền',
      dataIndex: 'amount',
      key: 'amount',
      align: 'right',
      render: (v: string) => <span className="font-extrabold text-[#4E1BA8] text-sm tabular-nums">{formatVnd(v)}</span>,
    },
    {
      title: statusFilter === 'OPEN' ? 'Gợi ý hoàn về' : 'Đã xử lý',
      key: 'action',
      width: 280,
      render: (_, r) => {
        if (r.resolution) {
          return (
            <div className="text-[11px] text-[#4B4764] space-y-0.5">
              <div>
                <Tag color={r.resolution.disbursementStatus === 'PAID' ? 'success' : 'warning'} className="!m-0 !rounded-md !text-[10px]">
                  {r.resolution.disbursementStatus === 'PAID' ? 'Đã chuyển tiền' : 'Chờ chuyển ở Giải ngân'}
                </Tag>
              </div>
              <div>
                {r.resolution.resolvedBy || 'Admin'}
                {r.resolution.resolvedAt ? ` · ${dayjs(r.resolution.resolvedAt).format('DD/MM HH:mm')}` : ''}
              </div>
              {r.resolution.note && <div className="text-[#6E6A8A]">“{r.resolution.note}”</div>}
            </div>
          );
        }
        const s = r.suggestedRecipient;
        return (
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-[#4B4764] min-w-0">
              {s ? (
                <>
                  Trả {RECIPIENT_LABELS[s.type]} <b>{s.name || 'chưa rõ tên'}</b>
                  {!s.bank && <div className="text-[#D97706]">Hồ sơ chưa có tài khoản</div>}
                </>
              ) : (
                <span className="text-[#8B86A4]">Không rõ người gửi</span>
              )}
            </div>
            <Button
              type="primary"
              size="small"
              icon={<RollbackOutlined />}
              onClick={() => openRefund(r)}
              className="!rounded-lg !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold shrink-0"
            >
              Hoàn tiền
            </Button>
          </div>
        );
      },
    },
  ];

  if (!mounted || !isAuthenticated || user?.role !== 'ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  const reasonInfo = selected ? REASON_LABELS[selected.reason] : null;

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader />

        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Tiền chưa khớp</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 max-w-2xl">
                Tiền đã vào tài khoản LanCare nhưng không ghi được vào đơn nào: không có mã, sai mã, về sau hạn, chuyển
                thiếu. Bấm Hoàn tiền để tạo lệnh chi, rồi chuyển khoản và bấm “Đã chuyển” ở trang Giải ngân.
              </p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchItems}
              className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
            >
              Làm mới
            </Button>
          </div>

          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 shadow-xs flex flex-col gap-4">
            <Segmented
              value={statusFilter}
              onChange={(val) => {
                setPage(1);
                setStatusFilter(val as FilterStatus);
              }}
              options={[
                { label: 'Đang chờ xử lý', value: 'OPEN' },
                { label: 'Đã hoàn', value: 'RESOLVED' },
              ]}
              className="!bg-[#F6F4FC] font-semibold text-xs self-start"
            />

            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={loading}
              scroll={{ x: 900 }}
              locale={{
                emptyText:
                  statusFilter === 'OPEN' ? 'Không có khoản tiền nào đang chờ xử lý.' : 'Chưa hoàn khoản nào.',
              }}
              pagination={{
                current: page,
                pageSize: PAGE_SIZE,
                total,
                showSizeChanger: false,
                onChange: setPage,
                showTotal: (t) => `${t} khoản`,
              }}
            />
          </div>
        </main>
      </div>

      <Modal
        open={Boolean(selected)}
        onCancel={closeRefund}
        title={selected ? `Hoàn ${formatVnd(selected.amount)}` : ''}
        okText="Tạo lệnh hoàn"
        cancelText="Huỷ"
        onOk={handleRefund}
        confirmLoading={submitting}
        okButtonProps={{ className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold' }}
        destroyOnClose
        width={520}
      >
        {selected && (
          <div className="space-y-4 pt-1">
            <div className="rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] p-3 text-xs text-[#4B4764] space-y-1">
              <div>
                Nội dung CK: <b className="font-mono text-[#1E1B2E]">{selected.transferContent || '(trống)'}</b>
              </div>
              <div>
                Lý do: <b className="text-[#1E1B2E]">{reasonInfo?.label ?? selected.reason}</b>
                {selected.order && (
                  <>
                    {' '}· đơn <b className="font-mono text-[#6027D2]">#{selected.order.orderCode}</b>
                  </>
                )}
              </div>
              <div>Nhận lúc {dayjs(selected.receivedAt).format('DD/MM/YYYY HH:mm')}</div>
            </div>

            <Form form={form} layout="vertical" requiredMark={false} className="space-y-1">
              {suggestedBank && selected.suggestedRecipient ? (
                <Form.Item name="bankChoice" label="Hoàn về tài khoản" className="!mb-3">
                  <Radio.Group className="flex flex-col gap-2">
                    <Radio value="SUGGESTED">
                      <span className="text-xs">
                        Tài khoản trong hồ sơ {RECIPIENT_LABELS[selected.suggestedRecipient.type]}{' '}
                        <b>{selected.suggestedRecipient.name || ''}</b>
                        <br />
                        <span className="text-[#6E6A8A]">
                          {suggestedBank.bankName} · {suggestedBank.bankAccount} · {suggestedBank.bankHolder}
                        </span>
                      </span>
                    </Radio>
                    <Radio value="OTHER">
                      <span className="text-xs">Tài khoản khác (cần ghi chú bằng chứng)</span>
                    </Radio>
                  </Radio.Group>
                </Form.Item>
              ) : (
                <>
                  <Form.Item name="bankChoice" hidden>
                    <Input />
                  </Form.Item>
                  <p className="text-xs text-[#D97706] !mb-3">
                    {selected.suggestedRecipient
                      ? `Hồ sơ ${RECIPIENT_LABELS[selected.suggestedRecipient.type]} chưa có tài khoản ngân hàng. Nhập tài khoản nhận tiền bên dưới.`
                      : 'Khoản này không gắn đơn nào nên không biết người gửi. Nhập tài khoản nhận và ghi chú bằng chứng.'}
                  </p>
                </>
              )}

              {usingOtherAccount && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
                  <Form.Item
                    name="bankName"
                    label="Ngân hàng"
                    rules={[{ required: true, whitespace: true, message: 'Nhập tên ngân hàng' }, { max: 100 }]}
                  >
                    <Input placeholder="VD: MBBank" />
                  </Form.Item>
                  <Form.Item
                    name="bankAccount"
                    label="Số tài khoản"
                    rules={[{ required: true, whitespace: true, message: 'Nhập số tài khoản' }, { max: 50 }]}
                  >
                    <Input placeholder="VD: 0123456789" />
                  </Form.Item>
                  <Form.Item
                    name="bankHolder"
                    label="Chủ tài khoản"
                    rules={[{ required: true, whitespace: true, message: 'Nhập tên chủ tài khoản' }, { max: 100 }]}
                  >
                    <Input placeholder="VD: NGUYEN VAN A" />
                  </Form.Item>
                  <Form.Item
                    name="bankBin"
                    label={
                      <Tooltip title="Mã 6 số của ngân hàng, dùng để tạo mã VietQR. Có thể bỏ trống.">
                        <span>Mã BIN (không bắt buộc)</span>
                      </Tooltip>
                    }
                    rules={[{ pattern: /^\d{6}$/, message: 'Mã BIN gồm 6 chữ số' }]}
                  >
                    <Input placeholder="VD: 970422" maxLength={6} />
                  </Form.Item>
                </div>
              )}

              <Form.Item
                name="note"
                label={noteRequired ? 'Ghi chú bằng chứng (bắt buộc)' : 'Ghi chú (không bắt buộc)'}
                rules={[
                  { required: noteRequired, whitespace: true, message: 'Ghi lại bằng chứng: ai xác nhận, ảnh sao kê...' },
                  { max: 1000 },
                ]}
              >
                <Input.TextArea
                  rows={3}
                  showCount
                  maxLength={1000}
                  placeholder="VD: Người gửi gửi ảnh sao kê, xác nhận chuyển nhầm."
                />
              </Form.Item>
            </Form>
          </div>
        )}
      </Modal>
    </div>
  );
}
