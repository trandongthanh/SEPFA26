import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamClient } from '@stream-io/node-sdk';
import type { CallSettingsRequest } from '@stream-io/node-sdk';
import {
  STREAM_APP_ROLE,
  STREAM_CALL_MEMBER_GRANTS,
  STREAM_CALL_MEMBER_ROLE,
  STREAM_EMPTY_GRANT_ROLES,
  STREAM_SYSTEM_USER_NAME,
} from './video-call.constants';

// P26: timeout SDK riêng (ms). Module BE KHÔNG cung cấp token này (giữ mặc định 3000 ms);
// chỉ module của script setup cung cấp STREAM_SETUP_TIMEOUT_MS.
export const STREAM_CLIENT_TIMEOUT_MS = 'STREAM_CLIENT_TIMEOUT_MS';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Một bên của cuộc gọi trên GetStream: id = accountId, name = accounts.full_name.
export interface StreamCallMember {
  id: string;
  name: string;
}

export interface EnsureCallTypeResult {
  appRoleCreated: boolean;
  callTypeCreated: boolean;
  // Grants đọc lại từ GetStream sau khi tạo/cập nhật — script setup đối chiếu.
  grants: Record<string, string[]>;
}

// K1 + K1b: chỉ call_member có 4 quyền; user/guest/lancare_user khai rõ là rỗng
// (không khai thì GetStream tự gán quyền mặc định).
export function buildCallTypeGrants(): Record<string, string[]> {
  const grants: Record<string, string[]> = {
    [STREAM_CALL_MEMBER_ROLE]: [...STREAM_CALL_MEMBER_GRANTS],
  };
  for (const role of STREAM_EMPTY_GRANT_ROLES) {
    grants[role] = [];
  }
  return grants;
}

export interface GrantCheckLine {
  ok: boolean;
  line: string;
}

/**
 * P27: so grants đọc lại từ GetStream với grants mong muốn (script setup in từng dòng).
 * call_member đúng 4 quyền; user, guest đúng [] (vắng dòng = LỆCH); riêng lancare_user vắng
 * hoặc [] đều OK — GetStream không lưu dòng rỗng của role tự tạo (K1b [14/10 tối]),
 * bằng chứng quyền thật là script kiểm quyền.
 */
export function checkCallTypeGrants(
  saved: Record<string, string[] | undefined>,
): GrantCheckLine[] {
  return Object.entries(buildCallTypeGrants()).map(([role, wanted]) => {
    const current = saved[role];
    if (!current) {
      return role === STREAM_APP_ROLE
        ? {
            ok: true,
            line: `OK ${role}: (GetStream không lưu dòng rỗng — xem kiểm quyền)`,
          }
        : { ok: false, line: `LỆCH ${role}: (vắng)` };
    }
    const sorted = [...current].sort();
    const ok = JSON.stringify(sorted) === JSON.stringify([...wanted].sort());
    return {
      ok,
      line: `${ok ? 'OK' : 'LỆCH'} ${role}: [${sorted.join(', ')}]`,
    };
  });
}

// K3: đúng danh sách cài đặt đã chốt, không thêm. target_resolution bắt buộc khai
// (thiếu → GetStream báo lỗi), kể cả screensharing đã tắt.
export function buildCallTypeSettings(
  maxDurationSeconds: number,
): CallSettingsRequest {
  return {
    audio: {
      default_device: 'speaker',
      mic_default_on: true,
      access_request_enabled: false,
    },
    video: {
      enabled: true,
      camera_default_on: true,
      camera_facing: 'front',
      access_request_enabled: false,
      target_resolution: { width: 1280, height: 720, bitrate: 1500000 },
    },
    screensharing: {
      enabled: false,
      access_request_enabled: false,
      target_resolution: { width: 1920, height: 1080, bitrate: 1500000 },
    },
    recording: { mode: 'disabled' },
    backstage: { enabled: false },
    limits: { max_duration_seconds: maxDurationSeconds },
  };
}

/**
 * Bọc SDK GetStream thành 1 provider: service không gọi SDK trực tiếp; e2e thay bằng bản giả,
 * unit test mock SDK. Timeout SDK giữ mặc định 3000 ms (bản chốt §3 "Mặc định khác"),
 * trừ khi module cung cấp STREAM_CLIENT_TIMEOUT_MS (chỉ script setup — P26).
 */
@Injectable()
export class StreamVideoClient {
  readonly apiKey: string;
  readonly callType: string;
  readonly systemUserId: string;
  private readonly client: StreamClient;

  constructor(
    config: ConfigService,
    @Optional() @Inject(STREAM_CLIENT_TIMEOUT_MS) timeoutMs?: number,
  ) {
    this.apiKey = config.getOrThrow<string>('STREAM_API_KEY');
    this.callType = config.getOrThrow<string>('STREAM_CALL_TYPE');
    this.systemUserId = config.getOrThrow<string>('STREAM_SYSTEM_USER_ID');
    const secret = config.getOrThrow<string>('STREAM_API_SECRET');
    this.client =
      timeoutMs === undefined
        ? new StreamClient(this.apiKey, secret)
        : new StreamClient(this.apiKey, secret, { timeout: timeoutMs });
  }

  callCid(callId: string): string {
    return `${this.callType}:${callId}`;
  }

  // K9: `call_cid` của webhook → id cuộc gọi; khác call type hoặc không phải uuid → null.
  parseCallCid(cid: unknown): string | null {
    if (typeof cid !== 'string') {
      return null;
    }
    const prefix = `${this.callType}:`;
    if (!cid.startsWith(prefix)) {
      return null;
    }
    const id = cid.slice(prefix.length);
    return UUID_PATTERN.test(id) ? id.toLowerCase() : null;
  }

  /**
   * K4, K5, P3: đăng ký user hệ thống (admin) + hai bên (role lancare_user, tên mới nhất),
   * rồi tạo cuộc gọi do user hệ thống đứng tên, hai bên là member call_member.
   * Không đặt max_participants (máy vào sau không bị chặn khi máy cũ chưa kịp rời — L6).
   */
  async createCall(
    callId: string,
    input: { members: StreamCallMember[]; maxDurationSeconds: number },
  ): Promise<void> {
    await this.client.upsertUsers([
      { id: this.systemUserId, name: STREAM_SYSTEM_USER_NAME, role: 'admin' },
      ...input.members.map((member) => ({
        id: member.id,
        name: member.name,
        role: STREAM_APP_ROLE,
      })),
    ]);
    await this.client.video.call(this.callType, callId).getOrCreate({
      data: {
        created_by_id: this.systemUserId,
        members: input.members.map((member) => ({
          user_id: member.id,
          role: STREAM_CALL_MEMBER_ROLE,
        })),
        settings_override: {
          limits: { max_duration_seconds: input.maxDurationSeconds },
        },
      },
    });
  }

  // K6: call token chỉ dùng cho đúng 1 cuộc gọi, role call_member.
  generateCallToken(
    userId: string,
    callId: string,
    ttlSeconds: number,
  ): string {
    return this.client.generateCallToken({
      user_id: userId,
      role: STREAM_CALL_MEMBER_ROLE,
      call_cids: [this.callCid(callId)],
      validity_in_seconds: ttlSeconds,
    });
  }

  // K1: chỉ BE kết thúc cuộc gọi trên GetStream (gọi lại trên cuộc đã kết thúc vẫn OK).
  async endCall(callId: string): Promise<void> {
    await this.client.video.call(this.callType, callId).end();
  }

  // K9: user id (không trùng) đang có mặt trong cuộc gọi. Chưa ai vào → session null → [].
  async listPresentUserIds(callId: string): Promise<string[]> {
    const response = await this.client.video.call(this.callType, callId).get();
    const participants = response.call.session?.participants ?? [];
    return [...new Set(participants.map((p) => p.user.id))];
  }

  // K9: chữ ký HMAC (header x-signature) trên raw body. Thiếu body hoặc chữ ký → false.
  verifyWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    if (!rawBody || rawBody.length === 0 || !signature) {
      return false;
    }
    return this.client.verifyWebhook(rawBody, signature);
  }

  /**
   * K7: cấu hình app GetStream cho video call (script setup gọi; chạy lại an toàn):
   * 1. Role toàn app lancare_user — chưa có thì tạo (K5).
   * 2. Call type — chưa có thì tạo, có rồi thì cập nhật grants (K1b) + settings (K3).
   * 3. Đăng ký user hệ thống (K4).
   * Trả grants đọc lại từ GetStream để đối chiếu.
   */
  async ensureCallType(
    maxDurationSeconds: number,
  ): Promise<EnsureCallTypeResult> {
    const { roles } = await this.client.listRoles();
    const appRoleCreated = !roles.some((role) => role.name === STREAM_APP_ROLE);
    if (appRoleCreated) {
      await this.client.createRole({ name: STREAM_APP_ROLE });
    }

    const request = {
      name: this.callType,
      grants: buildCallTypeGrants(),
      settings: buildCallTypeSettings(maxDurationSeconds),
    };
    const { call_types } = await this.client.video.listCallTypes();
    const callTypeCreated = !(this.callType in call_types);
    if (callTypeCreated) {
      await this.client.video.createCallType(request);
    } else {
      await this.client.video.updateCallType(request);
    }

    await this.client.upsertUsers([
      { id: this.systemUserId, name: STREAM_SYSTEM_USER_NAME, role: 'admin' },
    ]);

    const saved = await this.client.video.getCallType({ name: this.callType });
    return { appRoleCreated, callTypeCreated, grants: saved.grants };
  }
}
