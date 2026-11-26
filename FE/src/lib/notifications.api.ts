import { api } from './api';

export type NotificationType =
  | 'ORDER_SUBMITTED'
  | 'ORDER_ACCEPTED'
  | 'ORDER_REJECTED'
  | 'ORDER_EXPIRED'
  | 'AGREEMENT_SIGNED_BY_PARTNER'
  | 'AGREEMENT_COMPLETED'
  | 'ORDER_PAID'
  | 'HANDOVER_STARTED'
  | 'HANDOVER_AWAITING_CONFIRM'
  | 'HANDOVER_CONFIRMED'
  | 'SECURITY_DEPOSIT_PAID'
  | 'ORDER_CANCELLED'
  | 'RETURN_STARTED'
  | 'RETURN_AWAITING_CONFIRM'
  | 'RETURN_CANCELLED'
  | 'ORDER_COMPLETED'
  | 'CARE_REPORT_SUBMITTED'
  | 'ADDON_PROPOSED'
  | 'ADDON_ACCEPTED'
  | 'ADDON_REJECTED'
  | 'ADDON_PAID'
  | 'ADDON_COMPLETED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_EVIDENCE_ADDED'
  | 'DISPUTE_OFFER_CREATED'
  | 'DISPUTE_OFFER_ACCEPTED'
  | 'DISPUTE_WITHDRAWN'
  | 'DISPUTE_ESCALATED'
  | 'DISPUTE_RESOLVED'
  | 'DISBURSEMENT_PAID'
  | 'PROVIDER_VERIFIED'
  | 'CUSTOMER_VERIFIED'
  | 'PACKAGE_VERIFIED'
  | 'PROFILE_SUBMITTED_FOR_REVIEW'
  | 'VIDEO_CALL_MISSED'
  | 'SYSTEM_ANNOUNCEMENT';

export type NotificationRefEntity =
  | 'ORDER'
  | 'DISPUTE'
  | 'ADDON'
  | 'CARE_REPORT'
  | 'DISBURSEMENT'
  | 'PROVIDER_PROFILE'
  | 'CUSTOMER_PROFILE'
  | 'SERVICE_PACKAGE'
  | 'VIDEO_CALL'
  | 'SYSTEM';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  refEntity?: NotificationRefEntity | null;
  refId?: string | null;
  metadata?: Record<string, any> | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  data: NotificationItem[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface QueryNotificationsParams {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}

export const notificationsApi = {
  countUnread: async (): Promise<number> => {
    const res = await api.get<{ unreadCount: number }>('/api/v1/notifications/unread-count');
    return res.data.unreadCount;
  },

  list: async (params?: QueryNotificationsParams): Promise<NotificationListResponse> => {
    const res = await api.get<NotificationListResponse>('/api/v1/notifications', { params });
    return res.data;
  },

  markAsRead: async (id: string): Promise<{ success: boolean; id: string; readAt: string }> => {
    const res = await api.patch<{ success: boolean; id: string; readAt: string }>(
      `/api/v1/notifications/${id}/read`,
    );
    return res.data;
  },

  markAllAsRead: async (): Promise<{ success: boolean; updatedCount: number }> => {
    const res = await api.patch<{ success: boolean; updatedCount: number }>(
      '/api/v1/notifications/read-all',
    );
    return res.data;
  },

  delete: async (id: string): Promise<{ success: boolean; id: string }> => {
    const res = await api.delete<{ success: boolean; id: string }>(`/api/v1/notifications/${id}`);
    return res.data;
  },

  deleteRead: async (): Promise<{ success: boolean; deletedCount: number }> => {
    const res = await api.delete<{ success: boolean; deletedCount: number }>(
      '/api/v1/notifications/read',
    );
    return res.data;
  },
};

