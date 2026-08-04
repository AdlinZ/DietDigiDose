import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ActivityIndicator,
  Alert
} from 'react-native';
import { Screen } from '@/components/Screen';
import { useAuthFetch } from '@/contexts/AuthContext';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { useFocusEffect } from 'expo-router';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { healthApi } from '@/services/api';


export default function HealthProfileScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [gender, setGender] = useState('保密');
  const [age, setAge] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [targetWeight, setTargetWeight] = useState('');

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const data = await healthApi.profile<Record<string, any>>(authFetch);
        if (data) {
          setGender(data.gender || '保密');
          setAge(data.age ? data.age.toString() : '');
          setHeight(data.height ? data.height.toString() : '');
          setWeight(data.weight ? data.weight.toString() : '');
          setTargetWeight(data.target_weight ? data.target_weight.toString() : '');
        }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile])
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await healthApi.saveProfile(authFetch, {
          gender,
          age: age ? parseInt(age, 10) : null,
          height: height ? parseFloat(height) : null,
          weight: weight ? parseFloat(weight) : null,
          target_weight: targetWeight ? parseFloat(targetWeight) : null,
      });
      Alert.alert('成功', '健康档案已更新', [
        { text: '确定', onPress: () => router.back() }
      ]);
    } catch (e) {
      Alert.alert('错误', '网络错误，保存失败');
    } finally {
      setSaving(false);
    }
  };

  const GenderOption = ({ label, value }: { label: string, value: string }) => {
    const isSelected = gender === value;
    return (
      <TouchableOpacity
        style={[styles.genderOption, isSelected && styles.genderOptionSelected]}
        onPress={() => setGender(value)}
      >
        <Text style={[styles.genderText, isSelected && styles.genderTextSelected]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2D6A4F" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          style={styles.container}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <FontAwesome6 name="arrow-left" size={20} color="#3D3229" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>健康档案</Text>
            <View style={{ width: 36 }} /> {/* Spacer */}
          </View>

          <ScrollView style={styles.content} contentContainerStyle={{ padding: 24, paddingBottom: 100 }}>
            <View style={styles.infoBox}>
              <FontAwesome6 name="circle-info" size={16} color="#0EA5E9" style={{ marginRight: 8 }} />
              <Text style={styles.infoText}>
                这些健康基础数据有助于为您提供更精准的饮食推荐与热量分析。
              </Text>
            </View>

            <View style={styles.form}>
              <View style={styles.field}>
                <Text style={styles.label}>性别</Text>
                <View style={styles.genderRow}>
                  <GenderOption label="男" value="男" />
                  <GenderOption label="女" value="女" />
                  <GenderOption label="保密" value="保密" />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>年龄 (岁)</Text>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={age}
                    onChangeText={setAge}
                    placeholder="输入年龄"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>身高 (cm)</Text>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={height}
                    onChangeText={setHeight}
                    placeholder="例如: 175"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>当前体重 (kg)</Text>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={weight}
                    onChangeText={setWeight}
                    placeholder="例如: 65.5"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>目标体重 (kg)</Text>
                <View style={styles.inputGroup}>
                  <TextInput
                    style={styles.input}
                    value={targetWeight}
                    onChangeText={setTargetWeight}
                    placeholder="例如: 60.0"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Bottom Save Button */}
          <View style={styles.bottomBar}>
            <TouchableOpacity 
              style={styles.saveBtn} 
              onPress={handleSave} 
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveBtnText}>保存档案</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#3D3229' },
  content: { flex: 1 },
  infoBox: {
    flexDirection: 'row', backgroundColor: '#E0F2FE', padding: 12, borderRadius: 12,
    marginBottom: 24, alignItems: 'center'
  },
  infoText: { fontSize: 12, color: '#0284C7', flex: 1, lineHeight: 18 },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700', color: '#3D3229', paddingLeft: 4 },
  genderRow: { flexDirection: 'row', gap: 12 },
  genderOption: {
    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: '#FFF', borderWidth: 1, borderColor: '#EBE3D5'
  },
  genderOptionSelected: {
    backgroundColor: '#2D6A4F', borderColor: '#2D6A4F'
  },
  genderText: { fontSize: 14, fontWeight: '600', color: '#8B7D6B' },
  genderTextSelected: { color: '#FFF' },
  inputGroup: {
    backgroundColor: '#FFF', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: '#EBE3D5'
  },
  input: { fontSize: 16, color: '#3D3229', padding: 0 },
  bottomBar: {
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    backgroundColor: '#FDF8F0',
    borderTopWidth: 1, borderTopColor: '#EBE3D5'
  },
  saveBtn: {
    backgroundColor: '#2D6A4F', paddingVertical: 16, borderRadius: 16,
    alignItems: 'center', shadowColor: '#2D6A4F', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
});
