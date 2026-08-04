import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';

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
      router.replace('/');
    } else {
      setError(result.error || '登录失败');
      setPassword(''); // 清空密码以提升安全防范
    }
  };

  const isSubmitDisabled = loading || !identifier.trim() || !password.trim();

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
          <View style={styles.content}>
            {/* Logo & Title */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image
                  source={require("@/assets/logo.png")}
                  style={{ width: 68, height: 68 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>食光烙记</Text>
              <Text style={styles.subtitle}>智能食材管理，健康饮食推荐</Text>
            </View>

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <FontAwesome6 name="envelope" size={18} color="#52796F" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="请输入注册时的邮箱或手机号"
                  placeholderTextColor="#94A3B8"
                  value={identifier}
                  onChangeText={handleIdentifierChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={styles.inputGroup}>
                <FontAwesome6 name="lock" size={18} color="#52796F" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="请输入密码"
                  placeholderTextColor="#94A3B8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              {/* 记住用户名与安全提示 */}
              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={styles.rememberOption}
                  onPress={handleRememberIdentifierChange}
                  activeOpacity={0.7}
                >
                  <FontAwesome6
                    name={rememberIdentifier ? "square-check" : "square"}
                    size={18}
                    color={rememberIdentifier ? "#2D6A4F" : "#94A3B8"}
                  />
                  <Text style={styles.rememberText}>记住登录方式</Text>
                </TouchableOpacity>
                <View style={styles.securityBadge}>
                  <FontAwesome6 name="shield-halved" size={13} color="#52796F" />
                  <Text style={styles.securityText}>加密保护</Text>
                </View>
              </View>

              {error ? (
                <View style={styles.errorContainer}>
                  <FontAwesome6 name="circle-exclamation" size={14} color="#D64545" style={{ marginRight: 6 }} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.loginButton, isSubmitDisabled && styles.disabledButton]}
                onPress={handleLogin}
                disabled={isSubmitDisabled}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.loginButtonText}>登录</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.registerLink}
                onPress={() => router.push('/register')}
              >
                <Text style={styles.registerText}>还没有账号？</Text>
                <Text style={styles.registerLinkText}>立即注册</Text>
              </TouchableOpacity>
            </View>
          </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  header: { alignItems: 'center', marginBottom: 48 },
  logoContainer: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#D8F3DC', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1B4332', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#52796F' },
  form: { gap: 16 },
  inputGroup: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0F0F3', borderRadius: 16,
    paddingHorizontal: 16, height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#1B4332', paddingVertical: 0 },
  eyeIcon: { padding: 8 },
  optionsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 4, marginTop: 2,
  },
  rememberOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  rememberText: { fontSize: 14, color: '#52796F' },
  securityBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  securityText: { fontSize: 12, color: '#52796F' },
  errorContainer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FEE2E2', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
  },
  errorText: { color: '#D64545', fontSize: 14, fontWeight: '500' },
  loginButton: {
    backgroundColor: '#2D6A4F', borderRadius: 16, height: 56,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#2D6A4F', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    marginTop: 8,
  },
  loginButtonText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  disabledButton: { opacity: 0.5 },
  registerLink: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', marginTop: 12,
  },
  registerText: { color: '#52796F', fontSize: 14 },
  registerLinkText: { color: '#2D6A4F', fontSize: 14, fontWeight: '600', marginLeft: 4 },
});
