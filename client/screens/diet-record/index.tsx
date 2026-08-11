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
import { addLocalDays, parseDateKey, toLocalDateKey } from "@/utils/date";
import { aiApi, ApiError, dietApi, waitForAgentRun } from "@/services/api";

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
  recorded_time?: string | null;
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

function currentTimeValue() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function normalizeRecordedTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export default function DietRecordScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<any>();
  const { isAuthenticated, user } = useAuth();
  const authFetch = useAuthFetch();

  const todayStr = toLocalDateKey();
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [weekOffset, setWeekOffset] = useState(0);
  const [records, setRecords] = useState<DietRecord[]>([]);
  const [weeklyRecordCounts, setWeeklyRecordCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  // Form
  const [mealType, setMealType] = useState("");
  const [recordedTime, setRecordedTime] = useState(currentTimeValue);
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
      // 预填数据已经进入本地表单状态，立即消费掉一次性路由参数。
      router.setParams({});
    }
  }, [params, router]);

  // 生成当前浏览周期的 7 天日期数组；weekOffset 为负数时查看更早周期。
  const pastSevenDays = Array.from({ length: 7 }).map((_, i) => {
    const d = addLocalDays(weekOffset * 7 - (6 - i));
    const dateStr = toLocalDateKey(d);
    const dayName = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    const isToday = dateStr === todayStr;
    return { date: d, dateStr, dayNum: d.getDate(), dayName, isToday };
  });

  const calendarMonthStartOffset = (calendarMonth.getDay() + 6) % 7;
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const date = addLocalDays(index - calendarMonthStartOffset, calendarMonth);
    const dateStr = toLocalDateKey(date);
    return {
      date,
      dateStr,
      isCurrentMonth: date.getMonth() === calendarMonth.getMonth(),
      isFuture: dateStr > todayStr,
      isToday: dateStr === todayStr,
      isSelected: dateStr === selectedDate,
    };
  });
  const now = new Date();
  const isCalendarCurrentMonth =
    calendarMonth.getFullYear() === now.getFullYear() && calendarMonth.getMonth() === now.getMonth();

  const changeWeek = (delta: -1 | 1) => {
    const nextOffset = Math.min(0, weekOffset + delta);
    setWeekOffset(nextOffset);
    setSelectedDate(toLocalDateKey(addLocalDays(nextOffset * 7)));
  };

  const goToToday = () => {
    setWeekOffset(0);
    setSelectedDate(todayStr);
  };

  const openCalendar = () => {
    const selected = parseDateKey(selectedDate) || new Date();
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setCalendarVisible(true);
  };

  const changeCalendarMonth = (delta: -1 | 1) => {
    setCalendarMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
      const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return next > currentMonth ? current : next;
    });
  };

  const selectCalendarDate = (date: Date) => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const selectedStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (selectedStart > todayStart) return;

    const daysAgo = Math.max(0, Math.round((todayStart.getTime() - selectedStart.getTime()) / 86400000));
    setWeekOffset(-Math.floor(daysAgo / 7));
    setSelectedDate(toLocalDateKey(selectedStart));
    setCalendarVisible(false);
  };

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

  const fetchWeeklyRecordCounts = useCallback(async () => {
    if (!isAuthenticated) {
      setWeeklyRecordCounts({});
      return;
    }

    const days = Array.from(
      { length: 7 },
      (_, index) => toLocalDateKey(addLocalDays(weekOffset * 7 + index - 6))
    );
    const results = await Promise.allSettled(days.map((date) => dietApi.list(authFetch, date)));
    setWeeklyRecordCounts(Object.fromEntries(results.map((result, index) => [
      days[index],
      result.status === "fulfilled" && Array.isArray(result.value)
        ? result.value.length
        : 0,
    ])));
  }, [authFetch, isAuthenticated, weekOffset]);

  useFocusEffect(
    useCallback(() => {
      fetchRecords();
    }, [fetchRecords])
  );

  useFocusEffect(
    useCallback(() => {
      void fetchWeeklyRecordCounts();
    }, [fetchWeeklyRecordCounts])
  );

  const openAddModal = (meal = "", time = currentTimeValue()) => {
    setMealType(meal);
    setRecordedTime(time);
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
      const json = await aiApi.visionFood<{ data?: Record<string, number | string>; rawText?: string; run: { id: string; status: string; artifacts?: Array<{ type: string; data: unknown }>; reply?: string; error?: { message?: string } } }>(authFetch, asset.base64);
      const run = await waitForAgentRun(authFetch, json.run);
      const data = json.data || run.artifacts?.find((artifact) => artifact.type === "vision")?.data as Record<string, number | string> | undefined;
      if (data) {
          if (data.foodName) setFoodName(String(data.foodName));
          if (data.estimatedWeightGrams) setAmount(`${data.estimatedWeightGrams}g`);
          if (data.calories) setCalories(String(data.calories));
          if (data.proteinGrams !== undefined) setProtein(String(data.proteinGrams));
          if (data.carbsGrams !== undefined) setCarbs(String(data.carbsGrams));
          if (data.fatGrams !== undefined) setFat(String(data.fatGrams));
          Alert.alert("AI 识别成功", `已自动识别【${data.foodName || "餐食"}】并估算营养成分！`);
      } else if (json.rawText || run.reply) {
        Alert.alert("AI 识别提示", json.rawText || run.reply);
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
    const normalizedTime = normalizeRecordedTime(recordedTime);
    if (!normalizedTime) {
      Alert.alert("提示", "请填写有效时间，例如 08:30");
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
        meal_type: mealType.trim(),
        food_name: foodName,
        amount,
        calories: parseNullableNumber(calories),
        protein: parseNullableNumber(protein),
        carbs: parseNullableNumber(carbs),
        fat: parseNullableNumber(fat),
        recorded_at: selectedDate,
        recorded_time: normalizedTime,
        image_url: imageUrl.trim() || null,
      };

      await dietApi.create(authFetch, payload);
      setModalVisible(false);
      fetchRecords();
      void fetchWeeklyRecordCounts();
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
            void fetchWeeklyRecordCounts();
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
  const sortedRecords = [...records].sort((a, b) => (a.recorded_time || "").localeCompare(b.recorded_time || ""));
  const timePercent = (time?: string | null) => {
    if (!time) return 0;
    const [hours, minutes] = time.split(":").map(Number);
    return Math.min(98, Math.max(0, ((hours * 60 + minutes) / (24 * 60)) * 100));
  };

  const targetCal = user?.daily_calories_target || 2000;
  const progressPercent = Math.min(Math.round((dayTotalCal / targetCal) * 100), 100);
  const remainingCal = Math.max(0, targetCal - dayTotalCal);
  const isSelectedToday = selectedDate === todayStr;

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

  const formattedWeekRangeText = () => {
    const start = pastSevenDays[0].date;
    const end = pastSevenDays[pastSevenDays.length - 1].date;
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
    }
    return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  };

  if (!isAuthenticated) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center p-6">
          <View className="w-16 h-16 rounded-full bg-brand/10 items-center justify-center mb-4">
            <FontAwesome6 name="utensils" size={28} color="#2D6A4F" />
          </View>
          <Text className="text-xl font-bold text-ink">饮食打卡日志</Text>
          <Text className="text-sm text-copy-muted text-center mt-2 mb-6 px-4 leading-5">
            登录后精准管理每日卡路里、记录三餐摄入与三大营养素分配。
          </Text>
          <TouchableOpacity
            onPress={() => router.push("/login")}
            className="bg-brand px-8 py-3.5 rounded-2xl active:opacity-90 shadow-sm"
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
            <Text className="text-2xl font-black text-ink">饮食日志</Text>
            <Text className="text-xs text-copy-muted mt-0.5 font-medium">
              {formattedSelectedDateText()}
            </Text>
          </View>

          <View className="flex-row items-center gap-2">
            {selectedDate !== todayStr && (
              <TouchableOpacity
                onPress={goToToday}
                className="bg-background-secondary px-3 py-2 rounded-xl active:opacity-80 border border-line"
              >
                <Text className="text-xs font-bold text-ink">回到今天</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => openAddModal()}
              accessibilityRole="button"
              accessibilityLabel="记录饮食"
              className="bg-brand px-4 py-2.5 rounded-2xl flex-row items-center gap-1.5 active:opacity-90 shadow-xs"
            >
              <FontAwesome6 name="plus" size={12} color="#FFF" />
              <Text className="text-xs font-bold text-white">记录饮食</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 每日卡路里与三大营养素 Dashboard 看板 */}
        <View className="px-5 pt-3 pb-2">
          <View className="bg-brand rounded-[24px] p-4 shadow-sm relative overflow-hidden">
            {/* 背景修饰气泡 */}
            <View className="absolute -right-8 -top-8 w-32 h-32 rounded-full bg-white/5" />
            <View className="absolute left-1/2 -bottom-10 w-28 h-28 rounded-full bg-highlight/10" />

            <View className="flex-row items-center justify-between">
              <View>
                <Text className="text-xs font-medium text-emerald-100/90">
                  {isSelectedToday ? "今日摄入" : "当日摄入"}
                </Text>
                <View className="flex-row items-baseline gap-1.5 mt-0.5">
                  <Text className="text-[28px] font-black text-white">{dayTotalCal}</Text>
                  <Text className="text-xs text-emerald-100 font-medium">
                    / {targetCal} kcal
                  </Text>
                </View>
              </View>

              <View className="items-end bg-black/15 px-3 py-1.5 rounded-full border border-white/10">
                <View className="flex-row items-center gap-1">
                  <FontAwesome6 name="fire" size={11} color="#E9C46A" />
                  <Text className="text-xs font-bold text-highlight">
                    {remainingCal > 0 ? `剩 ${remainingCal} kcal` : "目标已达成"}
                  </Text>
                </View>
              </View>
            </View>

            {/* 卡路里进度条 */}
            <View className="w-full bg-black/20 h-2 rounded-full mt-2.5 mb-3 overflow-hidden">
              <View
                className="bg-highlight h-full rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </View>

            {/* 三大营养素统计 */}
            <View className="flex-row items-center justify-between pt-3 border-t border-white/10">
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

        {/* 连续七日日期条 */}
        <View className="px-5 py-2.5">
          <View className="bg-white rounded-3xl border border-line shadow-2xs overflow-hidden">
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-line">
              <TouchableOpacity
                onPress={() => changeWeek(-1)}
                accessibilityRole="button"
                accessibilityLabel="查看更早七天"
                className="w-9 h-9 rounded-xl bg-background-secondary items-center justify-center active:opacity-70"
              >
                <FontAwesome6 name="chevron-left" size={11} color="#3D3229" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openCalendar}
                accessibilityRole="button"
                accessibilityLabel="打开月历选择日期"
                className="items-center px-3 py-1 active:opacity-70"
              >
                <View className="flex-row items-center gap-1.5">
                  <FontAwesome6 name="calendar-days" size={11} color="#2D6A4F" />
                  <Text className="text-xs font-black text-ink">{formattedWeekRangeText()}</Text>
                </View>
                <Text className="text-[9px] text-brand font-bold mt-0.5">点此打开月历</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => changeWeek(1)}
                disabled={weekOffset === 0}
                accessibilityRole="button"
                accessibilityLabel="查看较新七天"
                accessibilityState={{ disabled: weekOffset === 0 }}
                className={`w-9 h-9 rounded-xl items-center justify-center ${
                  weekOffset === 0 ? "bg-background-secondary opacity-35" : "bg-background-secondary active:opacity-70"
                }`}
              >
                <FontAwesome6 name="chevron-right" size={11} color="#3D3229" />
              </TouchableOpacity>
            </View>
            <View className="p-1.5 flex-row">
              {pastSevenDays.map((item) => {
                const isSelected = item.dateStr === selectedDate;
                const hasRecord = (weeklyRecordCounts[item.dateStr] || 0) > 0;
                return (
                  <TouchableOpacity
                    key={item.dateStr}
                    onPress={() => setSelectedDate(item.dateStr)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${item.isToday ? "今天" : `周${item.dayName}`} ${item.dayNum}日`}
                    className={`flex-1 h-14 rounded-2xl items-center justify-center ${isSelected ? "bg-brand" : "bg-white"}`}
                  >
                    <Text
                      className={`text-[10px] ${
                        isSelected
                          ? "text-white/80 font-medium"
                          : item.isToday
                          ? "text-brand font-black"
                          : "text-copy-muted"
                      }`}
                    >
                      {item.isToday ? "今天" : `周${item.dayName}`}
                    </Text>
                    <Text
                      className={`text-sm font-black mt-0.5 ${
                        isSelected
                          ? "text-white"
                          : item.isToday
                          ? "text-brand"
                          : "text-ink"
                      }`}
                    >
                      {item.dayNum}
                    </Text>
                    <View
                      className={`absolute bottom-1 w-1 h-1 rounded-full ${
                        hasRecord
                          ? isSelected
                            ? "bg-highlight"
                            : "bg-brand"
                          : "bg-transparent"
                      }`}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 按实际发生时间排列的饮食时间线 */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          className="flex-1 px-5 pt-2 pb-6"
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {loading ? (
            <View className="py-12 items-center justify-center">
              <ActivityIndicator size="large" color="#2D6A4F" />
              <Text className="text-xs text-copy-muted mt-2">读取饮食记录中...</Text>
            </View>
          ) : (
            <View>
              <View className="mb-3 px-1">
                <Text className="text-base font-black text-ink">
                  {isSelectedToday ? "今天吃了什么" : "这天吃了什么"}
                </Text>
                <Text className="text-[11px] text-copy-muted mt-0.5">
                  {sortedRecords.length > 0 ? `${sortedRecords.length} 条记录 · 按进食时间排列` : "记录每一餐，更轻松地了解营养摄入"}
                </Text>
              </View>
              {sortedRecords.length === 0 ? (
                <View className="bg-white px-5 py-5 rounded-3xl border border-line shadow-2xs">
                  <View className="flex-row items-center">
                    <View className="w-12 h-12 rounded-2xl bg-brand/10 items-center justify-center mr-3.5">
                      <FontAwesome6 name="utensils" size={18} color="#2D6A4F" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-black text-ink">还没有饮食记录</Text>
                      <Text className="text-[11px] leading-4 text-copy-muted mt-1">
                        可手动填写，也可以用 AI 拍照识别食物
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => openAddModal()}
                    accessibilityRole="button"
                    accessibilityLabel="记录第一餐"
                    className="bg-brand rounded-2xl py-3 mt-4 flex-row items-center justify-center gap-2 active:opacity-90"
                  >
                    <FontAwesome6 name="plus" size={12} color="#FFF" />
                    <Text className="text-sm font-bold text-white">记录第一餐</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <View className="bg-white rounded-3xl border border-line px-4 pt-3.5 pb-4 mb-3 shadow-2xs">
                    <View className="flex-row justify-between px-0.5">
                      {["00", "06", "12", "18", "24"].map((time) => (
                        <Text key={time} className="text-[9px] font-bold text-copy-muted">{time}</Text>
                      ))}
                    </View>
                    <View className="h-2 rounded-full bg-background-secondary mt-2.5 relative">
                      <View className="absolute left-1/4 top-0 h-2 w-px bg-line" />
                      <View className="absolute left-1/2 top-0 h-2 w-px bg-line" />
                      <View className="absolute left-3/4 top-0 h-2 w-px bg-line" />
                      {sortedRecords.filter((record) => record.recorded_time).map((record) => (
                        <View
                          key={`dot-${record.id}`}
                          className="absolute -top-1.5 w-5 h-5 rounded-full bg-brand border-2 border-white items-center justify-center"
                          style={{ left: `${timePercent(record.recorded_time)}%`, marginLeft: -10 }}
                        >
                          <FontAwesome6 name="utensils" size={7} color="#FFF" />
                        </View>
                      ))}
                    </View>
                  </View>
                  <View className="bg-white rounded-3xl border border-line overflow-hidden shadow-2xs">
                    <View className="px-4 py-2.5 bg-canvas/60 border-b border-line">
                      <Text className="text-[10px] font-bold text-copy-muted">饮食记录</Text>
                    </View>
                    {sortedRecords.map((record, index) => (
                      <View key={record.id} className={`flex-row ${index < sortedRecords.length - 1 ? "border-b border-line" : ""}`}>
                        <View className="w-16 bg-canvas/50 border-r border-line items-center pt-4">
                          <Text className="text-xs font-black text-brand">{record.recorded_time || "—"}</Text>
                          <View className="w-1.5 h-1.5 rounded-full bg-brand mt-1.5" />
                        </View>
                        <View className="flex-1 p-3 flex-row items-center min-h-20">
                          {record.image_url ? (
                            <Image source={{ uri: record.image_url }} className="w-10 h-10 rounded-xl mr-2.5" />
                          ) : (
                            <View className="w-10 h-10 rounded-xl bg-brand/10 items-center justify-center mr-2.5">
                              <FontAwesome6 name="utensils" size={14} color="#2D6A4F" />
                            </View>
                          )}
                          <View className="flex-1">
                            <View className="flex-row items-center gap-1.5">
                              <Text className="text-sm font-bold text-ink flex-shrink" numberOfLines={1}>{record.food_name}</Text>
                              {record.meal_type ? <Text className="text-[9px] text-copy-muted">{record.meal_type}</Text> : null}
                            </View>
                            <Text className="text-[10px] text-copy-muted mt-0.5">
                              {record.amount} · {record.calories == null ? "热量未填" : `${record.calories} kcal`}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => handleDelete(record.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`删除${record.food_name}`}
                            className="w-8 h-8 items-center justify-center"
                          >
                            <FontAwesome6 name="trash-can" size={12} color="#B0A495" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </ScrollView>

        {/* 月历日期选择器 */}
        <Modal
          visible={calendarVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setCalendarVisible(false)}
        >
          <View className="flex-1 bg-black/40 justify-center px-5">
            <View className="bg-white rounded-[28px] p-5 shadow-xl">
              <View className="flex-row items-center justify-between mb-4">
                <View>
                  <Text className="text-lg font-black text-ink">选择日期</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">可以直接跳转到任意历史记录</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setCalendarVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="关闭月历"
                  className="w-9 h-9 rounded-full bg-background-secondary items-center justify-center"
                >
                  <FontAwesome6 name="xmark" size={15} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <View className="flex-row items-center justify-between mb-3">
                <TouchableOpacity
                  onPress={() => changeCalendarMonth(-1)}
                  accessibilityRole="button"
                  accessibilityLabel="上一个月"
                  className="w-10 h-10 rounded-xl bg-background-secondary items-center justify-center active:opacity-70"
                >
                  <FontAwesome6 name="chevron-left" size={12} color="#3D3229" />
                </TouchableOpacity>
                <Text className="text-base font-black text-ink">
                  {calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月
                </Text>
                <TouchableOpacity
                  onPress={() => changeCalendarMonth(1)}
                  disabled={isCalendarCurrentMonth}
                  accessibilityRole="button"
                  accessibilityLabel="下一个月"
                  accessibilityState={{ disabled: isCalendarCurrentMonth }}
                  className={`w-10 h-10 rounded-xl bg-background-secondary items-center justify-center ${
                    isCalendarCurrentMonth ? "opacity-35" : "active:opacity-70"
                  }`}
                >
                  <FontAwesome6 name="chevron-right" size={12} color="#3D3229" />
                </TouchableOpacity>
              </View>

              <View className="flex-row mb-1">
                {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
                  <View key={day} className="items-center py-1" style={{ width: "14.2857%" }}>
                    <Text className="text-[10px] font-bold text-copy-muted">{day}</Text>
                  </View>
                ))}
              </View>

              <View className="flex-row flex-wrap">
                {calendarDays.map((item) => (
                  <TouchableOpacity
                    key={item.dateStr}
                    onPress={() => selectCalendarDate(item.date)}
                    disabled={item.isFuture}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.date.getMonth() + 1}月${item.date.getDate()}日${item.isToday ? "，今天" : ""}`}
                    accessibilityState={{ selected: item.isSelected, disabled: item.isFuture }}
                    className="h-11 items-center justify-center"
                    style={{ width: "14.2857%" }}
                  >
                    <View
                      className={`w-9 h-9 rounded-full items-center justify-center ${
                        item.isSelected
                          ? "bg-brand"
                          : item.isToday
                          ? "bg-brand/10 border border-brand"
                          : "bg-transparent"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${
                          item.isSelected
                            ? "text-white"
                            : item.isFuture
                            ? "text-copy-muted/25"
                            : item.isCurrentMonth
                            ? item.isToday
                              ? "text-brand"
                              : "text-ink"
                            : "text-copy-muted/45"
                        }`}
                      >
                        {item.date.getDate()}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                onPress={() => selectCalendarDate(new Date())}
                accessibilityRole="button"
                accessibilityLabel="选择今天"
                className="mt-4 py-3 rounded-2xl bg-brand/10 items-center active:opacity-70"
              >
                <Text className="text-sm font-black text-brand">回到今天</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 打卡 Bottom Sheet Modal */}
        <Modal visible={modalVisible} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] p-6 max-h-[90%] shadow-xl">
              {/* Modal Header */}
              <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-brand/10 items-center justify-center">
                    <FontAwesome6 name="pen-to-square" size={14} color="#2D6A4F" />
                  </View>
                  <Text className="text-lg font-black text-ink">
                    添加饮食记录
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleCloseModal}
                  className="w-8 h-8 rounded-full bg-background-secondary items-center justify-center"
                >
                  <FontAwesome6 name="xmark" size={16} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                <View className="flex-row gap-3">
                  <View className="w-28">
                    <Text className="text-xs font-bold text-copy-muted mb-1">进食时间 *</Text>
                    <TextInput value={recordedTime} onChangeText={setRecordedTime} placeholder="08:30" keyboardType="numbers-and-punctuation" className="bg-canvas px-3 py-3 rounded-2xl border border-line text-sm text-ink" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">餐别标签（可选）</Text>
                    <TextInput value={mealType} onChangeText={setMealType} placeholder="如 早餐、运动后加餐" className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink" />
                  </View>
                </View>
                {/* AI 识图入口卡片 */}
                <TouchableOpacity
                  onPress={handlePickImageAndRecognize}
                  disabled={aiAnalyzing}
                  className="bg-brand/10 border border-brand/30 p-3.5 rounded-2xl flex-row items-center justify-between active:bg-brand/20"
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-9 h-9 rounded-xl bg-brand items-center justify-center shadow-xs">
                      <FontAwesome6 name="camera" size={15} color="#FFF" />
                    </View>
                    <View>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-xs font-black text-brand">AI 智能拍照识菜</Text>
                        <View className="bg-highlight px-1.5 py-0.2 rounded-md">
                          <Text className="text-[9px] font-black text-ink">推荐</Text>
                        </View>
                      </View>
                      <Text className="text-[10px] text-copy-muted mt-0.5">
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
                  <Text className="text-xs font-bold text-copy-muted">常用健康食物快捷填表</Text>
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
                        className="bg-canvas px-3 py-1.5 rounded-xl border border-line mr-2.5 active:bg-brand/10 active:border-brand"
                      >
                        <Text className="text-xs font-bold text-ink">
                          {preset.name}
                        </Text>
                        <Text className="text-[9px] text-copy-muted mt-0.5">
                          {preset.calories} kcal
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  </View>
                </View>

                {/* 食物名称 */}
                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">食物名称</Text>
                  <TextInput
                    value={foodName}
                    onChangeText={setFoodName}
                    placeholder="如: 煎鸡胸肉沙拉 / 燕麦水煮蛋"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                {/* 分量与卡路里 */}
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">分量</Text>
                    <TextInput
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="1份 / 200g"
                      className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1">卡路里 (kcal)</Text>
                    <TextInput
                      value={calories}
                      onChangeText={setCalories}
                      keyboardType="numeric"
                      className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                    />
                  </View>
                </View>

                {/* 三大营养素 */}
                <View className="flex-row gap-2">
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">蛋白质 (g)</Text>
                    <TextInput
                      value={protein}
                      onChangeText={setProtein}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">碳水化合物 (g)</Text>
                    <TextInput
                      value={carbs}
                      onChangeText={setCarbs}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-[11px] font-bold text-copy-muted mb-1">脂肪 (g)</Text>
                    <TextInput
                      value={fat}
                      onChangeText={setFat}
                      keyboardType="numeric"
                      className="bg-canvas px-3 py-2.5 rounded-xl border border-line text-xs text-ink"
                    />
                  </View>
                </View>

                {/* 打卡保存按钮 */}
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  className="bg-brand py-3.5 rounded-2xl items-center mt-3 shadow-xs active:opacity-90"
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
