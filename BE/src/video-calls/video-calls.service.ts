import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StreamClient } from '@stream-io/node-sdk';
import { randomUUID } from 'node:crypto';

import { VideoCall } from './entities/video-call.entity';
import { VideoCallEvent } from './entities/video-call-event.entity';
import { CreateCallDto } from './dto/create-call.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { CreateCallResponseDto } from './dto/create-call-response.dto';
import { CallInfoResponseDto } from './dto/call-info-response.dto';
import { JoinCallResponseDto } from './dto/join-call-response.dto';
import { VideoCallsGateway } from './video-calls.gateway';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { ServiceOrder } from '../orders/entities/service-order.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { Account } from '../accounts/entities/account.entity';

/** Default token validity, in seconds. */
const TOKEN_VALIDITY_IN_SECONDS = 60 * 60;
const CALL_ELIGIBLE_ORDER_STATUSES = new Set([
  'AGREEMENT_PENDING',
  'AWAITING_PAYMENT',
  'PAID',
  'HANDOVER_IN_PROGRESS',
  'HANDOVER_AWAITING_CONFIRM',
  'IN_CARE',
]);

@Injectable()
export class VideoCallsService {
  private readonly streamClient: StreamClient;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(VideoCall)
    private readonly videoCallRepo: Repository<VideoCall>,
    @InjectRepository(VideoCallEvent)
    private readonly videoCallEventRepo: Repository<VideoCallEvent>,
    @InjectRepository(ProviderProfile)
    private readonly providerProfileRepo: Repository<ProviderProfile>,
    @InjectRepository(ServiceOrder)
    private readonly orderRepo: Repository<ServiceOrder>,
    @InjectRepository(CustomerProfile)
    private readonly customerProfileRepo: Repository<CustomerProfile>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly gateway: VideoCallsGateway,
  ) {
    const apiKey = this.configService.getOrThrow<string>('STREAM_API_KEY');
    const apiSecret =
      this.configService.getOrThrow<string>('STREAM_API_SECRET');
    this.streamClient = new StreamClient(apiKey, apiSecret);
  }

  /**
   * Generates a GetStream user token for the currently authenticated account.
   * The accountId doubles as the GetStream user id, so it must exist on
   * GetStream's side before the token can be used by the client SDK.
   */
  async generateToken(accountId: string): Promise<TokenResponseDto> {
    await this.ensureStreamUser(accountId);

    const token = this.streamClient.generateUserToken({
      user_id: accountId,
      validity_in_seconds: TOKEN_VALIDITY_IN_SECONDS,
    });

    return { token };
  }

  /**
   * Creates a new GetStream call and persists a local record for
   * ownership/audit purposes.
   */
  async createCall(
    accountId: string,
    dto: CreateCallDto,
  ): Promise<CreateCallResponseDto> {
    const order = await this.orderRepo.findOne({ where: { id: dto.orderId } });
    if (!order || !CALL_ELIGIBLE_ORDER_STATUSES.has(order.status)) {
      throw new NotFoundException('ORDER_NOT_AVAILABLE_FOR_CALL');
    }
    const provider = await this.providerProfileRepo.findOne({
      where: { id: order.providerId },
    });
    if (provider?.accountId !== accountId) {
      throw new ForbiddenException('ONLY_PROVIDER_CAN_CREATE_CALL');
    }
    const existing = await this.videoCallRepo.findOne({
      where: { serviceOrderId: order.id, status: 'OPEN' },
      order: { createdAt: 'DESC' },
    });
    if (existing) throw new ForbiddenException('CALL_ALREADY_OPEN');

    await this.ensureStreamUser(accountId);
    const customer = await this.customerProfileRepo.findOne({
      where: { id: order.customerId },
    });

    const callType = dto.type ?? 'default';
    // Keep the id below GetStream's call-id length limit while retaining a
    // deterministic link to the order and a unique suffix for later sessions.
    const orderKey = order.id.replace(/-/g, '');
    const sessionKey = randomUUID().replace(/-/g, '').slice(0, 12);
    const callId = `order_${orderKey}_${sessionKey}`;

    try {
      const call = this.streamClient.video.call(callType, callId);
      await call.getOrCreate({
        data: {
          created_by_id: accountId,
          members: [{ user_id: accountId, role: 'admin' }],
          settings_override: {
            video: { enabled: true, access_request_enabled: false },
          },
        },
      });
    } catch {
      throw new InternalServerErrorException(
        'Failed to create the video call.',
      );
    }

    const videoCall = this.videoCallRepo.create({
      callId,
      callType,
      createdById: accountId,
      providerId: provider.accountId,
      serviceOrderId: order.id,
      status: 'OPEN',
      providerJoinedAt: null,
      customerJoinedAt: null,
      providerLeftAt: null,
      customerLeftAt: null,
      endedAt: null,
    });
    const saved = await this.videoCallRepo.save(videoCall);
    // Notify the customer. The target is derived from the order, never supplied by the client.
    if (customer?.accountId) {
      try {
        await this.videoCallEventRepo.save(
          this.videoCallEventRepo.create({
            // video_call_events.video_call_id là FK tới video_calls.id (UUID nội bộ),
            // không phải callId của Stream.
            videoCallId: saved.id,
            eventType: 'call.created',
            payload: { orderId: order.id, customerId: customer.accountId },
            originAccountId: accountId,
          }),
        );
        this.gateway.notifyAccount(customer.accountId, {
          eventType: 'call.created',
          callId,
          callType,
          orderId: order.id,
          createdBy: accountId,
        });
      } catch {
        // Non-fatal: log or ignore
      }
    }

    return {
      callId,
      joinUrl: this.buildJoinUrl(callType, callId),
      createdBy: accountId,
      callType,
    };
  }

  async getCurrentOrderCall(orderId: string, accountId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    const parties = await this.getOrderParties(order);
    this.assertParty(parties, accountId);
    const call = await this.videoCallRepo.findOne({
      where: { serviceOrderId: orderId, status: 'OPEN' },
      order: { createdAt: 'DESC' },
    });
    return {
      call: call
        ? { callId: call.callId, callType: call.callType, status: call.status }
        : null,
      canCreate:
        parties.providerAccountId === accountId &&
        CALL_ELIGIBLE_ORDER_STATUSES.has(order.status),
    };
  }

  /**
   * Returns call metadata (creator, members) by combining the local record
   * with live state from GetStream.
   */
  async getCallInfo(
    callId: string,
    accountId: string,
  ): Promise<CallInfoResponseDto> {
    const videoCall = await this.findLocalCallOrThrow(callId);
    await this.assertOrderParty(videoCall, accountId);
    if (videoCall.status !== 'OPEN') throw new ForbiddenException('CALL_CLOSED');

    let members: CallInfoResponseDto['members'] = [];
    try {
      const call = this.streamClient.video.call(videoCall.callType, callId);
      const response = await call.get();
      members = Object.values(response.members ?? {}).map((member) => ({
        userId: member.user_id,
        role: member.role,
      }));
    } catch {
      throw new NotFoundException(`Call ${callId} was not found on GetStream.`);
    }

    let providerName: string | null = null;
    if (videoCall.providerId) {
      const providerProfile = await this.providerProfileRepo.findOne({
        where: { accountId: videoCall.providerId },
      });
      if (providerProfile) {
        providerName = providerProfile.displayName;
      }
    }

    return {
      callId,
      createdBy: videoCall.createdById,
      providerId: videoCall.providerId,
      providerName,
      orderId: videoCall.serviceOrderId,
      members,
    };
  }

  /**
   * Adds the current account as a member (if not already one) and returns a
   * GetStream token scoped for joining the call.
   */
  async joinCall(
    callId: string,
    accountId: string,
  ): Promise<JoinCallResponseDto> {
    const videoCall = await this.findLocalCallOrThrow(callId);
    await this.assertOrderParty(videoCall, accountId);
    await this.ensureStreamUser(accountId);

    try {
      const call = this.streamClient.video.call(videoCall.callType, callId);
      await call.update({
        settings_override: {
          video: { enabled: true, access_request_enabled: false },
        },
      });
      await call.updateCallMembers({
        // Customer needs the same media capability as Provider for this call.
        // This is scoped to the existing room; creation remains backend-only.
        update_members: [{ user_id: accountId, role: 'admin' }],
      });
    } catch {
      throw new ForbiddenException('Unable to join this call.');
    }

    await this.recordParticipation(videoCall, accountId, 'joined');

    const token = this.streamClient.generateUserToken({
      user_id: accountId,
      validity_in_seconds: TOKEN_VALIDITY_IN_SECONDS,
    });

    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      select: { fullName: true },
    });
    return {
      callId,
      token,
      userId: accountId,
      userName: account?.fullName || 'Người dùng LanCare',
    };
  }

  async leaveCall(callId: string, accountId: string) {
    const videoCall = await this.findLocalCallOrThrow(callId);
    const parties = await this.assertOrderParty(videoCall, accountId);
    if (videoCall.status === 'CLOSED') return { status: 'CLOSED' };

    const now = new Date();
    if (parties.providerAccountId === accountId) videoCall.providerLeftAt = now;
    if (parties.customerAccountId === accountId) videoCall.customerLeftAt = now;
    if (
      videoCall.providerJoinedAt &&
      videoCall.customerJoinedAt &&
      videoCall.providerLeftAt &&
      videoCall.customerLeftAt
    ) {
      videoCall.status = 'CLOSED';
      videoCall.endedAt = now;
    }
    await this.videoCallRepo.save(videoCall);
    await this.videoCallEventRepo.save(this.videoCallEventRepo.create({
      videoCallId: videoCall.id,
      eventType: 'participant.left',
      payload: { status: videoCall.status },
      originAccountId: accountId,
    }));
    return { status: videoCall.status };
  }

  private async findLocalCallOrThrow(callId: string): Promise<VideoCall> {
    const videoCall = await this.videoCallRepo.findOne({ where: { callId } });
    if (!videoCall) {
      throw new NotFoundException(`Call ${callId} was not found.`);
    }
    return videoCall;
  }

  private async assertOrderParty(videoCall: VideoCall, accountId: string) {
    if (!videoCall.serviceOrderId)
      throw new ForbiddenException('ORDER_PARTY_REQUIRED');
    const order = await this.orderRepo.findOne({
      where: { id: videoCall.serviceOrderId },
    });
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    const parties = await this.getOrderParties(order);
    this.assertParty(parties, accountId);
    return parties;
  }

  private async getOrderParties(order: ServiceOrder) {
    const [customer, provider] = await Promise.all([
      this.customerProfileRepo.findOne({ where: { id: order.customerId } }),
      this.providerProfileRepo.findOne({ where: { id: order.providerId } }),
    ]);
    return {
      customerAccountId: customer?.accountId,
      providerAccountId: provider?.accountId,
    };
  }

  private assertParty(
    parties: { customerAccountId?: string; providerAccountId?: string },
    accountId: string,
  ) {
    if (
      parties.customerAccountId !== accountId &&
      parties.providerAccountId !== accountId
    ) throw new ForbiddenException('ORDER_PARTY_REQUIRED');
  }

  private async recordParticipation(
    videoCall: VideoCall,
    accountId: string,
    eventType: 'joined' | 'left',
  ) {
    const parties = await this.assertOrderParty(videoCall, accountId);
    const now = new Date();
    if (eventType === 'joined') {
      if (parties.providerAccountId === accountId) {
        videoCall.providerJoinedAt = now;
        videoCall.providerLeftAt = null;
      }
      if (parties.customerAccountId === accountId) {
        videoCall.customerJoinedAt = now;
        videoCall.customerLeftAt = null;
      }
    }
    await this.videoCallRepo.save(videoCall);
    await this.videoCallEventRepo.save(this.videoCallEventRepo.create({
      videoCallId: videoCall.id,
      eventType: `participant.${eventType}`,
      originAccountId: accountId,
    }));
  }

  /**
   * GetStream requires a user to exist before it can be referenced as a call
   * member or used to mint a token. accountId is reused as the GetStream
   * user id, so this is idempotent and safe to call on every request.
   */
  private async ensureStreamUser(accountId: string): Promise<void> {
    try {
      const account = await this.accountRepo.findOne({
        where: { id: accountId },
        select: { id: true, fullName: true },
      });
      await this.streamClient.upsertUsers([
        {
          id: accountId,
          name: account?.fullName || 'Người dùng LanCare',
          role: 'user',
        },
      ]);
    } catch {
      throw new InternalServerErrorException(
        'Failed to register the account with GetStream.',
      );
    }
  }

  private buildJoinUrl(callType: string, callId: string): string {
    const appBaseUrl = this.configService.get<string>('APP_BASE_URL');
    if (appBaseUrl) {
      return `${appBaseUrl.replace(/\/$/, '')}/calls/${callType}/${callId}`;
    }
    return `${callType}:${callId}`;
  }
}
