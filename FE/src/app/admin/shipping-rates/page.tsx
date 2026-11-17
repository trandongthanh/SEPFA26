'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, InputNumber, Modal, Spin } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import { ShippingRate, ShippingRateInput, adminApi } from '@/lib/admin.api';
import { getApiErrorCode } from '@/lib/api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';

// Một bậc trong bảng đang sửa. minKm của bậc i > 0 luôn = maxKm của bậc trước (tự nối liền),
// bậc cuối luôn maxKm = null (không giới hạn) — đúng ràng buộc của BE replaceShippingRates.
interface Tier {
  minKm: number;
  maxKm: number | null;
  baseFee: number;
  perKmFee: number;
  billingUnitKm: number | null;
}

const vnd = (value: number) => `${Math.round(value || 0).toLocaleString('vi-VN')} VNĐ`;
const moneyFormatter = (value: number | string | undefined) =>
  `${value ?? ''}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const moneyParser = (value: string | undefined) => Number((value ?? '').replace(/\./g, '')) || 0;

const toTiers = (rates: ShippingRate[]): Tier[] =>
  [...rates]
    .sort((a, b) => Number(a.minKm) - Number(b.minKm))
    .map((r) => ({
      minKm: Number(r.minKm),
      maxKm: r.maxKm === null ? null : Number(r.maxKm),
      baseFee: Number(r.baseFee),
      perKmFee: Number(r.perKmFee),
      billingUnitKm: r.billingUnitKm === null || Number(r.billingUnitKm) === 0 ? null : Number(r.billingUnitKm),
    }));

// Ép bảng về dạng hợp lệ về cấu trúc: bậc sau nối bậc trước, bậc cuối không giới hạn.
const normalize = (tiers: Tier[]): Tier[] =>
  tiers.map((tier, index) => ({
    ...tier,
    minKm: index === 0 ? tier.minKm : (tiers[index - 1].maxKm ?? tier.minKm),
    maxKm: index === tiers.length - 1 ? null : tier.maxKm,
  }));

const ERROR_MESSAGES: Record<string, string> = {
  SHIPPING_RATE_RANGE_INVALID: '"Đến km" của mỗi bậc phải lớn hơn "Từ km".',
  SHIPPING_RATE_RANGES_MUST_BE_CONTIGUOUS: 'Các bậc phải nối liền nhau, không được hở hoặc chồng lên nhau.',
  LAST_SHIPPING_RATE_MUST_NOT_HAVE_MAX_KM: 'Bậc cuối cùng không được có "Đến km".',
};

// Giống pickTier + computeShippingFee của BE (BE/src/orders/shipping-fee.ts).
// Phí tính MỘT LẦN cho cả đơn, không nhân số cây (BE chốt 14/11/2026).
function computeFee(tiers: Tier[], km: number) {
  const tier = tiers.find((t) => km >= t.minKm && km < (t.maxKm === null ? Infinity : t.maxKm));
  if (!tier) return null;
  const exceeded = Math.max(0, km - tier.minKm);
  const unit = tier.billingUnitKm || 0;
  const extra = unit > 0 ? Math.ceil(exceeded / unit) * tier.perKmFee : exceeded * tier.perKmFee;
  return { tier, exceeded, unit, extra, total: Math.round(tier.baseFee + extra) };
}

export default function AdminShippingRatesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState<Tier[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [hadInactive, setHadInactive] = useState(false);
  const [calcKm, setCalcKm] = useState<number>(7);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || user?.role !== 'ADMIN') {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, user, router]);

  const isAdmin = mounted && isAuthenticated && user?.role === 'ADMIN';

  const fetchRates = useCallback(async () => {
    setLoading(true);
    try {
      const rates = await adminApi.listShippingRates();
      const loaded = toTiers(rates);
      setSaved(loaded);
      setTiers(loaded);
      setHadInactive(rates.some((r) => !r.isActive));
    } catch (err: any) {
      message.error(err?.response?.data?.message || 'Không thể tải bảng phí lấy cây.');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    if (isAdmin) fetchRates();
  }, [isAdmin, fetchRates]);

  const dirty = JSON.stringify(tiers) !== JSON.stringify(saved);

  const errors = useMemo(() => {
    const list: string[] = [];
    if (tiers.length === 0) list.push('Bảng phí phải có ít nhất một bậc.');
    tiers.forEach((tier, index) => {
      const isLast = index === tiers.length - 1;
      if (!isLast && (tier.maxKm === null || tier.maxKm <= tier.minKm)) {
        list.push(`Bậc ${index + 1}: "Đến km" phải lớn hơn "Từ km" (${tier.minKm} km).`);
      }
    });
    return list;
  }, [tiers]);

  const invalidRow = (index: number) => {
    const tier = tiers[index];
    return index < tiers.length - 1 && (tier.maxKm === null || tier.maxKm <= tier.minKm);
  };

  const update = (index: number, patch: Partial<Tier>) => {
    setTiers((prev) => normalize(prev.map((t, i) => (i === index ? { ...t, ...patch } : t))));
  };

  const addTier = () => {
    setTiers((prev) => {
      if (prev.length === 0) {
        return [{ minKm: 0, maxKm: null, baseFee: 0, perKmFee: 0, billingUnitKm: null }];
      }
      const last = prev[prev.length - 1];
      const split = last.minKm + 5;
      return normalize([
        ...prev.slice(0, -1),
        { ...last, maxKm: split },
        { ...last, minKm: split, maxKm: null },
      ]);
    });
  };

  const removeTier = (index: number) => {
    setTiers((prev) => {
      const next = prev.filter((_, i) => i !== index);
      // Xóa bậc giữa: bậc phía trước kéo dài tới mốc đầu của bậc phía sau để không bị hở.
      if (index > 0 && index < prev.length - 1) {
        next[index - 1] = { ...next[index - 1], maxKm: prev[index + 1].minKm };
      }
      if (index === 0 && next.length > 0) next[0] = { ...next[0], minKm: prev[0].minKm };
      return normalize(next);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: ShippingRateInput[] = tiers.map((t) => ({
        minKm: t.minKm,
        maxKm: t.maxKm,
        baseFee: Math.round(t.baseFee),
        perKmFee: Math.round(t.perKmFee),
        billingUnitKm: t.billingUnitKm,
        isActive: true,
      }));
      const result = await adminApi.replaceShippingRates(payload);
      const loaded = toTiers(result);
      setSaved(loaded);
      setTiers(loaded);
      setHadInactive(false);
      setConfirmOpen(false);
      message.success('Đã lưu bảng phí lấy cây.');
    } catch (err: any) {
      const code = getApiErrorCode(err);
      message.error((code && ERROR_MESSAGES[code]) || err?.response?.data?.message || 'Lưu bảng phí thất bại.');
    } finally {
      setSaving(false);
    }
  };

  const preview = computeFee(tiers, calcKm || 0);

  if (!isAdmin) {
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
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Bảng phí lấy cây</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 max-w-2xl">
                Phí nhà vườn tính khi đến lấy cây, theo khoảng cách. Mỗi dòng là một bậc km, các bậc
                nối liền nhau và bậc cuối không có giới hạn trên. Phí tính <b>một lần cho cả đơn</b>, không nhân số cây.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {dirty ? (
                <Button
                  icon={<UndoOutlined />}
                  onClick={() => setTiers(saved)}
                  className="!rounded-xl !border-[#ECE7FA]"
                >
                  Hoàn tác
                </Button>
              ) : (
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchRates}
                  className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
                >
                  Làm mới
                </Button>
              )}
              <Button
                type="primary"
                icon={<SaveOutlined />}
                disabled={!dirty || errors.length > 0}
                onClick={() => setConfirmOpen(true)}
                className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold disabled:!bg-[#D9D3EE]"
              >
                Lưu bảng phí
              </Button>
            </div>
          </div>

          {hadInactive && (
            <Alert
              type="warning"
              showIcon
              message="Bảng phí hiện có bậc đang tắt. Khi lưu, mọi bậc trong bảng sẽ được bật để khoảng km nào cũng có phí."
            />
          )}

          <div className="bg-white rounded-2xl border border-[#ECE7FA] shadow-xs overflow-hidden">
            {loading ? (
              <div className="py-16 flex justify-center">
                <Spin />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse">
                  <thead>
                    <tr className="bg-[#F6F4FC] text-left text-xs text-[#6E6A8A]">
                      <th className="px-3 py-3 font-semibold w-[120px]">Từ km</th>
                      <th className="px-3 py-3 font-semibold w-[140px]">Đến km</th>
                      <th className="px-3 py-3 font-semibold">Phí cơ bản</th>
                      <th className="px-3 py-3 font-semibold">Phí cộng thêm</th>
                      <th className="px-3 py-3 font-semibold w-[170px]">Cộng thêm theo khối</th>
                      <th className="px-3 py-3 w-[56px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {tiers.length === 0 && (
                      <tr className="border-t border-[#ECE7FA]">
                        <td colSpan={6} className="px-4 py-10 text-center text-sm text-[#6E6A8A]">
                          Chưa có bảng phí nào, nên hiện mọi đơn đều đang được tính phí lấy cây <b>0 đ</b>.
                          Bấm <b>Thêm bậc</b> để tạo bậc đầu tiên (từ 0 km, không giới hạn).
                        </td>
                      </tr>
                    )}
                    {tiers.map((tier, index) => {
                      const isLast = index === tiers.length - 1;
                      return (
                        <tr key={index} className="border-t border-[#ECE7FA] align-top">
                          <td className="px-3 py-2.5">
                            <InputNumber
                              value={tier.minKm}
                              min={0}
                              step={0.5}
                              precision={2}
                              disabled={index > 0}
                              title={index > 0 ? 'Tự lấy theo "Đến km" của bậc trước' : undefined}
                              onChange={(v) => update(index, { minKm: Number(v ?? 0) })}
                              suffix="km"
                              className="!w-full"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            {isLast ? (
                              <span className="text-xs italic text-[#8B86A4] leading-8">Không giới hạn</span>
                            ) : (
                              <InputNumber
                                value={tier.maxKm ?? undefined}
                                min={0}
                                step={0.5}
                                precision={2}
                                status={invalidRow(index) ? 'error' : undefined}
                                onChange={(v) => update(index, { maxKm: v === null ? null : Number(v) })}
                                suffix="km"
                                className="!w-full"
                              />
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <InputNumber
                              value={tier.baseFee}
                              min={0}
                              step={10000}
                              formatter={moneyFormatter}
                              parser={moneyParser}
                              onChange={(v) => update(index, { baseFee: Number(v ?? 0) })}
                              suffix="đ"
                              className="!w-full"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <InputNumber
                              value={tier.perKmFee}
                              min={0}
                              step={10000}
                              formatter={moneyFormatter}
                              parser={moneyParser}
                              onChange={(v) => update(index, { perKmFee: Number(v ?? 0) })}
                              suffix="đ"
                              className="!w-full"
                            />
                            <div className="text-[11px] text-[#8B86A4] mt-1">
                              {tier.perKmFee
                                ? `${vnd(tier.perKmFee)} mỗi ${tier.billingUnitKm ? `${tier.billingUnitKm} km` : 'km'} vượt mốc ${tier.minKm} km`
                                : 'Phí phẳng cho cả bậc'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <InputNumber
                              value={tier.billingUnitKm ?? undefined}
                              min={0.01}
                              step={1}
                              precision={2}
                              placeholder="Từng km"
                              onChange={(v) =>
                                update(index, { billingUnitKm: v === null || Number(v) === 0 ? null : Number(v) })
                              }
                              suffix="km"
                              className="!w-full"
                            />
                            <div className="text-[11px] text-[#8B86A4] mt-1">
                              {tier.billingUnitKm ? `Làm tròn lên từng khối ${tier.billingUnitKm} km` : 'Để trống = cộng theo từng km'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {tiers.length > 1 && (
                              <Button
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => removeTier(index)}
                                aria-label={`Xóa bậc ${index + 1}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-4 py-3 border-t border-[#ECE7FA] flex flex-wrap items-center justify-between gap-2">
              <Button icon={<PlusOutlined />} onClick={addTier} className="!rounded-xl !border-[#ECE7FA]">
                Thêm bậc
              </Button>
              <span className="text-xs text-[#6E6A8A]">
                Thêm bậc sẽ tách bậc cuối thêm 5 km. &quot;Từ km&quot; của mỗi bậc tự nối theo bậc trước.
              </span>
            </div>
          </div>

          {/* Chỉ báo lỗi khi admin đã sửa — bảng trống lúc mới mở đã có thông báo riêng trong bảng */}
          {dirty && errors.length > 0 && (
            <Alert type="error" showIcon message="Bảng phí chưa hợp lệ" description={
              <ul className="list-disc pl-4 m-0">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
            } />
          )}

          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 space-y-3">
            <h3 className="text-sm font-bold text-[#1E1B2E] m-0">Thử tính phí</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
              <div>
                <label htmlFor="calc-km" className="text-xs text-[#6E6A8A] block mb-1">Khoảng cách</label>
                <InputNumber id="calc-km" value={calcKm} min={0} step={0.5} onChange={(v) => setCalcKm(Number(v ?? 0))} suffix="km" className="!w-full" />
              </div>
              <div>
                <p className="text-xs text-[#6E6A8A] m-0">Phí lấy cây cho cả đơn (theo bảng đang sửa)</p>
                <p className="text-2xl font-extrabold text-[#4E1BA8] m-0">{preview ? vnd(preview.total) : '—'}</p>
              </div>
            </div>
            <p className="text-xs text-[#6E6A8A] m-0">
              {preview
                ? `Bậc ${preview.tier.minKm}–${preview.tier.maxKm ?? '∞'} km: ${vnd(preview.tier.baseFee)} + ${
                    preview.unit ? `⌈${preview.exceeded.toFixed(2)} km ÷ ${preview.unit}⌉` : `${preview.exceeded.toFixed(2)} km`
                  } × ${vnd(preview.tier.perKmFee)}`
                : 'Khoảng cách này không thuộc bậc nào trong bảng.'}
            </p>
          </div>
        </main>
      </div>

      <Modal
        title={<span className="font-bold text-[#1E1B2E]">Lưu bảng phí mới?</span>}
        open={confirmOpen}
        onCancel={() => !saving && setConfirmOpen(false)}
        onOk={handleSave}
        okText="Lưu"
        cancelText="Hủy"
        confirmLoading={saving}
        okButtonProps={{ className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl' }}
        cancelButtonProps={{ className: '!rounded-xl' }}
        centered
      >
        <p className="text-sm text-[#4B4764]">
          Bảng mới <b>thay toàn bộ</b> bảng cũ ({tiers.length} bậc) và áp dụng ngay cho các đơn đặt từ bây
          giờ.
        </p>
      </Modal>
    </div>
  );
}
