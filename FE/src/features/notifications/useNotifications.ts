'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { notification as antdNotification } from 'antd';
import { useAuthStore } from '@/lib/auth.store';
import {
  NotificationItem,
  notificationsApi,
  QueryNotificationsParams,
} from '@/lib/notifications.api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://lancare-hub-api.onrender.com';

export function useNotifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [limit] = useState<number>(15);

  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const socketRef = useRef<Socket | null>(null);

  // Tải số lượng chưa đọc ban đầu
  const refreshUnreadCount = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const count = await notificationsApi.countUnread();
      setUnreadCount(count);
    } catch {
      // Ignore
    }
  }, [isAuthenticated]);

  // Tải danh sách thông báo
  const fetchNotifications = useCallback(
    async (params?: QueryNotificationsParams) => {
      if (!isAuthenticated) return;
      setLoading(true);
      try {
        const res = await notificationsApi.list({
          page: params?.page ?? page,
          limit: params?.limit ?? limit,
          unreadOnly: params?.unreadOnly ?? false,
        });
        setNotifications(res.data);
        setTotal(res.total);
        setUnreadCount(res.unreadCount);
        if (params?.page) setPage(params.page);
      } catch (err) {
        console.error('Không thể tải thông báo:', err);
      } finally {
        setLoading(false);
      }
    },
    [isAuthenticated, page, limit],
  );

  // Đánh dấu 1 thông báo đã đọc
  const markAsRead = useCallback(async (id: string) => {
    try {
      await notificationsApi.markAsRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Lỗi đánh dấu đã đọc:', err);
    }
  }, []);

  // Đánh dấu tất cả đã đọc
  const markAllAsRead = useCallback(async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('Lỗi đánh dấu tất cả đã đọc:', err);
    }
  }, []);

  // Xóa 1 thông báo
  const deleteNotification = useCallback(async (id: string) => {
    try {
      await notificationsApi.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Lỗi xóa thông báo:', err);
    }
  }, []);

  // Xóa toàn bộ thông báo đã đọc
  const deleteReadNotifications = useCallback(async () => {
    try {
      await notificationsApi.deleteRead();
      setNotifications((prev) => prev.filter((n) => !n.isRead));
    } catch (err) {
      console.error('Lỗi xóa thông báo đã đọc:', err);
    }
  }, []);

  // Kết nối socket.io để nhận sự kiện real-time
  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    refreshUnreadCount();

    const socket = io(`${API_BASE}/ws`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on('notification.new', (payload: { notification: NotificationItem; unreadCount: number }) => {
      setNotifications((prev) => [payload.notification, ...prev]);
      setUnreadCount(payload.unreadCount);

      // Hiển thị toast thông báo góc màn hình
      antdNotification.info({
        message: payload.notification.title,
        description: payload.notification.body,
        placement: 'topRight',
        duration: 4.5,
      });
    });

    socket.on('notification.read', (payload: { notificationId: string; unreadCount: number }) => {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === payload.notificationId
            ? { ...n, isRead: true, readAt: new Date().toISOString() }
            : n,
        ),
      );
      setUnreadCount(payload.unreadCount);
    });

    socket.on('notification.read_all', () => {
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })),
      );
      setUnreadCount(0);
    });

    socket.on('notification.deleted', (payload: { notificationId: string; unreadCount: number }) => {
      setNotifications((prev) => prev.filter((n) => n.id !== payload.notificationId));
      setUnreadCount(payload.unreadCount);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, accessToken, refreshUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    total,
    page,
    fetchNotifications,
    refreshUnreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteReadNotifications,
  };
}

