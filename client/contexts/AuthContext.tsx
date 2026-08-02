import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { purgeLegacyUnscopedPrivateStorage } from '@/utils/userStorage';

const EXPO_PUBLIC_BACKEND_BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || 'http://localhost:9091';

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
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = '@auth_token';
const USER_KEY = '@auth_user';

const parseResponseJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

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
            const res = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/auth/me`, {
              headers: { 'Authorization': `Bearer ${savedToken}` },
            });
            if (res.ok) {
              const freshUser = await parseResponseJson(res);
              if (freshUser) {
                await AsyncStorage.setItem(USER_KEY, JSON.stringify(freshUser));
                setUser(freshUser);
              }
            } else if (res.status === 401) {
              // Token strictly invalid or expired
              await clearAuthState();
            }
          } catch {
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
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await parseResponseJson(response);
      if (!response.ok) {
        return { success: false, error: data?.error || data?.message || '登录失败' };
      }
      if (!data?.token || !data?.user) {
        return { success: false, error: '返回数据不完整' };
      }
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (e) {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  const register = useCallback(async (identifier: string, password: string) => {
    try {
      await purgeLegacyUnscopedPrivateStorage();
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await parseResponseJson(response);
      if (!response.ok) {
        return { success: false, error: data?.error || data?.message || '注册失败' };
      }
      if (!data?.token || !data?.user) {
        return { success: false, error: '返回数据不完整' };
      }
      await AsyncStorage.setItem(TOKEN_KEY, data.token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
      return { success: true };
    } catch (e) {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthState();
  }, [clearAuthState]);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    if (!token) return { success: false, error: '未登录' };
    try {
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(profileData),
      });
      const data = await parseResponseJson(response);
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await clearAuthState();
          return { success: false, error: '登录已过期，请重新登录' };
        }
        return { success: false, error: data?.error || data?.message || '更新失败' };
      }
      if (!data) {
        return { success: false, error: '返回数据异常' };
      }
      const updatedUser = { ...user, ...data } as User;
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      setUser(updatedUser);
      return { success: true };
    } catch (e) {
      return { success: false, error: '网络错误，请稍后重试' };
    }
  }, [token, user, clearAuthState]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_BASE_URL}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await parseResponseJson(response);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
        setUser(data);
      } else if (response.status === 401 || response.status === 403) {
        await clearAuthState();
      }
    } catch (e) {
      // Ignore
    }
  }, [token, clearAuthState]);

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
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      void logout();
    }
    return response;
  }, [token, logout]);
}
