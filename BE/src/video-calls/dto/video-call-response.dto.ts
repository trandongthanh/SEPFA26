import { ApiProperty } from '@nestjs/swagger';
import {
  VIDEO_CALL_END_REASONS,
  VIDEO_CALL_ROLES,
  VIDEO_CALL_STATUSES,
  type VideoCallEndReason,
  type VideoCallRole,
  type VideoCallStatus,
} from '../video-call.constants';

// Một bên của cuộc gọi — chỉ id + tên hiển thị (không trả entity Account).
export class VideoCallPartyDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  accountId!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan' })
  fullName!: string;
}

// Bản chốt §5.2 — một cuộc gọi nhìn từ phía người hỏi.
export class VideoCallResponseDto {
  @ApiProperty({ example: '6f1c1a1e-8a51-4c2b-9d3e-2f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: '3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b' })
  orderId!: string;

  @ApiProperty({ enum: VIDEO_CALL_STATUSES, example: 'RINGING' })
  status!: VideoCallStatus;

  @ApiProperty({
    enum: VIDEO_CALL_END_REASONS,
    nullable: true,
    example: null,
  })
  endReason!: VideoCallEndReason | null;

  @ApiProperty({ enum: VIDEO_CALL_ROLES, example: 'CALLER' })
  myRole!: VideoCallRole;

  @ApiProperty({
    enum: VIDEO_CALL_ROLES,
    nullable: true,
    example: null,
    description:
      'Ai bấm cúp/từ chối/hủy; null = hệ thống đóng (hết hạn, đơn bị đóng)',
  })
  endedBy!: VideoCallRole | null;

  @ApiProperty({ type: VideoCallPartyDto })
  caller!: VideoCallPartyDto;

  @ApiProperty({ type: VideoCallPartyDto })
  callee!: VideoCallPartyDto;

  @ApiProperty({
    example: '2026-10-14T10:00:00.000Z',
    description: 'Lúc bắt đầu đổ chuông',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-10-14T10:00:45.000Z',
    description: 'Hết giờ đổ chuông (FE đếm ngược theo mốc này)',
  })
  ringExpiresAt!: string;

  @ApiProperty({ nullable: true, example: null })
  answeredAt!: string | null;

  @ApiProperty({ nullable: true, example: null })
  endedAt!: string | null;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Giây đã nói (đã nghe và đã kết thúc); còn lại null',
  })
  durationSeconds!: number | null;
}

// GET /video-calls/active — cuộc gọi đang diễn ra của đơn, hoặc null.
export class ActiveVideoCallResponseDto {
  @ApiProperty({ type: VideoCallResponseDto, nullable: true })
  call!: VideoCallResponseDto | null;
}

// Thông tin để client vào cuộc gọi trên GetStream (K6: call token chỉ dùng cho cuộc gọi này).
export class VideoCallStreamCredentialsDto {
  @ApiProperty({
    example: 'stream-api-key',
    description: 'API key GetStream (công khai)',
  })
  apiKey!: string;

  @ApiProperty({ example: 'lancare_call' })
  callType!: string;

  @ApiProperty({ example: '6f1c1a1e-8a51-4c2b-9d3e-2f6a7b8c9d0e' })
  callId!: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  token!: string;

  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;
}

// POST /video-calls, POST /video-calls/:id/join — cuộc gọi + thông tin vào GetStream.
export class VideoCallSessionResponseDto {
  @ApiProperty({ type: VideoCallResponseDto })
  call!: VideoCallResponseDto;

  @ApiProperty({ type: VideoCallStreamCredentialsDto })
  stream!: VideoCallStreamCredentialsDto;

  @ApiProperty({
    example: '9b2d3c4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e',
    description:
      'Phiên thiết bị đang giữ cuộc gọi (L6) — so với video_call.accepted / video_call.moved',
  })
  deviceSessionId!: string;
}
