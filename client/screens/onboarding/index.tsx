import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import FontAwesome6 from '@/components/ThemedFontAwesome6';
import { Screen } from '@/components/Screen';
import { useAuthFetch } from '@/contexts/AuthContext';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { validateAuthReturnTo } from '@/utils/authReturnTo';
import { healthApi } from '@/services/api';
import { ALLERGY_LABELS, type AllergyEntry, type AllergySeverity } from '@/utils/healthProfile';
import { useAppThemeColors } from '@/hooks/useAppThemeColors';

type Gender = '男' | '女' | '保密';
type HealthGoal = 'lose_weight' | 'reduce_fat' | 'gain_muscle' | 'maintain' | 'healthy';
type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';

const GOALS: { value: HealthGoal; title: string; description: string; icon: string }[] = [
  { value: 'lose_weight', title: '减重', description: '循序渐进地减轻体重', icon: 'arrow-trend-down' },
  { value: 'reduce_fat', title: '减脂', description: '改善体脂与身体线条', icon: 'fire-flame-curved' },
  { value: 'gain_muscle', title: '增肌', description: '搭配饮食，强健体魄', icon: 'dumbbell' },
  { value: 'maintain', title: '维持体重', description: '保持现在的健康状态', icon: 'scale-balanced' },
  { value: 'healthy', title: '健康饮食', description: '培养更好的饮食习惯', icon: 'leaf' },
];

const ACTIVITIES: { value: ActivityLevel; title: string; description: string }[] = [
  { value: 'sedentary', title: '久坐为主', description: '日常活动较少' },
  { value: 'light', title: '轻度活动', description: '每周运动 1–3 次' },
  { value: 'moderate', title: '规律运动', description: '每周运动 3–5 次' },
  { value: 'active', title: '高强度活动', description: '几乎每天运动' },
];

const PREFERENCES = ['无特别偏好', '清淡少油', '高蛋白', '控糖少甜'] as const;
const SAFETY_ALLERGIES = [
  { name: '坚果', type: 'allergy' as const }, { name: '海鲜', type: 'allergy' as const },
  { name: '乳糖', type: 'intolerance' as const }, { name: '麸质', type: 'intolerance' as const },
];
const SAFETY_CONDITIONS = ['糖尿病', '高血压', '高尿酸', '肾病', '胃肠问题', '孕期', '哺乳期'];
const SAFETY_RESTRICTIONS = ['蛋奶素', '纯素', '不吃猪肉', '清真', '低盐', '低糖', '低嘌呤'];

function ValueSlider({ label, value, unit, minimumValue, maximumValue, step, onValueChange }: { label: string; value: number; unit: string; minimumValue: number; maximumValue: number; step: number; onValueChange: (value: number) => void }) {
  const styles = createStyles(useAppThemeColors());
  const [trackWidth, setTrackWidth] = useState(0);
  const percentage = ((value - minimumValue) / (maximumValue - minimumValue)) * 100;
  const displayValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  const updateFromPosition = (position: number) => {
    if (!trackWidth) return;
    const ratio = Math.max(0, Math.min(1, position / trackWidth));
    const next = minimumValue + Math.round(((maximumValue - minimumValue) * ratio) / step) * step;
    onValueChange(Number(next.toFixed(1)));
  };
  return <View style={styles.sliderGroup}>
    <View style={styles.sliderHeader}><Text style={styles.label}>{label}</Text><View style={styles.valuePill}><Text style={styles.valueText}>{displayValue} {unit}</Text></View></View>
    <View
      style={styles.sliderTouchArea}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => updateFromPosition(event.nativeEvent.locationX)}
      onResponderMove={(event) => updateFromPosition(event.nativeEvent.locationX)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: minimumValue, max: maximumValue, now: value, text: `${displayValue}${unit}` }}
    >
      <View style={styles.sliderTrack}><View style={[styles.sliderFill, { width: `${percentage}%` }]} /><View style={[styles.sliderThumb, { left: `${percentage}%` }]} /></View>
    </View>
    <View style={styles.sliderBounds}><Text style={styles.sliderBoundsText}>{minimumValue}{unit}</Text><Text style={styles.sliderBoundsText}>{maximumValue}{unit}</Text></View>
  </View>;
}

export default function OnboardingScreen() {
  const colors = useAppThemeColors();
  const styles = createStyles(colors);
  const router = useSafeRouter(); const authFetch = useAuthFetch();
  const { returnTo: rawReturnTo } = useSafeSearchParams<{ returnTo?: unknown }>();
  const returnTo = validateAuthReturnTo(rawReturnTo);
  const [currentStep, setCurrentStep] = useState(1); const [goal, setGoal] = useState<HealthGoal | null>(null);
  const [gender, setGender] = useState<Gender>('保密'); const [age, setAge] = useState(25); const [height, setHeight] = useState(165);
  const [weight, setWeight] = useState(60); const [targetWeight, setTargetWeight] = useState(55); const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [preference, setPreference] = useState<(typeof PREFERENCES)[number]>('无特别偏好'); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [allergies, setAllergies] = useState<AllergyEntry[]>([]); const [medications, setMedications] = useState('');
  const [conditions, setConditions] = useState<string[]>([]); const [restrictions, setRestrictions] = useState<string[]>([]); const [dislikedFoods, setDislikedFoods] = useState('');
  const needsTargetWeight = goal === 'lose_weight' || goal === 'reduce_fat' || goal === 'gain_muscle';
  const next = () => { if (currentStep === 1 && !goal) { setError('请选择你希望食光格记如何帮助你'); return; } setError(''); setCurrentStep((step) => Math.min(7, step + 1)); };
  const back = () => { setError(''); setCurrentStep((step) => Math.max(1, step - 1)); };
  const finish = async () => {
    if (!goal) return; setError(''); setSaving(true);
    try {
      await healthApi.saveProfile(authFetch, {
        gender, age, height, weight, target_weight: needsTargetWeight ? targetWeight : null,
        health_goal: goal, activity_level: activityLevel, dietary_preference: preference,
        allergies, medications, medical_conditions: conditions, dietary_restrictions: restrictions, disliked_foods: dislikedFoods,
      });
      router.replace(returnTo || '/');
    } catch { setError('网络异常，请检查网络后重试'); } finally { setSaving(false); }
  };
  const title = currentStep === 1 ? '你想从哪里开始？' : currentStep === 2 ? '你的性别是？' : currentStep === 3 ? '你今年多大？' : currentStep === 4 ? '你的身高是？' : currentStep === 5 ? '记录身体数据' : currentStep === 6 ? '打造你的饮食方案' : '确认饮食安全信息';
  const subtitle = currentStep === 1 ? '选择最符合你现在需求的目标，之后随时都能修改。' : currentStep === 2 ? '用于更合适的营养估算，也可以选择保密。' : currentStep === 3 ? '拖动滑块选择年龄。' : currentStep === 4 ? '拖动滑块选择身高。' : currentStep === 5 ? '拖动滑块即可填写，不需要精确到每一天。' : currentStep === 6 ? '选择你的活动程度和饮食偏好。' : '用于菜谱、食材替换与 AI 对话的安全拦截；没有可直接完成。';
  return <Screen><KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView style={styles.scrollView} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.progressTrack}><View style={[styles.progress, { width: `${(currentStep / 7) * 100}%` }]} /></View><Text style={styles.step}>第 {currentStep} 步，共 7 步</Text>
    <View style={styles.intro}><View style={styles.iconWrap}><FontAwesome6 name={currentStep === 1 ? 'compass' : currentStep === 2 ? 'user' : currentStep === 3 ? 'cake-candles' : currentStep === 4 ? 'ruler-vertical' : currentStep === 5 ? 'weight-scale' : currentStep === 6 ? 'seedling' : 'shield-halved'} size={28} colorClassName="accent-brand" /></View><Text style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View><View style={styles.selectionArea}>
    {currentStep === 1 ? <View style={styles.goalList}>{GOALS.map((item) => { const selected = goal === item.value; return <TouchableOpacity key={item.value} style={[styles.goalCard, selected && styles.goalCardActive]} onPress={() => { setGoal(item.value); setError(''); }}><View style={[styles.goalIcon, selected && styles.goalIconActive]}><FontAwesome6 name={item.icon as never} size={18} color={selected ? colors['on-brand'] : colors.brand} /></View><View style={styles.goalCopy}><Text style={styles.goalTitle}>{item.title}</Text><Text style={styles.goalDescription}>{item.description}</Text></View><View style={[styles.radio, selected && styles.radioActive]}>{selected && <View style={styles.radioDot} />}</View></TouchableOpacity>; })}</View> : null}
    {currentStep === 2 ? <View style={styles.card}><Text style={styles.sectionTitle}>性别</Text><View style={styles.options}>{(['男', '女', '保密'] as Gender[]).map((option) => <TouchableOpacity key={option} style={[styles.option, gender === option && styles.optionActive]} onPress={() => setGender(option)}><Text style={[styles.optionText, gender === option && styles.optionTextActive]}>{option}</Text></TouchableOpacity>)}</View></View> : null}
    {currentStep === 3 ? <View style={styles.card}><ValueSlider label="年龄" value={age} unit="岁" minimumValue={14} maximumValue={80} step={1} onValueChange={setAge} /></View> : null}
    {currentStep === 4 ? <View style={styles.card}><ValueSlider label="身高" value={height} unit="cm" minimumValue={130} maximumValue={220} step={1} onValueChange={setHeight} /></View> : null}
    {currentStep === 5 ? <View style={styles.card}><Text style={styles.sectionTitle}>身体数据</Text><ValueSlider label="当前体重" value={weight} unit="kg" minimumValue={30} maximumValue={180} step={0.5} onValueChange={setWeight} />{needsTargetWeight ? <ValueSlider label="目标体重" value={targetWeight} unit="kg" minimumValue={30} maximumValue={180} step={0.5} onValueChange={setTargetWeight} /> : <Text style={styles.hint}>你选择了“{GOALS.find((item) => item.value === goal)?.title}”，因此不需要设定目标体重。</Text>}</View> : null}
    {currentStep === 6 ? <View style={styles.card}><Text style={styles.sectionTitle}>日常活动</Text>{ACTIVITIES.map((item) => <TouchableOpacity key={item.value} style={[styles.choiceRow, activityLevel === item.value && styles.choiceRowActive]} onPress={() => setActivityLevel(item.value)}><View><Text style={styles.choiceTitle}>{item.title}</Text><Text style={styles.choiceDescription}>{item.description}</Text></View><View style={[styles.radio, activityLevel === item.value && styles.radioActive]}>{activityLevel === item.value && <View style={styles.radioDot} />}</View></TouchableOpacity>)}<Text style={[styles.sectionTitle, styles.preferenceTitle]}>饮食偏好</Text><View style={styles.preferenceWrap}>{PREFERENCES.map((item) => <TouchableOpacity key={item} style={[styles.preference, preference === item && styles.preferenceActive]} onPress={() => setPreference(item)}><Text style={[styles.preferenceText, preference === item && styles.preferenceTextActive]}>{item}</Text></TouchableOpacity>)}</View></View> : null}
    {currentStep === 7 ? <View style={styles.card}>
      <Text style={styles.safetyTitle}>过敏与不耐受</Text><View style={styles.preferenceWrap}>{SAFETY_ALLERGIES.map((item) => { const selected = allergies.some((entry) => entry.name === item.name); return <TouchableOpacity key={item.name} style={[styles.preference, selected && styles.safetyPreferenceActive]} onPress={() => setAllergies((current) => selected ? current.filter((entry) => entry.name !== item.name) : [...current, { ...item, severity: 'moderate' }])}><Text style={[styles.preferenceText, selected && styles.safetyPreferenceText]}>{item.name}</Text></TouchableOpacity>; })}</View>
      {allergies.map((allergy) => <View key={allergy.name} style={styles.allergyRow}><Text style={styles.allergyName}>{allergy.name}</Text><View style={styles.severityRow}>{(['mild', 'moderate', 'severe'] as AllergySeverity[]).map((severity) => <TouchableOpacity key={severity} onPress={() => setAllergies((current) => current.map((item) => item.name === allergy.name ? { ...item, severity } : item))} style={[styles.severityButton, allergy.severity === severity && (severity === 'severe' ? styles.severityDanger : styles.severityActive)]}><Text style={[styles.severityText, allergy.severity === severity && styles.severityTextActive]}>{ALLERGY_LABELS[severity]}</Text></TouchableOpacity>)}</View></View>)}
      <Text style={styles.safetyTitle}>用药与补充剂</Text><TextInput value={medications} onChangeText={setMedications} placeholder="药名 + 频率/时段（可选）" placeholderTextColor={colors['copy-muted']} multiline style={styles.safetyInput} /><Text style={styles.safetyHint}>食语不会给出停换药或可能影响药效的建议。</Text>
      <Text style={styles.safetyTitle}>疾病或特殊状态</Text><View style={styles.preferenceWrap}>{SAFETY_CONDITIONS.map((item) => <TouchableOpacity key={item} style={[styles.preference, conditions.includes(item) && styles.safetyPreferenceActive]} onPress={() => setConditions((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}><Text style={[styles.preferenceText, conditions.includes(item) && styles.safetyPreferenceText]}>{item}</Text></TouchableOpacity>)}</View>
      <Text style={styles.safetyTitle}>饮食限制</Text><View style={styles.preferenceWrap}>{SAFETY_RESTRICTIONS.map((item) => <TouchableOpacity key={item} style={[styles.preference, restrictions.includes(item) && styles.preferenceActive]} onPress={() => setRestrictions((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item])}><Text style={[styles.preferenceText, restrictions.includes(item) && styles.preferenceTextActive]}>{item}</Text></TouchableOpacity>)}</View><TextInput value={dislikedFoods} onChangeText={setDislikedFoods} placeholder="不喜欢吃的食物（可选）" placeholderTextColor={colors['copy-muted']} style={[styles.safetyInput, { marginTop: 12 }]} />
    </View> : null}</View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </ScrollView><View style={styles.footer}>
    {currentStep < 7 ? <TouchableOpacity style={styles.primaryButton} onPress={next}><Text style={styles.primaryButtonText}>下一步</Text></TouchableOpacity> : <TouchableOpacity style={[styles.primaryButton, saving && styles.buttonDisabled]} onPress={finish} disabled={saving}>{saving ? <ActivityIndicator color={colors['on-brand']} /> : <Text style={styles.primaryButtonText}>保存并开始使用</Text>}</TouchableOpacity>}
    <View style={styles.footerLinks}>{currentStep > 1 ? <TouchableOpacity style={styles.footerLink} onPress={back} disabled={saving}><Text style={styles.backText}>返回上一步</Text></TouchableOpacity> : <View style={styles.footerLink} />}<TouchableOpacity style={styles.footerLink} onPress={() => router.replace(returnTo || '/')} disabled={saving}><Text style={styles.skipText}>暂时跳过</Text></TouchableOpacity></View>
  </View></KeyboardAvoidingView></Screen>;
}

const createStyles = (colors: ReturnType<typeof useAppThemeColors>) => StyleSheet.create({
  container: { flex: 1 }, scrollView: { flex: 1 }, content: { flexGrow: 1, padding: 24, paddingBottom: 28 }, intro: { flex: 1, justifyContent: 'center', paddingBottom: 12 }, selectionArea: { paddingBottom: 10 }, footer: { backgroundColor: colors.canvas, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 }, footerLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }, footerLink: { minWidth: 86, alignItems: 'center', paddingVertical: 4 }, progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors['brand-soft'], marginBottom: 18 }, progress: { height: '100%', borderRadius: 3, backgroundColor: colors.brand }, step: { color: colors['copy-muted'], fontSize: 13, fontWeight: '600', textAlign: 'center' }, iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors['brand-soft'], alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14 }, title: { color: colors['brand-strong'], fontSize: 26, fontWeight: '700', textAlign: 'center' }, subtitle: { color: colors['copy-muted'], fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10, marginBottom: 22 }, goalList: { gap: 10 }, goalCard: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, padding: 14 }, goalCardActive: { borderColor: colors.brand, backgroundColor: colors['brand-soft'] }, goalIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors['brand-soft'], alignItems: 'center', justifyContent: 'center', marginRight: 12 }, goalIconActive: { backgroundColor: colors['brand-fill'] }, goalCopy: { flex: 1 }, goalTitle: { color: colors['brand-strong'], fontSize: 16, fontWeight: '700' }, goalDescription: { color: colors['copy-muted'], fontSize: 12, marginTop: 3 }, radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }, radioActive: { borderColor: colors['brand-fill'] }, radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors['brand-fill'] }, card: { backgroundColor: colors.surface, borderRadius: 20, padding: 20, shadowColor: colors['brand-strong'], shadowOpacity: 0.06, shadowRadius: 12, elevation: 2 }, sectionTitle: { color: colors['brand-strong'], fontSize: 17, fontWeight: '700', marginBottom: 16, textAlign: 'center' }, label: { color: colors.ink, fontSize: 13, fontWeight: '600', marginBottom: 7, textAlign: 'center' }, options: { flexDirection: 'row', gap: 10, marginBottom: 12 }, option: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' }, optionActive: { backgroundColor: colors['brand-soft'], borderColor: colors.brand }, optionText: { color: colors['copy-muted'], fontSize: 14, textAlign: 'center' }, optionTextActive: { color: colors.brand, fontWeight: '700' }, sliderGroup: { marginTop: 14 }, sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, valuePill: { backgroundColor: colors['brand-soft'], borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }, valueText: { color: colors.brand, fontSize: 14, fontWeight: '700' }, sliderTouchArea: { height: 35, justifyContent: 'center', marginTop: 3 }, sliderTrack: { height: 6, borderRadius: 3, backgroundColor: colors.line }, sliderFill: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: colors['brand-fill'] }, sliderThumb: { position: 'absolute', width: 19, height: 19, borderRadius: 10, top: -6.5, backgroundColor: colors.brand, borderWidth: 3, borderColor: colors.surface, transform: [{ translateX: -9.5 }], shadowColor: colors['brand-strong'], shadowOpacity: 0.15, shadowRadius: 3, elevation: 2 }, sliderBounds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 }, sliderBoundsText: { color: colors['copy-muted'], fontSize: 11 }, hint: { color: colors['copy-muted'], fontSize: 13, lineHeight: 19, backgroundColor: colors['brand-soft'], padding: 12, borderRadius: 12, marginTop: 18, textAlign: 'center' }, choiceRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line }, choiceRowActive: { backgroundColor: colors['brand-soft'], marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 10 }, choiceTitle: { color: colors['brand-strong'], fontSize: 14, fontWeight: '700' }, choiceDescription: { color: colors['copy-muted'], fontSize: 12, marginTop: 2 }, preferenceTitle: { marginTop: 22 }, preferenceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'center' }, preference: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }, preferenceActive: { backgroundColor: colors['brand-soft'], borderColor: colors.brand }, preferenceText: { color: colors['copy-muted'], fontSize: 13, textAlign: 'center' }, preferenceTextActive: { color: colors.brand, fontWeight: '700' }, error: { color: colors.critical, fontSize: 14, textAlign: 'center', marginTop: 16 }, primaryButton: { height: 54, borderRadius: 16, backgroundColor: colors['brand-fill'], alignItems: 'center', justifyContent: 'center' }, buttonDisabled: { opacity: 0.65 }, primaryButtonText: { color: colors['on-brand'], fontSize: 16, fontWeight: '700' }, backText: { color: colors['copy-muted'], fontSize: 14, fontWeight: '600' }, skipText: { color: colors['copy-muted'], fontSize: 14, fontWeight: '600' },
  safetyTitle: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 15, marginBottom: 9 }, safetyPreferenceActive: { backgroundColor: colors['danger-soft'], borderColor: colors.critical }, safetyPreferenceText: { color: colors.critical, fontWeight: '700' }, allergyRow: { marginTop: 9, padding: 10, borderRadius: 12, backgroundColor: colors['background-secondary'], borderWidth: 1, borderColor: colors.line }, allergyName: { color: colors.ink, fontSize: 13, fontWeight: '700', marginBottom: 7 }, severityRow: { flexDirection: 'row', gap: 7 }, severityButton: { flex: 1, paddingVertical: 6, borderRadius: 9, backgroundColor: colors['background-secondary'], alignItems: 'center' }, severityActive: { backgroundColor: colors['brand-soft'] }, severityDanger: { backgroundColor: colors['danger-soft'] }, severityText: { color: colors['copy-muted'], fontSize: 11 }, severityTextActive: { color: colors.critical, fontWeight: '700' }, safetyInput: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors['background-secondary'], paddingHorizontal: 12, paddingVertical: 11, color: colors.ink, fontSize: 13, textAlignVertical: 'top' }, safetyHint: { marginTop: 6, color: colors.critical, fontSize: 10, lineHeight: 15 },
});
