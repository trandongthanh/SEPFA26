'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  DollarOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tag,
  message,
} from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import {
  CreatePackagePayload,
  ProviderProfileResponse,
  ServicePackageItem,
  providerApi,
} from '@/lib/provider.api';
import ProviderHeader from '../components/ProviderHeader';
import ProviderSidebar from '../components/ProviderSidebar';
import ListToolbar, { NoResults } from '../components/ListToolbar';
import Highlight from '../components/Highlight';
import { matchesQuery, useUrlParam } from '@/lib/search';

const PACKAGE_FILTERS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'REJECTED', label: 'Bị từ chối' },
];

function PackagesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [profile, setProfile] = useState<ProviderProfileResponse | null>(null);
  const [packages, setPackages] = useState<ServicePackageItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // null = tạo gói mới; có giá trị = đang sửa gói đó (dùng chung 1 hộp thoại).
  const [editingPackage, setEditingPackage] = useState<ServicePackageItem | null>(null);

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

  // Open modal if query param ?create=true is set
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      openCreateModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadData = async () => {
    setLoading(true);
    try {
      const prof = await providerApi.getProfile();
      setProfile(prof);
    } catch {
      setProfile(null);
    }

    try {
      const pkgs = await providerApi.listMyPackages();
      if (Array.isArray(pkgs)) {
        setPackages(pkgs);
      } else {
        setPackages([]);
      }
    } catch (err: any) {
      message.error('Không thể tải danh sách gói dịch vụ');
      setPackages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted && isAuthenticated) {
      loadData();
    }
  }, [mounted, isAuthenticated]);

  const openCreateModal = () => {
    setEditingPackage(null);
    setIsModalOpen(true);
  };

  const openEditModal = (pkg: ServicePackageItem) => {
    setEditingPackage(pkg);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPackage(null);
  };

  // Điền form SAU khi hộp thoại đã mở (Modal destroyOnClose → form chỉ tồn tại lúc đang mở).
  useEffect(() => {
    if (!isModalOpen) return;
    if (!editingPackage) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      name: editingPackage.name,
      description: editingPackage.description ?? '',
      durationDays: Number(editingPackage.durationDays),
      reportFrequencyDays: Number(editingPackage.reportFrequencyDays),
      maxPlants: Number(editingPackage.maxPlants),
      basePrice: Number(editingPackage.basePrice),
      minDeclaredValue: Number(editingPackage.minDeclaredValue ?? 0),
      maxDeclaredValue: Number(editingPackage.maxDeclaredValue ?? 0),
    });
  }, [isModalOpen, editingPackage, form]);

  // Tạo hoặc sửa gói — cùng 8 trường của UpsertPackageDto (BE bắt buộc gửi đủ cả khi sửa).
  const handleSubmitPackage = async (values: any) => {
    setSubmitting(true);
    try {
      const payload: CreatePackagePayload = {
        name: values.name,
        description: values.description,
        durationDays: Number(values.durationDays),
        reportFrequencyDays: Number(values.reportFrequencyDays),
        maxPlants: Number(values.maxPlants),
        basePrice: Number(values.basePrice),
        minDeclaredValue: Number(values.minDeclaredValue || 0),
        maxDeclaredValue: Number(values.maxDeclaredValue || 0),
      };

      if (editingPackage) {
        await providerApi.updatePackage(editingPackage.id, payload);
        message.success('Đã lưu thay đổi. Gói chuyển về Chờ Admin duyệt và tạm ngưng bán tới khi được duyệt lại.');
      } else {
        await providerApi.createPackage(payload);
        message.success('Đã tạo gói mới. Gói sẽ mở bán sau khi Admin duyệt.');
      }
      closeModal();
      loadData();
    } catch (err: any) {
      const rawMsg =
        err?.response?.data?.message ||
        err?.message ||
        'Tạo gói dịch vụ thất bại. Vui lòng kiểm tra lại thông tin.';
      const msgText = Array.isArray(rawMsg) ? rawMsg.join(', ') : String(rawMsg);
      if (msgText.includes('PROFILE_NOT_FOUND')) {
        message.error('Vui lòng hoàn thiện và lưu Hồ sơ nhà vườn trước khi tạo gói dịch vụ.');
      } else if (msgText.includes('PROFILE_NOT_APPROVED')) {
        message.error('Chỉ nhà vườn đã được Admin phê duyệt hồ sơ mới có thể tạo gói dịch vụ mới.');
      } else if (msgText.includes('PACKAGE_NOT_FOUND')) {
        message.error('Gói này không còn tồn tại (có thể đã bị xoá). Đang tải lại danh sách...');
        closeModal();
        loadData();
      } else {
        message.error(msgText);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Delete Package
  const handleDeletePackage = async (id: string) => {
    try {
      await providerApi.deletePackage(id);
      message.success('Đã xóa gói dịch vụ thành công!');
      loadData();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Không thể xóa gói dịch vụ này.';
      message.error(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  };

  // ===== Tìm kiếm + lọc trạng thái duyệt + sắp xếp (phía FE) =====
  const [searchQuery, setSearchQuery] = useUrlParam('q');
  const [approvalFilter, setApprovalFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'NEWEST' | 'PRICE_ASC' | 'PRICE_DESC'>('NEWEST');
  // Gói chưa có approvalStatus (dữ liệu cũ) coi như đang chờ duyệt — giống thẻ trạng thái bên dưới.
  const approvalOf = (pkg: ServicePackageItem) => pkg.approvalStatus ?? 'PENDING';
  const searchedPackages = packages.filter((pkg) => matchesQuery(searchQuery, pkg.name));
  const visiblePackages = searchedPackages
    .filter((pkg) => approvalFilter === 'ALL' || approvalOf(pkg) === approvalFilter)
    .sort((a, b) => {
      if (sortBy === 'PRICE_ASC') return Number(a.basePrice) - Number(b.basePrice);
      if (sortBy === 'PRICE_DESC') return Number(b.basePrice) - Number(a.basePrice);
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    });

  if (!mounted || !isAuthenticated) return null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F6F4FC] font-sans">
      <ProviderSidebar profile={profile} />

      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden">
        <ProviderHeader profile={profile} />

        <main className="flex-1 p-6 overflow-y-auto">
          {/* Header Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Quản lý Gói chăm sóc</h1>
              <p className="text-xs text-[#6E6A8A] mt-1 font-medium">
                Tạo và quản lý danh mục dịch vụ chăm sóc lan chuyên nghiệp cho nhà vườn của bạn
              </p>
            </div>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreateModal}
              className="!h-11 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold text-sm shadow-[0_4px_12px_rgba(96,39,210,0.25)]"
            >
              Tạo gói dịch vụ mới
            </Button>
          </div>

          {/* Verification Status Alert if PENDING */}
          {profile?.verificationStatus === 'PENDING' && (
            <div className="p-4 mb-6 rounded-2xl bg-[#FFFBEB] border border-[#FDE68A] text-[#B45309] text-xs flex items-center gap-3">
              <ExclamationCircleOutlined className="text-lg text-[#F59E0B]" />
              <span>
                Hồ sơ nhà vườn của bạn đang trong quá trình xét duyệt bởi Ban quản trị LanCare. Bạn vẫn có thể soạn thảo gói dịch vụ, nhưng gói sẽ hiển thị công khai sau khi hồ sơ được xác minh.
              </span>
            </div>
          )}

          {loading ? (
            <div className="py-20 text-center">
              <Spin size="large" />
              <p className="mt-3 text-sm text-[#6E6A8A]">Đang tải danh sách gói chăm sóc...</p>
            </div>
          ) : packages.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-[#ECE7FA] flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-full bg-[#F3E8FF] text-[#6027D2] flex items-center justify-center text-4xl mb-4">
                <AppstoreOutlined />
              </div>
              <h3 className="font-bold text-[#1E1B2E] text-base">Chưa có gói dịch vụ nào</h3>
              <p className="text-xs text-[#6E6A8A] mt-1 max-w-md">
                Tạo gói chăm sóc đầu tiên để khách hàng có thể đăng ký gửi chăm sóc lan tại nhà vườn của bạn.
              </p>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
                className="mt-5 !h-10 !px-5 !rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !font-semibold"
              >
                Tạo gói chăm sóc ngay
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ListToolbar
                query={searchQuery}
                onQueryChange={setSearchQuery}
                placeholder="Tìm tên gói…"
                chips={PACKAGE_FILTERS.map((f) => ({
                  ...f,
                  count:
                    f.value === 'ALL'
                      ? searchedPackages.length
                      : searchedPackages.filter((pkg) => approvalOf(pkg) === f.value).length,
                }))}
                activeChip={approvalFilter}
                onChipChange={setApprovalFilter}
                extra={
                  <Select
                    size="large"
                    value={sortBy}
                    onChange={setSortBy}
                    aria-label="Sắp xếp gói"
                    className="w-48"
                    options={[
                      { value: 'NEWEST', label: 'Mới tạo trước' },
                      { value: 'PRICE_ASC', label: 'Giá thấp → cao' },
                      { value: 'PRICE_DESC', label: 'Giá cao → thấp' },
                    ]}
                  />
                }
              />
              {visiblePackages.length === 0 ? (
                <NoResults
                  label={searchQuery || PACKAGE_FILTERS.find((f) => f.value === approvalFilter)?.label || ''}
                  onReset={() => {
                    setSearchQuery('');
                    setApprovalFilter('ALL');
                  }}
                />
              ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visiblePackages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="bg-white rounded-2xl p-6 border border-[#ECE7FA] hover:border-[#6027D2] shadow-[0_4px_16px_rgba(96,39,210,0.04)] transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="font-bold text-base text-[#1E1B2E] group-hover:text-[#6027D2] transition-colors">
                          <Highlight text={pkg.name} query={searchQuery} />
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {pkg.approvalStatus === 'APPROVED' ? (
                            <Tag color="success" icon={<CheckCircleOutlined />}>
                              Đã duyệt
                            </Tag>
                          ) : pkg.approvalStatus === 'REJECTED' ? (
                            <Tag color="error">Bị từ chối</Tag>
                          ) : (
                            <Tag color="warning" icon={<SyncOutlined spin />}>
                              Chờ Admin duyệt
                            </Tag>
                          )}

                          <Tag color={pkg.isActive ? 'purple' : 'default'}>
                            {pkg.isActive ? 'Đang mở bán' : 'Tạm ngưng'}
                          </Tag>

                          <span className="text-[11px] text-[#8B86A4]">
                            {pkg.durationDays || 30} ngày chăm sóc
                          </span>
                        </div>
                      </div>

                      <Popconfirm
                        title="Xóa gói dịch vụ"
                        description="Bạn có chắc chắn muốn xóa gói dịch vụ này?"
                        onConfirm={() => handleDeletePackage(pkg.id)}
                        okText="Xóa"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true }}
                      >
                        <button className="w-8 h-8 rounded-lg text-[#8B86A4] hover:text-[#E53E3E] hover:bg-[#FEE2E2] flex items-center justify-center transition-colors">
                          <DeleteOutlined className="text-base" />
                        </button>
                      </Popconfirm>
                    </div>

                    {pkg.approvalStatus === 'PENDING' && (
                      <div className="text-[11px] text-[#92400E] bg-[#FFFBEB] p-2 rounded-xl border border-[#FDE68A] mb-3">
                        ⏳ Gói dịch vụ đang chờ Admin phê duyệt trước khi mở bán công khai.
                      </div>
                    )}

                    {pkg.approvalStatus === 'REJECTED' && (
                      <div className="text-[11px] text-[#991B1B] bg-[#FEF2F2] p-2 rounded-xl border border-[#FECACA] mb-3">
                        <span className="font-semibold">Lý do Admin từ chối: </span>
                        {pkg.rejectionReason || 'Admin không ghi lý do.'}
                      </div>
                    )}

                    <p className="text-xs text-[#4B4764] leading-relaxed mb-4 line-clamp-3">
                      {pkg.description || 'Chưa có mô tả chi tiết cho gói chăm sóc này.'}
                    </p>

                    {/* Features summary */}
                    <div className="space-y-2 py-3 border-y border-[#ECE7FA] text-xs text-[#6E6A8A] mb-4">
                      <div className="flex items-center justify-between">
                        <span>Tần suất báo cáo:</span>
                        <strong className="text-[#1E1B2E]">
                          {pkg.reportFrequencyDays ? `${pkg.reportFrequencyDays} ngày/lần` : '7 ngày/lần'}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Số lượng lan tối đa:</span>
                        <strong className="text-[#1E1B2E]">
                          {pkg.maxPlants ? `${pkg.maxPlants} chậu` : '10 chậu'}
                        </strong>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Bồi thường bảo hiểm:</span>
                        <strong className="text-[#6027D2]">
                          Lên tới {Number(pkg.maxDeclaredValue || 5000000).toLocaleString('vi-VN')} VNĐ
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Price display */}
                  <div className="pt-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-[#8B86A4] uppercase tracking-wider font-semibold">
                        Giá trọn gói
                      </span>
                      <p className="text-xl font-bold text-[#6027D2] leading-tight">
                        {Number(pkg.basePrice || pkg.pricePerMonth || 500000).toLocaleString('vi-VN')}
                        <span className="text-xs font-semibold text-[#1E1B2E] ml-1">VNĐ</span>
                      </p>
                    </div>

                    <Button
                      type="default"
                      icon={<EditOutlined />}
                      onClick={() => openEditModal(pkg)}
                      className="!rounded-xl !border-[#ECE7FA] !text-[#6027D2] hover:!border-[#6027D2] !font-medium text-xs"
                    >
                      Sửa gói
                    </Button>
                  </div>
                </div>
              ))}
            </div>
              )}
            </div>
          )}
        </main>

        {/* Modal: Create Service Package */}
        <Modal
          title={
            <div className="flex items-center gap-2 text-lg font-bold text-[#1E1B2E]">
              <AppstoreOutlined className="text-[#6027D2]" />
              <span>{editingPackage ? 'Sửa gói dịch vụ' : 'Đăng ký Gói dịch vụ mới'}</span>
            </div>
          }
          open={isModalOpen}
          onCancel={closeModal}
          footer={null}
          width={640}
          destroyOnClose
          className="rounded-2xl overflow-hidden"
        >
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmitPackage}
            initialValues={{
              durationDays: 30,
              reportFrequencyDays: 7,
              maxPlants: 10,
              basePrice: 500000,
              minDeclaredValue: 1000000,
              maxDeclaredValue: 5000000,
            }}
            className="pt-3 space-y-4"
          >
            {editingPackage && (
              <div className="p-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-xs text-[#92400E]">
                Sau khi lưu, gói chuyển về <b>Chờ Admin duyệt</b> và <b>tạm ngưng bán</b> cho tới khi
                Admin duyệt lại. Đơn khách đã đặt trước đó không bị ảnh hưởng.
              </div>
            )}
            <Form.Item
              name="name"
              label={<span className="font-semibold text-xs text-[#1E1B2E]">Tên gói dịch vụ</span>}
              rules={[
                { required: true, message: 'Vui lòng nhập tên gói dịch vụ' },
                { min: 2, message: 'Tên gói quá ngắn (tối thiểu 2 ký tự)' },
                { max: 255, message: 'Tên gói tối đa 255 ký tự' },
              ]}
            >
              <Input
                maxLength={255}
                placeholder="VD: Gói chăm sóc lan đột biến cao cấp 30 ngày"
                className="!rounded-xl !py-2.5"
              />
            </Form.Item>

            <Form.Item
              name="description"
              label={<span className="font-semibold text-xs text-[#1E1B2E]">Mô tả chi tiết</span>}
              rules={[
                { required: true, whitespace: true, message: 'Vui lòng nhập mô tả gói dịch vụ' },
                { max: 2000, message: 'Mô tả tối đa 2000 ký tự' },
              ]}
            >
              <Input.TextArea
                rows={3}
                maxLength={2000}
                showCount
                placeholder="Mô tả quy trình chăm sóc, chất dinh dưỡng, tưới tiêu, chế độ ánh sáng..."
                className="!rounded-xl"
              />
            </Form.Item>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Form.Item
                name="durationDays"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Thời gian (ngày)</span>}
                rules={[{ required: true, message: 'Bắt buộc' }]}
              >
                <InputNumber min={1} className="!w-full !rounded-xl !py-1" />
              </Form.Item>

              <Form.Item
                name="reportFrequencyDays"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Tần suất báo cáo (ngày)</span>}
                rules={[{ required: true, message: 'Bắt buộc' }]}
              >
                <InputNumber min={1} className="!w-full !rounded-xl !py-1" />
              </Form.Item>

              <Form.Item
                name="maxPlants"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Số chậu lan tối đa</span>}
                rules={[{ required: true, message: 'Bắt buộc' }]}
              >
                <InputNumber min={1} className="!w-full !rounded-xl !py-1" />
              </Form.Item>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Form.Item
                name="basePrice"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Giá trọn gói (VNĐ)</span>}
                rules={[{ required: true, message: 'Vui lòng nhập giá' }]}
              >
                <InputNumber
                  min={10000}
                  step={50000}
                  formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(val) => (val ? (Number(val.replace(/\$\s?|(,*)/g, '')) as any) : 0)}
                  className="!w-full !rounded-xl !py-1"
                />
              </Form.Item>

              <Form.Item
                name="minDeclaredValue"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Giá trị khai báo min (VNĐ)</span>}
              >
                <InputNumber
                  min={0}
                  step={100000}
                  formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(val) => (val ? (Number(val.replace(/\$\s?|(,*)/g, '')) as any) : 0)}
                  className="!w-full !rounded-xl !py-1"
                />
              </Form.Item>

              <Form.Item
                name="maxDeclaredValue"
                label={<span className="font-semibold text-xs text-[#1E1B2E]">Giá trị khai báo max (VNĐ)</span>}
              >
                <InputNumber
                  min={0}
                  step={500000}
                  formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(val) => (val ? (Number(val.replace(/\$\s?|(,*)/g, '')) as any) : 0)}
                  className="!w-full !rounded-xl !py-1"
                />
              </Form.Item>
            </div>

            {/* Không có công tắc mở bán: BE chỉ cho Admin bật/tắt (tạo/sửa gói luôn tạm ngưng chờ duyệt). */}
            <p className="m-0 text-xs text-[#6E6A8A]">
              Gói mở bán sau khi Admin duyệt. Muốn ngừng bán một gói thì xoá gói đó.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#ECE7FA]">
              <Button
                onClick={closeModal}
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
                {editingPackage ? 'Lưu & gửi duyệt lại' : 'Đăng ký gói'}
              </Button>
            </div>
          </Form>
        </Modal>
      </div>
    </div>
  );
}

export default function PackagesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
          <Spin size="large" />
        </div>
      }
    >
      <PackagesPageContent />
    </Suspense>
  );
}
