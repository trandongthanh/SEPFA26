'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Collapse, Image, Spin, Switch, Tag } from 'antd';
import dayjs from 'dayjs';
import { AddonStatus, OrderAddonItem, adminApi } from '@/lib/admin.api';
import type { CareReportItem, CareReportPlantItem } from '@/lib/provider.api';
import { formatVnd } from './dispute-ui';

// Hai khối bằng chứng cho màn phân xử tranh chấp:
// - Báo cáo chăm sóc từng kỳ: GET /care-reports?serviceOrderId=
// - Add-on (dịch vụ phát sinh): GET /orders/:orderId/addons

const CONDITION: Record<string, { label: string; color: string }> = {
  GOOD: { label: 'Tốt', color: 'success' },
  NORMAL: { label: 'Bình thường', color: 'default' },
  AVERAGE: { label: 'Trung bình', color: 'warning' },
  POOR: { label: 'Kém', color: 'error' },
};
const MOISTURE: Record<string, string> = { LOW: 'Khô', MEDIUM: 'Vừa', HIGH: 'Ẩm' };
const EVIDENCE: Record<string, string> = { OVERVIEW: 'Toàn cây', LEAF: 'Lá', STEM: 'Thân', ROOT: 'Rễ' };

const ADDON_STATUS: Record<AddonStatus, { label: string; color: string }> = {
  PENDING: { label: 'Chờ khách trả lời', color: 'processing' },
  ACCEPTED: { label: 'Khách đồng ý, chờ trả tiền', color: 'warning' },
  PAID: { label: 'Đã trả tiền, chờ làm', color: 'purple' },
  DONE: { label: 'Đã làm xong', color: 'success' },
  REJECTED: { label: 'Khách từ chối', color: 'default' },
  EXPIRED: { label: 'Hết hạn', color: 'default' },
  REFUNDED: { label: 'Vườn trả lại, đã hoàn khách', color: 'blue' },
};
const EXPIRED_REASON: Record<string, string> = {
  NO_RESPONSE: 'khách không trả lời',
  NOT_PAID: 'khách không trả tiền',
  ORDER_RETURNING: 'đơn đã chuyển sang trả cây',
};

const fmtDay = (v: string | null | undefined) => (v ? dayjs(v).format('DD/MM') : '—');
const fmtDateTime = (v: string | null | undefined) => (v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '—');

function Thumbs({ items }: { items: { url: string; caption?: string | null }[] }) {
  if (items.length === 0) return null;
  return (
    <Image.PreviewGroup>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <div key={`${item.url}-${i}`} className="w-16">
            <Image
              src={item.url}
              alt={item.caption || 'Ảnh'}
              width={64}
              height={64}
              className="!rounded-lg object-cover border border-[#ECE7FA]"
            />
            {item.caption && (
              <div className="text-[10px] text-[#6E6A8A] truncate" title={item.caption}>
                {item.caption}
              </div>
            )}
          </div>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}

function PlantEntry({ entry, disputed }: { entry: CareReportPlantItem; disputed: boolean }) {
  const health = CONDITION[entry.overallHealth];
  const part = (label: string, v: string) => (
    <span className="text-[11px] text-[#4B4764]">
      {label}: <b>{CONDITION[v]?.label ?? v}</b>
    </span>
  );
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${disputed ? 'border-[#F5C2C4] bg-[#FFF7F7]' : 'border-[#ECE7FA]'}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="text-sm text-[#1E1B2E]">{entry.plant.name || 'Cây'}</b>
        {disputed && <Tag color="error" className="!rounded-md !text-[10px] !m-0">Bị khiếu nại</Tag>}
        {health && (
          <Tag color={health.color} className="!rounded-md !text-[10px] !m-0">
            Tổng thể: {health.label}
          </Tag>
        )}
        {entry.hasPestDisease && <Tag color="error" className="!rounded-md !text-[10px] !m-0">Có sâu bệnh</Tag>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {part('Lá', entry.leafCondition)}
        {part('Thân', entry.stemCondition)}
        {part('Rễ', entry.rootCondition)}
        <span className="text-[11px] text-[#4B4764]">
          Giá thể: <b>{MOISTURE[entry.substrateMoisture] ?? entry.substrateMoisture}</b>
        </span>
      </div>
      {entry.note && <p className="text-xs text-[#4B4764] m-0">“{entry.note}”</p>}
      <Thumbs
        items={entry.photos.map((p) => ({
          url: p.photoUrl,
          caption: [EVIDENCE[p.evidenceType] ?? p.evidenceType, p.caption].filter(Boolean).join(' · '),
        }))}
      />
    </div>
  );
}

export function CareReportsSection({
  orderId,
  disputedPlantIds,
}: {
  orderId: string;
  disputedPlantIds: Set<string>;
}) {
  const [reports, setReports] = useState<CareReportItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDisputed, setOnlyDisputed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReports(null);
    setError(null);
    adminApi
      .listOrderCareReports(orderId)
      .then((data) => !cancelled && setReports([...data].sort((a, b) => a.periodIndex - b.periodIndex)))
      .catch(() => !cancelled && setError('Không tải được báo cáo chăm sóc của đơn.'));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const items = useMemo(
    () =>
      (reports ?? []).map((report) => {
        const plants = onlyDisputed
          ? report.plants.filter((p) => disputedPlantIds.has(p.plant.id))
          : report.plants;
        return {
          key: report.id,
          label: (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <b className="text-[#1E1B2E]">Kỳ {report.periodIndex}</b>
              <span className="text-[#6E6A8A]">
                {fmtDay(report.periodStart)} – {fmtDay(report.periodEnd)} · nộp {fmtDateTime(report.submittedAt)}
              </span>
              {report.isLate && <Tag color="warning" className="!rounded-md !text-[10px] !m-0">Nộp trễ</Tag>}
              {report.plants.some((p) => disputedPlantIds.has(p.plant.id) && p.overallHealth === 'POOR') && (
                <Tag color="error" className="!rounded-md !text-[10px] !m-0">Cây khiếu nại: Kém</Tag>
              )}
            </div>
          ),
          children: (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#4B4764]">
                <span>🌡 {report.airTemperature}°C</span>
                <span>💧 Độ ẩm {report.airHumidity}%</span>
                <span>☀ {report.lightIntensity} lux</span>
                <span>
                  Tưới: <b>{report.watered ? `Có${report.waterAmountMl ? ` (${report.waterAmountMl} ml)` : ''}` : 'Không'}</b>
                </span>
                <span>
                  Bón phân: <b>{report.fertilized ? report.fertilizerType || 'Có' : 'Không'}</b>
                </span>
              </div>
              {report.otherCareNote && <p className="text-xs text-[#4B4764] m-0">Ghi chú: {report.otherCareNote}</p>}
              {plants.length === 0 ? (
                <p className="text-xs text-[#8B86A4] m-0">
                  {onlyDisputed ? 'Kỳ này không có cây bị khiếu nại trong báo cáo.' : 'Kỳ này không có cây nào.'}
                </p>
              ) : (
                plants.map((entry) => (
                  <PlantEntry
                    key={entry.id ?? entry.plant.id}
                    entry={entry}
                    disputed={disputedPlantIds.has(entry.plant.id)}
                  />
                ))
              )}
            </div>
          ),
        };
      }),
    [reports, onlyDisputed, disputedPlantIds]
  );

  return (
    <section className="bg-white rounded-2xl border border-[#ECE7FA] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-[#1E1B2E] m-0">
          Báo cáo chăm sóc {reports ? `(${reports.length} kỳ)` : ''}
        </h3>
        <label className="flex items-center gap-2 text-xs text-[#6E6A8A] cursor-pointer">
          <Switch size="small" checked={onlyDisputed} onChange={setOnlyDisputed} />
          Chỉ cây bị khiếu nại
        </label>
      </div>
      {error ? (
        <Alert type="warning" showIcon message={error} />
      ) : reports === null ? (
        <div className="py-6 flex justify-center">
          <Spin size="small" />
        </div>
      ) : reports.length === 0 ? (
        <p className="text-xs text-[#8B86A4] m-0">Nhà vườn chưa nộp báo cáo chăm sóc nào cho đơn này.</p>
      ) : (
        <Collapse size="small" items={items} defaultActiveKey={reports.length ? [reports[reports.length - 1].id] : []} />
      )}
    </section>
  );
}

export function AddonsSection({ orderId }: { orderId: string }) {
  const [addons, setAddons] = useState<OrderAddonItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAddons(null);
    setError(null);
    adminApi
      .listOrderAddons(orderId)
      .then((data) => !cancelled && setAddons(data))
      .catch(() => !cancelled && setError('Không tải được add-on của đơn.'));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  return (
    <section className="bg-white rounded-2xl border border-[#ECE7FA] p-5 flex flex-col gap-3">
      <h3 className="text-sm font-bold text-[#1E1B2E] m-0">
        Add-on – dịch vụ phát sinh {addons ? `(${addons.length})` : ''}
      </h3>
      {error ? (
        <Alert type="warning" showIcon message={error} />
      ) : addons === null ? (
        <div className="py-6 flex justify-center">
          <Spin size="small" />
        </div>
      ) : addons.length === 0 ? (
        <p className="text-xs text-[#8B86A4] m-0">Đơn này không có add-on nào.</p>
      ) : (
        <div className="space-y-2">
          {addons.map((a) => {
            const st = ADDON_STATUS[a.status];
            const done = CONDITION[a.donePlantHealth ?? ''];
            return (
              <div key={a.id} className="rounded-xl border border-[#ECE7FA] p-3 space-y-1.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b className="text-sm text-[#1E1B2E]">
                    {a.title}
                    {a.plant?.name && <span className="font-normal text-[#6E6A8A]"> · {a.plant.name}</span>}
                  </b>
                  <Tag color={st?.color} className="!rounded-md !text-[10px] !m-0">
                    {st?.label ?? a.status}
                  </Tag>
                </div>
                <div className="text-[#4B4764]">
                  Giá <b>{formatVnd(a.price)}</b> · khách trả <b>{formatVnd(a.amountDue)}</b> · đề xuất{' '}
                  {fmtDateTime(a.createdAt)}
                  {a.status === 'EXPIRED' && a.expiredReason && <> · hết hạn vì {EXPIRED_REASON[a.expiredReason]}</>}
                </div>
                {a.reason && <p className="text-[#4B4764] m-0">Lý do vườn đề xuất: “{a.reason}”</p>}
                {a.customerNote && <p className="text-[#4B4764] m-0">Khách ghi: “{a.customerNote}”</p>}
                {a.status === 'REFUNDED' && a.refundReason && (
                  <p className="text-[#4B4764] m-0">
                    Vườn trả lại{a.refundedAt ? ` lúc ${fmtDateTime(a.refundedAt)}` : ''}: “{a.refundReason}”
                  </p>
                )}
                <Thumbs items={(a.photoUrls ?? []).map((url) => ({ url, caption: 'Lúc đề xuất' }))} />
                {a.status === 'DONE' && (
                  <div className="rounded-lg bg-[#F6F4FC] p-2 space-y-1">
                    <div className="text-[#1E1B2E]">
                      Báo xong {fmtDateTime(a.doneAt)}
                      {done && (
                        <Tag color={done.color} className="!rounded-md !text-[10px] !ml-2">
                          Cây sau khi làm: {done.label}
                        </Tag>
                      )}
                    </div>
                    {a.doneNote && <p className="text-[#4B4764] m-0">“{a.doneNote}”</p>}
                    <Thumbs items={(a.donePhotoUrls ?? []).map((url) => ({ url, caption: 'Sau khi làm' }))} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
