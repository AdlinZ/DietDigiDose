import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { recommendationsApi } from "@/services/api/recommendations";
import { toLocalDateKey, addLocalDays } from "@/utils/date";
import { cookingPlanDraftSchema, type CookingPlanDraft } from "@dietdigidose/contracts";
import * as Crypto from "expo-crypto";
import { mealPlansApi } from "@/services/api/mealPlans";

export default function CookingPlanScreen() {
  const router = useSafeRouter();
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const saveId = useRef(Crypto.randomUUID());
  const persistedPlan = useRef<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activated, setActivated] = useState(false);
  const [replacement, setReplacement] = useState<{ draft: CookingPlanDraft; conflicts: string[] } | null>(null);
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [date, setDate] = useState(toLocalDateKey());
  const [servings, setServings] = useState("1");
  const [minutes, setMinutes] = useState("");
  const [includeLunch, setIncludeLunch] = useState(true);
  const [result, setResult] = useState<CookingPlanDraft | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const requestSequence = useRef(0);
  const loadedContext = useRef<string | null>(null);
  useFocusEffect(useCallback(() => {
    const context = `${user?.id ?? "anonymous"}:${planId ?? "new"}`;
    if (loadedContext.current === context) {
      setLoading(false); setSaving(false);
      return () => { requestSequence.current += 1; };
    }
    setResult(null); setError(""); setLoading(false); setSaved(false); setSaving(false); setReplacement(null); setActivated(false);
    persistedPlan.current = null;
    const owner = user?.id;
    const sequence = ++requestSequence.current;
    if (planId && owner) {
      setLoading(true);
      void mealPlansApi.get(authFetch, planId).then(plan => {
        if (account.current !== owner || requestSequence.current !== sequence) return;
        const snapshot = plan.constraints.savedCookingDraft as { draft?: unknown } | undefined;
        const draft = cookingPlanDraftSchema.parse(plan.constraints.currentCookingDraft ?? snapshot?.draft);
        if (plan.archived) throw new Error("此方案已归档");
        loadedContext.current = context;
        persistedPlan.current = { id: plan.id, version: plan.version };
        setResult(draft); setSaved(true); setActivated(plan.status !== "draft");
        setDate(draft.meals[0].date); setServings(String(draft.meals[0].servings));
        setMinutes(String(draft.time.budgetMinutes));
        setIncludeLunch(draft.meals.some(meal => meal.mealType === "lunch"));
      }).catch(e => {
        if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "恢复方案失败");
      }).finally(() => { if (account.current === owner && requestSequence.current === sequence) setLoading(false); });
    } else { loadedContext.current = context; }
    return () => { requestSequence.current += 1; };
  }, [user?.id, planId, authFetch]));
  const invalidateDraft = () => {
    setReplacement(null);
    setSaved(false); setSaving(false);
    requestSequence.current += 1;
    setResult(null);
    setError("");
    setLoading(false);
  };
  const calculate = async () => {
    if (!user || loading || saving) return;
    if (activated) { persistedPlan.current = null; setActivated(false); }
    const owner = user.id;
    const sequence = ++requestSequence.current;
    setLoading(true); setError(""); setResult(null); setSaved(false); setReplacement(null);
    saveId.current = Crypto.randomUUID();
    try {
      const parsed = new Date(`${date}T12:00:00`);
      const nextDate = Number.isFinite(parsed.getTime()) ? toLocalDateKey(addLocalDays(1, parsed)) : "";
      const draft = await recommendationsApi.cookingPlan(authFetch, {
        meals: [{ id: "dinner", date, mealType: "dinner", servings: Number(servings) },
          ...(includeLunch ? [{ id: "lunch", date: nextDate, mealType: "lunch" as const, servings: Number(servings) }] : [])],
        excludedPreparedMealIds: [],
        ...(minutes.trim() ? { preferences: { meal_time_minutes: Number(minutes) } } : {}),
      });
      if (account.current === owner && requestSequence.current === sequence) setResult(draft);
    } catch (e) { if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "方案计算失败"); }
    finally { if (account.current === owner && requestSequence.current === sequence) setLoading(false); }
  };
  const replace = async (targetMealId: string) => {
    if (!user || !result || loading || saving) return;
    const owner = user.id;
    const sequence = ++requestSequence.current;
    setLoading(true); setReplacement(null); setError("");
    try {
      const preview = await recommendationsApi.replaceCookingItem(authFetch, { draft: result, targetMealId });
      if (account.current === owner && requestSequence.current === sequence) setReplacement(preview);
    } catch (e) {
      if (account.current === owner && requestSequence.current === sequence) setError(e instanceof Error ? e.message : "替换计算失败，原方案保留");
    } finally { if (account.current === owner && requestSequence.current === sequence) setLoading(false); }
  };
  const activate = async () => {
    if (!user || !persistedPlan.current || !saved || saving || activated) return;
    const owner = user.id;
    const sequence = requestSequence.current;
    setSaving(true); setError("");
    try {
      const existing = persistedPlan.current;
      const response = await mealPlansApi.activateDraft(authFetch, existing.id, existing.version);
      if (account.current === owner && sequence === requestSequence.current) {
        persistedPlan.current = { id: response.plan.id, version: response.plan.version };
        setActivated(true);
        router.push("/meal-plans");
      }
    } catch (e) {
      if (account.current === owner && sequence === requestSequence.current) setError(e instanceof Error ? e.message : "转换餐单失败");
    } finally { if (account.current === owner && sequence === requestSequence.current) setSaving(false); }
  };
  const save = async () => {
    if (!user || !result || saving || saved || loading || replacement) return;
    const owner = user.id;
    const sequence = requestSequence.current;
    setSaving(true); setError("");
    try {
      const existing = persistedPlan.current;
      const response = existing
        ? await mealPlansApi.updateDraft(authFetch, existing.id, { version: existing.version, idempotencyKey: saveId.current, draft: result })
        : await mealPlansApi.saveDraft(authFetch, { id: saveId.current, title: `${result.meals[0].date} 备餐方案`, draft: result });
      if (account.current === owner && sequence === requestSequence.current) {
        const snapshot = response.plan.constraints.savedCookingDraft as { draft?: unknown } | undefined;
        const actual = cookingPlanDraftSchema.parse(response.plan.constraints.currentCookingDraft ?? snapshot?.draft);
        persistedPlan.current = { id: response.plan.id, version: response.plan.version };
        setResult(actual); setSaved(true);
      }
    } catch (e) {
      if (account.current === owner && sequence === requestSequence.current) setError(e instanceof Error ? e.message : "保存失败，请重试");
    } finally { if (account.current === owner && sequence === requestSequence.current) setSaving(false); }
  };
  return <Screen className="flex-1 bg-canvas">
    <View className="flex-row items-center gap-4 px-5 py-4"><TouchableOpacity onPress={() => router.back()}><Text className="font-bold text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-black text-ink">这次怎么备餐</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4 pb-12" keyboardShouldPersistTaps="handled">
      <Text className="text-copy-muted">先用未保留的待吃餐，再计算需要补做的份量。可到待吃餐页标记“这份留着”。</Text>
      <TouchableOpacity onPress={() => router.push("/prepared-meals")}><Text className="font-bold text-brand">查看待吃餐与保留项</Text></TouchableOpacity>
      <View className="rounded-2xl bg-surface p-4 gap-3">
        <Text className="font-bold text-ink">晚餐日期</Text><TextInput accessibilityLabel="晚餐日期" value={date} onChangeText={value => { setDate(value); invalidateDraft(); }} className="rounded-xl border border-line p-3 text-ink" placeholder="YYYY-MM-DD" />
        <Text className="font-bold text-ink">每餐需要几份</Text><TextInput accessibilityLabel="每餐份量" value={servings} onChangeText={value => { setServings(value); invalidateDraft(); }} keyboardType="decimal-pad" className="rounded-xl border border-line p-3 text-ink" />
        <Text className="font-bold text-ink">本次时间上限（分钟）</Text><TextInput accessibilityLabel="本次时间上限" value={minutes} onChangeText={value => { setMinutes(value); invalidateDraft(); }} keyboardType="number-pad" placeholder="留空沿用长期设置，未设置为30" className="rounded-xl border border-line p-3 text-ink" />
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: includeLunch }} onPress={() => { setIncludeLunch(value => !value); invalidateDraft(); }}><Text className="font-bold text-brand">{includeLunch ? "已包含" : "未包含"} · 次日午餐</Text></TouchableOpacity>
        <TouchableOpacity disabled={!user || loading} onPress={() => void calculate()} className="rounded-xl bg-brand-fill p-3 items-center">{loading ? <ActivityIndicator color="#fff" /> : <Text className="font-bold text-white">{user ? "按当前库存重新计算" : "请先登录"}</Text>}</TouchableOpacity>
      </View>
      {error ? <Text className="text-danger">{error}</Text> : null}
      {replacement ? <View className="rounded-2xl bg-warm-soft p-4 gap-3">
        <Text className="font-black text-ink">替换预览 · 其余安排保留</Text>
        {replacement.draft.cooking.filter(item => result?.cooking.find(old => old.targetMealId === item.targetMealId)?.recipeId !== item.recipeId).map(item => <Text key={item.targetMealId} className="text-ink">改为 {item.title} {item.servings} 份</Text>)}
        {replacement.conflicts.map(message => <Text key={message} className="text-danger">{message}</Text>)}
        <Text className="text-copy-muted">整套已知顺序耗时 {replacement.draft.time.knownSequentialMinutes} 分钟，完整时间与存放条件仍需核对。</Text>
        <TouchableOpacity onPress={() => { setResult(replacement.draft); setReplacement(null); setSaved(false); saveId.current = Crypto.randomUUID(); }}><Text className="font-bold text-brand">采用这次替换草案</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setReplacement(null)}><Text className="text-copy-muted">保留原方案</Text></TouchableOpacity>
      </View> : null}
      {result ? <>
        <TouchableOpacity disabled={saved || saving || loading || !!replacement} onPress={() => void save()} className="rounded-xl bg-brand-fill p-3 items-center"><Text className="font-bold text-white">{saving ? "正在保存" : saved ? "已保存 · 可从餐单恢复" : "保存此方案草案"}</Text></TouchableOpacity>
        <Text className="text-copy-muted">保存的是计算时的方案；库存变化后请重新核对。</Text>
        {saved ? <TouchableOpacity disabled={saving || loading || activated || !!replacement || !!result.unresolved.length} onPress={() => void activate()} className="rounded-xl bg-brand-soft p-3"><Text className="font-bold text-brand">{activated ? "已转为餐单 · 从餐单开始制作" : "转为餐单，选择要制作的菜"}</Text></TouchableOpacity> : null}
        <View className="rounded-2xl bg-warm-soft p-4 gap-2"><Text className="font-black text-ink">方案草案 · 还需核对</Text><Text className="text-copy-muted">已知顺序耗时约 {result.time.knownSequentialMinutes} 分钟，上限 {result.time.budgetMinutes} 分钟{result.time.exceedsBudget ? "，已超时" : ""}。尚未计入完整收尾、设备安排；保鲜、携带和加热条件也需核实。</Text></View>
        {result.meals.map(meal => <View key={meal.id} className="rounded-2xl bg-surface p-4 gap-2"><Text className="font-black text-ink">{meal.date} · {meal.mealType === "dinner" ? "晚餐" : "午餐"}</Text><Text className="text-brand">需要 {meal.servings} 份 · 待吃餐 {meal.preparedServings} 份 · 补做 {meal.cookServings} 份</Text>
          {meal.allocations.map(item => <Text key={item.preparedMealId} className="text-copy-muted">待吃：{item.foodName} {item.servings} 份（存放条件待核对）</Text>)}
          {result.cooking.filter(item => item.targetMealId === meal.id).map(item => <View key={item.recipeId} className="gap-2"><TouchableOpacity onPress={() => router.push({ pathname: "/recipe-detail", params: { id: item.recipeId } })}><Text className="font-bold text-brand">补做：{item.title} {item.servings} 份 · 查看菜谱</Text></TouchableOpacity><TouchableOpacity disabled={loading || saving || activated} onPress={() => void replace(meal.id)}><Text className="font-bold text-brand">这道换一个</Text></TouchableOpacity></View>)}
          {result.unresolved.filter(item => item.targetMealId === meal.id).map(item => <Text key={item.targetMealId} className="text-danger">{item.reason}</Text>)}
        </View>)}
        <View className="rounded-2xl bg-surface p-4 gap-2"><Text className="font-black text-ink">整套原料预算</Text>{result.ingredientBudget.map((item, index) => <Text key={index} className="text-copy-muted">{item.food_name}：{item.quantity_status === "unknown" ? "数量或换算依据未知" : item.fully_covered ? "已知库存足量" : `缺 ${item.missing_value} ${item.unit}`}</Text>)}</View>
        <Text className="text-copy-muted text-xs">此页只计算方案。实际制作时请按最新库存核对扣减；实际吃下后再记录饮食。</Text>
      </> : null}
    </ScrollView>
  </Screen>;
}
