'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeftOutlined,
  CameraOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Spin,
  Switch,
  message,
} from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import {
  CareEvidenceType,
  CareReportSchedule,
  CreateCareReportPayload,
  CreateCareReportPhotoPayload,
  OrderItem,
  OrderPlantSummary,
  OverallHealth,
  PartCondition,
  ProviderProfileResponse,
  SubstrateMoisture,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../../components/ProviderHeader';
import ProviderSidebar from '../../components/ProviderSidebar';

const EVIDENCE_LABELS: Record<CareEvidenceType, string> = {
  OVERVIEW: 'Ảnh toàn cảnh',
  LEAF: 'Ảnh cận lá',
  STEM: 'Ảnh cận thân',
  ROOT: 'Ảnh cận rễ',
};

interface PlantFormDraft {
  plantId: string;
  plantName: string;
  speciesName?: string | null;
  substrateMoisture: SubstrateMoisture;
  leafCondition: PartCondition;
  rootCondition: PartCondition;
  stemCondition: PartCondition;
  hasPestDisease: boolean;
  overallHealth: OverallHealth;
  note: string;
  leafLengthCm?: number;
  leafCount?: number;
  newRootLengthCm?: number;
  newShootCount?: number;
  flowerSpikeCount?: number;
  budCount?: number;
  flowerCount?: number;
  photos: Record<CareEvidenceType, string>;
}

function createInitialPlantDraft(plant: OrderPlantSummary): PlantFormDraft {
  return {
    plantId: plant.id,
    plantName: plant.name,
    speciesName: plant.speciesName,
    substrateMoisture: 'MEDIUM',
    leafCondition: 'GOOD',
    rootCondition: 'GOOD',
    stemCondition: 'GOOD',
    hasPestDisease: false,
    overallHealth: 'GOOD',
    note: '',
    photos: {
      OVERVIEW: '',
      LEAF: '',
      STEM: '',
      ROOT: '',
    },
  };
}

function NewReportPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [inCareOrders, setInCareOrders] = useState<OrderItem[]>([]);
  const [selectedOrderSchedule, setSelectedOrderSchedule] = useState<CareReportSchedule | null>(null);
  const [plantDrafts, setPlantDrafts] = useState<PlantFormDraft[]>([]);
  const [uploadingPhotoKey, setUploadingPhotoKey] = useState<string | null>(null);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [form] = Form.useForm();
  const watered = Form.useWatch('watered', form);
  const fertilized = Form.useWatch('fertilized', form);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, router]);

  const loadOrderPlants = async (orderId: string) => {
    if (!orderId) {
      setPlantDrafts([]);
      setSelectedOrderSchedule(null);
      return;
    }
    setLoadingOrderDetail(true);
    try {
      const detail = await providerApi.getOrderDetail(orderId);
      const rawPlants: OrderPlantSummary[] = Array.isArray(detail?.plants) ? detail.plants : [];
      const activePlants = rawPlants.filter((p) => p.handoverDecision !== 'REJECT');
      setPlantDrafts(activePlants.map(createInitialPlantDraft));
      setSelectedOrderSchedule(detail?.careReportSchedule ?? null);
    } catch {
      message.error('Không thể tải danh sách cây của đơn hàng.');
      setPlantDrafts([]);
      setSelectedOrderSchedule(null);
    } finally {
      setLoadingOrderDetail(false);
    }
  };

  useEffect(() => {
    if (!mounted || !isAuthenticated) return;
    const init = async () => {
      setLoading(true);
      try {
        const [prof, inCareRes] = await Promise.all([
          providerApi.getProfile().catch(() => null),
          providerApi.listOrders('IN_CARE').catch(() => ({ items: [] })),
        ]);
        setProfile(prof);
        setInCareOrders(Array.isArray(inCareRes?.items) ? inCareRes.items : []);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [mounted, isAuthenticated]);

  useEffect(() => {
    const orderIdParam = searchParams.get('orderId');
    if (orderIdParam && mounted && isAuthenticated) {
      form.setFieldsValue({ serviceOrderId: orderIdParam });
      loadOrderPlants(orderIdParam);
    }
  }, [searchParams, form, mounted, isAuthenticated]);

  const updatePlantDraft = (index: number, patch: Partial<PlantFormDraft>) => {
    setPlantDrafts((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const updatePlantPhoto = (index: number, type: CareEvidenceType, url: string) => {
    setPlantDrafts((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, photos: { ...item.photos, [type]: url } } : item
      )
    );
  };

  const handleUploadPlantPhoto = async (index: number, type: CareEvidenceType, file?: File) => {
    if (!file) return;
    const key = `${index}-${type}`;
    setUploadingPhotoKey(key);
    try {
      const uploaded = await providerApi.uploadDocument(file);
      updatePlantPhoto(index, type, uploaded.url);
      message.success(`Đã tải ${EVIDENCE_LABELS[type].toLowerCase()} thành công`);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể tải ảnh lên.';
      message.error(msg);
    } finally {
      setUploadingPhotoKey(null);
    }
  };

  const handleCreateReport = async (values: any) => {
    if (plantDrafts.length === 0) {
      message.error('Vui lòng chọn đơn hàng có cây đang chăm sóc.');
      return;
    }

    for (const draft of plantDrafts) {
      const overviewUrl = draft.photos.OVERVIEW?.trim();
      if (!overviewUrl || !overviewUrl.startsWith('https://')) {
        message.error(`Cây "${draft.plantName}" bắt buộc có Ảnh toàn cảnh.`);
        return;
      }
      if (draft.leafCondition === 'POOR' && !draft.photos.LEAF?.trim()) {
        message.error(`Cây "${draft.plantName}" có lá chấm Xấu — bắt buộc tải Ảnh cận lá.`);
        return;
      }
      if (draft.stemCondition === 'POOR' && !draft.photos.STEM?.trim()) {
        message.error(`Cây "${draft.plantName}" có thân chấm Xấu — bắt buộc tải Ảnh cận thân.`);
        return;
      }
      if (draft.rootCondition === 'POOR' && !draft.photos.ROOT?.trim()) {
        message.error(`Cây "${draft.plantName}" có rễ chấm Xấu — bắt buộc tải Ảnh cận rễ.`);
        return;
      }
      if (
        draft.hasPestDisease &&
        !draft.photos.LEAF?.trim() &&
        !draft.photos.STEM?.trim() &&
        !draft.photos.ROOT?.trim()
      ) {
        message.error(`Cây "${draft.plantName}" có sâu bệnh — cần ít nhất 1 ảnh cận (Lá, Thân hoặc Rễ).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: CreateCareReportPayload = {
        serviceOrderId: values.serviceOrderId,
        airTemperature: Number(values.airTemperature),
        airHumidity: Number(values.airHumidity),
        lightIntensity: Math.round(Number(values.lightIntensity)),
        watered: Boolean(values.watered),
        waterAmountMl: values.watered ? Math.round(Number(values.waterAmountMl)) : undefined,
        fertilized: Boolean(values.fertilized),
        fertilizerType: values.fertilized ? String(values.fertilizerType || '').trim() : undefined,
        otherCareNote: values.otherCareNote ? String(values.otherCareNote).trim() : undefined,
        waterPh: values.waterPh !== undefined && values.waterPh !== null ? Number(values.waterPh) : undefined,
        waterEc: values.waterEc !== undefined && values.waterEc !== null ? Number(values.waterEc) : undefined,
        plants: plantDrafts.map((draft) => {
          const photos: CreateCareReportPhotoPayload[] = (
            ['OVERVIEW', 'LEAF', 'STEM', 'ROOT'] as CareEvidenceType[]
          )
            .filter((t) => draft.photos[t]?.trim())
            .map((t) => ({
              evidenceType: t,
              photoUrl: draft.photos[t].trim(),
              caption: `${EVIDENCE_LABELS[t]} - ${draft.plantName}`,
            }));

          return {
            plantId: draft.plantId,
            substrateMoisture: draft.substrateMoisture,
            leafCondition: draft.leafCondition,
            rootCondition: draft.rootCondition,
            stemCondition: draft.stemCondition,
            hasPestDisease: draft.hasPestDisease,
            overallHealth: draft.overallHealth,
            note: draft.note.trim() || undefined,
            leafLengthCm: draft.leafLengthCm,
            leafCount: draft.leafCount,
            newRootLengthCm: draft.newRootLengthCm,
            newShootCount: draft.newShootCount,
            flowerSpikeCount: draft.flowerSpikeCount,
            budCount: draft.budCount,
            flowerCount: draft.flowerCount,
            photos,
          };
        }),
      };

      const created = await providerApi.createCareReport(payload);
      message.success(`Đã nộp báo cáo Kỳ ${created.periodIndex} thành công!`);
      router.push('/provider/reports');
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Không thể gửi báo cáo. Vui lòng kiểm tra lại các thông tin nhập.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} />

        <main className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-5xl mx-auto space-y-6 pb-10">
            {/* Top Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <button
                  type="button"
                  onClick={() => router.push('/provider/reports')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#6027D2] hover:underline mb-2"
                >
                  <ArrowLeftOutlined /> Quay lại Nhật ký Báo cáo
                </button>
                <h1 className="text-2xl font-bold text-[#1E1B2E] flex items-center gap-2">
                  <FileTextOutlined className="text-[#6027D2]" />
                  Nộp Báo cáo Chăm sóc Định kỳ
                </h1>
                <p className="text-xs text-[#6E6A8A] mt-1">
                  Ghi nhận thông số môi trường của đơn hàng và tình trạng chi tiết từng chậu cây
                </p>
              </div>
            </div>

            {loading ? (
              <div className="py-20 text-center">
                <Spin size="large" />
              </div>
            ) : (
              <Form
                form={form}
                layout="vertical"
                onFinish={handleCreateReport}
                initialValues={{
                  airTemperature: 27.5,
                  airHumidity: 72,
                  lightIntensity: 18000,
                  watered: true,
                  waterAmountMl: 500,
                  fertilized: false,
                }}
                className="space-y-6"
              >
                {/* Card 1: Chọn đơn hàng */}
                <section className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-sm space-y-4">
                  <h2 className="text-sm font-bold text-[#1E1B2E]">
                    1. Chọn đơn hàng đang chăm sóc
                  </h2>

                  <Form.Item
                    name="serviceOrderId"
                    label={<span className="font-semibold text-xs text-[#4B4764]">Đơn hàng</span>}
                    rules={[{ required: true, message: 'Vui lòng chọn đơn hàng' }]}
                    className="!mb-0"
                  >
                    <Select
                      size="large"
                      placeholder="Chọn đơn hàng đang trong quá trình chăm sóc..."
                      className="!rounded-xl"
                      onChange={(orderId) => loadOrderPlants(orderId)}
                      options={inCareOrders.map((ord) => ({
                        label: `Đơn ${ord.orderCode} - ${ord.customer?.account?.fullName || 'Khách hàng'} (${ord.servicePackage?.name || 'Gói chăm sóc'})`,
                        value: ord.id,
                      }))}
                    />
                  </Form.Item>

                  {selectedOrderSchedule && (
                    <Alert
                      type={selectedOrderSchedule.isReportOverdue ? 'warning' : 'info'}
                      showIcon
                      icon={<ClockCircleOutlined />}
                      message={`Tiến độ kỳ báo cáo: Đã nộp ${selectedOrderSchedule.submittedCount}/${selectedOrderSchedule.totalPeriods} kỳ (đang nộp Kỳ ${selectedOrderSchedule.submittedCount + 1})`}
                      description={
                        selectedOrderSchedule.nextReportDueAt
                          ? `Hạn kỳ tiếp theo: ${new Date(selectedOrderSchedule.nextReportDueAt).toLocaleString('vi-VN')}`
                          : 'Đã hoàn tất các kỳ báo cáo của gói.'
                      }
                    />
                  )}
                </section>

                {/* Card 2: Tầng 1 - Môi trường & Chăm sóc chung */}
                <section className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-sm space-y-4">
                  <h2 className="text-sm font-bold text-[#1E1B2E]">
                    2. Thông số môi trường & Chăm sóc chung của đơn
                  </h2>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Form.Item
                      name="airTemperature"
                      label={<span className="font-semibold text-xs text-[#4B4764]">Nhiệt độ (°C)</span>}
                      rules={[{ required: true, message: 'Nhập nhiệt độ' }]}
                      className="!mb-0"
                    >
                      <InputNumber min={-10} max={60} step={0.5} className="w-full !rounded-xl" />
                    </Form.Item>

                    <Form.Item
                      name="airHumidity"
                      label={<span className="font-semibold text-xs text-[#4B4764]">Độ ẩm không khí (%)</span>}
                      rules={[{ required: true, message: 'Nhập độ ẩm' }]}
                      className="!mb-0"
                    >
                      <InputNumber min={0} max={100} step={1} className="w-full !rounded-xl" />
                    </Form.Item>

                    <Form.Item
                      name="lightIntensity"
                      label={<span className="font-semibold text-xs text-[#4B4764]">Ánh sáng (Lux)</span>}
                      rules={[{ required: true, message: 'Nhập cường độ ánh sáng' }]}
                      className="!mb-0"
                    >
                      <InputNumber min={0} max={200000} step={500} className="w-full !rounded-xl" />
                    </Form.Item>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#1E1B2E]">Đã tưới nước trong kỳ</span>
                        <Form.Item name="watered" valuePropName="checked" className="!mb-0">
                          <Switch />
                        </Form.Item>
                      </div>
                      {watered && (
                        <Form.Item
                          name="waterAmountMl"
                          label={<span className="text-xs font-medium text-[#4B4764]">Lượng nước (ml)</span>}
                          rules={[{ required: true, message: 'Nhập lượng nước (ml)' }]}
                          className="!mb-0"
                        >
                          <InputNumber min={1} max={100000} className="w-full !rounded-xl" placeholder="VD: 500" />
                        </Form.Item>
                      )}
                    </div>

                    <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#1E1B2E]">Đã bón phân trong kỳ</span>
                        <Form.Item name="fertilized" valuePropName="checked" className="!mb-0">
                          <Switch />
                        </Form.Item>
                      </div>
                      {fertilized && (
                        <Form.Item
                          name="fertilizerType"
                          label={<span className="text-xs font-medium text-[#4B4764]">Loại phân bón & liều lượng</span>}
                          rules={[{ required: true, message: 'Nhập tên/liều lượng phân bón' }]}
                          className="!mb-0"
                        >
                          <Input placeholder="VD: NPK 20-20-20 pha loãng" className="!rounded-xl" />
                        </Form.Item>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Form.Item
                      name="waterPh"
                      label={<span className="font-semibold text-xs text-[#4B4764]">pH nước tưới (tuỳ chọn)</span>}
                      className="!mb-0"
                    >
                      <InputNumber min={0} max={14} step={0.1} className="w-full !rounded-xl" placeholder="VD: 6.2" />
                    </Form.Item>

                    <Form.Item
                      name="waterEc"
                      label={<span className="font-semibold text-xs text-[#4B4764]">EC nước tưới mS/cm (tuỳ chọn)</span>}
                      className="!mb-0"
                    >
                      <InputNumber min={0} max={20} step={0.05} className="w-full !rounded-xl" placeholder="VD: 0.8" />
                    </Form.Item>
                  </div>

                  <Form.Item
                    name="otherCareNote"
                    label={<span className="font-semibold text-xs text-[#4B4764]">Ghi chú chăm sóc chung (tuỳ chọn)</span>}
                    className="!mb-0"
                  >
                    <Input.TextArea rows={2} placeholder="Cắt tỉa lá già, vệ sinh giá thể..." className="!rounded-xl" />
                  </Form.Item>
                </section>

                {/* Card 3: Tầng 2 - Từng chậu cây */}
                <section className="bg-white rounded-2xl p-6 border border-[#ECE7FA] shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#1E1B2E]">
                      3. Đánh giá & Hình ảnh từng chậu cây ({plantDrafts.length})
                    </h2>
                  </div>

                  {loadingOrderDetail ? (
                    <div className="py-10 text-center">
                      <Spin size="small" /> <span className="text-xs text-[#6E6A8A] ml-2">Đang tải cây của đơn...</span>
                    </div>
                  ) : plantDrafts.length === 0 ? (
                    <div className="p-8 rounded-xl bg-[#F6F4FC] border border-dashed border-[#DDD6FE] text-center text-xs text-[#6E6A8A]">
                      Vui lòng chọn một đơn hàng ở mục 1 để hiển thị danh sách chậu cây cần báo cáo.
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {plantDrafts.map((draft, idx) => (
                        <div
                          key={draft.plantId}
                          className="p-5 rounded-2xl bg-[#FAFAFD] border border-[#E9E3FA] space-y-4"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-[#ECE7FA]">
                            <div>
                              <span className="font-bold text-base text-[#1E1B2E]">
                                #{idx + 1}. {draft.plantName}
                              </span>
                              {draft.speciesName && (
                                <span className="text-xs text-[#6E6A8A] ml-2">({draft.speciesName})</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-[#ECE7FA]">
                              <span className="text-xs font-semibold text-[#4B4764]">Có sâu bệnh?</span>
                              <Switch
                                size="small"
                                checked={draft.hasPestDisease}
                                onChange={(checked) => updatePlantDraft(idx, { hasPestDisease: checked })}
                              />
                            </div>
                          </div>

                          {/* Trạng thái các bộ phận */}
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                            <div>
                              <label className="block text-xs font-semibold text-[#4B4764] mb-1">Độ ẩm giá thể</label>
                              <Select
                                className="w-full"
                                value={draft.substrateMoisture}
                                onChange={(v) => updatePlantDraft(idx, { substrateMoisture: v })}
                                options={[
                                  { value: 'LOW', label: 'Thấp' },
                                  { value: 'MEDIUM', label: 'Vừa' },
                                  { value: 'HIGH', label: 'Cao' },
                                ]}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-[#4B4764] mb-1">Tình trạng lá</label>
                              <Select
                                className="w-full"
                                value={draft.leafCondition}
                                onChange={(v) => updatePlantDraft(idx, { leafCondition: v })}
                                options={[
                                  { value: 'GOOD', label: 'Tốt' },
                                  { value: 'NORMAL', label: 'Bình thường' },
                                  { value: 'POOR', label: 'Xấu (cần ảnh)' },
                                ]}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-[#4B4764] mb-1">Tình trạng thân</label>
                              <Select
                                className="w-full"
                                value={draft.stemCondition}
                                onChange={(v) => updatePlantDraft(idx, { stemCondition: v })}
                                options={[
                                  { value: 'GOOD', label: 'Tốt' },
                                  { value: 'NORMAL', label: 'Bình thường' },
                                  { value: 'POOR', label: 'Xấu (cần ảnh)' },
                                ]}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-[#4B4764] mb-1">Tình trạng rễ</label>
                              <Select
                                className="w-full"
                                value={draft.rootCondition}
                                onChange={(v) => updatePlantDraft(idx, { rootCondition: v })}
                                options={[
                                  { value: 'GOOD', label: 'Tốt' },
                                  { value: 'NORMAL', label: 'Bình thường' },
                                  { value: 'POOR', label: 'Xấu (cần ảnh)' },
                                ]}
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-[#4B4764] mb-1">Sức khỏe tổng thể</label>
                              <Select
                                className="w-full"
                                value={draft.overallHealth}
                                onChange={(v) => updatePlantDraft(idx, { overallHealth: v })}
                                options={[
                                  { value: 'GOOD', label: 'Tốt' },
                                  { value: 'AVERAGE', label: 'Trung bình' },
                                  { value: 'POOR', label: 'Kém' },
                                ]}
                              />
                            </div>
                          </div>

                          {/* Chỉ số đo tùy chọn */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium text-[#6E6A8A] mb-1">Dài lá (cm)</label>
                              <InputNumber
                                min={0}
                                max={200}
                                step={0.5}
                                placeholder="VD: 18.5"
                                className="w-full"
                                value={draft.leafLengthCm}
                                onChange={(v) => updatePlantDraft(idx, { leafLengthCm: v ?? undefined })}
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-[#6E6A8A] mb-1">Số lá</label>
                              <InputNumber
                                min={0}
                                max={1000}
                                placeholder="VD: 6"
                                className="w-full"
                                value={draft.leafCount}
                                onChange={(v) => updatePlantDraft(idx, { leafCount: v ?? undefined })}
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-[#6E6A8A] mb-1">Dài rễ mới (cm)</label>
                              <InputNumber
                                min={0}
                                max={200}
                                step={0.5}
                                placeholder="VD: 3"
                                className="w-full"
                                value={draft.newRootLengthCm}
                                onChange={(v) => updatePlantDraft(idx, { newRootLengthCm: v ?? undefined })}
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-[#6E6A8A] mb-1">Số chồi mới</label>
                              <InputNumber
                                min={0}
                                max={1000}
                                placeholder="VD: 1"
                                className="w-full"
                                value={draft.newShootCount}
                                onChange={(v) => updatePlantDraft(idx, { newShootCount: v ?? undefined })}
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#4B4764] mb-1">
                              Ghi chú riêng cho chậu này (tuỳ chọn)
                            </label>
                            <Input
                              placeholder="VD: Lá già phía gốc đã cắt bỏ..."
                              value={draft.note}
                              onChange={(e) => updatePlantDraft(idx, { note: e.target.value })}
                              className="!rounded-xl"
                            />
                          </div>

                          {/* Ảnh minh chứng: 4 ô gọn gàng, input file ẩn hoàn toàn */}
                          <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] space-y-3">
                            <div className="flex items-center gap-2 text-xs font-bold text-[#6027D2]">
                              <CameraOutlined />
                              <span>
                                Ảnh minh chứng (Bắt buộc Ảnh toàn cảnh; thêm ảnh cận nếu chấm Xấu hoặc có sâu bệnh)
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              {(['OVERVIEW', 'LEAF', 'STEM', 'ROOT'] as CareEvidenceType[]).map((type) => {
                                const isRequired =
                                  type === 'OVERVIEW' ||
                                  (type === 'LEAF' && draft.leafCondition === 'POOR') ||
                                  (type === 'STEM' && draft.stemCondition === 'POOR') ||
                                  (type === 'ROOT' && draft.rootCondition === 'POOR');
                                const uploading = uploadingPhotoKey === `${idx}-${type}`;
                                const currentUrl = draft.photos[type];

                                return (
                                  <div
                                    key={type}
                                    className="bg-white rounded-xl border border-[#ECE7FA] p-3 flex flex-col justify-between gap-2.5"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-[#1E1B2E]">
                                        {EVIDENCE_LABELS[type]}
                                        {isRequired ? <span className="text-red-500"> *</span> : null}
                                      </span>
                                      {currentUrl && (
                                        <button
                                          type="button"
                                          onClick={() => updatePlantPhoto(idx, type, '')}
                                          className="text-red-500 hover:text-red-700 text-xs"
                                          title="Xóa ảnh"
                                        >
                                          <DeleteOutlined />
                                        </button>
                                      )}
                                    </div>

                                    {currentUrl ? (
                                      <img
                                        src={currentUrl}
                                        alt={EVIDENCE_LABELS[type]}
                                        className="w-full h-28 rounded-lg object-cover border border-[#ECE7FA]"
                                      />
                                    ) : (
                                      <div className="w-full h-28 rounded-lg bg-[#F8F6FE] border border-dashed border-[#DDD6FE] flex flex-col items-center justify-center text-[#8B86A4] gap-1">
                                        <CameraOutlined className="text-lg" />
                                        <span className="text-[11px]">Chưa có ảnh</span>
                                      </div>
                                    )}

                                    <label className="w-full cursor-pointer inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F6F4FC] border border-[#DDD6FE] text-xs font-semibold text-[#6027D2] hover:bg-[#EDE9FE]">
                                      {uploading ? <Spin size="small" /> : <UploadOutlined />}
                                      <span>{currentUrl ? 'Đổi ảnh' : 'Tải ảnh lên'}</span>
                                      <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        style={{ display: 'none' }}
                                        onChange={(e) => handleUploadPlantPhoto(idx, type, e.target.files?.[0])}
                                      />
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Submit footer */}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button
                    size="large"
                    onClick={() => router.push('/provider/reports')}
                    className="!rounded-xl !px-6"
                  >
                    Hủy bỏ
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    htmlType="submit"
                    icon={<SendOutlined />}
                    loading={submitting}
                    disabled={plantDrafts.length === 0}
                    className="!rounded-xl !px-8 !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold shadow-sm"
                  >
                    Nộp báo cáo
                  </Button>
                </div>
              </Form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function NewCareReportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <NewReportPageContent />
    </Suspense>
  );
}

