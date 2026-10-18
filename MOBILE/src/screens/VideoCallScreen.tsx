import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { FE_WEB_URL } from '../config/api';
import {
  videoCallService,
  VideoCallSessionResponseDto,
} from '../services/videoCallService';
import { socketService } from '../services/socketService';
import { storage } from '../utils/storage';

interface VideoCallScreenProps {
  navigation: any;
  route: {
    params: {
      callId: string;
      session?: VideoCallSessionResponseDto;
      orderId?: string;
    };
  };
}

export const VideoCallScreen: React.FC<VideoCallScreenProps> = ({
  navigation,
  route,
}) => {
  const { callId, orderId } = route.params;
  const [session, setSession] = useState<VideoCallSessionResponseDto | null>(
    route.params.session || null
  );
  const [loading, setLoading] = useState<boolean>(!route.params.session);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Call duration counter
  const [durationSeconds, setDurationSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const webViewRef = useRef<WebView>(null);

  // 1. Fetch / Join call session if not passed in params & load auth state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  const initSession = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [u, rt, t] = await Promise.all([
        storage.getUser(),
        storage.getRefreshToken(),
        storage.getToken(),
      ]);
      if (u) setCurrentUser(u);
      if (rt) setRefreshToken(rt);
      if (t) setAuthToken(t);

      if (Platform.OS === 'android') {
        try {
          const res = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.CAMERA,
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ]);
          console.log('[VideoCallScreen] Permissions result:', res);
          const camGranted =
            res[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED;
          const micGranted =
            res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;

          if (!camGranted || !micGranted) {
            Alert.alert(
              'Yêu cầu quyền Camera & Micro',
              'Để đối phương nhìn và nghe thấy bạn, vui lòng vào Cài đặt -> Ứng dụng -> Expo Go -> Quyền ứng dụng và BẬT quyền Camera & Micro.',
              [{ text: 'Đã hiểu' }]
            );
          }
        } catch (permErr) {
          console.warn('[VideoCallScreen] Request permissions error:', permErr);
        }
      }

      if (!session) {
        const data = await videoCallService.joinCall(callId);
        setSession(data);
      }
    } catch (err: any) {
      console.error('[VideoCallScreen] Init session error:', err);
      const msg =
        err?.response?.data?.message || err?.message || 'Không thể tham gia cuộc gọi.';
      setErrorMsg(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  }, [callId, session]);

  useEffect(() => {
    initSession();
  }, [initSession]);

  // 2. Call Duration Timer
  useEffect(() => {
    if (loading || errorMsg) return;
    const interval = setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [loading, errorMsg]);

  // 3. Socket event listeners for this call (ended, moved)
  useEffect(() => {
    const unsubEnded = socketService.onEnded((data) => {
      if (data.callId === callId) {
        Alert.alert('Cuộc gọi kết thúc', 'Bên đối phương đã kết thúc cuộc gọi.', [
          { text: 'Đóng', onPress: () => navigation.goBack() },
        ]);
      }
    });

    const unsubMoved = socketService.onMoved((data) => {
      if (data.callId === callId) {
        Alert.alert('Chuyển thiết bị', 'Cuộc gọi đã được chuyển sang thiết bị khác của bạn.', [
          { text: 'Đóng', onPress: () => navigation.goBack() },
        ]);
      }
    });

    return () => {
      unsubEnded();
      unsubMoved();
    };
  }, [callId, navigation]);

  // 4. Handle End Call
  const handleEndCall = async () => {
    try {
      webViewRef.current?.injectJavaScript(`
        if (typeof window !== 'undefined' && window.lancareEndCall) {
          window.lancareEndCall();
        }
        true;
      `);
      await videoCallService.endCall(callId);
    } catch (e) {
      console.warn('End call error:', e);
    } finally {
      navigation.goBack();
    }
  };

  const formatDuration = (totalSec: number) => {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // 5. Injected JS to authenticate and pass session into WebView
  const getInjectedJavaScript = () => {
    if (!session) return '';
    const sessionStr = JSON.stringify(session);
    const authState = {
      state: {
        user: currentUser || {
          id: session.call.myRole === 'CALLER' ? session.call.caller.accountId : session.call.callee.accountId,
          fullName: session.call.myRole === 'CALLER' ? session.call.caller.fullName : session.call.callee.fullName,
          role: 'CUSTOMER',
        },
        refreshToken: refreshToken || null,
        isAuthenticated: true,
      },
      version: 0,
    };
    return `
      (function() {
        try {
          window.sessionStorage.setItem('lancare_call_session_${callId}', ${JSON.stringify(sessionStr)});
          window.sessionStorage.setItem('lancare_call_started_${callId}', '${Date.now()}');
          window.localStorage.setItem('lancare-auth', ${JSON.stringify(JSON.stringify(authState))});
          
          // Giúp Stream Video UI tự tối ưu cho màn hình Mobile trong WebView
          var style = document.createElement('style');
          style.innerHTML = 'body { overflow: hidden !important; }';
          document.head.appendChild(style);

          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            try {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'NO_MEDIA_DEVICES',
                isSecureContext: window.isSecureContext,
                origin: window.location.origin
              }));
            } catch(e) {}
          }
        } catch (e) {
          console.error('Injected script error', e);
        }
      })();
      true;
    `;
  };

  const partnerName =
    session?.call?.myRole === 'CALLER'
      ? session.call.callee.fullName
      : session?.call?.caller.fullName || 'Đối phương';

  const callType = session?.stream?.callType || 'default';
  const sessionHash = session ? encodeURIComponent(JSON.stringify(session)) : '';
  const tokenQuery = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
  const webCallUrl = `${FE_WEB_URL}/calls/${callType}/${callId}?isMobile=true${tokenQuery}${sessionHash ? `#session=${sessionHash}` : ''}`;

  if (loading) {
    return (
      <SafeAreaView style={styles.darkContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0914" />
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingTitle}>Đang kết nối phòng gọi video...</Text>
          <Text style={styles.loadingSub}>Vui lòng chờ trong giây lát</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMsg) {
    return (
      <SafeAreaView style={styles.darkContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#0B0914" />
        <View style={styles.centerBox}>
          <Ionicons name="alert-circle-outline" size={56} color="#EF4444" />
          <Text style={styles.errorTitle}>Không thể tham gia cuộc gọi</Text>
          <Text style={styles.errorSub}>{errorMsg}</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnText}>Quay lại</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.darkContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0914" />

      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <View style={styles.topInfo}>
          <Text style={styles.partnerText} numberOfLines={1}>
            {partnerName}
          </Text>
          <View style={styles.badgeRow}>
            <View style={styles.liveIndicator} />
            <Text style={styles.timerText}>{formatDuration(durationSeconds)}</Text>
            {orderId && (
              <Text style={styles.orderTag}>• Đơn #{orderId.slice(0, 8).toUpperCase()}</Text>
            )}
          </View>
        </View>

        <TouchableOpacity style={styles.topLeaveBtn} onPress={handleEndCall}>
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Main Video Stream Container via WebView */}
      <View style={styles.videoContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: webCallUrl }}
          injectedJavaScriptBeforeContentLoaded={getInjectedJavaScript()}
          onLoadEnd={() => {
            webViewRef.current?.injectJavaScript(getInjectedJavaScript());
            if (session) {
              const postMsg = `
                try {
                  window.postMessage({ type: 'LANCARE_CALL_SESSION', session: ${JSON.stringify(session)} }, '*');
                } catch(e) {}
                true;
              `;
              webViewRef.current?.injectJavaScript(postMsg);
            }
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          originWhitelist={['*']}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              console.log('[WebView Msg]', data);
              if (data.type === 'LOCAL_MEDIA_STATE') {
                setIsVideoOff(!data.isCamOn);
                setIsMuted(!data.isMicOn);
              } else if (data.type === 'NO_MEDIA_DEVICES') {
                Alert.alert(
                  'Thiết bị chặn Camera/Micro trên WebView',
                  `Trình duyệt WebView không cấp quyền getUserMedia cho địa chỉ ${data.origin || ''} (isSecureContext: ${data.isSecureContext}).`
                );
              } else if (data.type === 'INIT_MEDIA_ERROR' || data.type === 'TOGGLE_ERROR') {
                const dev = data.device === 'camera' ? 'Camera' : 'Micro';
                Alert.alert(
                  `Không thể bật ${dev}`,
                  `Lỗi: ${data.name || ''} - ${data.message || ''}\n\nVui lòng vào Cài đặt -> Ứng dụng -> Expo Go -> Quyền ứng dụng và đảm bảo Camera/Micro đã được cho phép.`
                );
              }
            } catch {
              console.log('[WebView Msg]', event.nativeEvent.data);
            }
          }}
          style={styles.webView}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.webViewLoading}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={styles.loadingSub}>Đang đồng bộ luồng video...</Text>
            </View>
          )}
        />
      </View>

      {/* Bottom Floating Control Actions */}
      <View style={styles.bottomBar}>
        {/* Toggle Mic */}
        <TouchableOpacity
          style={[styles.controlBtn, isMuted && styles.controlBtnInactive]}
          onPress={() => {
            webViewRef.current?.injectJavaScript(`
              (function() {
                if (window.lancareToggleMic) {
                  window.lancareToggleMic();
                } else if (window.lancareEnableMedia) {
                  window.lancareEnableMedia();
                }
              })();
              true;
            `);
          }}
        >
          <Ionicons
            name={isMuted ? 'mic-off' : 'mic'}
            size={22}
            color={isMuted ? '#EF4444' : '#FFFFFF'}
          />
        </TouchableOpacity>

        {/* End Call Button */}
        <TouchableOpacity style={styles.endCallBtn} onPress={handleEndCall}>
          <Ionicons name="call" size={28} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>

        {/* Toggle Camera */}
        <TouchableOpacity
          style={[styles.controlBtn, isVideoOff && styles.controlBtnInactive]}
          onPress={() => {
            webViewRef.current?.injectJavaScript(`
              (function() {
                if (window.lancareToggleCam) {
                  window.lancareToggleCam();
                } else if (window.lancareEnableMedia) {
                  window.lancareEnableMedia();
                }
              })();
              true;
            `);
          }}
        >
          <Ionicons
            name={isVideoOff ? 'videocam-off' : 'videocam'}
            size={22}
            color={isVideoOff ? '#EF4444' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  darkContainer: {
    flex: 1,
    backgroundColor: '#0B0914',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingTitle: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadingSub: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  errorTitle: {
    marginTop: 14,
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  errorSub: {
    marginTop: 8,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    marginBottom: 20,
  },
  backBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  backBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#120F20',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  topInfo: {
    flex: 1,
  },
  partnerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 3,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  timerText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#10B981',
  },
  orderTag: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  topLeaveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#05050A',
  },
  webView: {
    flex: 1,
    backgroundColor: '#05050A',
  },
  webViewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0B0914',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingVertical: 14,
    paddingBottom: Platform.OS === 'ios' ? 8 : 14,
    backgroundColor: '#120F20',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlBtnInactive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  endCallBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
});
