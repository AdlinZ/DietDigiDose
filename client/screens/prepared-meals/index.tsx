import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { preparedMealEventSchema, type PreparedMeal, type PreparedMealEventInput } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { ApiError, dietApi } from "@/services/api";
import { toLocalDateKey } from "@/utils/date";

type Pending = { mealId: string; input: PreparedMealEventInput };
export default function PreparedMealsScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [meals, setMeals] = useState<PreparedMeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ meal: PreparedMeal; type: PreparedMealEventInput["type"] } | null>(null);
  const [servings, setServings] = useState("1");
  const [date, setDate] = useState(toLocalDateKey());
  const [pending, setPending] = useState<Pending | null>(null);
  const busy = useRef(false);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const key = `prepared-meal-pending:${user?.id}`;
  const load = useCallback(async () => {
    if (!user?.id) { setMeals([]); setPending(null); return; }
    const account = user.id;
    setLoading(true); setError(""); setMeals([]); setPending(null);
    try {
      const [value, stored] = await Promise.all([dietApi.preparedMeals(authFetch), AsyncStorage.getItem(key)]);
      if (accountRef.current !== account) return;
      setMeals(value);
      if (stored) setPending(JSON.parse(stored));
    } catch (e) { if (accountRef.current === account) setError(e instanceof Error ? e.message : "待吃餐加载失败"); }
    finally { if (accountRef.current === account) setLoading(false); }
  }, [authFetch, user?.id, key]);
  useFocusEffect(useCallback(() => { setSelection(null); void load(); }, [load]));
  const submit = async (retry?: Pending) => {
    if (busy.current || !user?.id || (!retry && !selection)) return;
    busy.current = true; setSaving(true);
    const account = user.id;
    try {
      const request = retry ?? { mealId: selection!.meal.id, input: preparedMealEventSchema.parse({
        idempotency_key: `prepared-meal:${Crypto.randomUUID()}`, version: selection!.meal.version, type: selection!.type,
        ...(selection!.type === "reschedule" ? { planned_date: date } : { servings: Number(servings), recorded_at: date }),
      }) };
      await AsyncStorage.setItem(key, JSON.stringify(request));
      if (accountRef.current !== account) return;
      setPending(request);
      const result = await dietApi.mealEvent(authFetch, request.mealId, request.input);
      await AsyncStorage.removeItem(key);
      if (accountRef.current !== account) return;
      setPending(null); setSelection(null);
      setMeals(items => items.map(item => item.id === result.prepared_meal.id ? result.prepared_meal : item));
      Alert.alert("已保存", request.input.type === "eat" ? "实际食用已记入对应日期的饮食记录。" : request.input.type === "discard" ? "已减少待吃份量，未新增摄入。" : request.input.is_reserved === undefined ? "已调整计划日期，尚未记录食用。" : request.input.is_reserved ? "已标记保留，剩余份量不变。" : "已解除保留，可参与后续规划。");
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        await AsyncStorage.removeItem(key);
        if (accountRef.current === account) { setPending(null); setSelection(null); void load(); }
      }
      if (accountRef.current === account) Alert.alert("未能确认保存", e instanceof Error ? e.message : "请重试，重复提交不会重复记账");
    }
    finally { busy.current = false; if (accountRef.current === account) setSaving(false); }
  };
  const open = (meal: PreparedMeal, type: PreparedMealEventInput["type"]) => {
    setSelection({ meal, type }); setServings(String(Math.min(1, meal.remaining_servings))); setDate(type === "reschedule" ? meal.planned_date || toLocalDateKey() : toLocalDateKey());
  };
  return <Screen className="flex-1 bg-background">
    <View className="px-5 py-4 flex-row items-center justify-between"><TouchableOpacity onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">待吃餐</Text><TouchableOpacity onPress={() => void load()}><Text className="text-brand">刷新</Text></TouchableOpacity></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">制作完成不等于已经吃了。只在确认食用时记录摄入。</Text>
      {!isAuthenticated ? <TouchableOpacity onPress={() => router.push("/login")}><Text className="text-brand">登录后查看待吃餐</Text></TouchableOpacity> : null}
      {loading ? <ActivityIndicator /> : null}
      {error ? <Text className="text-danger">{error}</Text> : null}
      {pending ? <View className="rounded-2xl bg-warm-soft p-4 gap-3"><Text className="text-ink">上次提交尚未确认结果，先重试以避免重复记录。</Text><TouchableOpacity disabled={saving} onPress={() => void submit(pending)}><Text className="font-bold text-brand">重试原提交</Text></TouchableOpacity></View> : null}
      {!loading && !error && !meals.some(meal => meal.remaining_servings > 0) ? <Text className="text-copy-muted">还没有待吃餐。完成制作时可保存剩余份量。</Text> : null}
      {meals.filter(meal => meal.remaining_servings > 0).map(meal => <View key={meal.id} className="rounded-2xl bg-surface border border-line p-4 gap-2">
        <Text className="font-bold text-lg text-ink">{meal.food_name}</Text><Text className="text-brand">剩余 {meal.remaining_servings} / 制作 {meal.produced_servings} 份</Text>
        <Text className="text-copy-muted text-xs">{meal.planned_date ? `计划 ${meal.planned_date} ${meal.meal_type}` : "尚未安排餐次"} · {meal.storage_location || "存放条件未记录"}</Text>
        <Text className="text-copy-muted text-xs">每份热量：{meal.nutrition_per_serving.calories == null ? "未知" : `${meal.nutrition_per_serving.calories} kcal`}</Text>
        <TouchableOpacity disabled={Boolean(pending) || saving} onPress={() => void submit({ mealId: meal.id, input: {
          idempotency_key: `prepared-reserve:${Crypto.randomUUID()}`, version: meal.version, type: "reschedule", is_reserved: !meal.is_reserved,
        } })}><Text className="font-bold text-brand">{meal.is_reserved ? "已保留 · 解除保留" : "这份留着，暂不参与规划"}</Text></TouchableOpacity>
        <View className="flex-row gap-5 mt-2">{(["eat", "discard", "reschedule"] as const).map(type => <TouchableOpacity disabled={Boolean(pending) || saving} key={type} onPress={() => open(meal, type)}><Text className="font-bold text-brand">{type === "eat" ? "我吃了" : type === "discard" ? "丢弃" : "延期"}</Text></TouchableOpacity>)}</View>
      </View>)}
    </ScrollView>
    <Modal visible={Boolean(selection)} transparent animationType="fade" onRequestClose={() => setSelection(null)}><View className="flex-1 bg-black/50 justify-center px-6"><View className="rounded-3xl bg-surface p-6 gap-4">
      <Text className="text-xl font-bold text-ink">{selection?.type === "eat" ? "记录我实际吃的份量" : selection?.type === "discard" ? "记录丢弃" : "调整计划"}</Text>
      {selection?.type !== "reschedule" ? <><Text className="text-copy-muted">份量（可填 0.5）</Text><TextInput accessibilityLabel="食用或丢弃份量" value={servings} onChangeText={setServings} keyboardType="decimal-pad" className="border border-line rounded-xl p-3 text-ink" /></> : null}
      <Text className="text-copy-muted">{selection?.type === "reschedule" ? "计划日期" : "实际日期"}（YYYY-MM-DD）</Text><TextInput accessibilityLabel="日期" value={date} onChangeText={setDate} className="border border-line rounded-xl p-3 text-ink" />
      <TouchableOpacity disabled={saving || Boolean(pending)} onPress={() => void submit()} className="bg-brand-fill rounded-xl p-3 items-center"><Text className="font-bold text-white">{saving ? "保存中…" : "确认保存"}</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setSelection(null)}><Text className="text-copy-muted text-center">返回</Text></TouchableOpacity>
    </View></View></Modal>
  </Screen>;
}
