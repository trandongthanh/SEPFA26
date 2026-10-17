import { randomUUID } from 'crypto';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import type {
  ActiveVideoCallResponseDto,
  VideoCallResponseDto,
  VideoCallSessionResponseDto,
} from './dto/video-call-response.dto';
import { VideoCall } from './entities/video-call.entity';
import { StreamVideoClient } from './stream-video.client';
import {
  CALL_TOKEN_BUFFER_SECONDS,
  CALLABLE_ORDER_STATUSES,
  LIVE_VIDEO_CALL_STATUSES,
  PRESENCE_RETRY_AFTER_MS,
  STREAM_DURATION_BUFFER_SECONDS,
  type VideoCallEndReason,
  type VideoCallRole,
} from './video-call.constants';
import { toVideoCallResponse } from './video-call.mapper';
import {
  countPresentParties,
  findDueExpiry,
  nextShortHandedSince,
  resolveEndReason,
  resolveJoin,
  ringExpiresAt,
  roleOf,
  type VideoCallTimeouts,
} from './video-call.rules';
import { VideoCallsGateway } from './video-calls.gateway';

// Postgres unique_violation — vướng UQ_video_calls_order_live (K12, P14).
const PG_UNIQUE_VIOLATION = '23505';
// P15: lịch sử trả tối đa 50 cuộc gọi mới nhất (chưa phân trang — §5.1).
const HISTORY_LIMIT = 50;

type BusyCode = 'VIDEO_CALL_IN_PROGRESS' | 'CALLER_BUSY' | 'CALLEE_BUSY';

// P13: lỗi nghiệp vụ trong transaction trả kết quả (không ném) để phần dọn hết hạn vẫn được commit.
type CreateOutcome =
  | { kind: 'created'; call: VideoCall }
  | { kind: 'busy'; code: BusyCode }
  | { kind: 'provider_error' };

// P13: kết quả của decline trong transaction.
type DeclineOutcome =
  | { kind: 'expired' } // vừa hết hạn → commit phần đóng rồi 409 VIDEO_CALL_NOT_RINGING (P16)
  | { kind: 'not_callee' }
  | { kind: 'not_ringing' }
  | { kind: 'declined'; call: VideoCall };

// P13: kết quả của join trong transaction.
type JoinOutcome =
  | { kind: 'expired' } // vừa hết hạn → commit phần đóng rồi 409 VIDEO_CALL_ENDED (P16)
  | { kind: 'order_not_callable' }
  | {
      kind: 'answered' | 'rejoined';
      call: VideoCall;
      deviceSessionId: string;
      previousDeviceSessionId: string | null;
    };

interface OrderParties {
  order: ServiceOrder;
  calleeId: string; // bên còn lại của đơn
}

/**
 * Cuộc gọi video 1-1 theo đơn (bản chốt BE/docs/video-call-ban-chot.md).
 * - BE giữ trạng thái; GetStream chỉ lo hình/tiếng (call type riêng, client chỉ có call token).
 * - Hết hạn được đóng khi có request chạm cuộc gọi (K10), `ended_at` = đúng mốc (L10).
 * - Ghi DB trong transaction có khóa (K12); kết thúc phía GetStream + gửi socket chạy SAU commit,
 *   lỗi chỉ log (P13, P21).
 */
@Injectable()
export class VideoCallsService {
  private readonly logger = new Logger(VideoCallsService.name);
  private readonly t: VideoCallTimeouts;
  // P18: callId → lúc hỏi GetStream "ai có mặt" lỗi gần nhất.
  private readonly presenceFailedAt = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(VideoCall)
    private readonly calls: Repository<VideoCall>,
    @InjectRepository(ServiceOrder)
    private readonly orders: Repository<ServiceOrder>,
    @InjectRepository(CustomerProfile)
    private readonly customers: Repository<CustomerProfile>,
    @InjectRepository(ProviderProfile)
    private readonly providers: Repository<ProviderProfile>,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    private readonly stream: StreamVideoClient,
    private readonly gateway: VideoCallsGateway,
    config: ConfigService,
  ) {
    this.t = {
      ringSeconds: Number(config.getOrThrow('VIDEO_CALL_RING_TIMEOUT_SECONDS')),
      graceSeconds: Number(
        config.getOrThrow('VIDEO_CALL_RECONNECT_GRACE_SECONDS'),
      ),
      maxDurationSeconds: Number(
        config.getOrThrow('VIDEO_CALL_MAX_DURATION_SECONDS'),
      ),
    };
  }

  /**
   * POST /video-calls — một bên của đơn gọi bên còn lại.
   * P9: (1) bên của đơn → (2) trạng thái đơn → (3) trong transaction: khóa 2 người → dọn hết hạn
   * → đơn đang có cuộc sống → người gọi bận → người nhận bận.
   * K13: tạo trên GetStream trước, ghi DB sau (created_at = lúc GetStream xong).
   */
  async create(
    accountId: string,
    orderId: string,
  ): Promise<VideoCallSessionResponseDto> {
    const { order, calleeId } = await this.resolveOrderParties(
      orderId,
      accountId,
    );
    if (!isCallable(order.status)) {
      throw new ConflictException('ORDER_NOT_CALLABLE');
    }
    const names = await this.loadNames([accountId, calleeId]);
    const ended: VideoCall[] = [];

    let outcome: CreateOutcome;
    try {
      outcome = await this.dataSource.transaction(async (manager) => {
        await lockAccounts(manager, [accountId, calleeId]);
        // Mọi cuộc gọi đang sống của 2 người (kể cả ở đơn khác), khóa dòng theo thứ tự id.
        const live = await manager.find(VideoCall, {
          where: [
            {
              callerAccountId: In([accountId, calleeId]),
              status: In([...LIVE_VIDEO_CALL_STATUSES]),
            },
            {
              calleeAccountId: In([accountId, calleeId]),
              status: In([...LIVE_VIDEO_CALL_STATUSES]),
            },
          ],
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_write' },
        });
        const now = new Date();
        for (const call of live) {
          if (await this.settleExpiry(manager, call, now)) {
            ended.push(call);
          }
        }
        const stillLive = live.filter((call) => call.status !== 'ENDED');
        if (stillLive.some((call) => call.orderId === order.id)) {
          return { kind: 'busy', code: 'VIDEO_CALL_IN_PROGRESS' } as const;
        }
        if (stillLive.some((call) => involves(call, accountId))) {
          return { kind: 'busy', code: 'CALLER_BUSY' } as const;
        }
        if (stillLive.some((call) => involves(call, calleeId))) {
          return { kind: 'busy', code: 'CALLEE_BUSY' } as const;
        }

        const callId = randomUUID();
        try {
          await this.stream.createCall(callId, {
            members: [
              { id: accountId, name: names.get(accountId) ?? '' },
              { id: calleeId, name: names.get(calleeId) ?? '' },
            ],
            maxDurationSeconds: this.streamMaxDurationSeconds(),
          });
        } catch (err) {
          this.logger.error(
            `Tạo cuộc gọi ${callId} trên GetStream lỗi: ${String(err)} — kiểm STREAM_* và đã chạy script setup chưa`,
          );
          return { kind: 'provider_error' } as const;
        }

        const call = manager.create(VideoCall, {
          id: callId,
          orderId: order.id,
          callerAccountId: accountId,
          calleeAccountId: calleeId,
          status: 'RINGING',
          endReason: null,
          endedBy: null,
          answeredAt: null,
          endedAt: null,
          shortHandedSince: null,
          callerDeviceSessionId: randomUUID(),
          calleeDeviceSessionId: null,
          // P5: giờ app lúc GetStream xong — không dùng now() của DB (= giờ bắt đầu transaction).
          createdAt: new Date(),
        });
        return { kind: 'created', call: await manager.save(call) } as const;
      });
    } catch (err) {
      // Lưới cuối: unique index một phần (mỗi đơn 1 cuộc gọi sống). Transaction đã rollback.
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('VIDEO_CALL_IN_PROGRESS');
      }
      throw err;
    }

    await this.afterEnded(ended);
    if (outcome.kind === 'busy') {
      throw new ConflictException(outcome.code);
    }
    if (outcome.kind === 'provider_error') {
      throw new BadGatewayException('VIDEO_PROVIDER_UNAVAILABLE');
    }
    const call = outcome.call;
    this.gateway.emitToAccounts([calleeId], 'video_call.ringing', {
      callId: call.id,
      orderId: call.orderId,
      caller: { accountId, fullName: names.get(accountId) ?? '' },
      ringExpiresAt: ringExpiresAt(call, this.t).toISOString(),
    });
    return this.toSession(
      call,
      accountId,
      call.callerDeviceSessionId as string,
      names,
    );
  }

  // GET /video-calls/active?orderId= — cuộc gọi đang diễn ra của đơn (đã dọn hết hạn), hoặc null.
  async getActive(
    accountId: string,
    orderId: string,
  ): Promise<ActiveVideoCallResponseDto> {
    const { order } = await this.resolveOrderParties(orderId, accountId);
    const live = await this.settleOrderLiveCall(order.id);
    return { call: live ? await this.toResponse(live, accountId) : null };
  }

  // GET /video-calls?orderId= — P15: mọi cuộc gọi của đơn, mới nhất trước, tối đa 50.
  async listHistory(
    accountId: string,
    orderId: string,
  ): Promise<VideoCallResponseDto[]> {
    const { order } = await this.resolveOrderParties(orderId, accountId);
    // K10: dọn cuộc đang sống quá hạn trước khi đọc → lịch sử không hiện trạng thái sai.
    await this.settleOrderLiveCall(order.id);
    const calls = await this.calls.find({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });
    const names = await this.loadNames(
      calls.flatMap((call) => [call.callerAccountId, call.calleeAccountId]),
    );
    return calls.map((call) =>
      toVideoCallResponse(call, accountId, names, this.t),
    );
  }

  /**
   * POST /video-calls/:id/join — người nhận nghe (đang đổ chuông); bên nào cũng vào lại/chuyển
   * máy (đang nói); người gọi vào lại lúc còn đổ chuông (P7). Máy vào sau giữ cuộc gọi (L6).
   * Thứ tự: khóa dòng → không phải bên → 404 → dọn hết hạn (vừa hết → 409 VIDEO_CALL_ENDED) →
   * đơn không còn gọi được → 409 ORDER_NOT_CALLABLE (L7) → resolveJoin.
   */
  async join(
    accountId: string,
    callId: string,
  ): Promise<VideoCallSessionResponseDto> {
    const ended: VideoCall[] = [];
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<JoinOutcome> => {
        const { call, role } = await lockCallForParty(
          manager,
          callId,
          accountId,
        );
        if (await this.settleExpiry(manager, call, new Date())) {
          ended.push(call);
          // L8: đơn đóng lúc đang đổ chuông → vừa đóng CANCELLED → báo đúng lý do (409 ORDER_NOT_CALLABLE).
          return call.endReason === 'CANCELLED'
            ? { kind: 'order_not_callable' }
            : { kind: 'expired' };
        }
        const order = await manager.findOne(ServiceOrder, {
          where: { id: call.orderId },
          select: { id: true, status: true },
        });
        if (!order || !isCallable(order.status)) {
          return { kind: 'order_not_callable' };
        }

        // Cuộc đã kết thúc (trước request này) → ném 409 VIDEO_CALL_ENDED (chưa ghi gì).
        const action = resolveJoin(call, role);
        const deviceSessionId = randomUUID();
        if (action === 'ANSWER') {
          // P6: chưa chắc 2 bên đã vào hình/tiếng → bật mốc thiếu người; webhook "vào" xóa mốc.
          const now = new Date();
          call.status = 'ACTIVE';
          call.answeredAt = now;
          call.shortHandedSince = now;
          call.calleeDeviceSessionId = deviceSessionId;
          await manager.save(call);
          return {
            kind: 'answered',
            call,
            deviceSessionId,
            previousDeviceSessionId: null,
          };
        }
        const previousDeviceSessionId =
          role === 'CALLER'
            ? call.callerDeviceSessionId
            : call.calleeDeviceSessionId;
        if (role === 'CALLER') {
          call.callerDeviceSessionId = deviceSessionId;
        } else {
          call.calleeDeviceSessionId = deviceSessionId;
        }
        await manager.save(call);
        return {
          kind: 'rejoined',
          call,
          deviceSessionId,
          previousDeviceSessionId,
        };
      },
    );

    await this.afterEnded(ended);
    if (outcome.kind === 'expired') {
      throw new ConflictException('VIDEO_CALL_ENDED');
    }
    if (outcome.kind === 'order_not_callable') {
      throw new ConflictException('ORDER_NOT_CALLABLE');
    }
    const { call, deviceSessionId } = outcome;
    if (outcome.kind === 'answered') {
      // P8: tới người gọi + mọi máy người nhận — máy không khớp deviceSessionId thì tắt chuông.
      this.gateway.emitToAccounts(
        [call.callerAccountId, call.calleeAccountId],
        'video_call.accepted',
        { callId: call.id, deviceSessionId },
      );
    } else if (outcome.previousDeviceSessionId) {
      // P7: chỉ room của người vừa chuyển máy; máy cũ không khớp phiên mới thì tự thoát.
      this.gateway.emitToAccounts([accountId], 'video_call.moved', {
        callId: call.id,
        deviceSessionId,
      });
    }
    const names = await this.loadNames([
      call.callerAccountId,
      call.calleeAccountId,
    ]);
    return this.toSession(call, accountId, deviceSessionId, names);
  }

  /**
   * POST /video-calls/:id/decline — người nhận từ chối lúc đang đổ chuông (L1 → DECLINED).
   * Thứ tự: khóa dòng → 404 → dọn hết hạn (vừa hết → 409 VIDEO_CALL_NOT_RINGING, P16)
   * → không phải người nhận → 403 → không còn đổ chuông → 409.
   */
  async decline(
    accountId: string,
    callId: string,
  ): Promise<VideoCallResponseDto> {
    const ended: VideoCall[] = [];
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<DeclineOutcome> => {
        const { call, role } = await lockCallForParty(
          manager,
          callId,
          accountId,
        );
        if (await this.settleExpiry(manager, call, new Date())) {
          ended.push(call);
          return { kind: 'expired' };
        }
        if (role !== 'CALLEE') {
          return { kind: 'not_callee' };
        }
        if (call.status !== 'RINGING') {
          return { kind: 'not_ringing' };
        }
        closeCall(call, 'DECLINED', new Date(), accountId);
        await manager.save(call);
        ended.push(call);
        return { kind: 'declined', call };
      },
    );

    await this.afterEnded(ended);
    if (outcome.kind === 'not_callee') {
      throw new ForbiddenException('ONLY_CALLEE_CAN_DECLINE');
    }
    if (outcome.kind !== 'declined') {
      throw new ConflictException('VIDEO_CALL_NOT_RINGING');
    }
    return this.toResponse(outcome.call, accountId);
  }

  /**
   * POST /video-calls/:id/end — hủy (người gọi, đang đổ chuông → CANCELLED), từ chối (người nhận,
   * đang đổ chuông → DECLINED), cúp (đang nói → COMPLETED), ghi ai bấm (L1, L2).
   * Đã kết thúc (kể cả vừa hết hạn trong request này) → trả nguyên trạng 200 (P16, idempotent).
   */
  async end(accountId: string, callId: string): Promise<VideoCallResponseDto> {
    const ended: VideoCall[] = [];
    const call = await this.dataSource.transaction(async (manager) => {
      const { call: locked, role } = await lockCallForParty(
        manager,
        callId,
        accountId,
      );
      if (await this.settleExpiry(manager, locked, new Date())) {
        ended.push(locked);
        return locked;
      }
      const endReason = resolveEndReason(locked, role);
      if (!endReason) {
        return locked; // đã ENDED từ trước → không đóng lần nữa
      }
      closeCall(locked, endReason, new Date(), accountId);
      await manager.save(locked);
      ended.push(locked);
      return locked;
    });

    await this.afterEnded(ended);
    return this.toResponse(call, accountId);
  }

  /**
   * K9: webhook "có người vào/rời/phiên kết thúc" chỉ là chuông báo — hỏi lại GetStream ai đang có
   * mặt (đếm theo BÊN) rồi bật/tắt mốc thiếu người (L3). Chỉ cuộc ACTIVE; cuộc khác bỏ qua (P17).
   * Hỏi GetStream lỗi → chưa có mốc thì bật mốc = now, có rồi thì giữ (P19, K10b-2).
   */
  async syncPresence(callId: string): Promise<void> {
    const ended: VideoCall[] = [];
    await this.dataSource.transaction(async (manager) => {
      const call = await manager.findOne(VideoCall, {
        where: { id: callId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!call || call.status !== 'ACTIVE') {
        return;
      }
      if (await this.settleExpiry(manager, call, new Date())) {
        ended.push(call);
        return;
      }
      // Hỏi GetStream lúc đang giữ khóa dòng → 2 webhook tới cùng lúc không ghi đè lẫn nhau.
      const present = await this.tryListPresent(call.id);
      const next =
        present === null
          ? (call.shortHandedSince ?? new Date()) // P19: không biết → bật mốc nếu chưa có
          : nextShortHandedSince(
              call.shortHandedSince,
              countPresentParties(call, present),
              new Date(),
            );
      if (next?.getTime() !== call.shortHandedSince?.getTime()) {
        call.shortHandedSince = next;
        await manager.save(call);
      }
    });
    await this.afterEnded(ended);
  }

  /**
   * Khóa + dọn hết hạn cuộc gọi đang sống của đơn (nếu có). Trả cuộc còn sống sau khi dọn, hoặc
   * null. Cuộc vừa đóng được hậu xử lý sau commit (P13).
   */
  private async settleOrderLiveCall(
    orderId: string,
  ): Promise<VideoCall | null> {
    const ended: VideoCall[] = [];
    const live = await this.dataSource.transaction(async (manager) => {
      const call = await manager.findOne(VideoCall, {
        where: { orderId, status: In([...LIVE_VIDEO_CALL_STATUSES]) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!call) {
        return null;
      }
      if (await this.settleExpiry(manager, call, new Date())) {
        ended.push(call);
        return null;
      }
      return call;
    });
    await this.afterEnded(ended);
    return live;
  }

  /**
   * Đơn + bên còn lại. Đơn không có HOẶC người hỏi không phải khách/provider của đơn
   * → cùng 404 ORDER_NOT_FOUND (chống dò id đơn của người khác).
   */
  private async resolveOrderParties(
    orderId: string,
    accountId: string,
  ): Promise<OrderParties> {
    const order = await this.orders.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }
    const [customer, provider] = await Promise.all([
      this.customers.findOne({
        where: { id: order.customerId },
        select: { id: true, accountId: true },
      }),
      this.providers.findOne({
        where: { id: order.providerId },
        select: { id: true, accountId: true },
      }),
    ]);
    if (customer && provider) {
      if (accountId === customer.accountId) {
        return { order, calleeId: provider.accountId };
      }
      if (accountId === provider.accountId) {
        return { order, calleeId: customer.accountId };
      }
    }
    throw new NotFoundException('ORDER_NOT_FOUND');
  }

  /**
   * K10: đóng cuộc gọi nếu đã quá hạn (đang giữ khóa dòng). Trả true nếu VỪA đóng.
   * - Đọc trạng thái đơn mỗi lần kiểm (K14): đơn đã đóng → thời gian chờ thiếu người = 0 (L7, P11).
   * - DROPPED chỉ là ứng viên: hỏi lại GetStream — đủ 2 bên thì xóa mốc, không đóng; không hỏi
   *   được (hoặc đang nghỉ hỏi — P18) thì chưa đóng vì rớt nhưng vẫn đóng TIMEOUT/MISSED (K10b-1).
   * - L8 (P12): đơn đã đóng khi đang đổ chuông, chưa quá giờ chuông → CANCELLED, hệ thống đóng.
   *   (Đây là đường DUY NHẤT hàm này đóng với lý do CANCELLED.)
   */
  private async settleExpiry(
    manager: EntityManager,
    call: VideoCall,
    now: Date,
  ): Promise<boolean> {
    if (call.status === 'ENDED') {
      return false;
    }
    const order = await manager.findOne(ServiceOrder, {
      where: { id: call.orderId },
      select: { id: true, status: true },
    });
    const orderCallable = !!order && isCallable(order.status);

    let markCleared = false;
    let due = findDueExpiry(call, now, this.t, { orderCallable });
    if (due?.endReason === 'DROPPED') {
      const present = await this.tryListPresent(call.id);
      if (present === null || countPresentParties(call, present) >= 2) {
        if (present !== null) {
          call.shortHandedSince = null; // đủ 2 bên → như chưa từng thiếu (L3)
          markCleared = true;
        }
        due = findDueExpiry({ ...call, shortHandedSince: null }, now, this.t, {
          orderCallable,
        });
      }
    }

    if (due) {
      closeCall(call, due.endReason, due.endedAt, null);
    } else if (call.status === 'RINGING' && !orderCallable) {
      closeCall(call, 'CANCELLED', now, null);
    } else {
      if (markCleared) {
        await manager.save(call);
      }
      return false;
    }
    await manager.save(call);
    return true;
  }

  /**
   * K9/K10: hỏi GetStream ai đang có mặt. Lỗi → log + null ("không biết") và nghỉ hỏi cuộc gọi đó
   * 10 giây (P18, bộ nhớ trong tiến trình) để request trong lúc GetStream sập không phải chờ
   * hết timeout mỗi lần.
   */
  private async tryListPresent(callId: string): Promise<string[] | null> {
    const failedAt = this.presenceFailedAt.get(callId);
    if (
      failedAt !== undefined &&
      Date.now() - failedAt < PRESENCE_RETRY_AFTER_MS
    ) {
      return null;
    }
    try {
      const present = await this.stream.listPresentUserIds(callId);
      this.presenceFailedAt.delete(callId);
      return present;
    } catch (err) {
      this.logger.warn(
        `Không hỏi được GetStream ai đang trong cuộc gọi ${callId}: ${String(err)}`,
      );
      const now = Date.now();
      // Dọn mục đã hết thời gian nghỉ để Map không phình.
      for (const [id, at] of this.presenceFailedAt) {
        if (now - at >= PRESENCE_RETRY_AFTER_MS) {
          this.presenceFailedAt.delete(id);
        }
      }
      this.presenceFailedAt.set(callId, now);
      return null;
    }
  }

  // P13, P21: chạy SAU commit — kết thúc phía GetStream (đẩy mọi thiết bị ra) + báo cả hai bên.
  private async afterEnded(ended: readonly VideoCall[]): Promise<void> {
    for (const call of ended) {
      try {
        await this.stream.endCall(call.id);
      } catch (err) {
        this.logger.warn(
          `Không kết thúc được cuộc gọi ${call.id} trên GetStream: ${String(err)}`,
        );
      }
      this.gateway.emitToAccounts(
        [call.callerAccountId, call.calleeAccountId],
        'video_call.ended',
        {
          callId: call.id,
          endReason: call.endReason as VideoCallEndReason,
          endedAt: (call.endedAt as Date).toISOString(),
        },
      );
    }
  }

  // P20 (K3b): thời lượng tối đa phía GetStream = tối đa + đổ chuông + 60 giây.
  private streamMaxDurationSeconds(): number {
    return (
      this.t.maxDurationSeconds +
      this.t.ringSeconds +
      STREAM_DURATION_BUFFER_SECONDS
    );
  }

  private async loadNames(
    accountIds: readonly string[],
  ): Promise<Map<string, string>> {
    const rows = await this.accounts.find({
      where: { id: In([...new Set(accountIds)]) },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }

  // Cuộc gọi nhìn từ phía người hỏi (§5.2).
  private async toResponse(
    call: VideoCall,
    accountId: string,
  ): Promise<VideoCallResponseDto> {
    const names = await this.loadNames([
      call.callerAccountId,
      call.calleeAccountId,
    ]);
    return toVideoCallResponse(call, accountId, names, this.t);
  }

  // §5.2: cuộc gọi + thông tin vào GetStream cho đúng người, đúng cuộc gọi (K6, P20).
  private toSession(
    call: VideoCall,
    accountId: string,
    deviceSessionId: string,
    names: ReadonlyMap<string, string>,
  ): VideoCallSessionResponseDto {
    const ttl =
      this.t.ringSeconds +
      this.t.maxDurationSeconds +
      CALL_TOKEN_BUFFER_SECONDS;
    return {
      call: toVideoCallResponse(call, accountId, names, this.t),
      stream: {
        apiKey: this.stream.apiKey,
        callType: this.stream.callType,
        callId: call.id,
        token: this.stream.generateCallToken(accountId, call.id, ttl),
        userId: accountId,
      },
      deviceSessionId,
    };
  }
}

// ===================== helper thuần =====================

function isCallable(status: string): boolean {
  return (CALLABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

function involves(call: VideoCall, accountId: string): boolean {
  return (
    call.callerAccountId === accountId || call.calleeAccountId === accountId
  );
}

function closeCall(
  call: VideoCall,
  endReason: VideoCallEndReason,
  endedAt: Date,
  endedBy: string | null,
): void {
  call.status = 'ENDED';
  call.endReason = endReason;
  call.endedAt = endedAt;
  call.endedBy = endedBy;
}

// Khóa dòng cuộc gọi (FOR UPDATE). Không có, hoặc người hỏi không phải hai bên → cùng 404.
async function lockCallForParty(
  manager: EntityManager,
  callId: string,
  accountId: string,
): Promise<{ call: VideoCall; role: VideoCallRole }> {
  const call = await manager.findOne(VideoCall, {
    where: { id: callId },
    lock: { mode: 'pessimistic_write' },
  });
  const role = call ? roleOf(call, accountId) : null;
  if (!call || !role) {
    throw new NotFoundException('VIDEO_CALL_NOT_FOUND');
  }
  return { call, role };
}

/**
 * P14 (K12): khóa theo NGƯỜI trong transaction (tự nhả khi commit/rollback) — mọi thao tác tạo
 * cuộc gọi đụng cùng một người chạy tuần tự. Khóa theo id tăng dần → A gọi B và B gọi A cùng lúc
 * không deadlock.
 */
async function lockAccounts(
  manager: EntityManager,
  accountIds: readonly string[],
): Promise<void> {
  for (const id of [...new Set(accountIds)].sort()) {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended('video_call:account:' || $1::text, 0))`,
      [id],
    );
  }
}
