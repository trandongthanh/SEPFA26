'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InteractionOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { App, Button, Segmented, Spin, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useAuthStore } from '@/lib/auth.store';
import { DisputeListItem, DisputeStatus, adminApi } from '@/lib/admin.api';
import AdminSidebar from '../components/AdminSidebar';
import AdminHeader from '../components/AdminHeader';
import { DisputeStatusTag, formatVnd } from './dispute-ui';

type FilterStatus = 'ALL' | DisputeStatus;

interface DisputeCounts {
  ADMIN_REVIEW: number;
  NEGOTIATING: number;
  RESOLVED: number;
  overdue: number;
}

export default function AdminDisputesPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DisputeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  // Mặc định mở tab "Chờ phân xử" — việc admin cần làm nằm ở đây.
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ADMIN_REVIEW');
  const [counts, setCounts] = useState<DisputeCounts | null>(null);

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

  const fetchDisputes = useCallback(
    async (targetPage: number, targetStatus: FilterStatus) => {
      setLoading(true);
      try {
        const res = await adminApi.listDisputes({
          status: targetStatus === 'ALL' ? undefined : targetStatus,
          page: targetPage,
          limit,
        });
        setItems(res.data || []);
        setTotal(res.total || 0);
      } catch (err: any) {
        message.error(
          err?.response?.data?.message || 'Không thể tải danh sách tranh chấp.'
        );
      } finally {
        setLoading(false);
      }
    },
    [limit, message]
  );

  // Đếm từng trạng thái cho các ô tổng quan. BE xếp vụ quá hạn lên đầu, nên trang đầu
  // (50 dòng) của ADMIN_REVIEW đủ để đếm số vụ quá hạn.
  const fetchCounts = useCallback(async () => {
    try {
      const [review, nego, done] = await Promise.all([
        adminApi.listDisputes({ status: 'ADMIN_REVIEW', page: 1, limit: 50 }),
        adminApi.listDisputes({ status: 'NEGOTIATING', page: 1, limit: 1 }),
        adminApi.listDisputes({ status: 'RESOLVED', page: 1, limit: 1 }),
      ]);
      setCounts({
        ADMIN_REVIEW: review.total,
        NEGOTIATING: nego.total,
        RESOLVED: done.total,
        overdue: review.data.filter((d) => d.isOverdue).length,
      });
    } catch {
      setCounts(null);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchDisputes(page, statusFilter);
  }, [isAdmin, page, statusFilter, fetchDisputes]);

  useEffect(() => {
    if (isAdmin) fetchCounts();
  }, [isAdmin, fetchCounts]);

  const refresh = () => {
    fetchDisputes(page, statusFilter);
    fetchCounts();
  };

  const columns: ColumnsType<DisputeListItem> = [
    {
      title: 'Đơn hàng',
      key: 'orderCode',
      render: (_, record) => (
        <div>
          <span className="font-bold text-[#6027D2] font-mono text-xs">
            #{record.orderCode}
          </span>
          <div className="text-[11px] text-[#6E6A8A] mt-0.5">
            Mở {dayjs(record.openedAt).format('DD/MM/YYYY HH:mm')}
          </div>
        </div>
      ),
    },
    {
      title: 'Lý do khiếu nại',
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: string) => (
        <span className="text-xs text-[#1E1B2E] font-medium">{reason}</span>
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      render: (_, record) => (
        <DisputeStatusTag
          status={record.status}
          outcome={record.outcome}
          isOverdue={record.isOverdue}
        />
      ),
    },
    {
      title: 'Hạn / Ngày kết thúc',
      key: 'deadline',
      render: (_, record) => {
        if (record.status === 'RESOLVED') {
          return (
            <div className="text-xs">
              <div className="font-medium text-[#1E1B2E]">
                {record.resolvedAt ? dayjs(record.resolvedAt).format('DD/MM/YYYY HH:mm') : '—'}
              </div>
              <div className="text-[11px] text-[#6E6A8A]">Ngày kết thúc</div>
            </div>
          );
        }
        const isReview = record.status === 'ADMIN_REVIEW';
        const due = isReview ? record.adminDueAt : record.negotiationDueAt;
        return (
          <div className="text-xs">
            <div
              className={`font-medium ${record.isOverdue ? 'text-[#C0262D]' : 'text-[#1E1B2E]'}`}
            >
              {due ? dayjs(due).format('DD/MM/YYYY HH:mm') : '—'}
            </div>
            <div className="text-[11px] text-[#6E6A8A]">
              {isReview
                ? record.isOverdue
                  ? 'Đã trễ hạn phân xử 5 ngày'
                  : 'Hạn phân xử (5 ngày)'
                : 'Hết hạn sẽ tự chuyển admin'}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Kết quả tiền',
      key: 'amount',
      render: (_, record) =>
        record.status === 'RESOLVED' ? (
          <div className="text-xs">
            <div className="font-extrabold text-[#4E1BA8] text-sm">
              {formatVnd(
                Number(record.refundAmount || 0) + Number(record.compensationAmount || 0)
              )}
            </div>
            <div className="text-[11px] text-[#6E6A8A]">
              Hoàn {formatVnd(record.refundAmount)} · Đền {formatVnd(record.compensationAmount)}
            </div>
          </div>
        ) : (
          <span className="text-xs text-[#8B86A4]">—</span>
        ),
    },
    {
      title: 'Thao tác',
      key: 'action',
      align: 'right',
      render: (_, record) => (
        <Button
          size="small"
          type={record.status === 'ADMIN_REVIEW' ? 'primary' : 'default'}
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/admin/disputes/${record.id}`);
          }}
          className={
            record.status === 'ADMIN_REVIEW'
              ? '!rounded-xl !bg-[#6027D2] hover:!bg-[#4E1BA8] !border-none !font-semibold text-xs'
              : '!rounded-xl !border-[#ECE7FA] text-xs'
          }
        >
          {record.status === 'ADMIN_REVIEW' ? 'Phân xử' : 'Xem'}
        </Button>
      ),
    },
  ];

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  const statCards = [
    {
      label: 'Quá hạn xử lý',
      value: counts?.overdue,
      icon: <ExclamationCircleOutlined />,
      tone: 'bg-[#FDECEC] text-[#C0262D]',
      valueTone: 'text-[#C0262D]',
    },
    {
      label: 'Chờ admin phân xử',
      value: counts?.ADMIN_REVIEW,
      icon: <ClockCircleOutlined />,
      tone: 'bg-[#FEF3C7] text-[#D97706]',
      valueTone: 'text-[#D97706]',
    },
    {
      label: 'Đang thương lượng',
      value: counts?.NEGOTIATING,
      icon: <InteractionOutlined />,
      tone: 'bg-[#E8EFFE] text-[#1D4ED8]',
      valueTone: 'text-[#1E1B2E]',
    },
    {
      label: 'Đã giải quyết',
      value: counts?.RESOLVED,
      icon: <CheckCircleOutlined />,
      tone: 'bg-[#ECFDF5] text-[#059669]',
      valueTone: 'text-[#059669]',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <AdminHeader />

        <main className="flex-1 p-6 space-y-6 overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#1E1B2E]">Tranh chấp</h1>
              <p className="text-xs text-[#6E6A8A] mt-1">
                Khiếu nại của khách sau khi nhận lại cây. Hai bên tự thương lượng 3 ngày; quá
                hạn thì chuyển admin phân xử trong 5 ngày.
              </p>
            </div>
            <Button
              icon={<ReloadOutlined />}
              onClick={refresh}
              className="!rounded-xl !border-[#ECE7FA] text-[#6027D2] font-semibold"
            >
              Làm mới
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statCards.map((card) => (
              <div
                key={card.label}
                className="bg-white p-4 rounded-2xl border border-[#ECE7FA] flex items-center gap-3"
              >
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl ${card.tone}`}
                >
                  {card.icon}
                </div>
                <div>
                  <p className="text-xs text-[#6E6A8A]">{card.label}</p>
                  <p className={`text-xl font-extrabold ${card.valueTone}`}>
                    {card.value ?? '—'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-[#ECE7FA] p-5 shadow-xs space-y-4">
            <Segmented
              value={statusFilter}
              onChange={(val) => {
                setPage(1);
                setStatusFilter(val as FilterStatus);
              }}
              options={[
                { label: 'Chờ phân xử', value: 'ADMIN_REVIEW' },
                { label: 'Đang thương lượng', value: 'NEGOTIATING' },
                { label: 'Đã giải quyết', value: 'RESOLVED' },
                { label: 'Tất cả', value: 'ALL' },
              ]}
              className="!bg-[#F6F4FC] font-semibold text-xs"
            />

            <Table
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={loading}
              scroll={{ x: 820 }}
              rowClassName={(record) =>
                `cursor-pointer ${record.isOverdue ? 'dispute-row-overdue' : ''}`
              }
              onRow={(record) => ({
                onClick: () => router.push(`/admin/disputes/${record.id}`),
              })}
              pagination={{
                current: page,
                pageSize: limit,
                total,
                onChange: (p) => setPage(p),
                showSizeChanger: false,
              }}
              locale={{ emptyText: 'Không có tranh chấp nào.' }}
            />
          </div>
        </main>
      </div>

      <style jsx global>{`
        .dispute-row-overdue > td:first-child {
          box-shadow: inset 3px 0 #c0262d;
        }
      `}</style>
    </div>
  );
}
