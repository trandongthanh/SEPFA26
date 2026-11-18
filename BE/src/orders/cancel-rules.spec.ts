import { ConflictException } from '@nestjs/common';
import {
  decideCancel,
  distanceToPickupMeters,
  freeCancelUntil,
  haversineMeters,
  isPastDue,
  isPickupTooSoon,
  noShowAutoCancelAt,
  noShowFrom,
  waitDueAt,
} from './cancel-rules';
import { ORDER_STATUSES, type OrderStatus } from './order-status';

// Giờ mẫu xuyên suốt: khách gửi đơn 07:00, hẹn lấy cây 18:00 cùng ngày (giờ Việt Nam, UTC+7).
const at = (hhmm: string, day = '17') =>
  new Date(`2026-11-${day}T${hhmm}:00+07:00`);
const PICKUP = at('18:00');

describe('cancel-rules', () => {
  describe('waitDueAt — hạn của một trạng thái chờ', () => {
    it('giờ hẹn gần: hạn dừng ở giờ hẹn − 3 giờ (gửi 07:00, hẹn 18:00 → 15:00)', () => {
      expect(waitDueAt(at('07:00'), PICKUP)).toEqual(at('15:00'));
    });

    it('ba hạn dùng CHUNG một mốc: vườn nhận lúc 14:50 thì hạn ký vẫn là 15:00', () => {
      expect(waitDueAt(at('14:50'), PICKUP)).toEqual(at('15:00'));
    });

    it('giờ hẹn xa: hạn là đúng 24 giờ sau lúc vào trạng thái', () => {
      expect(waitDueAt(at('07:00'), at('18:00', '20'))).toEqual(
        at('07:00', '18'),
      );
    });
  });

  it('các mốc quanh giờ hẹn: hết miễn phí 15:00, hết ân hạn 18:30, tự huỷ 18:00 hôm sau', () => {
    expect(freeCancelUntil(PICKUP)).toEqual(at('15:00'));
    expect(noShowFrom(PICKUP)).toEqual(at('18:30'));
    expect(noShowAutoCancelAt(PICKUP)).toEqual(at('18:00', '18'));
  });

  describe('isPickupTooSoon — gửi đơn', () => {
    it('còn đúng 3 giờ hoặc ít hơn → quá gần', () => {
      expect(isPickupTooSoon(PICKUP, at('15:00'))).toBe(true);
      expect(isPickupTooSoon(PICKUP, at('16:30'))).toBe(true);
      expect(isPickupTooSoon(PICKUP, at('19:00'))).toBe(true);
    });

    it('còn hơn 3 giờ → gửi được', () => {
      expect(isPickupTooSoon(PICKUP, at('14:59'))).toBe(false);
    });
  });

  it('isPastDue: hạn rỗng (đơn cũ) không bao giờ quá hạn; đúng mốc là đã quá', () => {
    expect(isPastDue(null, at('15:00'))).toBe(false);
    expect(isPastDue(undefined, at('15:00'))).toBe(false);
    expect(isPastDue(at('15:00'), at('14:59'))).toBe(false);
    expect(isPastDue(at('15:00'), at('15:00'))).toBe(true);
    expect(isPastDue(at('15:00'), at('15:01'))).toBe(true);
  });

  describe('decideCancel — khách', () => {
    const customer = (status: OrderStatus, now: Date) =>
      decideCancel({ role: 'CUSTOMER', status, now, pickupAt: PICKUP });

    it.each([
      'PENDING_PROVIDER',
      'AGREEMENT_PENDING',
      'AWAITING_PAYMENT',
    ] as const)(
      'đơn %s (chưa thanh toán) → rút đơn, không có tiền, bất kể giờ',
      (status) => {
        for (const now of [at('08:00'), at('17:00'), at('20:00')]) {
          expect(customer(status, now)).toEqual({
            code: 'CUSTOMER_WITHDREW',
            refund: 'NONE',
            countsAgainstProvider: false,
          });
        }
      },
    );

    it('đã thanh toán, sớm hơn 3 giờ trước giờ hẹn → hoàn 100%', () => {
      expect(customer('PAID', at('14:59'))).toEqual({
        code: 'CUSTOMER_CANCELLED_FREE',
        refund: 'FULL',
        countsAgainstProvider: false,
      });
    });

    it('đã thanh toán, từ đúng mốc −3 giờ tới trước khi hết ân hạn → vườn giữ phí lấy cây', () => {
      for (const now of [at('15:00'), at('17:00'), at('18:00'), at('18:29')]) {
        expect(customer('PAID', now)).toEqual({
          code: 'CUSTOMER_CANCELLED_LATE',
          refund: 'KEEP_PICKUP_FEE',
          countsAgainstProvider: false,
        });
      }
    });

    it('đã thanh toán, từ đúng mốc hết ân hạn (vườn không tới) → hoàn 100%, tính một lần huỷ cho vườn', () => {
      for (const now of [at('18:30'), at('23:00')]) {
        expect(customer('PAID', now)).toEqual({
          code: 'PROVIDER_NO_SHOW',
          refund: 'FULL',
          countsAgainstProvider: true,
        });
      }
    });
  });

  describe('decideCancel — vườn', () => {
    const provider = (status: OrderStatus) =>
      decideCancel({
        role: 'PROVIDER',
        status,
        now: at('10:00'),
        pickupAt: PICKUP,
      });

    it.each(['AGREEMENT_PENDING', 'AWAITING_PAYMENT'] as const)(
      'đơn %s (đã nhận, chưa có tiền) → huỷ, tính một lần huỷ',
      (status) => {
        expect(provider(status)).toEqual({
          code: 'PROVIDER_CANCELLED',
          refund: 'NONE',
          countsAgainstProvider: true,
        });
      },
    );

    it('đơn đã thanh toán → khách nhận lại 100%, tính một lần huỷ', () => {
      expect(provider('PAID')).toEqual({
        code: 'PROVIDER_CANCELLED',
        refund: 'FULL',
        countsAgainstProvider: true,
      });
    });
  });

  describe('decideCancel — mọi tổ hợp còn lại đều bị cấm (409)', () => {
    const allowed: Record<'CUSTOMER' | 'PROVIDER', OrderStatus[]> = {
      CUSTOMER: [
        'PENDING_PROVIDER',
        'AGREEMENT_PENDING',
        'AWAITING_PAYMENT',
        'PAID',
      ],
      PROVIDER: ['AGREEMENT_PENDING', 'AWAITING_PAYMENT', 'PAID'],
    };
    for (const role of ['CUSTOMER', 'PROVIDER'] as const) {
      const forbidden = ORDER_STATUSES.filter(
        (status) => !allowed[role].includes(status),
      );
      it.each(forbidden)(
        `${role} huỷ đơn %s → INVALID_STATE_TRANSITION`,
        (status) => {
          const run = () =>
            decideCancel({ role, status, now: at('10:00'), pickupAt: PICKUP });
          expect(run).toThrow(ConflictException);
          expect(run).toThrow('INVALID_STATE_TRANSITION');
        },
      );
    }

    it('đủ 15 trạng thái × 2 vai: 7 tổ hợp cho phép, 23 tổ hợp cấm', () => {
      expect(ORDER_STATUSES).toHaveLength(15);
      expect(allowed.CUSTOMER.length + allowed.PROVIDER.length).toBe(7);
    });
  });

  describe('khoảng cách tới điểm lấy cây', () => {
    it('haversine: 1 độ vĩ ≈ 111,19 km; cùng điểm = 0', () => {
      expect(haversineMeters(10, 106, 11, 106)).toBeCloseTo(111_194.9, 0);
      expect(haversineMeters(10.77, 106.7, 10.77, 106.7)).toBe(0);
    });

    it('ảnh có toạ độ → số mét làm tròn (lệch 0,001 độ vĩ ≈ 111 m)', () => {
      expect(
        distanceToPickupMeters(
          { gpsLat: 10.771, gpsLng: 106.7 },
          { gpsLat: '10.770000', gpsLng: '106.700000' },
        ),
      ).toBe(111);
    });

    it('thiếu toạ độ (vườn tắt định vị) hoặc toạ độ đơn hỏng → null', () => {
      const pickup = { gpsLat: '10.77', gpsLng: '106.70' };
      expect(distanceToPickupMeters({}, pickup)).toBeNull();
      expect(distanceToPickupMeters({ gpsLat: 10.77 }, pickup)).toBeNull();
      expect(
        distanceToPickupMeters({ gpsLat: null, gpsLng: 106.7 }, pickup),
      ).toBeNull();
      expect(
        distanceToPickupMeters(
          { gpsLat: 10.77, gpsLng: 106.7 },
          { gpsLat: 'abc', gpsLng: '106.70' },
        ),
      ).toBeNull();
    });

    it('toạ độ 0 (xích đạo / kinh tuyến gốc) vẫn là toạ độ hợp lệ, không bị coi là thiếu', () => {
      expect(
        distanceToPickupMeters(
          { gpsLat: 0, gpsLng: 0 },
          { gpsLat: '0', gpsLng: '0' },
        ),
      ).toBe(0);
    });
  });
});
