import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { preparedMealEventSchema, type PreparedMeal, type PreparedMealEventInput } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { ApiError, dietApi } from "@/services/api";
import { getPrivateStorageGeneration, getUserStorageKey, removeUserPrivateStorage, writeUserPrivateStorage } from "@/utils/userStorage";
import { mergePreparedMeals } from "@/utils/preparedMealState";
import { toLocalDateKey } from "@/utils/date";

const mealLabel = (value: string) => ({ breakfast: "早餐", lunch: "午餐", dinner: "晚餐", snack: "加餐" } as Record<string,string>)[value] ?? value;

type Pending = { mealId: string; input: PreparedMealEventInput };
export default function PreparedMealsScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [meals, setMeals] = useState<PreparedMeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ meal: PreparedMeal; type: PreparedMealEventInput["type"]; editTime?: boolean } | null>(null);
  const [allocationId, setAllocationId] = useState<string | null>(null);
  const [reportedMinutes,setReportedMinutes] = useState("");
  const [showHistory,setShowHistory] = useState(false);
  const [servings, setServings] = useState("1");
  const [date, setDate] = useState(toLocalDateKey());
  const [pending, setPending] = useState<Pending | null>(null);
  const busy = useRef(false);
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;
  const key = getUserStorageKey("prepared-meal-pending", user?.id);
  const generation = user?.id ? getPrivateStorageGeneration(user.id) : 0;
  const requestRevision = useRef(0);
  useEffect(() => {
    requestRevision.current += 1;
    setMeals([]); setPending(null); setSelection(null); setSaving(false);
  }, [user?.id]);
  const load = useCallback(async () => {
    if (!user?.id || !key) { setMeals([]); setPending(null); return; }
    const account = user.id;
    const revision = ++requestRevision.current;
    setLoading(true); setError("");
    try {
      const [value, currentStored, legacyStored] = await Promise.all([
        dietApi.preparedMeals(authFetch), AsyncStorage.getItem(key), AsyncStorage.getItem(`prepared-meal-pending:${account}`),
      ]);
      if (accountRef.current !== account || generation !== getPrivateStorageGeneration(account) || revision !== requestRevision.current) return;
      const stored = currentStored ?? legacyStored;
      if (legacyStored && !currentStored) {
        if (!await writeUserPrivateStorage("prepared-meal-pending", account, generation, legacyStored)) return;
        await AsyncStorage.removeItem(`prepared-meal-pending:${account}`);
      }
      if (accountRef.current !== account || revision !== requestRevision.current) return;
      setMeals(items => mergePreparedMeals(items, value, true));
      setPending(stored ? JSON.parse(stored) : null);
    } catch (e) { if (accountRef.current === account && revision === requestRevision.current) setError(e instanceof Error ? e.message : "待吃餐加载失败"); }
    finally { if (accountRef.current === account && revision === requestRevision.current) setLoading(false); }
  }, [authFetch, user?.id, key, generation]);
  useFocusEffect(useCallback(() => { setSelection(null); void load(); }, [load]));
  const submit = async (retry?: Pending) => {
    if (busy.current || !user?.id || !key || (!retry && !selection)) return;
    busy.current = true; setSaving(true);
    const account = user.id;
    requestRevision.current += 1;
    setLoading(false);
    try {
      const allocation = selection?.meal.allocations?.find(row => row.id === allocationId && row.status === "active");
      if (!retry && !selection?.editTime && (selection?.meal.allocations?.filter(row => row.status === "active").length ?? 0) > 1 && !allocation && allocationId !== "unallocated") throw new Error("请先选择要处理的餐次");
      const request = retry ?? { mealId: selection!.meal.id, input: preparedMealEventSchema.parse({
        ...(allocationId === "unallocated" && !selection!.editTime ? { allocation_id: null } : {}),
        ...(allocation && !selection!.editTime ? { allocation_id: allocation.id, allocation_version: allocation.version } : {}),
        idempotency_key: `prepared-meal:${Crypto.randomUUID()}`, version: selection!.meal.version, type: selection!.type,
        ...(selection!.editTime ? { reported_cooking_minutes: reportedMinutes.trim() ? Number(reportedMinutes) : null } : selection!.type === "reschedule" ? { planned_date: date } : { servings: Number(servings), recorded_at: date }),
      }) };
      if (!await writeUserPrivateStorage("prepared-meal-pending", account, generation, JSON.stringify(request))) return;
      if (accountRef.current !== account || generation !== getPrivateStorageGeneration(account)) return;
      setPending(request);
      const result = await dietApi.mealEvent(authFetch, request.mealId, request.input);
      if (accountRef.current !== account || generation !== getPrivateStorageGeneration(account)) return;
      requestRevision.current += 1;
      if (!await removeUserPrivateStorage("prepared-meal-pending", account, generation)) return;
      if (accountRef.current !== account || generation !== getPrivateStorageGeneration(account)) return;
      setPending(null); setSelection(null);
      setMeals(items => mergePreparedMeals(items, [result.prepared_meal]));
      void load();
      Alert.alert("已保存", request.input.type === "eat" ? "实际食用已记入对应日期的饮食记录。" : request.input.type === "discard" ? "已减少待吃份量，未新增摄入。" : request.input.release_allocation ? "已取消所选安排，实际剩余份量不变。" : request.input.reported_cooking_minutes !== undefined ? "已纠正制作用时，份量与摄入不变。" : request.input.is_reserved === undefined ? "已调整计划日期，尚未记录食用。" : request.input.is_reserved ? "已标记保留，剩余份量不变。" : "已解除保留，可参与后续规划。");
    } catch (e) {
      if (accountRef.current === account && generation === getPrivateStorageGeneration(account) && e instanceof ApiError && [400, 404, 409, 422].includes(e.status)) {
        if (!await removeUserPrivateStorage("prepared-meal-pending", account, generation)) return;
        if (accountRef.current === account) { setPending(null); setSelection(null); void load(); }
      }
      if (accountRef.current === account) Alert.alert("未能确认保存", e instanceof Error ? e.message : "请重试，重复提交不会重复记账");
    }
    finally { busy.current = false; if (accountRef.current === account) setSaving(false); }
  };
  const open = (meal: PreparedMeal, type: PreparedMealEventInput["type"]) => {
    const allocations = meal.allocations?.filter(row => row.status === "active") ?? [];
    setAllocationId(allocations.length === 1 ? allocations[0].id : null);
    setSelection({ meal, type }); setServings(String(Math.min(1, allocations.length === 1 ? allocations[0].remainingServings : meal.remaining_servings))); setDate(type === "reschedule" ? (allocations.length === 1 ? allocations[0].plannedDate : meal.planned_date) || toLocalDateKey() : toLocalDateKey());
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
      <TouchableOpacity onPress={() => setShowHistory(value => !value)}><Text className="text-brand">{showHistory ? "只看待吃餐" : "同时查看已吃完或丢弃的制作记录"}</Text></TouchableOpacity>
      {meals.filter(meal => showHistory || meal.remaining_servings > 0).map(meal => <View key={meal.id} className="rounded-2xl bg-surface border border-line p-4 gap-2">
        <Text className="font-bold text-lg text-ink">{meal.food_name}</Text><Text className="text-brand">剩余 {meal.remaining_servings} / 制作 {meal.produced_servings} 份</Text>
        <Text className="text-copy-muted text-xs">{meal.planned_date ? `计划 ${meal.planned_date} ${meal.meal_type}` : "尚未安排餐次"} · {meal.storage_location || "存放条件未记录"}</Text>
        {meal.allocations?.filter(row => row.status === "active" || row.status === "conflict").map(row => <Text key={row.id} className={row.status === "conflict" ? "text-danger text-sm" : "text-copy-muted text-sm"}>{row.plannedDate} · {mealLabel(row.mealType)} · {row.remainingServings} 份{row.status === "conflict" ? " · 安排冲突，请核对餐单" : ""}</Text>)}
        {meal.allocations?.filter(row => row.status === "active" || row.status === "conflict").map(row => <TouchableOpacity key={`release:${row.id}`} disabled={Boolean(pending) || saving} onPress={() => void submit({ mealId: meal.id, input: { idempotency_key: `prepared-release:${Crypto.randomUUID()}`, version: meal.version, type: "reschedule", allocation_id: row.id, allocation_version: row.version, release_allocation: true } })}><Text className="text-brand">取消 {row.plannedDate} {mealLabel(row.mealType)} 的这项安排</Text></TouchableOpacity>)}
        <Text className="text-copy-muted text-xs">用户报告制作用时：{meal.reported_cooking_minutes == null ? "未知" : `${meal.reported_cooking_minutes} 分钟`}</Text>
        <TouchableOpacity disabled={Boolean(pending) || saving} onPress={() => { setReportedMinutes(meal.reported_cooking_minutes == null ? "" : String(meal.reported_cooking_minutes)); setSelection({ meal,type: "reschedule",editTime: true }); }}><Text className="text-brand">纠正制作用时</Text></TouchableOpacity>
        <Text className="text-copy-muted text-xs">每份热量：{meal.nutrition_per_serving.calories == null ? "未知" : `${meal.nutrition_per_serving.calories} kcal`}</Text>
        <TouchableOpacity disabled={Boolean(pending) || saving || meal.remaining_servings <= 0} onPress={() => void submit({ mealId: meal.id, input: {
          idempotency_key: `prepared-reserve:${Crypto.randomUUID()}`, version: meal.version, type: "reschedule", is_reserved: !meal.is_reserved,
        } })}><Text className="font-bold text-brand">{meal.is_reserved ? "已保留 · 解除保留" : "这份留着，暂不参与规划"}</Text></TouchableOpacity>
        <View className="flex-row gap-5 mt-2">{(["eat", "discard", "reschedule"] as const).map(type => <TouchableOpacity disabled={Boolean(pending) || saving || meal.remaining_servings <= 0} key={type} onPress={() => open(meal, type)}><Text className="font-bold text-brand">{type === "eat" ? "我吃了" : type === "discard" ? "丢弃" : "延期"}</Text></TouchableOpacity>)}</View>
      </View>)}
    </ScrollView>
    <Modal visible={Boolean(selection)} transparent animationType="fade" onRequestClose={() => setSelection(null)}><View className="flex-1 bg-black/50 justify-center px-6"><View className="rounded-3xl bg-surface p-6 gap-4">
      <Text className="text-xl font-bold text-ink">{selection?.editTime ? "纠正实际制作用时" : selection?.type === "eat" ? "记录我实际吃的份量" : selection?.type === "discard" ? "记录丢弃" : "调整计划"}</Text>
      {!selection?.editTime && selection?.meal.allocations?.some(row => row.status === "active") ? <View className="gap-2">
        <Text className="text-copy-muted">选择餐次安排</Text>
        {selection.meal.remaining_servings > selection.meal.allocations.filter(row => row.status === "active" || row.status === "conflict").reduce((sum, row) => sum + row.remainingServings, 0) ? <TouchableOpacity accessibilityRole="radio" accessibilityState={{ checked: allocationId === "unallocated" }} onPress={() => { setAllocationId("unallocated"); setServings(String(Math.min(1, selection.meal.remaining_servings - selection.meal.allocations!.filter(row => row.status === "active" || row.status === "conflict").reduce((sum, row) => sum + row.remainingServings, 0)))); }}><Text className="text-brand">未安排的份量</Text></TouchableOpacity> : null}
        {selection.meal.allocations.filter(row => row.status === "active").map(row => <TouchableOpacity key={row.id} accessibilityRole="radio" accessibilityState={{ checked: allocationId === row.id }} accessibilityLabel={`选择餐次 ${row.plannedDate} ${mealLabel(row.mealType)}`} onPress={() => {
          setAllocationId(row.id); setServings(String(Math.min(1, row.remainingServings))); if (selection.type === "reschedule") setDate(row.plannedDate);
        }}><Text className={allocationId === row.id ? "text-brand font-bold" : "text-ink"}>{row.plannedDate} · {mealLabel(row.mealType)} · 剩余 {row.remainingServings} 份</Text></TouchableOpacity>)}
      </View> : null}
      {selection?.type !== "reschedule" ? <><Text className="text-copy-muted">份量（可填 0.5）</Text><TextInput accessibilityLabel="食用或丢弃份量" value={servings} onChangeText={setServings} keyboardType="decimal-pad" className="border border-line rounded-xl p-3 text-ink" /></> : null}
      {selection?.editTime ? <><Text className="text-copy-muted">用户报告分钟，留空清除误记</Text><TextInput accessibilityLabel="纠正实际制作分钟" value={reportedMinutes} onChangeText={setReportedMinutes} keyboardType="number-pad" className="border border-line rounded-xl p-3 text-ink" /></> : <>
      <Text className="text-copy-muted">{selection?.type === "reschedule" ? "计划日期" : "实际日期"}（YYYY-MM-DD）</Text><TextInput accessibilityLabel="日期" value={date} onChangeText={setDate} className="border border-line rounded-xl p-3 text-ink" /></>}
      <TouchableOpacity disabled={saving || Boolean(pending)} onPress={() => void submit()} className="bg-brand-fill rounded-xl p-3 items-center"><Text className="font-bold text-white">{saving ? "保存中…" : "确认保存"}</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setSelection(null)}><Text className="text-copy-muted text-center">返回</Text></TouchableOpacity>
    </View></View></Modal>
  </Screen>;
}
