import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import { Vibration, AppState } from 'react-native';
import { socketService } from '../services/socketService';
import {
  videoCallService,
  VideoCallRingingPayload,
  VideoCallSessionResponseDto,
} from '../services/videoCallService';
import { storage, onTokenChange } from '../utils/storage';

interface CallContextType {
  incomingCall: VideoCallRingingPayload | null;
  acceptCall: () => Promise<VideoCallSessionResponseDto | null>;
  declineCall: () => Promise<void>;
  dismissCall: () => void;
  refreshSocket: () => Promise<void>;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [incomingCall, setIncomingCall] = useState<VideoCallRingingPayload | null>(null);
  const incomingCallRef = useRef<VideoCallRingingPayload | null>(null);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  const startAlert = () => {
    try {
      // Rung nhịp điệu chuông điện thoại
      Vibration.vibrate([0, 600, 1000, 600], true);
    } catch (e) {
      // Ignored
    }
  };

  const stopAlert = () => {
    try {
      Vibration.cancel();
    } catch (e) {
      // Ignored
    }
  };

  const dismissCall = useCallback(() => {
    stopAlert();
    setIncomingCall(null);
  }, []);

  const refreshSocket = useCallback(async () => {
    const token = await storage.getToken();
    if (token) {
      socketService.connect(token);
    } else {
      socketService.disconnect();
    }
  }, []);

  useEffect(() => {
    refreshSocket();

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshSocket();
      }
    });

    // 1. Nhận cuộc gọi đến (đổ chuông)
    const unsubRinging = socketService.onRinging((data) => {
      setIncomingCall(data);
      startAlert();
    });

    // 2. Cuộc gọi đã được nghe trên máy khác -> tắt chuông
    const unsubAccepted = socketService.onAccepted((data) => {
      if (incomingCallRef.current?.callId === data.callId) {
        dismissCall();
      }
    });

    // 3. Cuộc gọi đã kết thúc (hủy, từ chối, timeout) -> tắt chuông
    const unsubEnded = socketService.onEnded((data) => {
      if (incomingCallRef.current?.callId === data.callId) {
        dismissCall();
      }
    });

    const unsubToken = onTokenChange((token) => {
      if (token) {
        socketService.connect(token);
      } else {
        socketService.disconnect();
      }
    });

    return () => {
      unsubToken();
      appStateSub.remove();
      unsubRinging();
      unsubAccepted();
      unsubEnded();
      stopAlert();
    };
  }, [dismissCall, refreshSocket]);

  const acceptCall = async (): Promise<VideoCallSessionResponseDto | null> => {
    if (!incomingCall) return null;
    const callId = incomingCall.callId;
    dismissCall();
    try {
      const session = await videoCallService.joinCall(callId);
      return session;
    } catch (err) {
      console.error('[CallContext] acceptCall failed:', err);
      throw err;
    }
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    const callId = incomingCall.callId;
    dismissCall();
    try {
      await videoCallService.declineCall(callId);
    } catch (err) {
      console.warn('[CallContext] declineCall failed:', err);
    }
  };

  return (
    <CallContext.Provider
      value={{
        incomingCall,
        acceptCall,
        declineCall,
        dismissCall,
        refreshSocket,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};

export const useCall = (): CallContextType => {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
