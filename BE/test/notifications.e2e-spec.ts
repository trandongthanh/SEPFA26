import type { AddressInfo } from 'net';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PasswordService } from '../src/crypto/password.service';
import { createAuthTestApp, type AuthTestApp } from './auth-test-app';

const API = '/api/v1';

interface SocketEvent {
  event: string;
  payload: Record<string, unknown>;
}

describe('Notifications (e2e)', () => {
  let ctx: AuthTestApp;
  let http: ReturnType<AuthTestApp['app']['getHttpServer']>;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createAuthTestApp();
    http = ctx.app.getHttpServer();
  });

  afterAll(async () => {
    for (const s of sockets) {
      s.disconnect();
    }
    sockets.length = 0;
    await ctx?.app.close();
  });

  beforeEach(async () => {
    for (const s of sockets) {
      s.disconnect();
    }
    sockets.length = 0;
    await ctx.reset();
  });

  async function seedUser(
    email: string,
    role: 'CUSTOMER' | 'PROVIDER' | 'ADMIN',
  ): Promise<{ accountId: string; accessToken: string }> {
    const passwords = ctx.app.get(PasswordService);
    const hash = await passwords.hash('Password123!');
    const rows = (await ctx.dataSource.query(
      `INSERT INTO accounts (email, password_hash, full_name, role, status, email_verified_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', now())
       RETURNING id`,
      [email, hash, `User ${role}`, role],
    )) as { id: string }[];
    const loginRes = await request(http)
      .post(`${API}/auth/login`)
      .send({ email, password: 'Password123!' })
      .expect(200);
    const body = loginRes.body as { accessToken: string };
    return { accountId: rows[0].id, accessToken: body.accessToken };
  }

  async function connectSocket(accessToken: string): Promise<{
    socket: Socket;
    events: SocketEvent[];
    waitFor: (
      event: string,
      predicate?: (payload: Record<string, unknown>) => boolean,
    ) => Promise<Record<string, unknown>>;
  }> {
    const { port } = http.address() as AddressInfo;
    const socket = io(`http://127.0.0.1:${port}/ws`, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    const events: SocketEvent[] = [];
    socket.onAny((event: string, payload: Record<string, unknown>) => {
      events.push({ event, payload });
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (err: Error) => reject(err));
    });
    const waitFor = (
      event: string,
      predicate: (payload: Record<string, unknown>) => boolean = () => true,
    ) => {
      const existing = events.find(
        (e) => e.event === event && predicate(e.payload),
      );
      if (existing) {
        return Promise.resolve(existing.payload);
      }
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timeout waiting for socket event ${event}`)),
          3000,
        );
        const listener = (ev: string, payload: Record<string, unknown>) => {
          if (ev === event && predicate(payload)) {
            clearTimeout(timer);
            socket.offAny(listener);
            resolve(payload);
          }
        };
        socket.onAny(listener);
      });
    };
    return { socket, events, waitFor };
  }

  it('user inbox CRUD + anti-IDOR + socket notification.new & notification.read', async () => {
    const customer = await seedUser('cus@lancare.vn', 'CUSTOMER');
    const other = await seedUser('other@lancare.vn', 'CUSTOMER');
    const socketProbe = await connectSocket(customer.accessToken);
    const notifications = ctx.app.get(NotificationsService);

    const created = await notifications.createAndEmit({
      accountId: customer.accountId,
      type: 'ORDER_ACCEPTED',
      title: 'Đơn đã được chấp nhận',
      body: 'Nhà vườn đã chấp nhận đơn của bạn.',
      refEntity: 'ORDER',
    });

    const newSocketPayload = await socketProbe.waitFor('notification.new');
    expect(newSocketPayload).toMatchObject({
      unreadCount: 1,
      notification: expect.objectContaining({
        id: created.id,
        type: 'ORDER_ACCEPTED',
      }),
    });

    // Unread count
    await request(http)
      .get(`${API}/notifications/unread-count`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect({ unreadCount: 1 });

    // List filter isRead=false
    const listRes = await request(http)
      .get(`${API}/notifications?isRead=false`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200);
    expect(listRes.body).toMatchObject({
      total: 1,
      unreadCount: 1,
    });

    // Anti-IDOR: người khác đọc / sửa / xoá thông báo của customer → 404
    await request(http)
      .get(`${API}/notifications/${created.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    await request(http)
      .patch(`${API}/notifications/${created.id}/read`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    await request(http)
      .delete(`${API}/notifications/${created.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    // Đánh dấu đã đọc → 200 + phát notification.read
    await request(http)
      .patch(`${API}/notifications/${created.id}/read`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          id: created.id,
          isRead: true,
          unreadCount: 0,
        });
      });

    const readPayload = await socketProbe.waitFor('notification.read');
    expect(readPayload).toEqual({
      notificationId: created.id,
      unreadCount: 0,
    });

    // Xoá tất cả đã đọc
    await request(http)
      .delete(`${API}/notifications/read`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect({ deletedCount: 1 });
  });

  it('admin broadcast: non-admin nhận 403, admin gửi tới đúng target', async () => {
    const customer = await seedUser('cus2@lancare.vn', 'CUSTOMER');
    const provider = await seedUser('prov2@lancare.vn', 'PROVIDER');
    const admin = await seedUser('admin2@lancare.vn', 'ADMIN');

    await request(http)
      .post(`${API}/admin/notifications/broadcast`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .send({
        title: 'Hack',
        body: 'Should fail',
        target: 'ALL',
      })
      .expect(403);

    await request(http)
      .post(`${API}/admin/notifications/broadcast`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        title: 'Bảo trì hệ thống',
        body: 'Hệ thống bảo trì lúc 02:00.',
        target: 'PROVIDER',
      })
      .expect(201)
      .expect({ sentCount: 1 });

    await request(http)
      .get(`${API}/notifications/unread-count`)
      .set('Authorization', `Bearer ${provider.accessToken}`)
      .expect(200)
      .expect({ unreadCount: 1 });

    await request(http)
      .get(`${API}/notifications/unread-count`)
      .set('Authorization', `Bearer ${customer.accessToken}`)
      .expect(200)
      .expect({ unreadCount: 0 });
  });
});
