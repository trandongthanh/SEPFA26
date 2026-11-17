'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, Image, Input, Modal, Select, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import {
  AdminDisputeDetail,
  DisputeEvidenceItem,
  DisputeHandoverView,
  DisputeVerdict,
  adminApi,
} from '@/lib/admin.api';
import AdminSidebar from '../../components/AdminSidebar';
import AdminHeader from '../../components/AdminHeader';
import {
  DisputeStatusTag,
  OUTCOME_LABELS,
  VERDICT_LABELS,
  VERDICT_OPTIONS,
  formatVnd,
  toDisputeError,
} from '../dispute-ui';

const NOTE_MAX = 4000;
const fmtDate = (value: string | null | undefined) =>
  value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '—';

function Section({ title, children, extra }: { title: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#ECE7FA] p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#1E1B2E] m-0">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function PhotoGrid({ photos }: { photos: { photoUrl: string; caption: string | null }[] }) {
  if (photos.length === 0) return null;
  return (
    <Image.PreviewGroup>
      <div className="flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <div key={`${photo.photoUrl}-${index}`} className="w-20">
            <Image
              src={photo.photoUrl}
              alt={photo.caption || 'Ảnh bằng chứng'}
              width={80}
              height={80}
              className="!rounded-lg object-cover border border-[#ECE7FA]"
            />
            {photo.caption && (
              <div className="text-[10px] text-[#6E6A8A] mt-0.5 truncate" title={photo.caption}>
                {photo.caption}
              </div>
            )}
          </div>
        ))}
      </div>
    </Image.PreviewGroup>
  );
}

function EvidenceColumn({
  title,
  items,
  plantName,
}: {
  title: string;
  items: DisputeEvidenceItem[];
  plantName: (plantId: string | null) => string | null;
}) {
  const notes = Array.from(new Set(items.map((item) => item.note).filter(Boolean))) as string[];
  return (
    <div className="space-y-2 min-w-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6E6A8A] m-0">
        {title} ({items.length} ảnh)
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-[#8B86A4] m-0">Chưa nộp bằng chứng.</p>
      ) : (
        <>
          <PhotoGrid
            photos={items.map((item) => ({
              photoUrl: item.photoUrl,
              caption:
                [plantName(item.plantId), item.caption].filter(Boolean).join(' · ') || null,
            }))}
          />
          {notes.map((note) => (
            <p key={note} className="text-xs text-[#4B4764] bg-[#F6F4FC] rounded-lg p-2 m-0">
              “{note}”
            </p>
          ))}
        </>
      )}
    </div>
  );
}

function HandoverBlock({
  label,
  handover,
  plantName,
}: {
  label: string;
  handover: DisputeHandoverView | null;
  plantName: (plantId: string | null) => string | null;
}) {
  if (!handover) {
    return (
      <div className="text-xs text-[#8B86A4]">
        <b className="text-[#1E1B2E]">{label}:</b> chưa có biên bản.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-xs">
        <b className="text-[#1E1B2E]">{label}</b>{' '}
        <Tag className="!rounded-md !text-[10px] !ml-1">{handover.status}</Tag>
        <span className="text-[#6E6A8A]">
          {handover.confirmedAt ? `Khách xác nhận ${fmtDate(handover.confirmedAt)}` : 'Khách chưa xác nhận'}
        </span>
      </div>
      {handover.assessments.map((assessment) => (
        <div key={assessment.id} className="pl-3 border-l-2 border-[#ECE7FA] space-y-1">
          <div className="text-xs font-semibold text-[#1E1B2E]">
            {plantName(assessment.plantId) || 'Cây'}{' '}
            <span className="font-normal text-[#8B86A4]">· {fmtDate(assessment.assessedAt)}</span>
          </div>
          {assessment.note && <p className="text-xs text-[#4B4764] m-0">{assessment.note}</p>}
          <PhotoGrid photos={assessment.photos} />
        </div>
      ))}
    </div>
  );
}

export default function AdminDisputeDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const disputeId = params?.id;
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dispute, setDispute] = useState<AdminDisputeDetail | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, DisputeVerdict | undefined>>({});
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const fetchDetail = useCallback(async () => {
    if (!disputeId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await adminApi.getDispute(disputeId);
      setDispute(data);
      setVerdicts({});
      setNote('');
    } catch (err: any) {
      setLoadError(toDisputeError(err, 'Không thể tải hồ sơ tranh chấp.'));
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => {
    if (isAdmin) fetchDetail();
  }, [isAdmin, fetchDetail]);

  const plantName = useCallback(
    (plantId: string | null) => {
      if (!plantId || !dispute) return null;
      return (
        dispute.orderPlants.find((p) => p.plantId === plantId)?.name ??
        dispute.plants.find((p) => p.plantId === plantId)?.name ??
        null
      );
    },
    [dispute]
  );

  const disputedIds = useMemo(
    () => new Set(dispute?.plants.map((p) => p.plantId) ?? []),
    [dispute]
  );
  const decidedCount = dispute ? dispute.plants.filter((p) => verdicts[p.plantId]).length : 0;
  const canSubmit =
    !!dispute &&
    dispute.plants.length > 0 &&
    decidedCount === dispute.plants.length &&
    note.trim().length > 0;

  const handleResolve = async () => {
    if (!dispute || !canSubmit) return;
    setSubmitting(true);
    try {
      const result = await adminApi.resolveDispute(dispute.id, {
        plants: dispute.plants.map((p) => ({
          plantId: p.plantId,
          verdict: verdicts[p.plantId] as DisputeVerdict,
        })),
        note: note.trim(),
      });
      message.success(
        `Đã phân xử đơn #${dispute.order.orderCode}: hoàn ${formatVnd(result.refundAmount)}, đền ${formatVnd(result.compensationAmount)}.`
      );
      setConfirmOpen(false);
      await fetchDetail();
    } catch (err: any) {
      message.error(toDisputeError(err, 'Phân xử thất bại.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  const renderBody = () => {
    if (loading && !dispute) {
      return (
        <div className="py-24 flex justify-center">
          <Spin size="large" />
        </div>
      );
    }
    if (loadError || !dispute) {
      return (
        <Alert
          type="error"
          showIcon
          message={loadError || 'Không tìm thấy tranh chấp.'}
          action={<Button onClick={fetchDetail}>Thử lại</Button>}
        />
      );
    }

    const d = dispute;
    const canResolve = d.status === 'ADMIN_REVIEW';

    const banner =
      d.status === 'ADMIN_REVIEW' ? (
        <Alert
          type={d.isOverdue ? 'error' : 'warning'}
          showIcon
          message={d.isOverdue ? 'Đã quá hạn phân xử' : 'Đang chờ admin phân xử'}
          description={`Hạn mềm: ${fmtDate(d.adminDueAt)}. Hai bên đang thấy ngày này là ngày dự kiến có kết quả.`}
        />
      ) : d.status === 'NEGOTIATING' ? (
        <Alert
          type="info"
          showIcon
          message="Hai bên đang tự thương lượng"
          description={`Hạn thương lượng: ${fmtDate(d.negotiationDueAt)}. Hết hạn mà chưa thỏa thuận được, hệ thống tự chuyển cho admin. Hiện admin chỉ xem, chưa phân xử được.`}
        />
      ) : (
        <Alert
          type="success"
          showIcon
          message={`Đã kết thúc – ${d.outcome ? OUTCOME_LABELS[d.outcome] : 'Đã giải quyết'} (${fmtDate(d.resolvedAt)})`}
          description={
            <div className="space-y-1">
              <div>
                Hoàn tiền công <b>{formatVnd(d.refundAmount)}</b> · Tiền đền{' '}
                <b>{formatVnd(d.compensationAmount)}</b> · Khách nhận tổng{' '}
                <b>{formatVnd(d.customerReceives)}</b>
              </div>
              {d.resolutionNote && <div>Lý do phân xử: {d.resolutionNote}</div>}
            </div>
          }
        />
      );

    return (
      <>
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1E1B2E] m-0">
              Tranh chấp đơn{' '}
              <span className="font-mono text-[#6027D2] text-xl">#{d.order.orderCode}</span>
            </h1>
            <p className="text-xs text-[#6E6A8A] mt-1 mb-0">
              {d.reason} · Mở lúc {fmtDate(d.openedAt)}
            </p>
          </div>
          <DisputeStatusTag status={d.status} outcome={d.outcome} isOverdue={d.isOverdue} />
        </div>

        {banner}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5 items-start">
          {/* Cột trái: hồ sơ + phân xử */}
          <div className="space-y-5 min-w-0">
            <Section title="Lời khiếu nại của khách">
              <p className="text-sm text-[#1E1B2E] bg-[#F6F4FC] rounded-xl p-3 m-0 whitespace-pre-line leading-relaxed">
                {d.description}
              </p>
              {d.handoverObjection && (
                <div className="rounded-xl bg-[#FEF3C7] p-3 space-y-2">
                  <p className="text-xs text-[#92400E] m-0">
                    <b>Khách đã ghi phản đối lúc nhận cây:</b>{' '}
                    {d.handoverObjection.note || '(không có ghi chú)'}
                  </p>
                  <PhotoGrid photos={d.handoverObjection.photos} />
                </div>
              )}
            </Section>

            <Section title="Bằng chứng hai bên">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <EvidenceColumn title="Khách hàng" items={d.evidence.customer} plantName={plantName} />
                <EvidenceColumn title="Nhà vườn" items={d.evidence.provider} plantName={plantName} />
              </div>
            </Section>

            <Section title="Lịch sử đề nghị thương lượng">
              {d.offers.length === 0 ? (
                <p className="text-xs text-[#8B86A4] m-0">Hai bên chưa đưa ra đề nghị nào.</p>
              ) : (
                <div className="space-y-2">
                  {d.offers.map((offer) => (
                    <div key={offer.id} className="rounded-xl border border-[#ECE7FA] p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <b className="text-[#1E1B2E]">
                          {offer.proposedBy === 'CUSTOMER' ? 'Khách đề nghị' : 'Nhà vườn đề nghị'}
                          <span className="font-normal text-[#8B86A4]"> · {fmtDate(offer.createdAt)}</span>
                        </b>
                        <Tag
                          color={
                            offer.status === 'ACCEPTED'
                              ? 'success'
                              : offer.status === 'PENDING'
                                ? 'processing'
                                : 'default'
                          }
                          className="!rounded-md !text-[10px] !m-0"
                        >
                          {offer.status === 'ACCEPTED'
                            ? 'Đã đồng ý'
                            : offer.status === 'PENDING'
                              ? 'Đang chờ'
                              : 'Bị thay thế'}
                        </Tag>
                      </div>
                      <div className="text-[#4B4764]">
                        Hoàn tiền công <b>{formatVnd(offer.refundAmount)}</b> · Đền{' '}
                        <b>{formatVnd(offer.compensationAmount)}</b> → khách nhận{' '}
                        <b className="text-[#4E1BA8]">{formatVnd(offer.customerReceives)}</b>
                      </div>
                      {offer.message && <div className="text-[#6E6A8A]">“{offer.message}”</div>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {canResolve && (
              <Section title="Phân xử từng cây bị khiếu nại">
                <p className="text-xs text-[#6E6A8A] m-0">
                  Admin không nhập số tiền. Chọn kết luận cho từng cây, hệ thống tự tính tiền hoàn và
                  tiền đền, chuyển đơn sang hoàn tất rồi chia tiền.
                  {d.caps && (
                    <>
                      {' '}Trần hiện tại: hoàn tối đa <b>{formatVnd(d.caps.refundCap)}</b>, đền tối đa{' '}
                      <b>{formatVnd(d.caps.compensationCap)}</b>.
                    </>
                  )}
                </p>
                <div className="space-y-2">
                  {d.plants.map((plant) => (
                    <div
                      key={plant.plantId}
                      className="rounded-xl border border-[#ECE7FA] p-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_280px] gap-2 items-center"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[#1E1B2E]">
                          {plant.name || 'Cây không rõ tên'}
                        </div>
                        <div className="text-[11px] text-[#6E6A8A]">
                          Mức đền tối đa: {formatVnd(plant.compensationCap)}
                        </div>
                      </div>
                      <Select
                        placeholder="Chọn kết luận"
                        value={verdicts[plant.plantId]}
                        onChange={(value: DisputeVerdict) =>
                          setVerdicts((prev) => ({ ...prev, [plant.plantId]: value }))
                        }
                        options={VERDICT_OPTIONS.map((opt) => ({
                          value: opt.value,
                          label: (
                            <div className="leading-tight py-0.5">
                              <div className="text-xs font-semibold">{opt.label}</div>
                              <div className="text-[10px] text-[#8B86A4]">{opt.hint}</div>
                            </div>
                          ),
                        }))}
                        labelRender={({ value }) => VERDICT_LABELS[value as DisputeVerdict]}
                        className="w-full"
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <label htmlFor="resolution-note" className="text-xs font-semibold text-[#1E1B2E]">
                    Lý do phân xử <span className="text-[#C0262D]">*</span>
                  </label>
                  <Input.TextArea
                    id="resolution-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={NOTE_MAX}
                    showCount
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder="VD: Biên bản nhận ghi cây khỏe, không cờ rủi ro; báo cáo kỳ 3–4 không có ảnh cây. Kết luận vườn làm chết cây."
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="text-xs text-[#6E6A8A]">
                    {decidedCount}/{d.plants.length} cây đã có kết luận
                    {decidedCount === d.plants.length && !note.trim() && ' · còn thiếu lý do phân xử'}
                  </span>
                  <Button
                    type="primary"
                    disabled={!canSubmit}
                    onClick={() => setConfirmOpen(true)}
                    className="!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold disabled:!bg-[#D9D3EE]"
                  >
                    Xác nhận phân xử
                  </Button>
                </div>
              </Section>
            )}

            {!canResolve && d.plants.some((p) => p.verdict) && (
              <Section title="Kết luận từng cây">
                <div className="space-y-1">
                  {d.plants.map((plant) => (
                    <div key={plant.plantId} className="flex justify-between gap-3 text-xs">
                      <span className="font-semibold text-[#1E1B2E]">{plant.name}</span>
                      <span className="text-[#4B4764]">
                        {plant.verdict ? VERDICT_LABELS[plant.verdict] : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>

          {/* Cột phải: bối cảnh đơn */}
          <div className="space-y-5 min-w-0">
            <Section title="Hai bên">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs m-0">
                <dt className="text-[#6E6A8A]">Khách hàng</dt>
                <dd className="m-0 font-semibold text-[#1E1B2E]">
                  {d.customer.fullName || '—'}
                  {d.customer.lostDisputeCount > 0 && (
                    <Tag color="error" className="!rounded-md !text-[10px] !ml-2">
                      Đã thua {d.customer.lostDisputeCount} vụ
                    </Tag>
                  )}
                </dd>
                <dt className="text-[#6E6A8A]">Nhà vườn</dt>
                <dd className="m-0 font-semibold text-[#1E1B2E]">{d.provider.displayName || '—'}</dd>
              </dl>
            </Section>

            <Section title="Đơn hàng">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs m-0">
                <dt className="text-[#6E6A8A]">Tiền công</dt>
                <dd className="m-0 font-semibold">{formatVnd(d.order.basePrice)}</dd>
                <dt className="text-[#6E6A8A]">Phí lấy cây</dt>
                <dd className="m-0 font-semibold">{formatVnd(d.order.pickupFee)}</dd>
                <dt className="text-[#6E6A8A]">Tổng đơn</dt>
                <dd className="m-0 font-extrabold text-[#4E1BA8]">{formatVnd(d.order.finalTotal)}</dd>
                <dt className="text-[#6E6A8A]">Thời gian chăm</dt>
                <dd className="m-0">
                  {d.order.careStartedAt ? dayjs(d.order.careStartedAt).format('DD/MM/YYYY') : '—'} →{' '}
                  {d.order.careDueAt ? dayjs(d.order.careDueAt).format('DD/MM/YYYY') : '—'}
                </dd>
                <dt className="text-[#6E6A8A]">Báo cáo chăm</dt>
                <dd className="m-0">
                  Đã nộp <b>{d.careReports.submittedCount}</b> kỳ
                  {d.careReports.reports.length > 0 && (
                    <div className="text-[11px] text-[#8B86A4] mt-0.5">
                      {d.careReports.reports
                        .map((r) => `Kỳ ${r.periodIndex}: ${r.submittedAt ? dayjs(r.submittedAt).format('DD/MM') : 'chưa nộp'}`)
                        .join(' · ')}
                    </div>
                  )}
                </dd>
              </dl>
            </Section>

            <Section title={`Cây trong đơn (${d.orderPlants.length})`}>
              <div className="space-y-2">
                {d.orderPlants.map((plant) => (
                  <div
                    key={plant.plantId}
                    className={`rounded-xl border p-2.5 text-xs ${disputedIds.has(plant.plantId) ? 'border-[#F5C2C4] bg-[#FFF7F7]' : 'border-[#ECE7FA]'}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b className="text-[#1E1B2E]">{plant.name}</b>
                      {disputedIds.has(plant.plantId) && (
                        <Tag color="error" className="!rounded-md !text-[10px] !m-0">Bị khiếu nại</Tag>
                      )}
                      {plant.isHighRisk && (
                        <Tag color="warning" className="!rounded-md !text-[10px] !m-0">Rủi ro cao</Tag>
                      )}
                      {plant.handoverDecision === 'REJECT' && (
                        <Tag className="!rounded-md !text-[10px] !m-0">Từ chối lúc nhận</Tag>
                      )}
                    </div>
                    <div className="text-[11px] text-[#6E6A8A] mt-0.5">
                      {plant.speciesName || 'Chưa rõ loài'} · Giá trị khai báo:{' '}
                      {plant.isValueDeclared ? formatVnd(plant.declaredValue) : 'Không khai'}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Biên bản giao nhận">
              <div className="space-y-4">
                <HandoverBlock label="Biên bản nhận cây" handover={d.handoverIn} plantName={plantName} />
                <HandoverBlock label="Biên bản trả cây" handover={d.handoverOut} plantName={plantName} />
              </div>
            </Section>
          </div>
        </div>

        <Modal
          title={<span className="font-bold text-[#1E1B2E]">Xác nhận phân xử đơn #{d.order.orderCode}?</span>}
          open={confirmOpen}
          onCancel={() => !submitting && setConfirmOpen(false)}
          onOk={handleResolve}
          okText="Xác nhận phân xử"
          cancelText="Hủy"
          confirmLoading={submitting}
          okButtonProps={{ className: '!bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !rounded-xl' }}
          cancelButtonProps={{ className: '!rounded-xl' }}
          centered
        >
          <div className="space-y-3 pt-2">
            <ul className="text-xs space-y-1 pl-4 m-0">
              {d.plants.map((plant) => (
                <li key={plant.plantId}>
                  <b>{plant.name}</b>:{' '}
                  {verdicts[plant.plantId] ? VERDICT_LABELS[verdicts[plant.plantId]!] : '—'}
                </li>
              ))}
            </ul>
            <Alert
              type="warning"
              showIcon
              message="Sau khi xác nhận, đơn chuyển sang hoàn tất và hệ thống chia tiền ngay. Không thể hoàn tác."
            />
          </div>
        </Modal>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader />
        <main className="flex-1 p-6 space-y-5 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="link"
              icon={<ArrowLeftOutlined />}
              onClick={() => router.push('/admin/disputes')}
              className="!px-0 !text-[#6027D2] font-semibold"
            >
              Danh sách tranh chấp
            </Button>
            {dispute && (
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchDetail}
                loading={loading}
                className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
              >
                Làm mới
              </Button>
            )}
          </div>
          {renderBody()}
        </main>
      </div>
    </div>
  );
}
