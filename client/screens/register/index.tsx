import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard, ActivityIndicator } from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/contexts/AuthContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { FontAwesome6 } from '@expo/vector-icons';

export default function RegisterScreen() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { register } = useAuth();
  const router = useSafeRouter();

  const handleRegister = async () => {
    if (!identifier.trim() || !password.trim()) {
      setError('请输入邮箱或手机号和密码');
      return;
    }
    const isEmail = identifier.includes('@') && identifier.includes('.');
    const isPhone = /^1[3-9]\d{9}$/.test(identifier.trim());
    if (!isEmail && !isPhone) {
      setError('请输入有效的邮箱或中国大陆手机号');
      return;
    }
    if (password.length < 6) {
      setError('密码至少6个字符');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setError('');
    setLoading(true);
    const result = await register(identifier.trim(), password);
    setLoading(false);
    if (result.success) {
      router.replace('/onboarding');
    } else {
      setError(result.error || '注册失败');
    }
  };

  return (
    <Screen>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} disabled={Platform.OS === 'web'}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>创建账号</Text>
              <Text style={styles.subtitle}>加入食光烙记，开启健康饮食之旅</Text>
            </View>

            {/* Form */}
            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <FontAwesome6 name="envelope" size={18} color="#52796F" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="邮箱或手机号"
                  placeholderTextColor="#94A3B8"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                />
              </View>

              <View style={styles.inputGroup}>
                <FontAwesome6 name="lock" size={18} color="#52796F" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="密码（至少6个字符）"
                  placeholderTextColor="#94A3B8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <FontAwesome6 name={showPassword ? 'eye-slash' : 'eye'} size={18} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <FontAwesome6 name="lock" size={18} color="#52796F" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="确认密码"
                  placeholderTextColor="#94A3B8"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                />
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <TouchableOpacity
                style={[styles.registerButton, loading && styles.disabledButton]}
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.registerButtonText}>注册</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.loginLink}
                onPress={() => router.back()}
              >
                <Text style={styles.loginText}>已有账号？</Text>
                <Text style={styles.loginLinkText}>返回登录</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 32 },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 28, fontWeight: '700', color: '#1B4332', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#52796F' },
  form: { gap: 14 },
  inputGroup: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0F0F3', borderRadius: 16,
    paddingHorizontal: 16, height: 52,
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, fontSize: 16, color: '#1B4332', paddingVertical: 0 },
  eyeIcon: { padding: 8 },
  errorText: { color: '#D64545', fontSize: 14, textAlign: 'center' },
  registerButton: {
    backgroundColor: '#2D6A4F', borderRadius: 16, height: 52,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#2D6A4F', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  registerButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  disabledButton: { opacity: 0.6 },
  loginLink: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', marginTop: 4,
  },
  loginText: { color: '#52796F', fontSize: 14 },
  loginLinkText: { color: '#2D6A4F', fontSize: 14, fontWeight: '600', marginLeft: 4 },
});
