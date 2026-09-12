import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import type { InterventionCard } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { interventionApi } from "@/services/api/interventions";
import { recipesApi } from "@/services/api/recipes";

export default function InterventionScreen() {
  const { token,user } = useAuth();
  const { id } = useSafeSearchParams<{ id?: string }>();
  return <InterventionDetail key={`${user?.id ?? "anonymous"}:${id ?? ""}`} token={token} id={id} />;
}
function InterventionDetail({ token,id }: { token: string | null; id?: string }) {
  const router = useSafeRouter();
  const [data,setData] = useState<{ token: string; card: InterventionCard; titles: Record<number,string> } | null>(null);
  const [loadError,setLoadError] = useState<{ token: string; message: string } | null>(null);
  const [reload,setReload] = useState(0);
  const [now,setNow] = useState(() => Date.now());
  const card = data?.token === token ? data?.card : undefined;
  const validId = typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
  const error = !token ? "请先登录后查看这条提醒。" : !validId ? "这条提醒的链接无效，请返回通知中心。" : loadError?.token === token ? loadError.message : "";
  useEffect(() => {
    let active = true;
    if (!token || !validId || !id) return;
    void interventionApi.card(token,id).then(async value => {
      if (!active) return;
      setLoadError(null);setData({ token,card: value,titles: {} });
      const recipes = await Promise.allSettled(value.recipeIds.map(recipeId => recipesApi.detail(recipeId)));
      if (active) setData({ token,card: value,titles: Object.fromEntries(recipes.flatMap((result,index) => result.status === "fulfilled" ? [[value.recipeIds[index],result.value.title]] : [])) });
    }).catch(() => { if (active) setLoadError({ token,message: "未能读取这条提醒。它可能已移除或不属于当前账号，请重试或返回通知中心。" }); });
    return () => { active = false; };
  },[token,id,validId,reload]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()),30_000);return () => clearInterval(timer); },[]);
  const expired = card && (card.status === "expired" || Date.parse(card.expiresAt)<=now);
  return <Screen className="flex-1 bg-background">
    <View className="gap-5 p-5">
      <View className="flex-row items-center gap-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace("/notifications")}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">食材与晚餐提醒</Text></View>
      {!card && !error && <ActivityIndicator accessibilityLabel="正在读取提醒" />}
      {!!error && <View className="gap-3 rounded-2xl bg-surface p-5"><Text className="text-copy-muted">{error}</Text><TouchableOpacity accessibilityRole="button" onPress={() => { setData(null);setLoadError(null);setReload(value => value+1); }}><Text className="font-bold text-brand">重新加载</Text></TouchableOpacity></View>}
      {card && <>
        <View className="gap-3 rounded-2xl border border-line bg-surface p-5">
          <Text className="text-xl font-bold text-ink">{card.title}</Text><Text className="text-copy-muted">{card.body}</Text>
          <Text className="font-bold text-ink">为什么现在提醒</Text><Text className="text-copy-muted">{card.whyNow}</Text>
          <Text className="font-bold text-ink">机会有效期</Text><Text className="text-copy-muted">{card.expiresLabel}</Text>
          {expired && <Text className="font-bold text-warm">这次建议已失效，请根据当前库存重新安排。</Text>}
          {card.status === "acted" && <Text className="text-brand">这条提醒已处理。</Text>}
        </View>
        <View className="gap-3"><Text className="text-lg font-bold text-ink">关联菜谱</Text>{card.recipeIds.map((recipeId,index) => <TouchableOpacity key={recipeId} accessibilityRole="button" onPress={() => router.push("/recipe-detail",{ id: recipeId })} className="rounded-xl border border-line bg-surface p-4"><Text className="font-bold text-brand">{data?.titles[recipeId] || `查看建议菜谱 ${index+1}`}</Text></TouchableOpacity>)}</View>
        {card.inventoryIds.length>0 && <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/(tabs)/inventory")} className="rounded-xl bg-surface p-4"><Text className="font-bold text-brand">查看库存</Text><Text className="mt-1 text-copy-muted">这条提醒生成时关联了 {card.inventoryIds.length} 项食材，请以当前库存状态为准。</Text></TouchableOpacity>}
      </>}
    </View>
  </Screen>;
}
