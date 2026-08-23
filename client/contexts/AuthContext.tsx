import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { purgeLegacyUnscopedPrivateStorage, purgeUserPrivateStorage } from '@/utils/userStorage';
import { ApiError, authApi } from '@/services/api';
import { AUTH_USER_KEY, getStoredToken, removeStoredToken, setStoredToken } from '@/utils/authStorage';

interface User {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  avatar_url: string | null;
  bio: string | null;
  daily_calories_target?: number;
  phone_verified_at?: string | null;
}

type PendingSmsRegistration = {
  registrationToken: string;
  phoneMasked: string;
};

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (identifier: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (identifier: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  pendingSmsRegistration: PendingSmsRegistration | null;
  sendSmsCode: (phone: string) => Promise<{ success: boolean; challengeId?: string; phoneMasked?: string; resendAfter?: number; error?: string }>;
  verifySmsCode: (challengeId: string, code: string) => Promise<{ success: boolean; registrationRequired?: boolean; error?: string }>;
  completeSmsRegistration: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  clearPendingSmsRegistration: () => void;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<{ success: boolean; error?: string }>;
  deleteAccount: (password: string) => Promise<{ success: boolean; error?: string }>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSmsRegistration, setPendingSmsRegistration] = useState<PendingSmsRegistration | null>(null);

  const applyAuthenticatedResult = useCallback(async (data: { token: string; user: User }) => {
    if (!data?.token || !data?.user) return false;
    await setStoredToken(data.token);
    await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setPendingSmsRegistration(null);
    return true;
  }, []);

  const clearAuthState = useCallback(async () => {
    await Promise.all([removeStoredToken(), AsyncStorage.removeItem(AUTH_USER_KEY)]);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    // Load saved auth state with offline resilience
    (async () => {
      try {
        await purgeLegacyUnscopedPrivateStorage();
        const savedToken = await getStoredToken();
        const savedUser = await AsyncStorage.getItem(AUTH_USER_KEY);
        if (savedToken && savedUser) {
          setToken(savedToken);
          try {
            setUser(JSON.parse(savedUser));
          } catch {
            await AsyncStorage.removeItem(AUTH_USER_KEY);
          }

          // Verify token asynchronously with backend
          try {
            const freshUser = await authApi.me<User>(savedToken);
            await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(freshUser));
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
      if (!await applyAuthenticatedResult(data)) {
        return { success: false, error: '返回数据不完整' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [applyAuthenticatedResult]);

  const register = useCallback(async (identifier: string, username: string, password: string) => {
    try {
      await purgeLegacyUnscopedPrivateStorage();
      const data = await authApi.register<{ token: string; user: User }>(identifier, username, password);
      if (!await applyAuthenticatedResult(data)) {
        return { success: false, error: '返回数据不完整' };
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '网络错误，请稍后重试' };
    }
  }, [applyAuthenticatedResult]);

  const sendSmsCode = useCallback(async (phone: string) => {
    try {
      const data = await authApi.sendSmsCode<{ challengeId: string; phoneMasked: string; resendAfter: number }>(phone);
      if (!data?.challengeId) return { success: false, error: '短信服务返回数据不完整' };
      return { success: true, ...data };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '验证码发送失败' };
    }
  }, []);

  const verifySmsCode = useCallback(async (challengeId: string, code: string) => {
    try {
      const data = await authApi.verifySmsCode<
        | { status: 'authenticated'; token: string; user: User }
        | { status: 'registration_required'; registrationToken: string; phoneMasked: string }
      >(challengeId, code);
      if (data.status === 'authenticated') {
        if (!await applyAuthenticatedResult(data)) return { success: false, error: '登录返回数据不完整' };
        return { success: true, registrationRequired: false };
      }
      if (data.status === 'registration_required' && data.registrationToken) {
        setPendingSmsRegistration({ registrationToken: data.registrationToken, phoneMasked: data.phoneMasked });
        return { success: true, registrationRequired: true };
      }
      return { success: false, error: '验证码核验返回数据异常' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '验证码核验失败' };
    }
  }, [applyAuthenticatedResult]);

  const completeSmsRegistration = useCallback(async (username: string, password: string) => {
    if (!pendingSmsRegistration) return { success: false, error: '手机号验证已失效，请重新验证' };
    try {
      const data = await authApi.registerWithSms<{ token: string; user: User }>(pendingSmsRegistration.registrationToken, username, password);
      if (!await applyAuthenticatedResult(data)) return { success: false, error: '注册返回数据不完整' };
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '注册失败' };
    }
  }, [applyAuthenticatedResult, pendingSmsRegistration]);

  const clearPendingSmsRegistration = useCallback(() => setPendingSmsRegistration(null), []);

  const logout = useCallback(() => {
    void (async () => {
      try {
        await purgeUserPrivateStorage(user?.id);
      } finally {
        await clearAuthState();
      }
    })();
  }, [clearAuthState, user?.id]);

  const updateProfile = useCallback(async (profileData: Partial<User>) => {
    if (!token) return { success: false, error: '未登录' };
    try {
      const data = await authApi.updateProfile<User>(token, profileData);
      if (!data) {
        return { success: false, error: '返回数据异常' };
      }
      const updatedUser = { ...user, ...data } as User;
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
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
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data));
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

  const value = React.useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: !!token,
      login,
      register,
      pendingSmsRegistration,
      sendSmsCode,
      verifySmsCode,
      completeSmsRegistration,
      clearPendingSmsRegistration,
      logout,
      updateProfile,
      deleteAccount,
      refreshUser,
    }),
    [user, token, isLoading, login, register, pendingSmsRegistration, sendSmsCode, verifySmsCode, completeSmsRegistration, clearPendingSmsRegistration, logout, updateProfile, deleteAccount, refreshUser]
  );

  return (
    <AuthContext.Provider value={value}>
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
