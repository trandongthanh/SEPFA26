'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircleOutlined,
  ContainerOutlined,
  FileTextOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Button,
  Modal,
  Pagination,
  Select,
  Spin,
  Tag,
} from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import {
  CareEvidenceType,
  CareReportItem,
  OrderItem,
  OverallHealth,
  PartCondition,
  ProviderProfileResponse,
  SubstrateMoisture,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';
import ListToolbar, { NoResults } from '../components/ListToolbar';
import Highlight from '../components/Highlight';
import { matchesQuery, useUrlParam } from '@/lib/search';

const REPORTS_PAGE_SIZE = 9;

const TIMELINESS_FILTERS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'ON_TIME', label: 'Đúng hạn' },
  { value: 'LATE', label: 'Nộp trễ' },
];

const SUBSTRATE_LABELS: Record<SubstrateMoisture, string> = {
  LOW: 'Thấp (khô)',
  MEDIUM: 'Vừa (ẩm tốt)',
  HIGH: 'Cao (rất ẩm)',
};

const PART_LABELS: Record<PartCondition, { label: string; color: string }> = {
  GOOD: { label: 'Tốt', color: 'green' },
  NORMAL: { label: 'Bình thường', color: 'blue' },
  POOR: { label: 'Xấu', color: 'red' },
};

const HEALTH_LABELS: Record<OverallHealth, { label: string; color: string }> = {
  GOOD: { label: 'Tốt', color: 'green' },
  AVERAGE: { label: 'Trung bình', color: 'gold' },
  POOR: { label: 'Kém', color: 'red' },
};

const EVIDENCE_LABELS: Record<CareEvidenceType, string> = {
  OVERVIEW: 'Toàn cảnh',
  LEAF: 'Cận lá',
  STEM: 'Cận thân',
  ROOT: 'Cận rễ',
};

function ReportsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [reports, setReports] = useState<CareReportItem[]>([]);
  const [ordersMap, setOrdersMap] = useState<Record<string, OrderItem>>({});
  const [orderFilter, setOrderFilter] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useUrlParam('q');
  const [timeliness, setTimeliness] = useState<string>('ALL');
  const [currentPage, setCurrentPage] = useState(1);

  // Về trang 1 mỗi khi đổi điều kiện lọc.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword, orderFilter, timeliness]);
  const [detailReport, setDetailReport] = useState<CareReportItem | null>(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, router]);

  useEffect(() => {
    const orderIdParam = searchParams.get('orderId');
    if (orderIdParam && mounted && isAuthenticated) {
      router.replace(`/provider/reports/new?orderId=${encodeURIComponent(orderIdParam)}`);
    }
  }, [searchParams, mounted, isAuthenticated, router]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Tải HẾT đơn: trước đây chỉ lấy 10 đơn mới nhất nên báo cáo của đơn cũ mất mã đơn / tên khách.
      const [prof, rpts, ordItems] = await Promise.all([
        providerApi.getProfile().catch(() => null),
        providerApi.listCareReports().catch(() => []),
        providerApi.listAllOrders().catch(() => [] as OrderItem[]),
      ]);
      setProfile(prof);
      setReports(Array.isArray(rpts) ? rpts : []);

      const map: Record<string, OrderItem> = {};
      ordItems.forEach((o) => {
        map[o.id] = o;
      });
      setOrdersMap(map);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      loadData();
    }
  }, [mounted, isAuthenticated]);

  // Lọc theo đơn + từ khoá (không phân biệt dấu); lọc "đúng hạn / nộp trễ" tách riêng để đếm số trên nút lọc.
  const searchedReports = reports.filter((rpt) => {
    if (orderFilter !== 'ALL' && rpt.serviceOrderId !== orderFilter) {
      return false;
    }
    const ord = ordersMap[rpt.serviceOrderId];
    return matchesQuery(
      searchKeyword,
      ord?.orderCode,
      ord?.customer?.account?.fullName,
      (rpt.plants || []).map((p) => p.plant?.name || '').join(', '),
      `Kỳ ${rpt.periodIndex}`,
    );
  });
  const filteredReports = searchedReports.filter(
    (rpt) => timeliness === 'ALL' || (timeliness === 'LATE') === Boolean(rpt.isLate),
  );
  const resetFilters = () => {
    setSearchKeyword('');
    setOrderFilter('ALL');
    setTimeliness('ALL');
  };
  // BE trả hết báo cáo một lần (chưa có page/limit) → FE tự chia trang. 9 thẻ = 3 hàng của lưới 3 cột.
  const pagedReports = filteredReports.slice(
    (currentPage - 1) * REPORTS_PAGE_SIZE,
    currentPage * REPORTS_PAGE_SIZE,
  );

  const ordersInReports = Object.values(ordersMap);
  const modalOrder = detailReport ? ordersMap[detailReport.serviceOrderId] : null;

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} />

        <main className="flex-1 p-6 overflow-y-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Nhật ký Báo cáo Chăm sóc</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 font-medium">
                Ghi nhận thông số môi trường chung và tình trạng từng chậu lan theo từng kỳ chăm sóc
              </p>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => router.push('/provider/reports/new')}
              className="!h-11 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-sm shadow-[0_4px_12px_rgba(96,39,210,0.25)]"
            >
              Nộp báo cáo mới
            </Button>
          </div>

          {/* Tìm kiếm + lọc theo đơn + lọc đúng hạn / nộp trễ */}
          <div className="mb-3">
            <ListToolbar
              query={searchKeyword}
              onQueryChange={setSearchKeyword}
              placeholder="Tìm mã đơn, tên khách hoặc tên cây…"
              chips={TIMELINESS_FILTERS.map((f) => ({
                ...f,
                count:
                  f.value === 'ALL'
                    ? searchedReports.length
                    : searchedReports.filter((r) => (f.value === 'LATE') === Boolean(r.isLate)).length,
              }))}
              activeChip={timeliness}
              onChipChange={setTimeliness}
              extra={
                <Select
                  size="large"
                  value={orderFilter}
                  onChange={(val) => setOrderFilter(val)}
                  aria-label="Chọn đơn hàng"
                  showSearch
                  optionFilterProp="label"
                  className="w-full sm:w-80"
                  options={[
                    { value: 'ALL', label: 'Tất cả đơn hàng' },
                    // Chỉ liệt kê đơn đã có báo cáo.
                    ...ordersInReports
                      .map((ord) => ({ ord, count: reports.filter((r) => r.serviceOrderId === ord.id).length }))
                      .filter(({ count }) => count > 0)
                      .map(({ ord, count }) => ({
                        value: ord.id,
                        label: `#${ord.orderCode} · ${ord.customer?.account?.fullName || 'Khách'} (${count})`,
                      })),
                  ]}
                />
              }
            />
          </div>
          {!loading && reports.length > 0 && (
            <p className="mb-4 text-xs text-[#6E6A8A]">
              Hiển thị <b className="text-[#1E1B2E] tabular-nums">{filteredReports.length}</b> /{' '}
              <b className="text-[#1E1B2E] tabular-nums">{reports.length}</b> báo cáo
            </p>
          )}

          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải danh sách báo cáo chăm sóc...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-[#ECE7FA] flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-4xl mb-4">
                <FileTextOutlined />
              </div>
              <h3 className="font-bold text-[#1E1B2E] text-base">Chưa có nhật ký báo cáo nào</h3>
              <p className="text-xs text-[#6E6A8A] mt-1 max-w-md">
                Hãy nộp báo cáo định kỳ cho các đơn hàng đang trong quá trình chăm sóc để khách hàng theo dõi.
              </p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => router.push('/provider/reports/new')}
                className="mt-5 !h-10 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold"
              >
                Tạo báo cáo đầu tiên
              </Button>
            </div>
          ) : filteredReports.length === 0 ? (
            <NoResults
              label={
                searchKeyword ||
                (timeliness !== 'ALL'
                  ? TIMELINESS_FILTERS.find((f) => f.value === timeliness)?.label || ''
                  : 'đơn đã chọn')
              }
              onReset={resetFilters}
            />
          ) : (
            <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {pagedReports.map((rpt, idx) => {
                const orderInfo = ordersMap[rpt.serviceOrderId];
                const plantNames = (rpt.plants || [])
                  .map((p) => p.plant?.name)
                  .filter(Boolean)
                  .join(', ');

                return (
                  <div
                    key={rpt.id || idx}
                    className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] transition-all flex flex-col justify-between"
                  >
                    <div>
                      {/* Order Info Badge Header */}
                      <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] mb-3">
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          <ContainerOutlined className="text-[#6027D2] text-xs shrink-0" />
                          <span className="font-mono text-xs font-bold text-[#6027D2] shrink-0">
                            #<Highlight text={orderInfo?.orderCode || rpt.serviceOrderId.slice(0, 8)} query={searchKeyword} />
                          </span>
                          {orderInfo?.customer?.account?.fullName && (
                            <span className="text-xs text-[#1E1B2E] font-medium truncate">
                              · <Highlight text={orderInfo.customer.account.fullName} query={searchKeyword} />
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => router.push(`/provider/orders/${rpt.serviceOrderId}`)}
                          className="text-[11px] text-[#6027D2] hover:text-[#4E1BA8] font-semibold hover:underline shrink-0"
                        >
                          Xem đơn →
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <Tag color="purple" className="!font-bold">Kỳ {rpt.periodIndex}</Tag>
                          {rpt.isLate ? (
                            <Tag color="orange">Trễ hạn</Tag>
                          ) : (
                            <Tag color="green">Đúng hạn</Tag>
                          )}
                        </div>
                        <span className="text-[11px] text-[#8B86A4]">
                          {new Date(rpt.submittedAt).toLocaleDateString('vi-VN')}
                        </span>
                      </div>

                      <div className="space-y-1.5 text-xs text-[#4B4764] mb-3">
                        <p>
                          Kỳ chăm sóc:{' '}
                          <strong className="text-[#1E1B2E]">
                            {new Date(rpt.periodStart).toLocaleDateString('vi-VN')} –{' '}
                            {new Date(rpt.periodEnd).toLocaleDateString('vi-VN')}
                          </strong>
                        </p>
                        <p>
                          Chậu lan:{' '}
                          <strong className="text-[#1E1B2E]">
                            {plantNames ? (
                              <Highlight text={plantNames} query={searchKeyword} />
                            ) : (
                              `${rpt.plants?.length ?? 0} chậu`
                            )}
                          </strong>
                        </p>
                        <p>
                          Môi trường:{' '}
                          <strong className="text-[#6027D2]">
                            {rpt.airTemperature}°C · {rpt.airHumidity}% · {rpt.lightIntensity} Lux
                          </strong>
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {rpt.watered && (
                            <Tag color="cyan" className="!text-[11px]">
                              Tưới {rpt.waterAmountMl} ml
                            </Tag>
                          )}
                          {rpt.fertilized && (
                            <Tag color="geekblue" className="!text-[11px]">
                              Bón: {rpt.fertilizerType}
                            </Tag>
                          )}
                        </div>
                        {rpt.otherCareNote && (
                          <p className="text-[#6E6A8A] line-clamp-2 italic pt-1">&ldquo;{rpt.otherCareNote}&rdquo;</p>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#ECE7FA] flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-xs text-[#6027D2] font-semibold">
                        <CheckCircleOutlined /> Đã nộp
                      </span>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setDetailReport(rpt)}
                        className="!rounded-lg !text-xs !border-[#ECE7FA] !text-[#6027D2] font-semibold"
                      >
                        Xem chi tiết
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
              {filteredReports.length > REPORTS_PAGE_SIZE && (
                <div className="flex justify-end">
                  <Pagination
                    current={currentPage}
                    pageSize={REPORTS_PAGE_SIZE}
                    total={filteredReports.length}
                    onChange={(page) => {
                      setCurrentPage(page);
                      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    showSizeChanger={false}
                    showTotal={(total, [from, to]) => `${from}–${to} / ${total} báo cáo`}
                  />
                </div>
              )}
            </div>
          )}
        </main>

        {/* Modal: Report Detail */}
        <Modal
          title={
            detailReport ? (
              <div className="flex items-center gap-2 text-base font-bold text-[#1E1B2E]">
                <FileTextOutlined className="text-[#6027D2]" />
                <span>Chi tiết Báo cáo Kỳ {detailReport.periodIndex}</span>
                {detailReport.isLate ? <Tag color="orange">Trễ hạn</Tag> : <Tag color="green">Đúng hạn</Tag>}
              </div>
            ) : null
          }
          open={Boolean(detailReport)}
          onCancel={() => setDetailReport(null)}
          footer={null}
          width={760}
        >
          {detailReport && (
            <div className="space-y-4 pt-2 max-h-[75vh] overflow-y-auto pr-1">
              {/* Order Info in Modal */}
              <div className="p-3.5 rounded-xl bg-[#FAF8FE] border border-[#ECE7FA] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-[#8B86A4] block text-[11px]">Báo cáo cho đơn hàng:</span>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <strong className="text-sm font-bold text-[#6027D2] font-mono">
                      #{modalOrder?.orderCode || detailReport.serviceOrderId}
                    </strong>
                    {modalOrder?.customer?.account?.fullName && (
                      <span className="text-[#1E1B2E] font-medium">
                        · Khách hàng: <strong>{modalOrder.customer.account.fullName}</strong>
                      </span>
                    )}
                  </div>
                  {modalOrder?.servicePackage?.name && (
                    <p className="text-[#6E6A8A] text-[11px] mt-0.5">
                      Gói dịch vụ: <strong>{modalOrder.servicePackage.name}</strong>
                    </p>
                  )}
                </div>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => router.push(`/provider/orders/${detailReport.serviceOrderId}`)}
                  className="!rounded-xl !bg-[#6027D2] text-xs font-semibold shrink-0"
                >
                  Mở chi tiết đơn hàng →
                </Button>
              </div>

              {/* Environmental metrics */}
              <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="text-[#6E6A8A]">Nhiệt độ:</span>{' '}
                  <strong className="text-[#1E1B2E]">{detailReport.airTemperature}°C</strong>
                </div>
                <div>
                  <span className="text-[#6E6A8A]">Độ ẩm:</span>{' '}
                  <strong className="text-[#1E1B2E]">{detailReport.airHumidity}%</strong>
                </div>
                <div>
                  <span className="text-[#6E6A8A]">Ánh sáng:</span>{' '}
                  <strong className="text-[#1E1B2E]">{detailReport.lightIntensity} Lux</strong>
                </div>
                <div>
                  <span className="text-[#6E6A8A]">Tưới nước:</span>{' '}
                  <strong className="text-[#1E1B2E]">
                    {detailReport.watered ? `${detailReport.waterAmountMl} ml` : 'Không'}
                  </strong>
                </div>
                <div>
                  <span className="text-[#6E6A8A]">Bón phân:</span>{' '}
                  <strong className="text-[#1E1B2E]">
                    {detailReport.fertilized ? detailReport.fertilizerType : 'Không'}
                  </strong>
                </div>
                <div>
                  <span className="text-[#6E6A8A]">pH / EC:</span>{' '}
                  <strong className="text-[#1E1B2E]">
                    {detailReport.waterPh ?? '-'} / {detailReport.waterEc ?? '-'}
                  </strong>
                </div>
                {detailReport.otherCareNote && (
                  <div className="col-span-2 sm:col-span-3 text-[#4B4764]">
                    <span className="text-[#6E6A8A]">Ghi chú chăm sóc:</span> {detailReport.otherCareNote}
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-sm text-[#1E1B2E]">
                  Tình trạng từng chậu cây ({detailReport.plants?.length ?? 0})
                </h4>
                {(detailReport.plants ?? []).map((entry, idx) => (
                  <div
                    key={entry.id || idx}
                    className="p-4 rounded-xl border border-[#ECE7FA] bg-white space-y-2"
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="font-bold text-sm text-[#1E1B2E]">
                        {entry.plant?.name || `Chậu cây #${idx + 1}`}
                        {entry.plant?.speciesName ? (
                          <span className="text-xs font-normal text-[#6E6A8A]">
                            {' '}
                            ({entry.plant.speciesName})
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Tag color={HEALTH_LABELS[entry.overallHealth]?.color || 'default'}>
                          Tổng thể: {HEALTH_LABELS[entry.overallHealth]?.label || entry.overallHealth}
                        </Tag>
                        {entry.hasPestDisease && <Tag color="red">Có sâu bệnh</Tag>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-[#4B4764]">
                      <div>Độ ẩm giá thể: <strong>{SUBSTRATE_LABELS[entry.substrateMoisture]}</strong></div>
                      <div>Lá: <Tag color={PART_LABELS[entry.leafCondition]?.color}>{PART_LABELS[entry.leafCondition]?.label}</Tag></div>
                      <div>Thân: <Tag color={PART_LABELS[entry.stemCondition]?.color}>{PART_LABELS[entry.stemCondition]?.label}</Tag></div>
                      <div>Rễ: <Tag color={PART_LABELS[entry.rootCondition]?.color}>{PART_LABELS[entry.rootCondition]?.label}</Tag></div>
                    </div>

                    {entry.note && <p className="text-xs text-[#6E6A8A] italic">&ldquo;{entry.note}&rdquo;</p>}

                    {(entry.photos ?? []).length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
                        {entry.photos.map((photo, pIdx) => (
                          <a
                            key={photo.id || pIdx}
                            href={photo.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-lg overflow-hidden border border-[#ECE7FA] hover:border-[#6027D2]"
                          >
                            <img
                              src={photo.photoUrl}
                              alt={photo.evidenceType}
                              className="w-full h-24 object-cover"
                            />
                            <div className="px-2 py-1 text-[10px] font-semibold text-center bg-[#F6F4FC] text-[#6027D2]">
                              {EVIDENCE_LABELS[photo.evidenceType] || photo.evidenceType}
                            </div>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <ReportsPageContent />
    </Suspense>
  );
}
