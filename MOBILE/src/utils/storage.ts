// Safe Storage wrapper for Expo/React Native
let AsyncStorageModule: any = null;
try {
  AsyncStorageModule = require('@react-native-async-storage/async-storage');
  if (AsyncStorageModule && AsyncStorageModule.default) {
    AsyncStorageModule = AsyncStorageModule.default;
  }
} catch (e) {
  // Module not found or Metro resolution cache pending
}

const TOKEN_KEY = '@auth_access_token';
const REFRESH_TOKEN_KEY = '@auth_refresh_token';
const USER_KEY = '@auth_user_data';

// In-memory fallback for Expo Go / Dev without native module
const memoryStore: Record<string, string> = {};

const safeGet = async (key: string): Promise<string | null> => {
  try {
    if (AsyncStorageModule && typeof AsyncStorageModule.getItem === 'function') {
      const val = await AsyncStorageModule.getItem(key);
      if (val !== null) return val;
    }
    return memoryStore[key] || null;
  } catch (e) {
    return memoryStore[key] || null;
  }
};

const safeSet = async (key: string, value: string): Promise<void> => {
  memoryStore[key] = value;
  try {
    if (AsyncStorageModule && typeof AsyncStorageModule.setItem === 'function') {
      await AsyncStorageModule.setItem(key, value);
    }
  } catch (e) {
    // Keep in memoryStore if native storage fails
  }
};

const safeRemove = async (key: string): Promise<void> => {
  delete memoryStore[key];
  try {
    if (AsyncStorageModule && typeof AsyncStorageModule.removeItem === 'function') {
      await AsyncStorageModule.removeItem(key);
    }
  } catch (e) {
    // Removed from memoryStore
  }
};

export const storage = {
  async setToken(accessToken: string, refreshToken?: string): Promise<void> {
    await safeSet(TOKEN_KEY, accessToken);
    if (refreshToken) {
      await safeSet(REFRESH_TOKEN_KEY, refreshToken);
    }
  },

  async getToken(): Promise<string | null> {
    return await safeGet(TOKEN_KEY);
  },

  async getRefreshToken(): Promise<string | null> {
    return await safeGet(REFRESH_TOKEN_KEY);
  },

  async setUser(user: any): Promise<void> {
    await safeSet(USER_KEY, JSON.stringify(user));
  },

  async getUser(): Promise<any | null> {
    const data = await safeGet(USER_KEY);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  },

  async clearAll(): Promise<void> {
    await safeRemove(TOKEN_KEY);
    await safeRemove(REFRESH_TOKEN_KEY);
    await safeRemove(USER_KEY);
  },
};
