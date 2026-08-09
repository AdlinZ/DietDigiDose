import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useCSSVariable } from 'uniwind';

const REMEMBERED_IDENTIFIER_KEY = '@remembered_login_identifier';

export default function LoginScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [rememberIdentifier, setRememberIdentifier] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const identifierWasEdited = useRef(false);
  const { login } = useAuth();
  const router = useSafeRouter();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [brand, muted, critical] = useCSSVariable([
    '--color-brand',
    '--color-copy-muted',
    '--color-critical',
  ]) as string[];

  useEffect(() => {
    (async () => {
      try {
        const savedIdentifier = await AsyncStorage.getItem(REMEMBERED_IDENTIFIER_KEY);
        if (savedIdentifier && !identifierWasEdited.current) {
          setIdentifier(savedIdentifier);
          setRememberIdentifier(true);
        }
      } catch (e) {
        // Ignore read errors
      }
    })();
  }, []);

  const handleIdentifierChange = (value: string) => {
    identifierWasEdited.current = true;
    setIdentifier(value);
    if (!rememberIdentifier) return;
    const normalizedValue = value.trim();
    void (normalizedValue
      ? AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, normalizedValue)
      : AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY)
    ).catch(() => undefined);
  };

  const handleRememberIdentifierChange = () => {
    const nextValue = !rememberIdentifier;
    setRememberIdentifier(nextValue);
    const normalizedIdentifier = identifier.trim();
    void (nextValue && normalizedIdentifier
      ? AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, normalizedIdentifier)
      : AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY)
    ).catch(() => undefined);
  };

  const handleLogin = async () => {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier || !password.trim()) {
      setError('请输入邮箱或手机号和密码');
      return;
    }
    const atIndex = trimmedIdentifier.indexOf('@');
    const isEmail = atIndex > 0 && trimmedIdentifier.slice(atIndex + 1).includes('.');
    const isPhone = /^1[3-9]\d{9}$/.test(trimmedIdentifier);
    if (!isEmail && !isPhone) {
      setError('请输入注册时使用的邮箱或手机号');
      return;
    }
    setError('');
    setLoading(true);

    if (rememberIdentifier) {
      await AsyncStorage.setItem(REMEMBERED_IDENTIFIER_KEY, trimmedIdentifier).catch(() => undefined);
    } else {
      await AsyncStorage.removeItem(REMEMBERED_IDENTIFIER_KEY).catch(() => undefined);
    }

    const result = await login(trimmedIdentifier, password);
    setLoading(false);
    if (result.success) {
      router.replace(returnTo || '/');
    } else {
      setError(result.error || '登录失败');
      setPassword(''); // 清空密码以提升安全防范
    }
  };

  const isSubmitDisabled = loading || !identifier.trim() || !password.trim();

  return (
    <Screen>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
          <View className="flex-1 justify-center px-8">
            {/* Logo & Title */}
            <View className="items-center mb-12">
              <View className="w-20 h-20 rounded-full bg-brand-soft items-center justify-center mb-4">
                <Image
                  source={require("@/assets/logo.png")}
                  style={{ width: 68, height: 68 }}
                  resizeMode="contain"
                  accessible={false}
                />
              </View>
              <Text className="text-display font-bold text-brand-strong mb-2" accessibilityRole="header">食光烙记</Text>
              <Text className="text-body text-copy-muted">智能食材管理，健康饮食推荐</Text>
            </View>

            {/* Form */}
            <View className="gap-4">
              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="envelope" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="请输入注册时的邮箱或手机号"
                  placeholderTextColor={muted}
                  value={identifier}
                  onChangeText={handleIdentifierChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  accessibilityLabel="邮箱或手机号"
                />
              </View>

              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="lock" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="请输入密码"
                  placeholderTextColor={muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="current-password"
                  textContentType="password"
                  accessibilityLabel="密码"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="min-w-touch min-h-touch items-center justify-center"
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                >
                  <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={18} color={muted} />
                </TouchableOpacity>
              </View>

              {/* 记住用户名与安全提示 */}
              <View className="flex-row justify-between items-center px-1 mt-0.5">
                <TouchableOpacity
                  className="flex-row items-center gap-1.5 min-h-touch"
                  onPress={handleRememberIdentifierChange}
                  activeOpacity={0.7}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberIdentifier }}
                  accessibilityLabel="记住登录方式"
                >
                  <FontAwesome6
                    name={rememberIdentifier ? "square-check" : "square"}
                    size={18}
                    color={rememberIdentifier ? brand : muted}
                  />
                  <Text className="text-body text-copy-muted">记住登录方式</Text>
                </TouchableOpacity>
                <View className="flex-row items-center gap-1">
                  <FontAwesome6 name="shield-halved" size={13} color={brand} />
                  <Text className="text-caption text-copy-muted">加密保护</Text>
                </View>
              </View>

              {error ? (
                <View
                  className="flex-row items-center justify-center bg-danger-soft rounded-control py-2 px-3"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  <FontAwesome6 name="circle-exclamation" size={14} color={critical} style={{ marginRight: 6 }} />
                  <Text className="text-critical text-body font-medium">{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                className={`bg-brand rounded-control h-14 items-center justify-center mt-2 active:bg-accent-hover ${isSubmitDisabled ? 'opacity-disabled' : ''}`}
                onPress={handleLogin}
                disabled={isSubmitDisabled}
                accessibilityRole="button"
                accessibilityLabel="登录"
                accessibilityState={{ disabled: isSubmitDisabled, busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-lg font-semibold">登录</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-row justify-center items-center mt-3 min-h-touch"
                onPress={() => router.push('/register', returnTo ? { returnTo } : {})}
                accessibilityRole="link"
                accessibilityLabel="还没有账号？立即注册"
              >
                <Text className="text-copy-muted text-body">还没有账号？</Text>
                <Text className="text-brand text-body font-semibold ml-1">立即注册</Text>
              </TouchableOpacity>
            </View>
          </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
