import React from 'react';
import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InteractionOutlined,
} from '@ant-design/icons';
import type { DisputeOutcome, DisputeStatus, DisputeVerdict } from '@/lib/admin.api';
import { getApiErrorCode } from '@/lib/api';

export const formatVnd = (value: string | number | null | undefined) =>
  `${Number(value || 0).toLocaleString('vi-VN')} VNĐ`;

export const OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  AGREED: 'Hai bên thỏa thuận',
  WITHDRAWN: 'Khách rút khiếu nại',
  ADJUDICATED: 'Admin phân xử',
};

export const VERDICT_OPTIONS: { value: DisputeVerdict; label: string; hint: string }[] = [
  {
    value: 'NOT_AT_FAULT',
    label: 'Vườn không có lỗi',
    hint: 'Không hoàn tiền, không đền cho cây này',
  },
  {
    value: 'SERVICE_FAULT',
    label: 'Vườn có lỗi – hoàn tiền công',
    hint: 'Hoàn tiền công chăm sóc của cây này',
  },
  {
    value: 'VALUE_LOST',
    label: 'Vườn có lỗi, cây mất giá trị',
    hint: 'Hoàn tiền công + đền trọn mức đền của cây',
  },
];

export const VERDICT_LABELS: Record<DisputeVerdict, string> = {
  NOT_AT_FAULT: 'Vườn không có lỗi',
  SERVICE_FAULT: 'Vườn có lỗi – hoàn tiền công',
  VALUE_LOST: 'Vườn có lỗi, cây mất giá trị',
};

// Mã lỗi BE (disputes.service / admin-disputes.controller) → câu dễ hiểu cho admin.
export const DISPUTE_ERROR_MESSAGES: Record<string, string> = {
  DISPUTE_NOT_FOUND: 'Không tìm thấy tranh chấp này.',
  DISPUTE_NOT_IN_REVIEW:
    'Tranh chấp không còn ở bước chờ admin phân xử (có thể hai bên vừa thỏa thuận xong). Hãy tải lại trang.',
  DISPUTE_VERDICT_INCOMPLETE:
    'Phải kết luận đủ mọi cây bị khiếu nại, không thiếu và không trùng.',
  ESCROW_BALANCE_INSUFFICIENT:
    'Số dư ký quỹ của đơn không đủ để chia tiền. Hãy báo đội kỹ thuật kiểm tra.',
};

export const toDisputeError = (err: any, fallback: string) => {
  const code = getApiErrorCode(err);
  // Mã chưa có trong bảng trên → dùng câu tiếng Việt interceptor đã dịch sẵn.
  return (code && DISPUTE_ERROR_MESSAGES[code]) || err?.response?.data?.message || fallback;
};

export function DisputeStatusTag({
  status,
  outcome,
  isOverdue,
}: {
  status: DisputeStatus;
  outcome: DisputeOutcome | null;
  isOverdue: boolean;
}) {
  if (status === 'ADMIN_REVIEW') {
    return isOverdue ? (
      <Tag color="error" icon={<ExclamationCircleOutlined />} className="!rounded-lg">
        Quá hạn xử lý
      </Tag>
    ) : (
      <Tag color="warning" icon={<ClockCircleOutlined />} className="!rounded-lg">
        Chờ phân xử
      </Tag>
    );
  }
  if (status === 'NEGOTIATING') {
    return (
      <Tag color="processing" icon={<InteractionOutlined />} className="!rounded-lg">
        Đang thương lượng
      </Tag>
    );
  }
  return (
    <Tag color="success" icon={<CheckCircleOutlined />} className="!rounded-lg">
      {outcome ? OUTCOME_LABELS[outcome] : 'Đã giải quyết'}
    </Tag>
  );
}
