import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useCSSVariable } from 'uniwind';

export default function RegisterScreen() {
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const router = useSafeRouter();
  const [brand, muted] = useCSSVariable([
    '--color-brand',
    '--color-copy-muted',
  ]) as string[];

  const handleRegister = async () => {
    if (!identifier.trim() || !username.trim() || !password.trim()) {
      setError('请输入用户名、邮箱或手机号和密码');
      return;
    }
    if (username.trim().length < 2 || username.trim().length > 30) {
      setError('用户名需为 2～30 个字符');
      return;
    }
    const isEmail = identifier.includes('@') && identifier.includes('.');
    const isPhone = /^1[3-9]\d{9}$/.test(identifier.trim());
    if (!isEmail && !isPhone) {
      setError('请输入有效的邮箱或中国大陆手机号');
      return;
    }
    if (password.length < 6 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
      setError('密码至少6位，并同时包含字母和数字');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    setLoading(true);
    const result = await register(identifier.trim(), username.trim(), password);
    setLoading(false);
    if (result.success) {
      router.replace('/onboarding');
    } else {
      setError(result.error || '注册失败');
    }
  };

  return (
    <Screen>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="flex-1 justify-center px-8">
            {/* Header */}
            <View className="items-center mb-10">
              <Text className="text-display font-bold text-brand-strong mb-2" accessibilityRole="header">创建账号</Text>
              <Text className="text-body text-copy-muted">加入食光烙记，开启健康饮食之旅</Text>
            </View>

            {/* Form */}
            <View className="gap-3.5">
              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="user" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="用户名（公开显示）"
                  placeholderTextColor={muted}
                  value={username}
                  onChangeText={setUsername}
                  maxLength={30}
                  autoComplete="username-new"
                  textContentType="username"
                  accessibilityLabel="用户名"
                />
              </View>
              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="envelope" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="邮箱或手机号"
                  placeholderTextColor={muted}
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="username"
                  textContentType="username"
                  accessibilityLabel="邮箱或手机号"
                />
              </View>

              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="lock" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="密码（至少6位，含字母和数字）"
                  placeholderTextColor={muted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
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

              <View className="flex-row items-center bg-field rounded-control px-4 h-14">
                <FontAwesome6 name="lock" size={18} color={brand} className="mr-3" />
                <TextInput
                  className="flex-1 text-base text-ink py-0"
                  placeholder="确认密码"
                  placeholderTextColor={muted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel="确认密码"
                />
              </View>

              {error ? (
                <Text
                  className="text-critical text-body text-center"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {error}
                </Text>
              ) : null}

              <TouchableOpacity
                className={`bg-brand rounded-control h-14 items-center justify-center active:bg-accent-hover ${loading ? 'opacity-disabled' : ''}`}
                onPress={handleRegister}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="注册"
                accessibilityState={{ disabled: loading, busy: loading }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-lg font-semibold">注册</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                className="flex-row justify-center items-center mt-1 min-h-touch"
                onPress={() => router.back()}
                accessibilityRole="link"
                accessibilityLabel="已有账号？返回登录"
              >
                <Text className="text-copy-muted text-body">已有账号？</Text>
                <Text className="text-brand text-body font-semibold ml-1">返回登录</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Screen>
  );
}
