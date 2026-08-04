import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { purgeLegacyUnscopedPrivateStorage, purgeUserPrivateStorage } from '@/utils/userStorage';
import { ApiError, authApi } from '@/services/api';

interface User {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  avatar_url: string | null;
  bio: string | null;
  daily_calories_target?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (password: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = '@auth_token';
const USER_KEY = '@auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const clearAuthState = useCallback(async () => {
    await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(USER_KEY)]);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    // Load saved auth state with offline resilience
    (async () => {
      try {
        await purgeLegacyUnscopedPrivateStorage();
        const savedToken = await AsyncStorage.getItem(TOKEN_KEY);
        const savedUser = await AsyncStorage.getItem(USER_KEY);
        if (savedToken && savedUser) {
          setToken(savedToken);
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            await AsyncStorage.removeItem(USER_KEY);
          }

          // Verify token asynchronously with backend
          try {
            const freshUser = await authApi.me<User>(savedToken);
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
            setUser(freshUser);
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) await clearAuthState();
            // Network error/server down during verify: keep local cached auth state so user stays logged in offline
          }
        }
      } catch (e) {
        await clearAuthState();
      } finally {
        setIsLoading(false);
      }
    })();
  }, [clearAuthState]);

  const login = useCallback(async (identifier: string, password: string) => {
    try {
      await purgeLegacyUnscopedPrivateStorage();
      const data = await authApi.login<{ token: string; user: User }>(identifier, password);
      if (!data?.token || !data?.user) {
        return { success: false, error: '返回数据不完整' };
      }
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, []);

  const register = useCallback(async (identifier: string, password: string) => {
    try {
      await purgeLegacyUnscopedPrivateStorage();
      const data = await authApi.register<{ token: string; user: User }>(identifier, password);
      if (!data?.token || !data?.user) {
        return { success: false, error: '返回数据不完整' };
      }
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthState();
  }, [clearAuthState]);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    if (!token) return { success: false, error: '未登录' };
    try {
      const data = await authApi.updateProfile<User>(token, profileData);
      if (!data) {
        return { success: false, error: '返回数据异常' };
      }
      const updatedUser = { ...user, ...data } as User;
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
      return { success: true };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearAuthState();
        return { success: false, error: '登录已过期，请重新登录' };
      }
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [token, user, clearAuthState]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const data = await authApi.me<User>(token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
      setUser(data);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) await clearAuthState();
      // Ignore
    }
  }, [token, clearAuthState]);

  const deleteAccount = useCallback(async (password: string) => {
    if (!token || !user) return { success: false, error: '请先登录' };
    try {
      await authApi.deleteAccount(token, password);
      await purgeUserPrivateStorage(user.id);
      await clearAuthState();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '账号删除失败' };
    }
  }, [clearAuthState, token, user]);

  return (
    <AuthContext.Provider value={{
      user,
      token,
      isLoading,
      isAuthenticated: !!token,
      login,
      register,
      logout,
      updateProfile,
      deleteAccount,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Helper to make authenticated API calls
 */
export function useAuthFetch() {
  const { token, logout } = useAuth();

  return useCallback(async (url: string, options: RequestInit = {}) => {
    // requestJson 传入的是 Headers 实例。对象展开会丢失其中的
    // Content-Type，导致 Express 不解析 POST 的 JSON 正文。
    const headers = new Headers(options.headers);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      void logout();
    }
    return response;
  }, [token, logout]);
}
