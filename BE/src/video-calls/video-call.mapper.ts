import type { VideoCallResponseDto } from './dto/video-call-response.dto';
import type { VideoCall } from './entities/video-call.entity';
import type { VideoCallRole } from './video-call.constants';
import {
  durationSeconds,
  ringExpiresAt,
  roleOf,
  type VideoCallTimeouts,
} from './video-call.rules';

/**
 * Bản chốt §5.2 + P15: cuộc gọi nhìn từ phía `accountId` (một trong hai bên).
 * Chỉ lấy đúng các field cần — không spread entity, không trả Account.
 * `names`: accountId → accounts.full_name của hai bên.
 */
export function toVideoCallResponse(
  call: VideoCall,
  accountId: string,
  names: ReadonlyMap<string, string>,
  t: VideoCallTimeouts,
): VideoCallResponseDto {
  return {
    id: call.id,
    orderId: call.orderId,
    status: call.status,
    endReason: call.endReason,
    myRole: roleOf(call, accountId) as VideoCallRole,
    // Trả vai trò (không trả id) để FE hiện "Bạn đã cúp" / "Đối phương đã cúp"; null = hệ thống.
    endedBy: call.endedBy ? roleOf(call, call.endedBy) : null,
    caller: {
      accountId: call.callerAccountId,
      fullName: names.get(call.callerAccountId) ?? '',
    },
    callee: {
      accountId: call.calleeAccountId,
      fullName: names.get(call.calleeAccountId) ?? '',
    },
    createdAt: call.createdAt.toISOString(),
    ringExpiresAt: ringExpiresAt(call, t).toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: durationSeconds(call),
  };
}
