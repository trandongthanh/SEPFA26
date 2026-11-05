import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import {
  GoogleSignin,
  statusCodes,
  isNativeGoogleSigninAvailable,
} from '../utils/googleAuth';
import { loginWithGoogle, GoogleAuthNotRegisteredError } from '../services/authService';
import { storage } from '../utils/storage';

WebBrowser.maybeCompleteAuthSession();

const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
  '355803384691-v7qukd44lesps02dbpv7s4tostiidhdv.apps.googleusercontent.com';

try {
  if (GoogleSignin) {
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      offlineAccess: false,
    });
  }
} catch (_) {
  // Không có native module trong Expo Go
}

interface GoogleSignInButtonProps {
  mode: 'login' | 'register';
  navigation?: any;
  onSuccess?: () => void;
  style?: any;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  mode,
  navigation,
  onSuccess,
  style,
}) => {
  const [loading, setLoading] = useState(false);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: WEB_CLIENT_ID,
    webClientId: WEB_CLIENT_ID,
  });

  const handleIdToken = async (idToken: string) => {
    try {
      setLoading(true);

      if (mode === 'register') {
        // Đăng ký trực tiếp vai trò Khách hàng (CUSTOMER)
        const data = await loginWithGoogle(idToken, 'CUSTOMER');
        await storage.setToken(data.accessToken, data.refreshToken);
        await storage.setUser(data.account);

        Alert.alert(
          'Đăng ký thành công',
          'Chào mừng bạn đến với LanCare Hub! Mật khẩu dự phòng đã được gửi đến email của bạn.',
          [
            {
              text: 'Bắt đầu ngay',
              onPress: () => {
                onSuccess?.();
                navigation?.reset({
                  index: 0,
                  routes: [{ name: 'MainTabs' }],
                });
              },
            },
          ]
        );
        return;
      }

      // Mode: Login
      try {
        const data = await loginWithGoogle(idToken);
        await storage.setToken(data.accessToken, data.refreshToken);
        await storage.setUser(data.account);

        onSuccess?.();
        navigation?.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
      } catch (err: any) {
        if (err?.code === 'GOOGLE_ACCOUNT_NOT_REGISTERED') {
          const regErr = err as GoogleAuthNotRegisteredError;
          Alert.alert(
            'Tài khoản chưa đăng ký',
            `Email ${regErr.email || ''} chưa có trong hệ thống LanCare Hub. Bạn có muốn tạo tài khoản Khách hàng mới không?`,
            [
              { text: 'Hủy', style: 'cancel' },
              {
                text: 'Đăng ký ngay',
                onPress: async () => {
                  try {
                    setLoading(true);
                    const regData = await loginWithGoogle(idToken, 'CUSTOMER');
                    await storage.setToken(regData.accessToken, regData.refreshToken);
                    await storage.setUser(regData.account);

                    Alert.alert(
                      'Đăng ký thành công',
                      'Tài khoản Khách hàng của bạn đã được khởi tạo thành công!',
                      [
                        {
                          text: 'Tiếp tục',
                          onPress: () => {
                            onSuccess?.();
                            navigation?.reset({
                              index: 0,
                              routes: [{ name: 'MainTabs' }],
                            });
                          },
                        },
                      ]
                    );
                  } catch (e: any) {
                    Alert.alert('Đăng ký thất bại', e.message || 'Có lỗi xảy ra.');
                  } finally {
                    setLoading(false);
                  }
                },
              },
            ]
          );
          return;
        }

        throw err;
      }
    } catch (err: any) {
      Alert.alert('Đăng nhập Google thất bại', err.message || 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (response?.type === 'success') {
      const idToken =
        response.params?.id_token || (response as any)?.authentication?.idToken;

      if (idToken) {
        handleIdToken(idToken);
      } else {
        Alert.alert('Lỗi xác thực', 'Không tìm thấy Google ID token trong phản hồi.');
      }
    } else if (response?.type === 'error') {
      Alert.alert(
        'Lỗi đăng nhập Google',
        response.error?.message || 'Quá trình đăng nhập bị gián đoạn.'
      );
    }
  }, [response]);

  const handlePress = async () => {
    if (loading) return;

    const isExpoGo =
      !isNativeGoogleSigninAvailable ||
      Constants.appOwnership === 'expo' ||
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

    if (isExpoGo) {
      Alert.alert(
        'Lưu ý về Google Sign-In trên Expo Go',
        'Google OAuth 2.0 chặn đăng nhập trực tiếp trên ứng dụng mẫu Expo Go. Để sử dụng Google Sign-In, bạn cần cài đặt ứng dụng bằng file APK độc lập.\n\nTrong lúc chưa build file APK, bạn có thể đăng nhập / đăng ký bằng Email & Mật khẩu ở form trên nhé!',
        [
          { text: 'Đã hiểu' },
          {
            text: 'Vẫn thử mở',
            onPress: async () => {
              try {
                await promptAsync();
              } catch (err: any) {
                Alert.alert(
                  'Không thể mở Google Sign-In',
                  err.message || 'Vui lòng kiểm tra lại cấu hình.'
                );
              }
            },
          },
        ]
      );
      return;
    }

    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      try {
        await GoogleSignin.signOut();
      } catch (_) {
        // Bỏ qua lỗi nếu trước đó chưa có tài khoản đăng nhập
      }
      const signInResult = await GoogleSignin.signIn();

      const idToken =
        signInResult.data?.idToken || (signInResult as any).idToken;

      if (idToken) {
        await handleIdToken(idToken);
      } else {
        Alert.alert('Lỗi xác thực', 'Không tìm thấy ID Token từ tài khoản Google.');
      }
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // Người dùng tự đóng popup đăng nhập
      } else if (error.code === statusCodes.IN_PROGRESS) {
        // Đang xử lý
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert('Lỗi', 'Thiết bị chưa cập nhật Google Play Services.');
      } else {
        Alert.alert('Đăng nhập Google thất bại', error.message || 'Có lỗi xảy ra.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      style={[styles.button, loading && styles.buttonDisabled, style]}
      onPress={handlePress}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator color="#6025D2" size="small" />
      ) : (
        <View style={styles.content}>
          <View style={styles.iconCircle}>
            <Ionicons name="logo-google" size={18} color="#EA4335" />
          </View>
          <Text style={styles.buttonText}>
            {mode === 'register' ? 'Đăng ký bằng Google' : 'Đăng nhập bằng Google'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: '#ECE7FA',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6025D2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#342E4B',
    letterSpacing: 0.2,
  },
});
