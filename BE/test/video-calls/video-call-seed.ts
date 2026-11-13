import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { io, type Socket } from 'socket.io-client';
import type { VideoCallsTestApp } from './video-calls-test-app';

const API = '/api/v1';
const PASSWORD = 'matkhau123';

export interface SeededUser {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  fullName: string;
  profileId: string; // customer_profiles.id hoặc provider_profiles.id
}

export interface SeededProvider extends SeededUser {
  packageId: string;
}

// Sự kiện socket nhận được (theo thứ tự) — test đọc/đợi trên mảng này.
export interface SocketProbe {
  socket: Socket;
  events: { event: string; payload: Record<string, unknown> }[];
  waitFor: (
    event: string,
    predicate?: (payload: Record<string, unknown>) => boolean,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown>>;
  close: () => void;
}

/**
 * Seed cho e2e video call (P23): tài khoản qua API đăng ký/đăng nhập thật; hồ sơ, gói, đơn bằng
 * SQL (phần ngoài phạm vi module — mẫu test/auth.e2e-spec.ts). Mỗi đơn 1 order_code khác nhau.
 */
export class VideoCallSeed {
  private seq = 0;
  private readonly sockets: Socket[] = [];

  constructor(private readonly ctx: VideoCallsTestApp) {}

  get http(): App {
    return this.ctx.app.getHttpServer() as App;
  }

  private async account(
    role: 'CUSTOMER' | 'PROVIDER',
    fullName: string,
  ): Promise<Omit<SeededUser, 'profileId'>> {
    const n = ++this.seq;
    const email = `vc${n}-${role.toLowerCase()}@example.com`;
    await request(this.http)
      .post(`${API}/auth/register`)
      .send({ email, password: PASSWORD, fullName, role })
      .expect(201);
    const res = await request(this.http)
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = res.body as {
      accessToken: string;
      refreshToken: string;
      account: { id: string };
    };
    return {
      accountId: body.account.id,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      email,
      fullName,
    };
  }

  async customer(fullName = 'Khách Hoa'): Promise<SeededUser> {
    const account = await this.account('CUSTOMER', fullName);
    const [{ id }] = (await this.ctx.dataSource.query(
      'INSERT INTO customer_profiles (account_id) VALUES ($1) RETURNING id',
      [account.accountId],
    )) as { id: string }[];
    return { ...account, profileId: id };
  }

  async provider(fullName = 'Vườn Lan'): Promise<SeededProvider> {
    const account = await this.account('PROVIDER', fullName);
    const [{ id }] = (await this.ctx.dataSource.query(
      `INSERT INTO provider_profiles (account_id, provider_type, display_name, verification_status)
       VALUES ($1, 'NURSERY', $2, 'APPROVED') RETURNING id`,
      [account.accountId, fullName],
    )) as { id: string }[];
    const [{ id: packageId }] = (await this.ctx.dataSource.query(
      `INSERT INTO service_packages
         (provider_id, name, duration_days, report_frequency_days, max_plants, base_price,
          is_active, approval_status)
       VALUES ($1, 'Gói thường', 30, 7, 5, 200000, true, 'APPROVED') RETURNING id`,
      [id],
    )) as { id: string }[];
    return { ...account, profileId: id, packageId };
  }

  async order(
    customer: SeededUser,
    provider: SeededProvider,
    status = 'IN_CARE',
  ): Promise<string> {
    const code = `LCVC${String(++this.seq).padStart(8, '0')}`;
    const [{ id }] = (await this.ctx.dataSource.query(
      `INSERT INTO service_orders
         (order_code, customer_id, provider_id, service_package_id, status, plant_count,
          base_price_snapshot, pickup_fee_snapshot, duration_days_snapshot,
          report_frequency_snapshot, provisional_total, scheduled_pickup_at,
          pickup_gps_lat, pickup_gps_lng)
       VALUES ($1, $2, $3, $4, $5, 1, 200000, 0, 30, 7, 200000, now() + interval '1 day',
               10.77, 106.70)
       RETURNING id`,
      [
        code,
        customer.profileId,
        provider.profileId,
        provider.packageId,
        status,
      ],
    )) as { id: string }[];
    return id;
  }

  // Một khách + một provider + một đơn (trạng thái tùy chọn).
  async pair(status = 'IN_CARE') {
    const customer = await this.customer();
    const provider = await this.provider();
    const orderId = await this.order(customer, provider, status);
    return { customer, provider, orderId };
  }

  private url(): string {
    const { port } = this.ctx.app.getHttpServer().address() as AddressInfo;
    return `http://127.0.0.1:${port}/ws`;
  }

  private open(
    accessToken: string | undefined,
    headers: Record<string, string>,
  ): Socket {
    const socket = io(this.url(), {
      auth: accessToken ? { token: accessToken } : {},
      extraHeaders: headers,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    this.sockets.push(socket);
    return socket;
  }

  // Mở socket /ws; resolve khi 'connect' (đã vào room), reject khi connect_error.
  async socket(
    accessToken: string,
    headers: Record<string, string> = {},
  ): Promise<SocketProbe> {
    const socket = this.open(accessToken, headers);
    const events: SocketProbe['events'] = [];
    socket.onAny((event: string, payload: Record<string, unknown>) => {
      events.push({ event, payload });
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err: Error) => reject(err));
    });
    const waitFor: SocketProbe['waitFor'] = (
      event,
      predicate = () => true,
      timeoutMs = 3000,
    ) =>
      new Promise((resolve, reject) => {
        const found = events.find(
          (e) => e.event === event && predicate(e.payload),
        );
        if (found) {
          resolve(found.payload);
          return;
        }
        const handler = (payload: Record<string, unknown>) => {
          if (predicate(payload)) {
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
          }
        };
        const timer = setTimeout(() => {
          socket.off(event, handler);
          reject(new Error(`Không nhận được ${event} trong ${timeoutMs}ms`));
        }, timeoutMs);
        socket.on(event, handler);
      });
    return { socket, events, waitFor, close: () => socket.close() };
  }

  // Thử mở socket, trả lỗi kết nối (ca bị từ chối); kết nối được → reject.
  socketError(
    accessToken?: string,
    headers: Record<string, string> = {},
  ): Promise<Error> {
    const socket = this.open(accessToken, headers);
    return new Promise<Error>((resolve, reject) => {
      socket.once('connect_error', (err: Error) => resolve(err));
      socket.once('connect', () =>
        reject(new Error('Socket lẽ ra phải bị từ chối nhưng đã kết nối')),
      );
    });
  }

  closeSockets(): void {
    for (const socket of this.sockets.splice(0)) {
      socket.close();
    }
  }
}
