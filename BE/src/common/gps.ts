import { BadRequestException } from '@nestjs/common';

// GPS chỉ có nghĩa khi đủ CẶP lat+lng — gửi lẻ 1 nửa là dữ liệu rác, chặn sớm ở service
// (validate chéo field, decorator per-field của class-validator không diễn đạt được).
export function assertGpsPair(
  gpsLat: number | undefined,
  gpsLng: number | undefined,
): void {
  if ((gpsLat === undefined) !== (gpsLng === undefined)) {
    throw new BadRequestException('GPS_PAIR_REQUIRED');
  }
}
