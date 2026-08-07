import { useCallback, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useFocusEffect } from "expo-router";
import { Screen } from "@/components/Screen";
import { useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { healthApi } from "@/services/api";
import {
  ALLERGY_LABELS,
  type AllergyEntry,
  type AllergySeverity,
  type AllergyType,
  type HealthProfile,
} from "@/utils/healthProfile";

type IconName = ComponentProps<typeof FontAwesome6>["name"];

const COMMON_ALLERGIES: Array<{ name: string; type: AllergyType }> = [
  { name: "坚果", type: "allergy" },
  { name: "海鲜", type: "allergy" },
  { name: "乳制品", type: "allergy" },
  { name: "乳糖", type: "intolerance" },
  { name: "麸质", type: "intolerance" },
  { name: "鸡蛋", type: "allergy" },
  { name: "大豆", type: "allergy" },
];

const CONDITIONS = ["糖尿病", "高血压", "高尿酸", "肾病", "胃肠问题", "孕期", "哺乳期"];
const RESTRICTIONS = ["蛋奶素", "纯素", "不吃猪肉", "清真", "低盐", "低糖", "低嘌呤"];

const PRESETS = [
  { label: "均衡减脂", kcal: "1600", protein: "80", salt: "4", sugar: "20", water: "2000" },
  { label: "增肌高蛋白", kcal: "2200", protein: "120", salt: "5", sugar: "25", water: "2500" },
  { label: "控糖心血管", kcal: "1500", protein: "75", salt: "3", sugar: "15", water: "1800" },
];

const numberOrNull = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function HealthProfileScreen() {
  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [gender, setGender] = useState("保密");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [allergies, setAllergies] = useState<AllergyEntry[]>([]);
  const [customAllergy, setCustomAllergy] = useState("");
  const [customAllergyType, setCustomAllergyType] = useState<AllergyType>("allergy");
  const [medications, setMedications] = useState("");
  const [conditions, setConditions] = useState<string[]>([]);
  const [medicalNotes, setMedicalNotes] = useState("");
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [dislikedFoods, setDislikedFoods] = useState("");
  const [mealTime, setMealTime] = useState("");
  const [budget, setBudget] = useState("");
  const [cookingLevel, setCookingLevel] = useState<"beginner" | "intermediate" | "advanced" | null>(null);
  const [servings, setServings] = useState("");
  const [eatingOut, setEatingOut] = useState<"rarely" | "sometimes" | "often" | null>(null);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [salt, setSalt] = useState("");
  const [sugar, setSugar] = useState("");
  const [water, setWater] = useState("");
  const [professionalAdvice, setProfessionalAdvice] = useState("");
  const [trackingEnabled, setTrackingEnabled] = useState(true);

  // Live Calculations: BMI & BMR
  const bmiInfo = useMemo(() => {
    const h = Number(height) / 100;
    const w = Number(weight);
    if (!h || !w || h <= 0 || w <= 0) return null;
    const bmi = Number((w / (h * h)).toFixed(1));
    let status = "标准";
    let badgeBg = "bg-[#E8F2EA]";
    let textColor = "text-brand";
    if (bmi < 18.5) {
      status = "偏瘦";
      badgeBg = "bg-[#FEF3C7]";
      textColor = "text-[#D97706]";
    } else if (bmi >= 24 && bmi < 28) {
      status = "偏重";
      badgeBg = "bg-[#FFEDD5]";
      textColor = "text-[#EA580C]";
    } else if (bmi >= 28) {
      status = "肥胖";
      badgeBg = "bg-[#FEE2E2]";
      textColor = "text-[#DC2626]";
    }
    return { bmi, status, badgeBg, textColor };
  }, [height, weight]);

  const bmrValue = useMemo(() => {
    const h = Number(height);
    const w = Number(weight);
    const a = Number(age) || 25;
    if (!h || !w) return null;
    const genderOffset = gender === "男" ? 5 : gender === "女" ? -161 : -78;
    const bmr = Math.round(10 * w + 6.25 * h - 5 * a + genderOffset);
    return bmr > 500 ? bmr : null;
  }, [gender, height, weight, age]);

  const applyProfile = useCallback((profile: HealthProfile | null) => {
    if (!profile) return;
    setGender(profile.gender || "保密");
    setAge(profile.age == null ? "" : String(profile.age));
    setHeight(profile.height == null ? "" : String(profile.height));
    setWeight(profile.weight == null ? "" : String(profile.weight));
    setTargetWeight(profile.target_weight == null ? "" : String(profile.target_weight));
    setAllergies(Array.isArray(profile.allergies) ? profile.allergies : []);
    setMedications(profile.medications || "");
    setConditions(Array.isArray(profile.medical_conditions) ? profile.medical_conditions : []);
    setMedicalNotes(profile.medical_notes || "");
    setRestrictions(Array.isArray(profile.dietary_restrictions) ? profile.dietary_restrictions : []);
    setDislikedFoods(profile.disliked_foods || "");
    const kitchen = profile.kitchen_constraints || {};
    setMealTime(kitchen.meal_time_minutes == null ? "" : String(kitchen.meal_time_minutes));
    setBudget(kitchen.budget_per_meal == null ? "" : String(kitchen.budget_per_meal));
    setCookingLevel(kitchen.cooking_level || null);
    setServings(kitchen.servings == null ? "" : String(kitchen.servings));
    setEatingOut(kitchen.eating_out_frequency || null);
    const targets = profile.nutrition_targets || {};
    setCalories(targets.calories_kcal == null ? "" : String(targets.calories_kcal));
    setProtein(targets.protein_g == null ? "" : String(targets.protein_g));
    setSalt(targets.salt_g == null ? "" : String(targets.salt_g));
    setSugar(targets.sugar_g == null ? "" : String(targets.sugar_g));
    setWater(targets.water_ml == null ? "" : String(targets.water_ml));
    setProfessionalAdvice(targets.professional_advice || "");
    setTrackingEnabled(profile.tracking_enabled == null ? true : Boolean(profile.tracking_enabled));
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      applyProfile(await healthApi.profile<HealthProfile>(authFetch));
    } catch (error) {
      console.error("Failed to load health profile", error);
    } finally {
      setLoading(false);
    }
  }, [applyProfile, authFetch]);

  useFocusEffect(useCallback(() => { void fetchProfile(); }, [fetchProfile]));

  const toggleListValue = (value: string, values: string[], setter: (next: string[]) => void) => {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  const toggleAllergy = (entry: { name: string; type: AllergyType }) => {
    const exists = allergies.some((item) => item.name === entry.name);
    if (exists) {
      setAllergies((current) => current.filter((item) => item.name !== entry.name));
      return;
    }
    setAllergies((current) => [...current, { ...entry, severity: "moderate" }]);
  };

  const setItemSeverity = (name: string, severity: AllergySeverity) => {
    setAllergies((current) =>
      current.map((item) => (item.name === name ? { ...item, severity } : item))
    );
  };

  const removeAllergy = (name: string) => {
    setAllergies((current) => current.filter((item) => item.name !== name));
  };

  const addCustomAllergy = () => {
    const name = customAllergy.trim();
    if (!name || allergies.some((item) => item.name === name)) return;
    setAllergies((current) => [...current, { name, type: customAllergyType, severity: "moderate" }]);
    setCustomAllergy("");
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setCalories(preset.kcal);
    setProtein(preset.protein);
    setSalt(preset.salt);
    setSugar(preset.sugar);
    setWater(preset.water);
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await healthApi.saveProfile<HealthProfile>(authFetch, {
        gender,
        age: numberOrNull(age),
        height: numberOrNull(height),
        weight: numberOrNull(weight),
        target_weight: numberOrNull(targetWeight),
        allergies,
        medications,
        medical_conditions: conditions,
        medical_notes: medicalNotes,
        dietary_restrictions: restrictions,
        disliked_foods: dislikedFoods,
        kitchen_constraints: {
          meal_time_minutes: numberOrNull(mealTime),
          budget_per_meal: numberOrNull(budget),
          cooking_level: cookingLevel,
          servings: numberOrNull(servings),
          eating_out_frequency: eatingOut,
        },
        nutrition_targets: {
          calories_kcal: numberOrNull(calories),
          protein_g: numberOrNull(protein),
          salt_g: numberOrNull(salt),
          sugar_g: numberOrNull(sugar),
          water_ml: numberOrNull(water),
          professional_advice: professionalAdvice,
        },
        tracking_enabled: trackingEnabled,
      });
      Alert.alert("已保存", "安全与健康限制已成功更新，用于全站食谱阻断与推荐。", [
        { text: "完成", onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请检查网络后重试");
    } finally {
      setSaving(false);
    }
  };

  const clearSensitiveProfile = () => {
    Alert.alert("清空安全与健康限制？", "将删除过敏、用药、疾病备注、饮食限制和专业建议，不会删除账号。", [
      { text: "取消", style: "cancel" },
      {
        text: "确认清空",
        style: "destructive",
        onPress: async () => {
          try {
            setSaving(true);
            await healthApi.saveProfile(authFetch, {
              allergies: [], medications: "", medical_conditions: [], medical_notes: "",
              dietary_restrictions: [], disliked_foods: "", nutrition_targets: {}, tracking_enabled: false,
            });
            setAllergies([]); setMedications(""); setConditions([]); setMedicalNotes("");
            setRestrictions([]); setDislikedFoods(""); setProfessionalAdvice(""); setTrackingEnabled(false);
            setCalories(""); setProtein(""); setSalt(""); setSugar(""); setWater("");
          } catch (error) {
            Alert.alert("清空失败", error instanceof Error ? error.message : "请稍后重试");
          } finally { setSaving(false); }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2D6A4F" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Dietdigidose Platform Top Navigation Header */}
        <View className="border-b border-line bg-canvas">
          <View className="mx-auto flex-row h-14 w-full max-w-2xl items-center justify-between px-4">
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityLabel="返回"
              className="h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm border border-line"
            >
              <FontAwesome6 name="arrow-left" size={15} color="#3D3229" />
            </TouchableOpacity>

            <View className="items-center">
              <Text className="text-lg font-black text-ink">健康与饮食档案</Text>
              <Text className="text-[10px] text-copy-muted">食语 · 智能膳食安全中枢</Text>
            </View>

            <TouchableOpacity
              onPress={saveProfile}
              disabled={saving}
              className="h-9 px-3.5 flex-row items-center justify-center rounded-full bg-brand shadow-sm"
            >
              <FontAwesome6 name="check" size={12} color="white" />
              <Text className="ml-1.5 text-xs font-bold text-white">{saving ? "保存中" : "保存"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Scrollable Form Body */}
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="px-4 pb-36 pt-4"
        >
          <View className="mx-auto w-full max-w-2xl gap-4">
            {/* Security Guarantee Banner */}
            <View className="flex-row items-center rounded-2xl border border-[#E7DED2] bg-white p-3.5 shadow-sm">
              <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#E8F2EA]">
                <FontAwesome6 name="shield-halved" size={14} color="#2D6A4F" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-xs font-bold text-ink">食语安全防线保障</Text>
                <Text className="mt-0.5 text-[11px] leading-4 text-[#786C60]">
                  档案数据用于全站菜谱风险检测与食材智能替换；不作为医学诊断，可随时修改。
                </Text>
              </View>
            </View>

            {/* Smart Health Calculator Widget */}
            <View className="rounded-3xl border border-line bg-white p-4 shadow-sm">
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center gap-2">
                  <View className="h-8 w-8 items-center justify-center rounded-xl bg-[#E8F2EA]">
                    <FontAwesome6 name="heart-pulse" size={14} color="#2D6A4F" />
                  </View>
                  <View>
                    <Text className="text-sm font-black text-ink">智能健康指标大盘</Text>
                    <Text className="text-[10px] text-copy-muted">根据个人身体数据实时动态测算</Text>
                  </View>
                </View>

                {bmiInfo ? (
                  <View className={`rounded-full px-3 py-1 ${bmiInfo.badgeBg}`}>
                    <Text className={`text-[10px] font-black ${bmiInfo.textColor}`}>
                      BMI {bmiInfo.bmi} · {bmiInfo.status}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-[10px] text-copy-muted">输入身高体重即可自动测算</Text>
                )}
              </View>

              <View className="flex-row divide-x divide-[#EBE3D5] border-t border-[#F3EDDF] pt-3">
                <View className="flex-1 items-center">
                  <Text className="text-[10px] font-bold text-copy-muted">BMI 指数</Text>
                  <Text className="mt-0.5 text-base font-black text-ink">
                    {bmiInfo ? bmiInfo.bmi : "--"}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-[10px] font-bold text-copy-muted">预估基础代谢 BMR</Text>
                  <Text className="mt-0.5 text-base font-black text-ink">
                    {bmrValue ? `${bmrValue} kcal` : "--"}
                  </Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-[10px] font-bold text-copy-muted">过敏阻断防线</Text>
                  <Text className="mt-0.5 text-base font-black text-brand">
                    {allergies.length ? `${allergies.length} 项` : "全绿安全"}
                  </Text>
                </View>
              </View>
            </View>

            {/* SECTION 01: 基础档案 */}
            <SectionCard icon="id-card" title="基础档案" subtitle="建立日常营养与卡路里估算的基本数据">
              <FieldLabel>性别</FieldLabel>
              <View className="flex-row gap-2">
                {["男", "女", "保密"].map((item) => (
                  <TouchableOpacity
                    key={item}
                    onPress={() => setGender(item)}
                    className={`flex-1 items-center rounded-xl border py-2.5 ${
                      gender === item
                        ? "border-brand bg-[#E8F2EA]"
                        : "border-[#E2D9CC] bg-[#FAF8F4]"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        gender === item ? "text-brand" : "text-[#766A5E]"
                      }`}
                    >
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="mt-4 gap-3">
                <View className="flex-row gap-3">
                  <NumberField label="年龄" unit="岁" icon="cake-candles" value={age} onChangeText={setAge} />
                  <NumberField label="身高" unit="cm" icon="ruler-vertical" value={height} onChangeText={setHeight} />
                </View>
                <View className="flex-row gap-3">
                  <NumberField label="当前体重" unit="kg" icon="weight-scale" value={weight} onChangeText={setWeight} />
                  <NumberField label="目标体重" unit="kg" icon="bullseye" value={targetWeight} onChangeText={setTargetWeight} />
                </View>
              </View>
            </SectionCard>

            {/* SECTION 02: 饮食安全 */}
            <SectionCard icon="triangle-exclamation" title="食物过敏与食材阻断" subtitle="设置常用过敏原，在整站菜谱中进行拦截与风险预警。">
              <ChipGrid>
                {COMMON_ALLERGIES.map((item) => {
                  const isSelected = allergies.some((entry) => entry.name === item.name);
                  return (
                    <Chip
                      key={item.name}
                      label={item.name}
                      selected={isSelected}
                      badge={item.type === "intolerance" ? "不耐受" : "过敏"}
                      onPress={() => toggleAllergy(item)}
                    />
                  );
                })}
              </ChipGrid>

              {/* Active Allergies List with Direct Severity Selectors */}
              {allergies.length > 0 && (
                <View className="mt-4 gap-2 border-t border-[#F3EDDF] pt-3">
                  <Text className="text-xs font-bold text-[#6E6256]">已选过敏/不耐受项目：</Text>
                  {allergies.map((item) => (
                    <View
                      key={item.name}
                      className="flex-row flex-wrap items-center justify-between rounded-2xl border border-line bg-[#FAF8F4] p-3"
                    >
                      <View className="flex-row items-center">
                        <View className="mr-2 h-2.5 w-2.5 rounded-full bg-[#B64D36]" />
                        <Text className="text-sm font-bold text-ink">{item.name}</Text>
                        <Text className="ml-1.5 text-[10px] text-copy-muted">
                          ({item.type === "allergy" ? "过敏" : "不耐受"})
                        </Text>
                      </View>

                      <View className="flex-row items-center gap-1.5">
                        {(["mild", "moderate", "severe"] as AllergySeverity[]).map((sev) => {
                          const active = item.severity === sev;
                          return (
                            <TouchableOpacity
                              key={sev}
                              onPress={() => setItemSeverity(item.name, sev)}
                              className={`rounded-lg px-2.5 py-1 ${
                                active
                                  ? sev === "severe"
                                    ? "bg-[#B42318]"
                                    : "bg-brand"
                                  : "bg-[#EAE3D7]"
                              }`}
                            >
                              <Text
                                className={`text-[10px] font-bold ${
                                  active ? "text-white" : "text-[#6E6256]"
                                }`}
                              >
                                {ALLERGY_LABELS[sev]}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}

                        <TouchableOpacity
                          onPress={() => removeAllergy(item.name)}
                          className="ml-1 h-7 w-7 items-center justify-center rounded-lg bg-white border border-[#E2D9CC]"
                        >
                          <FontAwesome6 name="xmark" size={12} color="#8B7D6B" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Add Custom Allergy */}
              <View className="mt-4 flex-row gap-2">
                <TextInput
                  value={customAllergy}
                  onChangeText={setCustomAllergy}
                  placeholder="其他食物或成分 (如：花生、海鲜粉)"
                  placeholderTextColor="#A39483"
                  className="flex-1 rounded-2xl border border-line bg-[#FAF8F4] px-3.5 py-2.5 text-sm text-ink"
                />
                <TouchableOpacity
                  onPress={() =>
                    setCustomAllergyType((v) => (v === "allergy" ? "intolerance" : "allergy"))
                  }
                  className="justify-center rounded-2xl border border-[#D8E5DC] bg-[#F1F7F2] px-3"
                >
                  <Text className="text-xs font-bold text-brand">
                    {customAllergyType === "allergy" ? "过敏" : "不耐受"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={addCustomAllergy}
                  className="h-11 w-11 items-center justify-center rounded-2xl bg-brand"
                >
                  <FontAwesome6 name="plus" size={14} color="white" />
                </TouchableOpacity>
              </View>
            </SectionCard>

            {/* SECTION 03: 疾病与用药 */}
            <SectionCard icon="heart-pulse" title="疾病与用药" subtitle="只需填写常服药名或特殊生理状态，系统将规避食材药效冲突。">
              <FieldLabel>生理状态 / 健康偏好</FieldLabel>
              <ChipGrid>
                {CONDITIONS.map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    selected={conditions.includes(item)}
                    onPress={() => toggleListValue(item, conditions, setConditions)}
                  />
                ))}
              </ChipGrid>

              <View className="mt-4">
                <FieldLabel>简短备注（可选）</FieldLabel>
                <MultilineInput
                  value={medicalNotes}
                  onChangeText={setMedicalNotes}
                  placeholder="例如：医生要求控制钠摄入、避免冷饮"
                />
              </View>

              <View className="mt-4">
                <FieldLabel>常服药品与时段</FieldLabel>
                <MultilineInput
                  value={medications}
                  onChangeText={setMedications}
                  placeholder="例如：二甲双胍，早晚随餐；钙片，睡前"
                />
              </View>

              <View className="mt-3 flex-row rounded-2xl bg-[#FFF3EF] border border-[#FADBD3] p-3">
                <FontAwesome6 name="circle-info" size={13} color="#B64D36" style={{ marginTop: 1 }} />
                <Text className="ml-2.5 flex-1 text-[11px] leading-4 text-[#9A4D3A]">
                  食语系统仅用于识别可能影响药效或引发冲突的特殊食材（如西柚与特定药物），绝不会建议停药或调整剂量。
                </Text>
              </View>
            </SectionCard>

            {/* Dietdigidose AI Assistant Banner */}
            <TouchableOpacity
              onPress={() => router.push("/ai-assistant")}
              className="flex-row items-center justify-between rounded-3xl border border-[#D8E5DC] bg-white p-4 shadow-sm"
            >
              <View className="flex-row items-center gap-3 flex-1">
                <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#E8F2EA]">
                  <FontAwesome6 name="comments" size={16} color="#2D6A4F" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-black text-ink">遇到不确定的食材与禁忌？</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">随时向【食语 AI 助手】发图或提问咨询</Text>
                </View>
              </View>
              <View className="flex-row items-center rounded-full bg-[#E8F2EA] px-3 py-1.5">
                <Text className="text-xs font-bold text-brand">去提问</Text>
                <FontAwesome6 name="chevron-right" size={10} color="#2D6A4F" style={{ marginLeft: 4 }} />
              </View>
            </TouchableOpacity>

            {/* SECTION 04: 饮食限制与忌口 */}
            <SectionCard icon="utensils" title="饮食限制与忌口" subtitle="管理个人饮食习惯、宗教戒律或个人避忌食材。">
              <FieldLabel>饮食习惯与限制</FieldLabel>
              <ChipGrid>
                {RESTRICTIONS.map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    selected={restrictions.includes(item)}
                    onPress={() => toggleListValue(item, restrictions, setRestrictions)}
                  />
                ))}
              </ChipGrid>
              <View className="mt-4">
                <FieldLabel>不喜欢的食物 / 偏好避开</FieldLabel>
                <MultilineInput
                  value={dislikedFoods}
                  onChangeText={setDislikedFoods}
                  placeholder="例如：香菜、苦瓜、芹菜、动物内脏"
                />
              </View>
            </SectionCard>

            {/* SECTION 05: 营养目标 */}
            <SectionCard icon="bullseye" title="每日营养目标" subtitle="没有明确目标时可以留空，系统会自动按推荐标准匹配。">
              {/* Presets & TDEE Smart Calculator */}
              <View className="flex-row items-center justify-between gap-2 mb-3">
                <Text className="text-xs font-bold text-[#6E6256]">快捷推荐：</Text>
                <View className="flex-row items-center gap-1.5 flex-wrap flex-1 justify-end">
                  {PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset.label}
                      onPress={() => applyPreset(preset)}
                      className="rounded-full border border-[#D8E5DC] bg-[#F1F7F2] px-2.5 py-1"
                    >
                      <Text className="text-[11px] font-bold text-brand">{preset.label}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => {
                      const baseBmr = bmrValue || 1600;
                      const w = Number(weight) || 60;
                      const targetKcal = Math.round(baseBmr * 1.2 - 250);
                      const targetProtein = Math.round(w * 1.6);
                      setCalories(String(targetKcal));
                      setProtein(String(targetProtein));
                      setSalt("4");
                      setSugar("20");
                      setWater("2200");
                      Alert.alert("TDEE 智能计算", `根据你的基础代谢 (${baseBmr} kcal) 与目标，已为你自动配置减脂期推荐每日热量 (${targetKcal} kcal) 与蛋白质 (${targetProtein}g)。`);
                    }}
                    className="rounded-full border border-brand bg-brand px-3 py-1 flex-row items-center gap-1 active:opacity-80"
                  >
                    <FontAwesome6 name="wand-magic-sparkles" size={10} color="#FFF" />
                    <Text className="text-[11px] font-black text-white">根据 BMR 智能估算</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View className="gap-3">
                <View className="flex-row gap-3">
                  <NumberField label="每日热量" unit="kcal" icon="fire" value={calories} onChangeText={setCalories} />
                  <NumberField label="蛋白质" unit="g" icon="egg" value={protein} onChangeText={setProtein} />
                </View>
                <View className="flex-row gap-3">
                  <NumberField label="盐" unit="g" icon="bottle-droplet" value={salt} onChangeText={setSalt} />
                  <NumberField label="添加糖" unit="g" icon="cubes-stacked" value={sugar} onChangeText={setSugar} />
                </View>
                <View className="flex-row gap-3">
                  <NumberField label="每日饮水" unit="ml" icon="droplet" value={water} onChangeText={setWater} />
                  <View className="flex-1" />
                </View>
              </View>
              <View className="mt-4">
                <FieldLabel>医生或营养师建议（可选）</FieldLabel>
                <MultilineInput
                  value={professionalAdvice}
                  onChangeText={setProfessionalAdvice}
                  placeholder="例如：建议每日优质蛋白质占比 >50%，尽量采用蒸煮方式"
                />
              </View>
            </SectionCard>

            {/* SECTION 06: 厨房与生活 */}
            <SectionCard icon="kitchen-set" title="厨房与生活约束" subtitle="帮助 AI 推荐最契合您做饭习惯与时间成本的食谱。">
              <View className="flex-row gap-3">
                <NumberField label="每餐时间" unit="分钟" icon="clock" value={mealTime} onChangeText={setMealTime} />
                <NumberField label="每餐预算" unit="元" icon="yen-sign" value={budget} onChangeText={setBudget} />
              </View>
              <ChoiceRow
                label="烹饪水平"
                options={[
                  { value: "beginner", label: "新手" },
                  { value: "intermediate", label: "熟练" },
                  { value: "advanced", label: "进阶" },
                ]}
                value={cookingLevel}
                onChange={setCookingLevel}
              />
              <View className="mt-4 flex-row gap-3">
                <NumberField label="就餐人数" unit="人" icon="users" value={servings} onChangeText={setServings} />
                <View className="flex-1" />
              </View>
              <ChoiceRow
                label="外食频率"
                options={[
                  { value: "rarely", label: "很少" },
                  { value: "sometimes", label: "偶尔" },
                  { value: "often", label: "经常" },
                ]}
                value={eatingOut}
                onChange={setEatingOut}
              />
            </SectionCard>

            {/* SECTION 07: 体征与健康中枢 */}
            <SectionCard icon="chart-line" title="体征与健康中枢" subtitle="结合体重、血压、血糖等记录，为您生成长期健康趋势分析。">
              <TouchableOpacity
                onPress={() => setTrackingEnabled((value) => !value)}
                className="flex-row items-center justify-between rounded-2xl bg-[#F5F1E9] p-3.5 border border-[#EAE3D7]"
              >
                <View className="mr-4 flex-1">
                  <Text className="text-sm font-bold text-ink">允许个性化趋势参考</Text>
                  <Text className="mt-1 text-[11px] leading-4 text-copy-muted">
                    体征数据仅在您主动记录时用于生成健康趋势曲线。
                  </Text>
                </View>
                <View
                  className={`h-7 w-12 justify-center rounded-full px-1 ${
                    trackingEnabled ? "bg-brand" : "bg-[#CFC6B9]"
                  }`}
                >
                  <View
                    className={`h-5 w-5 rounded-full bg-white shadow-sm ${
                      trackingEnabled ? "self-end" : "self-start"
                    }`}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => router.push("/health-data")}
                className="mt-3 flex-row items-center justify-center rounded-2xl border border-[#D8E5DC] bg-white py-3 shadow-sm"
              >
                <Text className="mr-2 text-xs font-black text-brand">管理体征追踪中枢</Text>
                <FontAwesome6 name="arrow-right" size={11} color="#2D6A4F" />
              </TouchableOpacity>
            </SectionCard>

            {/* Clear Sensitive Data */}
            <TouchableOpacity
              onPress={clearSensitiveProfile}
              disabled={saving}
              className="mb-6 mt-4 flex-row items-center justify-center rounded-2xl border border-[#F5D4CB] bg-[#FFF8F6] py-3.5"
            >
              <FontAwesome6 name="trash-can" size={13} color="#B64D36" />
              <Text className="ml-2 text-xs font-bold text-[#B64D36]">清空安全与健康限制资料</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Bottom Save Action Bar */}
        <View className="absolute bottom-0 left-0 right-0 border-t border-line bg-canvas/95 px-4 pb-6 pt-3 shadow-lg backdrop-blur-md">
          <View className="mx-auto w-full max-w-2xl">
            <TouchableOpacity
              onPress={saveProfile}
              disabled={saving}
              className={`h-13 flex-row items-center justify-center rounded-2xl bg-brand py-3.5 shadow-md active:opacity-90 ${
                saving ? "opacity-60" : ""
              }`}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <FontAwesome6 name="floppy-disk" size={16} color="white" />
                  <Text className="ml-2 text-base font-black text-white">保存健康与饮食档案</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  </Screen>
);
}
function SectionCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <View className="rounded-3xl border border-line bg-white p-4.5 shadow-sm">
      <View className="mb-4 flex-row items-start">
        <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#E8F2EA]">
          <FontAwesome6 name={icon} size={15} color="#2D6A4F" />
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-base font-black text-ink">{title}</Text>
          <Text className="mt-1 text-[11px] leading-4 text-copy-muted">{subtitle}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <Text className="mb-2 text-xs font-bold text-[#6E6256]">{children}</Text>;
}

function ChipGrid({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}

function Chip({
  label,
  selected,
  badge,
  onPress,
}: {
  label: string;
  selected: boolean;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center rounded-full border px-3.5 py-2 ${
        selected ? "border-brand bg-[#E8F2EA]" : "border-[#E2D9CC] bg-[#FAF8F4]"
      }`}
    >
      <Text className={`text-xs font-bold ${selected ? "text-brand" : "text-[#766A5E]"}`}>
        {label}
      </Text>
      {badge && !selected && (
        <Text className="ml-1 text-[9px] font-medium text-[#A39483]">({badge})</Text>
      )}
    </TouchableOpacity>
  );
}

function Segment({
  label,
  selected,
  danger,
  onPress,
}: {
  label: string;
  selected: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-1 items-center rounded-xl border py-2.5 ${
        selected
          ? danger
            ? "border-[#B42318] bg-[#FFF0EE]"
            : "border-brand bg-[#E8F2EA]"
          : "border-[#E2D9CC] bg-[#FAF8F4]"
      }`}
    >
      <Text
        className={`text-xs font-bold ${
          selected ? (danger ? "text-[#B42318]" : "text-brand") : "text-[#766A5E]"
        }`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function MultilineInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#A39483"
      multiline
      textAlignVertical="top"
      className="min-h-20 rounded-2xl border border-line bg-[#FAF8F4] px-3.5 py-3 text-sm leading-5 text-ink"
    />
  );
}

function NumberField({
  label,
  unit,
  icon,
  value,
  onChangeText,
}: {
  label: string;
  unit: string;
  icon?: IconName;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View className="flex-1 min-w-0">
      <Text className="mb-1.5 text-xs font-bold text-[#6E6256]">{label}</Text>
      <View className="flex-row items-center rounded-2xl border border-line bg-[#FAF8F4] px-3 py-1 overflow-hidden">
        {icon && <FontAwesome6 name={icon} size={12} color="#8B7D6B" style={{ marginRight: 6 }} />}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor="#C5B8A8"
          className="flex-1 min-w-0 py-1.5 text-sm font-bold text-ink"
          style={Platform.OS === "web" ? ({ outlineStyle: "none", minWidth: 0 } as any) : undefined}
        />
        <Text className="ml-1 shrink-0 text-xs font-bold text-copy-muted">{unit}</Text>
      </View>
    </View>
  );
}

function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View className="mt-4">
      <Text className="mb-2 text-xs font-bold text-[#6E6256]">{label}</Text>
      <View className="flex-row gap-2">
        {options.map((item) => (
          <Segment
            key={item.value}
            label={item.label}
            selected={value === item.value}
            onPress={() => onChange(item.value)}
          />
        ))}
      </View>
    </View>
  );
}
