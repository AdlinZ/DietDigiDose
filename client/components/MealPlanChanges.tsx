import { useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { useAuthFetch } from "@/contexts/AuthContext";
import { mealPlansApi, type MealPlanChange, type MealPlanItem } from "@/services/api";

const labels: Record<string,string> = { pending: "等待确认", applied: "已应用", rejected: "已拒绝", blocked: "已进入执行，保留原安排", reverted: "已恢复", conflict: "状态已变化" };
function describe(change: MealPlanChange) {
  const before = change.before.input ?? {};
  const after = change.after;
  return [
    after.plannedDate !== undefined && after.plannedDate !== before.plannedDate ? `日期：${before.plannedDate} → ${after.plannedDate}` : "",
    after.mealType !== undefined && after.mealType !== before.mealType ? `餐次：${before.mealType} → ${after.mealType}` : "",
    after.recipeId !== undefined && after.recipeId !== before.recipeId ? `菜谱：${change.before.title || "原菜谱"} → ${after.title || "新菜谱"}` : "",
    after.status !== undefined && after.status !== before.status ? (after.status === "skipped" ? "跳过这餐" : "恢复这餐安排") : "",
  ].filter(Boolean).join(" · ") || "调整餐次";
}
export function MealPlanChanges({ planId, revision, items, onChanged }: { planId: string; revision: number; items: MealPlanItem[]; onChanged: (item: MealPlanItem) => void }) {
  const authFetch = useAuthFetch();
  const [changes, setChanges] = useState<MealPlanChange[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void mealPlansApi.changes(authFetch,planId).then(value => { if (active) setChanges(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "变更记录加载失败"); });
    return () => { active = false; };
  }, [authFetch,planId,revision,refresh]);
  const review = async (change: MealPlanChange, action: "accept" | "reject" | "restore") => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await mealPlansApi.reviewChange(authFetch,planId,change.id,action);
      onChanged(next); setRefresh(value => value + 1);
    } catch (reason) { Alert.alert("原安排已保留", reason instanceof Error ? reason.message : "请刷新后重试"); }
    finally { setBusy(false); }
  };
  if (!changes.length && !error) return null;
  return <View className="mx-5 my-3 gap-3">
    <Text className="font-bold text-ink">安排变更</Text>
    {error ? <Text className="text-danger">{error}</Text> : null}
    {changes.map(change => <View key={change.id} className="rounded-2xl border border-line bg-surface p-4 gap-2">
      <Text className="font-bold text-ink">{items.find(item => item.id === change.itemId)?.title || "餐次"} · {labels[change.status] || change.status}</Text>
      <Text className="text-copy-muted text-xs">{change.reason} · {change.source === "manual" ? "手动调整" : "系统建议"}</Text>
      <Text className="text-ink text-sm">{describe(change)}</Text>
      <View className="flex-row gap-5">
        {change.status === "pending" ? <><TouchableOpacity disabled={busy} onPress={() => void review(change,"accept")}><Text className="font-bold text-brand">接受变更</Text></TouchableOpacity><TouchableOpacity disabled={busy} onPress={() => void review(change,"reject")}><Text className="text-copy-muted">保留原安排</Text></TouchableOpacity></> : null}
        {change.status === "applied" ? <TouchableOpacity disabled={busy} onPress={() => void review(change,"restore")}><Text className="text-brand">恢复变更前安排</Text></TouchableOpacity> : null}
      </View>
    </View>)}
  </View>;
}
