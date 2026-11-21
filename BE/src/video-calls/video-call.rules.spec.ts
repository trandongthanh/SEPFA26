import { ConflictException } from '@nestjs/common';
import type { VideoCallRole, VideoCallStatus } from './video-call.constants';
import {
  countPresentParties,
  durationSeconds,
  findDueExpiry,
  nextShortHandedSince,
  resolveEndReason,
  resolveJoin,
  ringExpiresAt,
  roleOf,
  type DueExpiry,
  type VideoCallTimeline,
  type VideoCallTimeouts,
} from './video-call.rules';

// Mốc mặc định theo bản chốt §5.4: đổ chuông 45s, chờ quay lại 300s, tối đa 3600s.
const T: VideoCallTimeouts = {
  ringSeconds: 45,
  graceSeconds: 300,
  maxDurationSeconds: 3600,
};

const T0 = new Date('2026-10-14T10:00:00.000Z').getTime();
// Mốc tương đối so với T0 (giây, có thể lẻ mili-giây; làm tròn để tránh sai số dấu phẩy động).
const at = (seconds: number): Date => new Date(T0 + Math.round(seconds * 1000));
const MS = 0.001;

const CALLER = '11111111-1111-4111-8111-111111111111';
const CALLEE = '22222222-2222-4222-8222-222222222222';
const PARTIES = { callerAccountId: CALLER, calleeAccountId: CALLEE };

describe('ringExpiresAt', () => {
  it('= lúc bắt đầu đổ chuông + thời gian đổ chuông', () => {
    expect(ringExpiresAt({ createdAt: at(0) }, T)).toEqual(at(45));
  });
});

describe('roleOf', () => {
  it.each<[string, VideoCallRole | null]>([
    [CALLER, 'CALLER'],
    [CALLEE, 'CALLEE'],
    ['33333333-3333-4333-8333-333333333333', null],
  ])('%s → %s', (accountId, expected) => {
    expect(roleOf(PARTIES, accountId)).toBe(expected);
  });
});

describe('resolveJoin', () => {
  it.each<[VideoCallStatus, VideoCallRole, 'ANSWER' | 'REJOIN']>([
    ['RINGING', 'CALLEE', 'ANSWER'], // người nhận bấm nghe
    ['RINGING', 'CALLER', 'REJOIN'], // người gọi mở lại lúc còn đổ chuông
    ['ACTIVE', 'CALLER', 'REJOIN'], // vào lại / chuyển máy
    ['ACTIVE', 'CALLEE', 'REJOIN'],
  ])('%s + %s → %s', (status, role, expected) => {
    expect(resolveJoin({ status }, role)).toBe(expected);
  });

  it.each<VideoCallRole>(['CALLER', 'CALLEE'])(
    'ENDED + %s → 409 VIDEO_CALL_ENDED (L9)',
    (role) => {
      expect(() => resolveJoin({ status: 'ENDED' }, role)).toThrow(
        new ConflictException('VIDEO_CALL_ENDED'),
      );
    },
  );
});

describe('resolveEndReason', () => {
  it.each<[VideoCallStatus, VideoCallRole, string | null]>([
    ['RINGING', 'CALLER', 'CANCELLED'], // người gọi hủy
    ['RINGING', 'CALLEE', 'DECLINED'], // người nhận từ chối
    ['ACTIVE', 'CALLER', 'COMPLETED'],
    ['ACTIVE', 'CALLEE', 'COMPLETED'],
    ['ENDED', 'CALLER', null], // đã kết thúc → không đóng lần nữa
    ['ENDED', 'CALLEE', null],
  ])('%s + %s → %s', (status, role, expected) => {
    expect(resolveEndReason({ status }, role)).toBe(expected);
  });
});

describe('findDueExpiry', () => {
  // Nghe lúc T0 + 10s.
  const ANSWERED = 10;

  const ringing = (): VideoCallTimeline => ({
    status: 'RINGING',
    createdAt: at(0),
    answeredAt: null,
    shortHandedSince: null,
  });
  const active = (shortHandedSince: number | null): VideoCallTimeline => ({
    status: 'ACTIVE',
    createdAt: at(0),
    answeredAt: at(ANSWERED),
    shortHandedSince: shortHandedSince === null ? null : at(shortHandedSince),
  });

  interface Case {
    name: string;
    call: VideoCallTimeline;
    now: number;
    orderCallable: boolean;
    expected: DueExpiry | null;
  }

  it.each<Case>([
    // ----- Đang đổ chuông (L1) -----
    {
      name: 'đổ chuông, trước mốc 1ms → chưa hết hạn',
      call: ringing(),
      now: 45 - MS,
      orderCallable: true,
      expected: null,
    },
    {
      name: 'đổ chuông, đúng bằng mốc → MISSED tại mốc',
      call: ringing(),
      now: 45,
      orderCallable: true,
      expected: { endReason: 'MISSED', endedAt: at(45) },
    },
    {
      name: 'đổ chuông, phát hiện trễ 1 giờ → MISSED, ended_at vẫn là mốc (L10)',
      call: ringing(),
      now: 3600,
      orderCallable: true,
      expected: { endReason: 'MISSED', endedAt: at(45) },
    },
    {
      name: 'đổ chuông, đơn đã đóng, chưa quá mốc → hàm này không đóng (L8 do service)',
      call: ringing(),
      now: 10,
      orderCallable: false,
      expected: null,
    },
    {
      name: 'đổ chuông, đơn đã đóng, quá mốc → vẫn MISSED tại mốc',
      call: ringing(),
      now: 100,
      orderCallable: false,
      expected: { endReason: 'MISSED', endedAt: at(45) },
    },

    // ----- Đang nói: quá giờ (L2) -----
    {
      name: 'đang nói đủ người, trước mốc quá giờ 1ms → chưa',
      call: active(null),
      now: ANSWERED + 3600 - MS,
      orderCallable: true,
      expected: null,
    },
    {
      name: 'đang nói, đúng bằng mốc quá giờ (tính từ lúc nghe) → TIMEOUT',
      call: active(null),
      now: ANSWERED + 3600,
      orderCallable: true,
      expected: { endReason: 'TIMEOUT', endedAt: at(ANSWERED + 3600) },
    },

    // ----- Đang nói: thiếu người (L3) -----
    {
      name: 'mốc thiếu người null → không bao giờ DROPPED',
      call: active(null),
      now: ANSWERED + 3000,
      orderCallable: true,
      expected: null,
    },
    {
      name: 'thiếu người, trước hạn chờ 1ms → chưa',
      call: active(100),
      now: 100 + 300 - MS,
      orderCallable: true,
      expected: null,
    },
    {
      name: 'thiếu người, đúng bằng hạn chờ → DROPPED tại mốc + 300s',
      call: active(100),
      now: 400,
      orderCallable: true,
      expected: { endReason: 'DROPPED', endedAt: at(400) },
    },
    {
      name: 'thiếu người, phát hiện trễ → DROPPED, ended_at vẫn là mốc + 300s',
      call: active(100),
      now: 2000,
      orderCallable: true,
      expected: { endReason: 'DROPPED', endedAt: at(400) },
    },

    // ----- Hai mốc cùng qua (P10) -----
    {
      name: 'hai mốc cùng qua, DROPPED sớm hơn → DROPPED',
      call: active(100),
      now: ANSWERED + 5000,
      orderCallable: true,
      expected: { endReason: 'DROPPED', endedAt: at(400) },
    },
    {
      name: 'hai mốc cùng qua, TIMEOUT sớm hơn → TIMEOUT',
      call: active(ANSWERED + 3500),
      now: ANSWERED + 5000,
      orderCallable: true,
      expected: { endReason: 'TIMEOUT', endedAt: at(ANSWERED + 3600) },
    },
    {
      name: 'hai mốc trùng nhau → TIMEOUT',
      call: active(ANSWERED + 3300),
      now: ANSWERED + 3600,
      orderCallable: true,
      expected: { endReason: 'TIMEOUT', endedAt: at(ANSWERED + 3600) },
    },

    // ----- Đơn đã đóng khi đang nói (L7, P11) -----
    {
      name: 'L7: đơn đã đóng, có người rời → thời gian chờ 0, DROPPED ngay tại mốc rời',
      call: active(100),
      now: 100,
      orderCallable: false,
      expected: { endReason: 'DROPPED', endedAt: at(100) },
    },
    {
      name: 'L7: đơn đã đóng, đủ hai bên → cuộc gọi tiếp tục',
      call: active(null),
      now: 100,
      orderCallable: false,
      expected: null,
    },
    {
      name: 'L7: đơn đã đóng vẫn giới hạn quá giờ',
      call: active(null),
      now: ANSWERED + 3600,
      orderCallable: false,
      expected: { endReason: 'TIMEOUT', endedAt: at(ANSWERED + 3600) },
    },

    // ----- Đã kết thúc -----
    {
      name: 'ENDED không bao giờ hết hạn lại',
      call: {
        status: 'ENDED',
        createdAt: at(0),
        answeredAt: at(ANSWERED),
        shortHandedSince: at(100),
      },
      now: 99_999,
      orderCallable: false,
      expected: null,
    },
  ])('$name', ({ call, now, orderCallable, expected }) => {
    expect(findDueExpiry(call, at(now), T, { orderCallable })).toEqual(
      expected,
    );
  });
});

describe('countPresentParties', () => {
  it.each<[string, string[], number]>([
    ['không ai', [], 0],
    ['chỉ người gọi', [CALLER], 1],
    ['chỉ người nhận', [CALLEE], 1],
    ['đủ hai bên', [CALLER, CALLEE], 2],
    ['một người hai máy vẫn là 1 bên', [CALLER, CALLER, CALLEE], 2],
    ['bỏ qua user lạ', [CALLER, 'stranger', 'lancare-system'], 1],
    ['chỉ user lạ', ['stranger'], 0],
  ])('%s → %d', (_name, userIds, expected) => {
    expect(countPresentParties(PARTIES, userIds)).toBe(expected);
  });
});

describe('nextShortHandedSince', () => {
  const NOW = at(500);
  const OLD = at(100);

  it.each<[string, Date | null, number, Date | null]>([
    ['đủ 2 bên, chưa có mốc → null', null, 2, null],
    ['đủ 2 bên, đang có mốc → xóa mốc', OLD, 2, null],
    ['thiếu 1 bên, chưa có mốc → bắt đầu từ now', null, 1, NOW],
    ['không còn ai, chưa có mốc → bắt đầu từ now', null, 0, NOW],
    ['thiếu 1 bên, đã có mốc → giữ mốc cũ (không dời)', OLD, 1, OLD],
    ['không còn ai, đã có mốc → giữ mốc cũ', OLD, 0, OLD],
  ])('%s', (_name, current, presentParties, expected) => {
    expect(nextShortHandedSince(current, presentParties, NOW)).toEqual(
      expected,
    );
  });
});

describe('durationSeconds', () => {
  it.each<[string, Date | null, Date | null, number | null]>([
    ['chưa nghe, chưa kết thúc → null', null, null, null],
    ['chưa nghe mà đã kết thúc (nhỡ/từ chối/hủy) → null', null, at(45), null],
    ['đang nói (chưa kết thúc) → null', at(10), null, null],
    ['đã nghe và kết thúc → làm tròn xuống', at(10), at(135.999), 125],
    ['nghe xong cúp ngay → 0', at(10), at(10), 0],
  ])('%s', (_name, answeredAt, endedAt, expected) => {
    expect(durationSeconds({ answeredAt, endedAt })).toBe(expected);
  });
});
