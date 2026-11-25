import { Logger } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import {
  realtimeAccountRoom,
  RealtimeEmitter,
} from './realtime-emitter.service';

describe('RealtimeEmitter', () => {
  let emitter: RealtimeEmitter;

  beforeEach(() => {
    emitter = new RealtimeEmitter();
  });

  it('chưa gắn server → emitToAccount và emitToAccounts bỏ qua êm, không ném lỗi', () => {
    expect(() =>
      emitter.emitToAccount('acc-1', 'notification.new', { a: 1 }),
    ).not.toThrow();
    expect(() =>
      emitter.emitToAccounts(['acc-1', 'acc-2'], 'notification.new', { a: 1 }),
    ).not.toThrow();
  });

  it('danh sách accountIds rỗng → không gọi server.to', () => {
    const to = jest.fn();
    emitter.attachServer({ to } as unknown as Namespace);
    emitter.emitToAccounts([], 'notification.new', { a: 1 });
    expect(to).not.toHaveBeenCalled();
  });

  it('gửi tới đúng room account:<id> và khử trùng lặp accountIds', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    emitter.attachServer({ to } as unknown as Namespace);

    emitter.emitToAccounts(['acc-1', 'acc-2', 'acc-1'], 'notification.new', {
      unreadCount: 3,
    });

    expect(to).toHaveBeenCalledWith([
      realtimeAccountRoom('acc-1'),
      realtimeAccountRoom('acc-2'),
    ]);
    expect(emit).toHaveBeenCalledWith('notification.new', { unreadCount: 3 });
  });

  it('emitToAccount uỷ quyền qua đúng room account:<id>', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    emitter.attachServer({ to } as unknown as Namespace);

    emitter.emitToAccount('acc-9', 'notification.read', {
      notificationId: 'n1',
      unreadCount: 0,
    });

    expect(to).toHaveBeenCalledWith(['account:acc-9']);
    expect(emit).toHaveBeenCalledWith('notification.read', {
      notificationId: 'n1',
      unreadCount: 0,
    });
  });

  it('server.to ném lỗi → chỉ log warn và không ném ra ngoài', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    emitter.attachServer({
      to: () => {
        throw new Error('socket adapter down');
      },
    } as unknown as Namespace);

    expect(() =>
      emitter.emitToAccount('acc-1', 'notification.new', { id: 'n1' }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('socket adapter down'),
    );
    warn.mockRestore();
  });
});
