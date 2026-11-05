import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Root navigation ref tách riêng khỏi AppNavigator để tránh circular dependency
 * và không cần dùng dynamic `await import()` gây lỗi bundle splitting trên mobile.
 */
export const navigationRef = createNavigationContainerRef<any>();
