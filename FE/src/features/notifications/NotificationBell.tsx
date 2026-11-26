'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BellOutlined,
  CheckOutlined,
  DeleteOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  ToolOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Badge, Button, Empty, Popover, Segmented, Spin, Tooltip } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/vi';
import { NotificationItem, NotificationType } from '@/lib/notifications.api';
import { useNotifications } from './useNotifications';
import { useAuthStore } from '@/lib/auth.store';

dayjs.extend(relativeTime);
dayjs.locale('vi');

const getNotificationIcon = (type: NotificationType) => {
  if (type.startsWith('ORDER_') || type.startsWith('AGREEMENT_') || type.startsWith('HANDOVER_') || type.startsWith('RETURN_')) {
    return <ShoppingOutlined className="text-purple-600 text-base" />;
  }
  if (type.startsWith('ADDON_') || type === 'CARE_REPORT_SUBMITTED') {
    return <ToolOutlined className="text-emerald-600 text-base" />;
  }
  if (type.startsWith('DISPUTE_')) {
    return <ExclamationCircleOutlined className="text-rose-600 text-base" />;
  }
  if (type.includes('PAID') || type === 'DISBURSEMENT_PAID') {
    return <DollarOutlined className="text-amber-500 text-base" />;
  }
  if (type === 'VIDEO_CALL_MISSED') {
    return <VideoCameraOutlined className="text-red-500 text-base" />;
  }
  return <BellOutlined className="text-blue-500 text-base" />;
};

export default function NotificationBell() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNREAD'>('ALL');

  const {
    notifications,
    unreadCount,
    loading,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteReadNotifications,
  } = useNotifications();

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen) {
      fetchNotifications({ unreadOnly: filterTab === 'UNREAD' });
    }
  };

  const handleTabChange = (value: 'ALL' | 'UNREAD') => {
    setFilterTab(value);
    fetchNotifications({ unreadOnly: value === 'UNREAD' });
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.isRead) {
      await markAsRead(item.id);
    }
    setOpen(false);

    // Điều hướng dựa vào vai trò và refEntity
    const role = user?.role;
    if (item.refEntity === 'ORDER' && item.refId) {
      if (role === 'PROVIDER') {
        router.push(`/provider/orders/${item.refId}`);
      }
    } else if (item.refEntity === 'DISPUTE' && item.refId) {
      if (role === 'ADMIN') {
        router.push(`/admin/disputes/${item.refId}`);
      } else if (role === 'PROVIDER') {
        router.push(`/provider/orders`);
      }
    } else if (item.refEntity === 'DISBURSEMENT') {
      if (role === 'ADMIN') {
        router.push(`/admin/disbursements`);
      }
    } else if (item.refEntity === 'PROVIDER_PROFILE') {
      if (role === 'ADMIN') {
        router.push(`/admin/verify/providers`);
      } else if (role === 'PROVIDER') {
        router.push(`/provider/profile`);
      }
    }
  };

  const content = (
    <div className="w-80 sm:w-96 max-w-[calc(100vw-32px)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#ECE7FA]">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-[#1E1B2E]">Thông báo</span>
          {unreadCount > 0 && (
            <span className="bg-[#E53E3E] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <Tooltip title="Đánh dấu tất cả đã đọc">
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                onClick={markAllAsRead}
                className="!text-xs !text-[#6027D2] hover:!bg-[#F6F4FC]"
              >
                Đã đọc hết
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Tải lại">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => fetchNotifications({ unreadOnly: filterTab === 'UNREAD' })}
              className="!text-[#6E6A8A]"
            />
          </Tooltip>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-2">
        <Segmented
          value={filterTab}
          onChange={(val) => handleTabChange(val as 'ALL' | 'UNREAD')}
          options={[
            { label: 'Tất cả', value: 'ALL' },
            { label: `Chưa đọc (${unreadCount})`, value: 'UNREAD' },
          ]}
          block
          size="small"
          className="!bg-[#F6F4FC] !p-0.5"
        />
      </div>

      {/* Notification List */}
      <div className="max-h-[360px] overflow-y-auto space-y-1 pr-0.5">
        {loading ? (
          <div className="py-8 text-center">
            <Spin size="small" />
            <p className="text-xs text-[#6E6A8A] mt-2">Đang tải thông báo...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="py-8">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span className="text-xs text-[#8B86A4]">
                  {filterTab === 'UNREAD' ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'}
                </span>
              }
            />
          </div>
        ) : (
          notifications.map((item) => (
            <div
              key={item.id}
              onClick={() => handleItemClick(item)}
              className={`p-3 rounded-xl transition-all cursor-pointer relative group flex gap-3 items-start border ${
                item.isRead
                  ? 'bg-white hover:bg-[#FAF8FE] border-transparent hover:border-[#ECE7FA]'
                  : 'bg-[#F9F7FE] border-[#ECE7FA] hover:bg-[#F3EFFF]'
              }`}
            >
              {/* Icon */}
              <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-white shadow-xs border border-[#ECE7FA] flex items-center justify-center">
                {getNotificationIcon(item.type)}
              </div>

              {/* Text content */}
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-1.5">
                  <h4
                    className={`text-xs truncate ${
                      item.isRead ? 'font-medium text-[#1E1B2E]' : 'font-bold text-[#6027D2]'
                    }`}
                  >
                    {item.title}
                  </h4>
                  {!item.isRead && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6027D2] shrink-0" />
                  )}
                </div>
                <p className="text-[11.5px] text-[#4A4568] line-clamp-2 mt-0.5 leading-relaxed">
                  {item.body}
                </p>
                <span className="text-[10px] text-[#A098C2] mt-1 block">
                  {dayjs(item.createdAt).fromNow()}
                </span>
              </div>

              {/* Action: Delete */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined className="text-[11px] text-[#A098C2] hover:text-rose-500" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNotification(item.id);
                  }}
                  className="!h-6 !w-6 !p-0"
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {notifications.some((n) => n.isRead) && (
        <div className="pt-2 mt-2 border-t border-[#ECE7FA] flex justify-end">
          <Button
            type="link"
            size="small"
            onClick={deleteReadNotifications}
            className="!text-[11.5px] !text-[#8B86A4] hover:!text-rose-500 !p-0"
          >
            Dọn sạch thông báo đã đọc
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottomRight"
      overlayClassName="notification-popover"
    >
      <button
        type="button"
        aria-label="Thông báo"
        className="w-9 h-9 rounded-xl bg-[#F6F4FC] text-[#6E6A8A] flex items-center justify-center hover:bg-[#ECE7FA] transition-colors relative"
      >
        <Badge count={unreadCount} overflowCount={99} size="small" offset={[2, -2]}>
          <BellOutlined className="text-lg text-[#6E6A8A]" />
        </Badge>
      </button>
    </Popover>
  );
}

