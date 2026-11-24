// Safe Google Sign-In wrapper for both Expo Go and standalone APK
let nativeGoogleSignin: any = null;
let nativeStatusCodes: Record<string, string> = {
  SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
};

try {
  // Chỉ tải khi native binary có đăng ký module 'RNGoogleSignin' (file APK/Dev Client)
  // Trong Expo Go, require() sẽ ném ra Invariant Violation và được bắt an toàn ở catch
  const gSignin = require('@react-native-google-signin/google-signin');
  if (gSignin && gSignin.GoogleSignin) {
    nativeGoogleSignin = gSignin.GoogleSignin;
    if (gSignin.statusCodes) {
      nativeStatusCodes = gSignin.statusCodes;
    }
  }
} catch (e) {
  // Expo Go client tiêu chuẩn không có thư viện Native Google Sign-In
  // Chạy an toàn ở chế độ dự phòng, không bao giờ bị văng màn hình đỏ
}

export const GoogleSignin = nativeGoogleSignin;
export const statusCodes = nativeStatusCodes;
export const isNativeGoogleSigninAvailable = Boolean(nativeGoogleSignin);
