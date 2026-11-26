'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Spin,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileDoneOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PaymentClaimItem,
  paymentClaimsApi,
} from '@/lib/payment-claims.api';
import { providerApi } from '@/lib/provider.api';

const { Text } = Typography;

interface PaymentClaimsModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderCode?: string | null;
}

const STATUS_TAGS = {
  OPEN: { color: 'gold', text: 'Chờ đối soát', icon: <ClockCircleOutlined /> },
  RESOLVED: { color: 'green', text: 'Đã hoàn tất', icon: <CheckCircleOutlined /> },
  REJECTED: { color: 'red', text: 'Đã từ chối', icon: <CloseCircleOutlined /> },
};

export default function PaymentClaimsModal({
  open,
  onClose,
  orderId,
  orderCode,
}: PaymentClaimsModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const [loading, setLoading] = useState(false);
  const [claims, setClaims] = useState<PaymentClaimItem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const fetchClaims = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = await paymentClaimsApi.listForOrder(orderId);
      setClaims(data);
    } catch {
      message.error('Không thể tải danh sách phiếu báo chuyển tiền.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchClaims();
      setIsCreating(false);
      form.resetFields();
      setPhotos([]);
    }
  }, [open, orderId]);

  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (photos.length >= 3) {
      message.warning('Tối đa 3 ảnh sao kê/biên lai chuyển khoản.');
      return;
    }

    setUploadingPhoto(true);
    try {
      const res = await providerApi.uploadDocument(file);
      setPhotos((prev) => [...prev, res.url]);
      message.success('Đã tải ảnh biên lai thành công.');
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Tải ảnh thất bại.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (values: any) => {
    if (photos.length === 0) {
      message.warning('Vui lòng tải lên ít nhất 1 ảnh biên lai/sao kê chuyển tiền.');
      return;
    }

    setSubmitting(true);
    try {
      await paymentClaimsApi.create(orderId, {
        amount: Number(values.amount),
        transferredAt: values.transferredAt ? values.transferredAt.toISOString() : undefined,
        note: values.note?.trim() || undefined,
        photos: photos.map((p) => ({ photoUrl: p })),
      });
      message.success('Đã gửi phiếu báo chuyển tiền thành công.');
      setIsCreating(false);
      form.resetFields();
      setPhotos([]);
      fetchClaims();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Gửi phiếu thất bại.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const openClaimsCount = claims.filter((c) => c.status === 'OPEN').length;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
          <FileDoneOutlined className="text-[#6027D2]" />
          <span>Phiếu báo đã chuyển tiền {orderCode ? `(Đơn #${orderCode})` : ''}</span>
        </div>
      }
      className="!rounded-2xl"
    >
      <div className="py-2 space-y-4">
        {!isCreating ? (
          <>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-[#6E6A8A] m-0">
                Nếu bạn đã chuyển khoản (tiền bảo đảm / add-on) mà hệ thống chưa cập nhật, hãy gửi
                phiếu kèm ảnh sao kê để ban quản trị đối soát.
              </p>
              {openClaimsCount < 3 && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setIsCreating(true)}
                  className="!rounded-xl !bg-[#6027D2] !font-semibold text-xs"
                >
                  Tạo phiếu báo mới
                </Button>
              )}
            </div>

            {loading ? (
              <div className="py-12 text-center">
                <Spin />
                <p className="text-xs text-[#6E6A8A] mt-2">Đang tải lịch sử phiếu...</p>
              </div>
            ) : claims.length === 0 ? (
              <div className="p-8 text-center bg-[#FAF8FE] rounded-2xl border border-[#ECE7FA]">
                <p className="text-sm font-semibold text-[#1E1B2E] mb-1">Chưa có phiếu báo chuyển tiền nào</p>
                <p className="text-xs text-[#6E6A8A]">
                  Bạn chưa gửi phiếu đối soát nào cho đơn hàng này.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {claims.map((claim) => {
                  const tagInfo = STATUS_TAGS[claim.status];
                  return (
                    <div
                      key={claim.id}
                      className="p-4 rounded-2xl border border-[#ECE7FA] bg-[#FAF8FE] space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-[#1E1B2E]">
                            {Number(claim.amount).toLocaleString('vi-VN')} VNĐ
                          </span>
                          <Tag color={tagInfo.color} icon={tagInfo.icon} className="!rounded-md !m-0">
                            {tagInfo.text}
                          </Tag>
                        </div>
                        <span className="text-xs text-[#8B86A4]">
                          {dayjs(claim.createdAt).format('DD/MM/YYYY HH:mm')}
                        </span>
                      </div>

                      {claim.transferredAt && (
                        <p className="text-xs text-[#4A4568] m-0">
                          🕒 Thời gian chuyển: <strong>{dayjs(claim.transferredAt).format('DD/MM/YYYY HH:mm')}</strong>
                        </p>
                      )}

                      {claim.note && (
                        <p className="text-xs text-[#4A4568] m-0 bg-white p-2.5 rounded-xl border border-[#ECE7FA]">
                          💬 Ghi chú: {claim.note}
                        </p>
                      )}

                      {claim.rejectReason && (
                        <Alert
                          type="error"
                          showIcon
                          message="Lý do từ chối"
                          description={claim.rejectReason}
                          className="!rounded-xl text-xs"
                        />
                      )}

                      {claim.refund?.receiptUrl && (
                        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs">
                          <p className="text-emerald-800 font-semibold mb-1">Ảnh biên lai hoàn tất từ ban quản trị:</p>
                          <Image
                            src={claim.refund.receiptUrl}
                            alt="Biên lai hoàn tiền"
                            width={80}
                            height={80}
                            className="rounded-lg object-cover border"
                          />
                        </div>
                      )}

                      {/* Photos */}
                      {claim.photos && claim.photos.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-[#6E6A8A] mb-1">Ảnh sao kê đính kèm:</p>
                          <Image.PreviewGroup>
                            <div className="flex flex-wrap gap-2">
                              {claim.photos.map((p, idx) => (
                                <Image
                                  key={p.id || idx}
                                  src={p.photoUrl}
                                  alt={`Sao kê ${idx + 1}`}
                                  width={64}
                                  height={64}
                                  className="rounded-lg object-cover border border-[#DDD6FE]"
                                />
                              ))}
                            </div>
                          </Image.PreviewGroup>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          /* Form tạo phiếu mới */
          <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark="optional">
            <Form.Item
              name="amount"
              label="Số tiền thực tế bạn đã chuyển (VNĐ)"
              rules={[
                { required: true, message: 'Vui lòng nhập số tiền đã chuyển' },
                {
                  type: 'number',
                  min: 1000,
                  message: 'Số tiền phải tối thiểu 1.000 VNĐ',
                },
              ]}
            >
              <InputNumber
                className="!w-full !rounded-xl"
                placeholder="VD: 530000"
                formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(val) => Number(val?.replace(/\$\s?|(,*)/g, '') || 0)}
              />
            </Form.Item>

            <Form.Item name="transferredAt" label="Thời gian chuyển tiền theo sao kê (Không bắt buộc)">
              <DatePicker
                showTime
                format="DD/MM/YYYY HH:mm"
                placeholder="Chọn thời gian chuyển khoản"
                className="!w-full !rounded-xl"
              />
            </Form.Item>

            <Form.Item
              name="note"
              label="Ghi chú thêm"
              rules={[{ max: 500, message: 'Tối đa 500 ký tự' }]}
            >
              <Input.TextArea
                rows={3}
                placeholder="VD: Quên ghi mã đơn, hoặc nội dung ngân hàng bị cắt bớt..."
                className="!rounded-xl"
              />
            </Form.Item>

            {/* Ảnh sao kê */}
            <div className="space-y-2 mb-4">
              <label className="text-sm font-medium text-[#1E1B2E] block">
                Ảnh biên lai / sao kê chuyển tiền (1 – 3 ảnh) <span className="text-red-500">*</span>
              </label>

              <div className="flex flex-wrap gap-2.5">
                {photos.map((url, idx) => (
                  <div key={idx} className="relative group">
                    <img
                      src={url}
                      alt={`Minh chứng ${idx + 1}`}
                      className="w-18 h-18 rounded-xl object-cover border border-[#DDD6FE]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(idx)}
                      className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow-sm"
                    >
                      ×
                    </button>
                  </div>
                ))}

                {photos.length < 3 && (
                  <label className="w-18 h-18 rounded-xl border border-dashed border-[#DDD6FE] text-[#6027D2] bg-[#FAF8FE] hover:bg-[#F3EFFF] cursor-pointer flex flex-col items-center justify-center text-xs font-semibold transition-colors">
                    <UploadOutlined className="text-base mb-1" />
                    <span>{uploadingPhoto ? 'Đang tải...' : 'Thêm ảnh'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUploadPhoto}
                      disabled={uploadingPhoto}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#ECE7FA]">
              <Button onClick={() => setIsCreating(false)} disabled={submitting}>
                Quay lại
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                className="!rounded-xl !bg-[#6027D2]"
              >
                Gửi phiếu đối soát
              </Button>
            </div>
          </Form>
        )}
      </div>
    </Modal>
  );
}

