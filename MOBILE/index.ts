// Đảm bảo engine.io-client / socket.io-client nhận diện đúng môi trường React Native
if (typeof navigator !== 'undefined') {
  try {
    Object.defineProperty(navigator, 'product', {
      value: 'ReactNative',
      writable: true,
      configurable: true,
    });
  } catch {
    (navigator as any).product = 'ReactNative';
  }
}

// Bổ sung header Origin: http://localhost:8081 cho mọi kết nối WebSocket native trên Mobile
// để vượt qua CORS gateway của Backend mà không cần sửa code BE
const globalScope = typeof globalThis !== 'undefined' ? (globalThis as any) : {};
if (globalScope.WebSocket) {
  const OriginalWS = globalScope.WebSocket;
  globalScope.WebSocket = class PatchedWebSocket extends OriginalWS {
    constructor(url: any, protocols: any, options: any) {
      const opts = options || {};
      opts.headers = {
        ...(opts.headers || {}),
        origin: 'http://localhost:8081',
        Origin: 'http://localhost:8081',
      };
      super(url, protocols, opts);
    }
  };
}

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
