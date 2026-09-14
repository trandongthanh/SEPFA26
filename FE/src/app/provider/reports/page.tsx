'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarOutlined,
  CameraOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  FileTextOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Tag,
  message,
} from 'antd';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import {
  CareReportItem,
  CreateCareReportPayload,
  OrderItem,
  ProviderProfileResponse,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';

export default function ReportsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [reports, setReports] = useState<CareReportItem[]>([]);
  const [inCareOrders, setInCareOrders] = useState<OrderItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [form] = Form.useForm();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Guard authentication
  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated) {
      router.replace('/auth/login');
    }
  }, [mounted, isAuthenticated, router]);

  // If orderId is passed in query param, pre-fill form & open modal
  useEffect(() => {
    const orderIdParam = searchParams.get('orderId');
    if (orderIdParam) {
      setIsModalOpen(true);
      form.setFieldsValue({ serviceOrderId: orderIdParam });
    }
  }, [searchParams, form]);

  const loadData = async () => {
    setLoading(true);
    try {
      const prof = await providerApi.getProfile();
      setProfile(prof);
    } catch {
      setProfile(null);
    }

    try {
      const inCareRes = await providerApi.listOrders('IN_CARE');
      if (inCareRes && Array.isArray(inCareRes.items)) {
        setInCareOrders(inCareRes.items);
      } else {
        setInCareOrders([]);
      }
    } catch {
      setInCareOrders([]);
    }

    try {
      const rpts = await providerApi.listCareReports();
      if (Array.isArray(rpts)) {
        setReports(rpts);
      } else if (rpts && Array.isArray((rpts as any).items)) {
        setReports((rpts as any).items);
      } else {
        setReports([]);
      }
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      loadData();
    }
  }, [mounted, isAuthenticated]);

  // Handle Care Report submission
  const handleCreateReport = async (values: any) => {
    setSubmitting(true);
    try {
      const payload: CreateCareReportPayload = {
        serviceOrderId: values.serviceOrderId,
        periodStart: values.periodRange[0].toISOString(),
        periodEnd: values.periodRange[1].toISOString(),
        plantNameSnapshot: values.plantNameSnapshot,
        plantCodeSnapshot: values.plantCodeSnapshot,
        plotPositionSnapshot: values.plotPositionSnapshot,
        weather: values.weather,
        temperatureMin: Number(values.temperatureMin),
        temperatureMax: Number(values.temperatureMax),
        humidityMin: Number(values.humidityMin),
        humidityMax: Number(values.humidityMax),
        substrateStatus: values.substrateStatus,
        rootStatus: values.rootStatus,
        rootAffectedCount: values.rootStatus === 'ROOTS_AFFECTED' ? Number(values.rootAffectedCount || 1) : undefined,
        leafStatus: values.leafStatus,
        shootStatus: values.shootStatus,
        wateringCount: Number(values.wateringCount),
        nutritionNote: values.nutritionNote,
        diseasePrevention: values.diseasePrevention,
        evidences: [
          {
            evidenceType: 'OVERVIEW',
            photoUrl: values.overviewPhotoUrl || 'https://images.unsplash.com/photo-1545241047-6083a3684587',
            caption: values.overviewCaption || 'Ảnh tổng quan cây lan',
          },
          {
            evidenceType: 'ROOT',
            photoUrl: values.rootPhotoUrl || 'https://images.unsplash.com/photo-1520412099551-62b6bafeb5bb',
            caption: values.rootCaption || 'Ảnh tình trạng bộ rễ',
          },
          {
            evidenceType: 'LEAF_OR_SHOOT',
            photoUrl: values.leafPhotoUrl || 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9',
            caption: values.leafCaption || 'Ảnh lá và ngọn lan',
          },
        ],
      };

      await providerApi.createCareReport(payload);
      message.success('Đã gửi nhật ký báo cáo chăm sóc thành công!');
      setIsModalOpen(false);
      form.resetFields();
      loadData();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Không thể gửi báo cáo. Vui lòng kiểm tra các thông tin nhập.';
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
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Nhật ký Báo cáo Chăm sóc</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 font-medium">
                Theo dõi tình trạng phát triển của cây lan và gửi báo cáo hình ảnh định kỳ cho khách hàng
              </p>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsModalOpen(true)}
              className="!h-11 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-sm shadow-[0_4px_12px_rgba(96,39,210,0.25)]"
            >
              Nộp báo cáo mới
            </Button>
          </div>

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
                onClick={() => setIsModalOpen(true)}
                className="mt-5 !h-10 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold"
              >
                Tạo báo cáo đầu tiên
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {reports.map((rpt, idx) => (
                <div
                  key={rpt.id || idx}
                  className="bg-white rounded-2xl p-5 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <Tag color="purple">Định kỳ</Tag>
                        <span className="text-xs font-bold text-[#1E1B2E]">
                          {rpt.plantNameSnapshot || 'Lan Chăm Sóc'}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#8B86A4]">
                        {rpt.createdAt
                          ? new Date(rpt.createdAt).toLocaleDateString('vi-VN')
                          : 'Hôm nay'}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-[#4B4764] mb-3">
                      {rpt.plantCodeSnapshot && (
                        <p>
                          Mã cây/chậu: <strong className="text-[#1E1B2E]">{rpt.plantCodeSnapshot}</strong>
                        </p>
                      )}
                      {rpt.weather && (
                        <p>
                          Thời tiết: <strong className="text-[#6027D2]">{rpt.weather}</strong>
                        </p>
                      )}
                      {rpt.notes && (
                        <p className="text-[#6E6A8A] line-clamp-2 italic">"{rpt.notes}"</p>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#ECE7FA] flex items-center justify-between">
                    <span className="inline-flex items-center gap-1 text-xs text-[#6027D2] font-semibold">
                      <CheckCircleOutlined /> Đã xác thực
                    </span>
                    <Button
                      type="default"
                      size="small"
                      onClick={() => message.info(`Chi tiết báo cáo ${rpt.id}`)}
                      className="!rounded-lg !text-xs !border-[#ECE7FA] !text-[#6027D2]"
                    >
                      Xem chi tiết
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Modal: Create Care Report */}
        <Modal
          title={
            <div className="flex items-center gap-2 text-lg font-bold text-[#1E1B2E]">
              <FileTextOutlined className="text-[#6027D2]" />
              <span>Nộp Nhật ký Báo cáo Chăm sóc Lan</span>
            </div>
          }
          open={isModalOpen}
          onCancel={() => {
            setIsModalOpen(false);
            form.resetFields();
          }}
          footer={null}
          width={720}
          destroyOnClose
          className="rounded-2xl overflow-hidden"
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleCreateReport}
            initialValues={{
              periodRange: [dayjs().subtract(7, 'day'), dayjs()],
              weather: 'SUNNY',
              temperatureMin: 24,
              temperatureMax: 32,
              humidityMin: 60,
              humidityMax: 85,
              substrateStatus: 'MOIST_GOOD',
              rootStatus: 'ROOTS_HEALTHY_GROWING',
              leafStatus: 'LEAVES_FIRM_AND_HEALTHY',
              shootStatus: 'SHOOTS_UNIFORM',
              wateringCount: 2,
              diseasePrevention: 'NONE',
              overviewPhotoUrl: 'https://images.unsplash.com/photo-1545241047-6083a3684587',
              rootPhotoUrl: 'https://images.unsplash.com/photo-1520412099551-62b6bafeb5bb',
              leafPhotoUrl: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9',
            }}
            className="pt-3 space-y-4"
          >
            <Form.Item
              name="serviceOrderId"
              label={<span className="font-semibold text-xs text-[#1E1B2E]">Đơn hàng đang chăm sóc</span>}
              rules={[{ required: true, message: 'Vui lòng chọn đơn hàng' }]}
            >
              <Select
                placeholder="Chọn đơn hàng đang trong quá trình chăm sóc..."
                className="!rounded-xl"
                options={inCareOrders.map((ord) => ({
                  label: `Đơn ${ord.orderCode} - ${ord.customer?.account?.fullName || 'Khách hàng'} (${ord.servicePackage?.name || 'Gói chăm sóc'})`,
                  value: ord.id,
                }))}
              />
            </Form.Item>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Form.Item
                name="plantNameSnapshot"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tên cây / giống lan</span>}
                rules={[{ required: true, message: 'Nhập tên cây' }]}
              >
                <Input placeholder="VD: Lan Phi Điệp 5CT" className="!rounded-xl !py-2" />
              </Form.Item>

              <Form.Item
                name="plantCodeSnapshot"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Mã định danh chậu</span>}
                rules={[{ required: true, message: 'Nhập mã chậu' }]}
              >
                <Input placeholder="VD: PĐ-001" className="!rounded-xl !py-2" />
              </Form.Item>

              <Form.Item
                name="plotPositionSnapshot"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Vị trí luống / giàn</span>}
                rules={[{ required: true, message: 'Nhập vị trí' }]}
              >
                <Input placeholder="VD: Khu A - Giàn 02" className="!rounded-xl !py-2" />
              </Form.Item>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Form.Item
                name="periodRange"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Khoảng thời gian báo cáo</span>}
                rules={[{ required: true, message: 'Chọn khoảng thời gian' }]}
              >
                <DatePicker.RangePicker format="DD/MM/YYYY" className="w-full !rounded-xl !py-2" />
              </Form.Item>

              <Form.Item
                name="weather"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Điều kiện thời tiết</span>}
                rules={[{ required: true }]}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="SUNNY">Nắng đẹp (SUNNY)</Select.Option>
                  <Select.Option value="RAINY">Mưa (RAINY)</Select.Option>
                  <Select.Option value="OVERCAST">Nhiều mây / Râm (OVERCAST)</Select.Option>
                  <Select.Option value="NORMAL">Bình thường (NORMAL)</Select.Option>
                </Select>
              </Form.Item>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Form.Item
                name="temperatureMin"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Nhiệt độ min (°C)</span>}
              >
                <InputNumber min={0} max={50} className="w-full !rounded-xl" />
              </Form.Item>

              <Form.Item
                name="temperatureMax"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Nhiệt độ max (°C)</span>}
              >
                <InputNumber min={0} max={50} className="w-full !rounded-xl" />
              </Form.Item>

              <Form.Item
                name="humidityMin"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Độ ẩm min (%)</span>}
              >
                <InputNumber min={0} max={100} className="w-full !rounded-xl" />
              </Form.Item>

              <Form.Item
                name="humidityMax"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Độ ẩm max (%)</span>}
              >
                <InputNumber min={0} max={100} className="w-full !rounded-xl" />
              </Form.Item>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Form.Item
                name="substrateStatus"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tình trạng giá thể</span>}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="MOIST_GOOD">Ẩm vừa đủ / Tốt (MOIST_GOOD)</Select.Option>
                  <Select.Option value="DRY_READY_TO_WATER">Khô / Cần tưới (DRY)</Select.Option>
                  <Select.Option value="WATERLOGGED_RISK">Cảnh báo úng nước (WATERLOGGED)</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="rootStatus"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tình trạng bộ rễ</span>}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="ROOTS_HEALTHY_GROWING">Rễ khỏe, đang phát triển tốt</Select.Option>
                  <Select.Option value="ROOTS_STABLE">Rễ ổn định</Select.Option>
                  <Select.Option value="ROOTS_AFFECTED">Rễ bị tổn thương / thối</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="leafStatus"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tình trạng lá</span>}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="LEAVES_FIRM_AND_HEALTHY">Lá xanh cứng cáp, khỏe mạnh</Select.Option>
                  <Select.Option value="STEM_TURGID_GOOD">Thân căng mộng tốt</Select.Option>
                  <Select.Option value="BASE_LEAVES_YELLOW_REMOVED">Lá gốc vàng đã tỉa</Select.Option>
                  <Select.Option value="LEAF_ROT_BLACKSPOT_BURN">Lá xuất hiện đốm đen / cháy</Select.Option>
                </Select>
              </Form.Item>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Form.Item
                name="shootStatus"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tình trạng mầm/chồi</span>}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="SHOOTS_UNIFORM">Mầm nẩy đều</Select.Option>
                  <Select.Option value="FLOWERS_UNIFORM">Nụ/Hoa nở đồng đều</Select.Option>
                </Select>
              </Form.Item>

              <Form.Item
                name="wateringCount"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Số lần tưới nước</span>}
              >
                <InputNumber min={0} className="w-full !rounded-xl" />
              </Form.Item>

              <Form.Item
                name="diseasePrevention"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Phòng trừ sâu bệnh</span>}
              >
                <Select className="!rounded-xl">
                  <Select.Option value="NONE">Không áp dụng (NONE)</Select.Option>
                  <Select.Option value="DISINFECT_GARDEN">Phun sát trùng nhà vườn</Select.Option>
                  <Select.Option value="SPRAY_BACTERIA_FUNGUS">Phun thuốc nấm khuẩn</Select.Option>
                  <Select.Option value="SNAIL_TREATMENT">Xử lý ốc sên</Select.Option>
                </Select>
              </Form.Item>
            </div>

            <Form.Item
              name="nutritionNote"
              label={<span className="font-semibold text-xs text-[#1E1B2E]">Ghi chú chế độ dinh dưỡng & Phân bón</span>}
            >
              <Input.TextArea rows={2} placeholder="Chi tiết liều lượng NPK, vi lượng, vitamin B1..." className="!rounded-xl" />
            </Form.Item>

            {/* 3 Evidence Images */}
            <div className="p-4 rounded-xl bg-[#F6F4FC] border border-[#ECE7FA] space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#6027D2]">
                <CameraOutlined />
                <span>3 Hình ảnh minh chứng bắt buộc</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Form.Item
                  name="overviewPhotoUrl"
                  label={<span className="text-[11px] font-semibold">1. Ảnh tổng quan</span>}
                  className="!mb-0"
                >
                  <Input placeholder="URL ảnh tổng quan" className="!rounded-xl text-xs" />
                </Form.Item>

                <Form.Item
                  name="rootPhotoUrl"
                  label={<span className="text-[11px] font-semibold">2. Ảnh bộ rễ</span>}
                  className="!mb-0"
                >
                  <Input placeholder="URL ảnh rễ" className="!rounded-xl text-xs" />
                </Form.Item>

                <Form.Item
                  name="leafPhotoUrl"
                  label={<span className="text-[11px] font-semibold">3. Ảnh lá & ngọn</span>}
                  className="!mb-0"
                >
                  <Input placeholder="URL ảnh lá" className="!rounded-xl text-xs" />
                </Form.Item>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#ECE7FA]">
              <Button
                onClick={() => setIsModalOpen(false)}
                className="!h-10 !px-5 !rounded-xl !bg-[#F6F4FC] !border-none !text-[#4B4764]"
              >
                Hủy bỏ
              </Button>
              <Button
                type="primary"
                htmlType="submit"
                loading={submitting}
                className="!h-10 !px-6 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold shadow-sm"
              >
                Nộp báo cáo
              </Button>
            </div>
          </Form>
        </Modal>
      </div>
    </div>
  );
}
