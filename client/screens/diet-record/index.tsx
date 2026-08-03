import { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { addLocalDays, toLocalDateKey } from "@/utils/date";
import { aiApi, ApiError, dietApi } from "@/services/api";

import * as ImagePicker from "expo-image-picker";

interface DietRecord {
  id: number;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  recorded_at: string;
  image_url: string | null;
}

interface PresetFood {
  name: string;
  amount: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

const QUICK_PRESETS: PresetFood[] = [
  { name: "水煮蛋", amount: "1个 (约50g)", calories: "70", protein: "6.5", carbs: "0.6", fat: "5" },
  { name: "煎鸡胸肉", amount: "150g", calories: "240", protein: "35", carbs: "0", fat: "4" },
  { name: "全麦面包", amount: "2片 (约70g)", calories: "160", protein: "6", carbs: "28", fat: "2" },
  { name: "无糖黑咖啡", amount: "1杯 (350ml)", calories: "10", protein: "0.5", carbs: "1", fat: "0" },
  { name: "鸡肉鲜蔬沙拉", amount: "1份 (300g)", calories: "320", protein: "25", carbs: "15", fat: "12" },
  { name: "牛奶燕麦粥", amount: "1碗 (250ml)", calories: "220", protein: "10", carbs: "30", fat: "6" },
  { name: "红富士苹果", amount: "1个 (约200g)", calories: "95", protein: "0.4", carbs: "25", fat: "0.3" },
  { name: "低脂无糖酸奶", amount: "1杯 (150g)", calories: "90", protein: "7.5", carbs: "9", fat: "1.5" },
];

export default function DietRecordScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<any>();
  const { isAuthenticated, user } = useAuth();
  const authFetch = useAuthFetch();

  const todayStr = toLocalDateKey();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [records, setRecords] = useState<DietRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  // Form
  const [mealType, setMealType] = useState("早餐");
  const [foodName, setFoodName] = useState("");
  const [amount, setAmount] = useState("1份");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // 监听路由预填参数
  useEffect(() => {
      if (params.prefill_food) {
      setFoodName(String(params.prefill_food));
      if (params.prefill_calories !== undefined) setCalories(String(params.prefill_calories));
      if (params.prefill_protein !== undefined) setProtein(String(params.prefill_protein));
      if (params.prefill_carbs !== undefined) setCarbs(String(params.prefill_carbs));
      if (params.prefill_fat !== undefined) setFat(String(params.prefill_fat));
      if (params.prefill_amount) setAmount(String(params.prefill_amount));
      if (params.prefill_meal_type) setMealType(String(params.prefill_meal_type));
      if (params.recorded_at) setSelectedDate(String(params.recorded_at));
      setModalVisible(true);
    }
  }, [params]);

  const mealCategories = [
    { name: "早餐", icon: "sun", color: "#E9C46A", recommended: "建议 400-550 kcal" },
    { name: "午餐", icon: "utensils", color: "#2D6A4F", recommended: "建议 600-750 kcal" },
    { name: "晚餐", icon: "moon", color: "#D4A276", recommended: "建议 450-600 kcal" },
    { name: "加餐", icon: "cookie", color: "#E07A5F", recommended: "建议 150-300 kcal" },
  ];

  // 生成过去 7 天的日期数组
  const pastSevenDays = Array.from({ length: 7 }).map((_, i) => {
    const d = addLocalDays(-(6 - i));
    const dateStr = toLocalDateKey(d);
    const dayName = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const isToday = dateStr === todayStr;
    return { dateStr, dayNum: d.getDate(), dayName, isToday };
  });

  const fetchRecords = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const data = await dietApi.list(authFetch, selectedDate);
      setRecords(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, authFetch, selectedDate]);

  useFocusEffect(
    useCallback(() => {
      fetchRecords();
    }, [fetchRecords])
  );

  const openAddModal = (meal: string) => {
    setMealType(meal);
    setFoodName("");
    setAmount("1份");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
    setImageUrl("");
    setModalVisible(true);
  };

  const applyPreset = (preset: PresetFood) => {
    setFoodName(preset.name);
    setAmount(preset.amount);
    setCalories(preset.calories);
    setProtein(preset.protein);
    setCarbs(preset.carbs);
    setFat(preset.fat);
  };

  const handlePickImageAndRecognize = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      if (asset.uri) setImageUrl(asset.uri);

      if (!asset.base64) {
        Alert.alert("提示", "图片编码失败，请重试");
        return;
      }

      setAiAnalyzing(true);
      const json = await aiApi.visionFood<{ data?: Record<string, number | string>; rawText?: string }>(authFetch, asset.base64);
      if (json.data) {
          if (json.data.foodName) setFoodName(String(json.data.foodName));
          if (json.data.estimatedWeightGrams) setAmount(`${json.data.estimatedWeightGrams}g`);
          if (json.data.calories) setCalories(String(json.data.calories));
          if (json.data.proteinGrams !== undefined) setProtein(String(json.data.proteinGrams));
          if (json.data.carbsGrams !== undefined) setCarbs(String(json.data.carbsGrams));
          if (json.data.fatGrams !== undefined) setFat(String(json.data.fatGrams));
          Alert.alert("AI 识别成功", `已自动识别【${json.data.foodName}】并估算营养成分！`);
      } else if (json.rawText) {
        Alert.alert("AI 识别提示", json.rawText);
      }
    } catch (e: any) {
      Alert.alert("错误", e.message || "识图出现异常");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!foodName.trim()) {
      Alert.alert("提示", "请输入食物名称");
      return;
    }
    try {
      setSaving(true);
      const parseNullableNumber = (value: string) => {
        if (!value.trim()) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const payload = {
        meal_type: mealType,
        food_name: foodName,
        amount,
        calories: parseNullableNumber(calories),
        protein: parseNullableNumber(protein),
        carbs: parseNullableNumber(carbs),
        fat: parseNullableNumber(fat),
        recorded_at: selectedDate,
        image_url: imageUrl.trim() || null,
      };

      await dietApi.create(authFetch, payload);
      setModalVisible(false);
      fetchRecords();
    } catch (e) {
      Alert.alert("错误", e instanceof ApiError ? e.message : "网络异常");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert("确认删除", "要删除此打卡记录吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await dietApi.remove(authFetch, id);
            fetchRecords();
          } catch (e) {
            console.error(e);
          }
        },
      },
    ]);
  };

  const dayTotalCal = records.reduce((s, r) => s + (r.calories || 0), 0);
  const dayTotalProtein = Math.round(records.reduce((s, r) => s + (r.protein || 0), 0) * 10) / 10;
  const dayTotalCarbs = Math.round(records.reduce((s, r) => s + (r.carbs || 0), 0) * 10) / 10;
  const dayTotalFat = Math.round(records.reduce((s, r) => s + (r.fat || 0), 0) * 10) / 10;

  const targetCal = user?.daily_calories_target || 2000;
  const progressPercent = Math.min(Math.round((dayTotalCal / targetCal) * 100), 100);
  const remainingCal = Math.max(0, targetCal - dayTotalCal);

  const handleCloseModal = () => {
    setModalVisible(false);
    router.setParams({});
  };

  const formattedSelectedDateText = () => {
    const d = new Date(selectedDate);
    const m = d.getMonth() + 1;
    const dateNum = d.getDate();
    const dayName = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
    return `${m}月${dateNum}日 ${dayName}`;
  };

  if (!isAuthenticated) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-16 h-16 rounded-full bg-[#2D6A4F]/10 items-center justify-center mb-4">
            <FontAwesome6 name="utensils" size={28} color="#2D6A4F" />
          </View>
          <Text className="text-xl font-bold text-[#3D3229]">饮食打卡日志</Text>
          <Text className="text-sm text-[#8B7D6B] text-center mt-2 mb-6 px-4 leading-5">
            登录后精准管理每日卡路里、记录三餐摄入与三大营养素分配。
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login")}
            className="bg-[#2D6A4F] px-8 py-3.5 rounded-2xl active:opacity-90 shadow-sm"
          >
            <Text className="text-sm font-bold text-white">立即登录</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen backgroundColor="#FDF8F0">
      <View className="flex-1">
        {/* 顶部 Header */}
        <View className="px-5 pt-4 pb-2 flex-row items-center justify-between">
          <View>
            <Text className="text-2xl font-black text-[#3D3229]">饮食日志</Text>
            <Text className="text-xs text-[#8B7D6B] mt-0.5 font-medium">
              {formattedSelectedDateText()}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            {selectedDate !== todayStr && (
              <TouchableOpacity
                onPress={() => setSelectedDate(todayStr)}
                className="bg-[#F5EFE6] px-3 py-2 rounded-xl active:opacity-80 border border-[#EBE3D5]"
              >
                <Text className="text-xs font-bold text-[#3D3229]">回到今天</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => openAddModal("加餐")}
              className="bg-[#2D6A4F] px-4 py-2 rounded-xl flex-row items-center gap-1.5 active:opacity-90 shadow-xs"
            >
              <FontAwesome6 name="plus" size={12} color="#FFF" />
              <Text className="text-xs font-bold text-white">手动记录</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 每日卡路里与三大营养素 Dashboard 看板 */}
        <View className="px-5 py-3">
          <View className="bg-[#2D6A4F] rounded-[24px] p-5 shadow-sm relative overflow-hidden">
            {/* 背景修饰气泡 */}
            <View className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/5" />
            <View className="absolute left-1/2 -bottom-10 w-28 h-28 rounded-full bg-[#E9C46A]/10" />

            <View className="flex-row items-center justify-between mb-2">
              <View>
                <Text className="text-xs font-medium text-emerald-100/90">
                  本日摄入总量
                </Text>
                <View className="flex-row items-baseline gap-1.5 mt-0.5">
                  <Text className="text-3xl font-black text-white">{dayTotalCal}</Text>
                  <Text className="text-xs text-emerald-100 font-medium">
                    / {targetCal} kcal
                  </Text>
                </View>
              </View>

              <View className="items-end bg-black/20 px-3 py-1.5 rounded-full border border-white/10">
                <View className="flex-row items-center gap-1">
                  <FontAwesome6 name="fire" size={11} color="#E9C46A" />
                  <Text className="text-xs font-bold text-[#E9C46A]">
                    {remainingCal > 0 ? `剩 ${remainingCal} kcal` : "目标已达成"}
                  </Text>
                </View>
              </View>
            </View>

            {/* 卡路里进度条 */}
            <View className="w-full bg-black/20 h-2 rounded-full my-3 overflow-hidden">
              <View
                className="bg-[#E9C46A] h-full rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </View>

            {/* 三大营养素统计 */}
            <View className="flex-row items-center justify-between pt-1.5 border-t border-white/10 mt-1">
              <View className="flex-1 items-center border-r border-white/10 pr-2">
                <Text className="text-[11px] text-emerald-100/80">蛋白质</Text>
                <Text className="text-sm font-bold text-white mt-0.5">
                  {dayTotalProtein} <Text className="text-[10px] font-normal">g</Text>
                </Text>
              </View>
              <View className="flex-1 items-center border-r border-white/10 px-2">
                <Text className="text-[11px] text-emerald-100/80">碳水化合物</Text>
                <Text className="text-sm font-bold text-white mt-0.5">
                  {dayTotalCarbs} <Text className="text-[10px] font-normal">g</Text>
                </Text>
              </View>
              <View className="flex-1 items-center pl-2">
                <Text className="text-[11px] text-emerald-100/80">脂肪</Text>
                <Text className="text-sm font-bold text-white mt-0.5">
                  {dayTotalFat} <Text className="text-[10px] font-normal">g</Text>
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* 日期滑动列表 */}
        <View className="px-5 py-2.5">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 4 }}
            className="flex-row"
          >
            {pastSevenDays.map((item) => {
              const isSelected = item.dateStr === selectedDate;
              return (
                <TouchableOpacity
                  key={item.dateStr}
                  onPress={() => setSelectedDate(item.dateStr)}
                  className={`w-12 h-14 rounded-2xl items-center justify-center border mr-2.5 transition-all ${
                    isSelected
                      ? "bg-[#2D6A4F] border-[#2D6A4F] shadow-xs"
                      : item.isToday
                      ? "bg-emerald-50 border-[#2D6A4F]/40"
                      : "bg-white border-[#EBE3D5]"
                  }`}
                >
                  <Text
                    className={`text-[10px] ${
                      isSelected
                        ? "text-white/80 font-medium"
                        : item.isToday
                        ? "text-[#2D6A4F] font-bold"
                        : "text-[#8B7D6B]"
                    }`}
                  >
                    {item.isToday ? "今天" : `周${item.dayName}`}
                  </Text>
                  <Text
                    className={`text-sm font-black mt-0.5 ${
                      isSelected
                        ? "text-white"
                        : item.isToday
                        ? "text-[#2D6A4F]"
                        : "text-[#3D3229]"
                    }`}
                  >
                    {item.dayNum}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* 4大餐别分类卡片 */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-1 px-5 pt-2 pb-6"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {loading ? (
            <View className="py-12 items-center justify-center">
              <ActivityIndicator size="large" color="#2D6A4F" />
              <Text className="text-xs text-[#8B7D6B] mt-2">读取饮食记录中...</Text>
            </View>
          ) : (
            <View className="space-y-3.5">
              {mealCategories.map((cat) => {
                const mealRecords = records.filter((r) => r.meal_type === cat.name);
                const categoryCalories = mealRecords.reduce(
                  (sum, r) => sum + (r.calories || 0),
                  0
                );

                return (
                  <View
                    key={cat.name}
                    className="bg-white p-4 rounded-3xl border border-[#EBE3D5] shadow-2xs"
                  >
                    {/* Meal Header */}
                    <View className="flex-row items-center justify-between mb-3 border-b border-[#F5EFE6] pb-2.5">
                      <View className="flex-row items-center gap-2.5">
                        <View
                          className="w-9 h-9 rounded-2xl items-center justify-center"
                          style={{ backgroundColor: `${cat.color}20` }}
                        >
                          <FontAwesome6 name={cat.icon} size={15} color={cat.color} />
                        </View>
                        <View>
                          <View className="flex-row items-center gap-2">
                            <Text className="text-base font-black text-[#3D3229]">
                              {cat.name}
                            </Text>
                            {categoryCalories > 0 && (
                              <View className="bg-[#2D6A4F]/10 px-2 py-0.5 rounded-full">
                                <Text className="text-[10px] font-bold text-[#2D6A4F]">
                                  {categoryCalories} kcal
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text className="text-[10px] text-[#8B7D6B] mt-0.5">
                            {cat.recommended}
                          </Text>
                        </View>
                      </View>

                      <TouchableOpacity
                        onPress={() => openAddModal(cat.name)}
                        className="bg-[#F5EFE6] px-3.5 py-1.5 rounded-xl flex-row items-center gap-1.5 active:opacity-80"
                      >
                        <FontAwesome6 name="plus" size={10} color="#3D3229" />
                        <Text className="text-xs font-bold text-[#3D3229]">记录</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Meal Records or Empty State */}
                    {mealRecords.length === 0 ? (
                      <TouchableOpacity
                        onPress={() => openAddModal(cat.name)}
                        className="py-3 px-2 rounded-2xl border border-dashed border-[#EBE3D5] items-center justify-center bg-[#FDF8F0]/50"
                      >
                        <Text className="text-xs text-[#8B7D6B] font-medium">
                          尚未记录{cat.name} · 点击【+记录】开启健康饮食
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View className="space-y-2">
                        {mealRecords.map((r) => (
                          <View
                            key={r.id}
                            className="bg-[#FFFDF9] p-3 rounded-2xl flex-row items-center justify-between border border-[#EBE3D5]"
                          >
                            <View className="flex-row items-center gap-3 flex-1">
                              {r.image_url ? (
                                <Image
                                  source={{ uri: r.image_url }}
                                  className="w-11 h-11 rounded-xl"
                                />
                              ) : (
                                <View className="w-11 h-11 rounded-xl bg-[#2D6A4F]/10 items-center justify-center">
                                  <FontAwesome6 name="utensils" size={15} color="#2D6A4F" />
                                </View>
                              )}
                              <View className="flex-1">
                                <View className="flex-row items-center gap-1.5">
                                  <Text className="text-sm font-bold text-[#3D3229]" numberOfLines={1}>
                                    {r.food_name}
                                  </Text>
                                  <Text className="text-xs text-[#8B7D6B]">({r.amount})</Text>
                                </View>
                                <View className="flex-row items-center gap-2 mt-1">
                                  <View className="flex-row items-center gap-1 bg-[#E07A5F]/10 px-1.5 py-0.5 rounded-md">
                                    <FontAwesome6 name="fire" size={9} color="#E07A5F" />
                                    <Text className="text-[10px] font-bold text-[#E07A5F]">
                                      {r.calories == null ? "—" : `${r.calories} kcal`}
                                    </Text>
                                  </View>
                                  <Text className="text-[10px] text-[#8B7D6B]">
                                    P: {r.protein == null ? "—" : `${r.protein}g`} · C: {r.carbs == null ? "—" : `${r.carbs}g`} · F: {r.fat == null ? "—" : `${r.fat}g`}
                                  </Text>
                                </View>
                              </View>
                            </View>

                            <TouchableOpacity
                              onPress={() => handleDelete(r.id)}
                              className="w-8 h-8 items-center justify-center rounded-full active:bg-[#F5EFE6]"
                            >
                              <FontAwesome6 name="trash-can" size={13} color="#B0A495" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {/* 打卡 Bottom Sheet Modal */}
        <Modal visible={modalVisible} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] p-6 max-h-[90%] shadow-xl">
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-[#2D6A4F]/10 items-center justify-center">
                    <FontAwesome6 name="pen-to-square" size={14} color="#2D6A4F" />
                  </View>
                  <Text className="text-lg font-black text-[#3D3229]">
                    记录 {mealType}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleCloseModal}
                  className="w-8 h-8 rounded-full bg-[#F5EFE6] items-center justify-center"
                >
                  <FontAwesome6 name="xmark" size={16} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                {/* AI 识图入口卡片 */}
                <TouchableOpacity
                  onPress={handlePickImageAndRecognize}
                  disabled={aiAnalyzing}
                  className="bg-[#2D6A4F]/10 border border-[#2D6A4F]/30 p-3.5 rounded-2xl flex-row items-center justify-between active:bg-[#2D6A4F]/20"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-9 h-9 rounded-xl bg-[#2D6A4F] items-center justify-center shadow-xs">
                      <FontAwesome6 name="camera" size={15} color="#FFF" />
                    </View>
                    <View>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-xs font-black text-[#2D6A4F]">AI 智能拍照识菜</Text>
                        <View className="bg-[#E9C46A] px-1.5 py-0.2 rounded-md">
                          <Text className="text-[9px] font-black text-[#3D3229]">推荐</Text>
                        </View>
                      </View>
                      <Text className="text-[10px] text-[#8B7D6B] mt-0.5">
                        拍照或选图，智能评估菜名与三大营养成分
                      </Text>
                    </View>
                  </View>
                  {aiAnalyzing ? (
                    <ActivityIndicator size="small" color="#2D6A4F" />
                  ) : (
                    <FontAwesome6 name="wand-magic-sparkles" size={15} color="#2D6A4F" />
                  )}
                </TouchableOpacity>

                {/* 常用食物快捷 Preset Chips */}
                <View className="space-y-1.5">
                  <Text className="text-xs font-bold text-[#8B7D6B]">常用健康食物快捷填表</Text>
                  <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10, paddingRight: 4 }}
                    className="flex-row py-1"
                  >
                    {QUICK_PRESETS.map((preset) => (
                      <TouchableOpacity
                        key={preset.name}
                        onPress={() => applyPreset(preset)}
                        className="bg-[#FDF8F0] px-3 py-1.5 rounded-xl border border-[#EBE3D5] mr-2.5 active:bg-[#2D6A4F]/10 active:border-[#2D6A4F]"
                      >
                        <Text className="text-xs font-bold text-[#3D3229]">
                          {preset.name}
                        </Text>
                        <Text className="text-[9px] text-[#8B7D6B] mt-0.5">
                          {preset.calories} kcal
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  </View>
                </View>

                {/* 食物名称 */}
                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">食物名称</Text>
                  <TextInput
                    value={foodName}
                    onChangeText={setFoodName}
                    placeholder="如: 煎鸡胸肉沙拉 / 燕麦水煮蛋"
                    className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                </View>

                {/* 分量与卡路里 */}
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-[#8B7D6B] mb-1">分量</Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="1份 / 200g"
                      className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-[#8B7D6B] mb-1">卡路里 (kcal)</Text>
                    <TextInput
                      value={calories}
                      onChangeText={setCalories}
                      keyboardType="numeric"
                      className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                    />
                  </View>
                </View>

                {/* 三大营养素 */}
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">蛋白质 (g)</Text>
                    <TextInput
                      value={protein}
                      onChangeText={setProtein}
                      keyboardType="numeric"
                      className="bg-[#FDF8F0] px-3 py-2.5 rounded-xl border border-[#EBE3D5] text-xs text-[#3D3229]"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">碳水化合物 (g)</Text>
                    <TextInput
                      value={carbs}
                      onChangeText={setCarbs}
                      keyboardType="numeric"
                      className="bg-[#FDF8F0] px-3 py-2.5 rounded-xl border border-[#EBE3D5] text-xs text-[#3D3229]"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">脂肪 (g)</Text>
                    <TextInput
                      value={fat}
                      onChangeText={setFat}
                      keyboardType="numeric"
                      className="bg-[#FDF8F0] px-3 py-2.5 rounded-xl border border-[#EBE3D5] text-xs text-[#3D3229]"
                    />
                  </View>
                </View>

                {/* 打卡保存按钮 */}
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center mt-3 shadow-xs active:opacity-90"
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text className="text-base font-bold text-white">保存打卡记录</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </Screen>
  );
}
