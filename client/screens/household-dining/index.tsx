import { useEffect, useRef, useState } from "react";
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { householdDiningPreferencesSchema, type HouseholdDiningPreferencesInput } from "@dietdigidose/contracts";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { householdApi, type Household } from "@/services/api/households";

export default function HouseholdDiningScreen() {
  const { user } = useAuth();
  return <DiningAccount key={user?.id ?? "signed-out"} signedIn={Boolean(user)} />;
}
function DiningAccount({ signedIn }: { signedIn: boolean }) {
  const apiFetch = useAuthFetch(); const router = useSafeRouter();
  const [families,setFamilies] = useState<Household[]>([]); const [selected,setSelected] = useState<number | null>(null);
  const [message,setMessage] = useState(""); const [reload,setReload] = useState(0);
  useEffect(() => {
    let active = true;
    if (signedIn) void householdApi.mine(apiFetch).then(value => {
      if (active) { setFamilies(value); setSelected(value[0]?.id ?? null); setMessage(value.length ? "" : "请先到库存页的家庭共享入口创建或加入家庭，再返回刷新。"); }
    }).catch(() => { if (active) setMessage("未能读取家庭，请重试。"); });
    return () => { active = false; };
  },[apiFetch,signedIn,reload]);
  return <Screen className="flex-1 bg-background">
    <View className="flex-row gap-6 p-5"><TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text className="text-brand">返回</Text></TouchableOpacity><Text className="text-xl font-bold text-ink">共餐忌口设置</Text></View>
    <ScrollView contentContainerClassName="p-5 gap-4">
      <Text className="text-copy-muted">只填写你愿意用于家庭共餐的过敏原和饮食限制。不会从个人健康档案自动复制；每个家庭分别设置。多人配餐功能仍在完善，保存后请继续向一起做饭的人确认忌口。</Text>
      {!signedIn ? <Text className="text-ink">请登录后设置。</Text> : <>
        {families.map(family => <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: selected === family.id }} key={family.id} onPress={() => setSelected(family.id)} className="rounded-xl bg-surface p-4"><Text className={selected === family.id ? "font-bold text-brand" : "text-ink"}>{family.name}</Text></TouchableOpacity>)}
        {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
        <TouchableOpacity accessibilityRole="button" onPress={() => { setSelected(null); setFamilies([]); setMessage(""); setReload(value => value+1); }}><Text className="text-brand">刷新家庭列表</Text></TouchableOpacity>
        {selected !== null ? <DiningEditor key={selected} householdId={selected} /> : null}
      </>}
    </ScrollView>
  </Screen>;
}
function DiningEditor({ householdId }: { householdId: number }) {
  const apiFetch = useAuthFetch();
  const [saved,setSaved] = useState<HouseholdDiningPreferencesInput | null>(null);
  const [shared,setShared] = useState(false); const [allergies,setAllergies] = useState(""); const [restrictions,setRestrictions] = useState("");
  const [busy,setBusy] = useState(true); const [message,setMessage] = useState(""); const [reload,setReload] = useState(0);
  const generation = useRef(0); const writing = useRef(false);
  const adopt = (value: HouseholdDiningPreferencesInput) => { setSaved(value); setShared(value.shared); setAllergies(value.allergies.join("\n")); setRestrictions(value.restrictions.join("\n")); };
  useEffect(() => {
    const ticket = ++generation.current;
    setSaved(null); setBusy(true); setMessage("");
    void householdApi.diningPreferences(apiFetch,householdId).then(value => { if (ticket === generation.current) adopt(value); })
      .catch(() => { if (ticket === generation.current) setMessage("未能读取设置，成员身份可能已变化。请重新读取或刷新家庭列表。"); })
      .finally(() => { if (ticket === generation.current) setBusy(false); });
    return () => { generation.current++; };
  },[apiFetch,householdId,reload]);
  const save = async () => {
    if (!saved || writing.current || busy) return;
    const lines = (value: string) => [...new Set(value.split(/\n/).map(line => line.trim()).filter(Boolean))];
    const input = householdDiningPreferencesSchema.safeParse({ ...saved,shared,allergies: lines(allergies),restrictions: lines(restrictions) });
    if (!input.success) { setMessage("每项最多100字，每类最多50项，请分行填写。"); return; }
    const ticket = generation.current; writing.current = true; setBusy(true); setMessage("");
    try {
      const value = await householdApi.saveDiningPreferences(apiFetch,householdId,input.data);
      if (ticket === generation.current) { adopt(value); setMessage("设置已保存"); }
    } catch {
      if (ticket === generation.current) { setSaved(null); setMessage("保存结果尚未确认，或成员设置已变化。请重新读取后核对。"); }
    } finally { if (ticket === generation.current) { writing.current = false; setBusy(false); } }
  };
  return <View className="gap-4">
    {saved ? <>
      <Text className="text-ink">过敏原（每行一项）</Text>
      <TextInput accessibilityLabel="共餐过敏原" multiline value={allergies} onChangeText={setAllergies} editable={!busy} className="rounded-xl border border-border bg-surface p-4 text-ink" />
      <Text className="text-ink">饮食限制（每行一项）</Text>
      <TextInput accessibilityLabel="共餐饮食限制" multiline value={restrictions} onChangeText={setRestrictions} editable={!busy} className="rounded-xl border border-border bg-surface p-4 text-ink" />
      <View className="flex-row items-center justify-between"><Text className="text-ink">允许用于本家庭共餐</Text><Switch accessibilityLabel="允许共餐共享" value={shared} onValueChange={setShared} disabled={busy} /></View>
      <Text className="text-copy-muted">关闭后保存即可撤回授权，填写内容仍保留在自己的设置中。退出家庭会清除这份设置，重新加入需要重新填写和授权。</Text>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void save()} className="rounded-xl bg-brand p-4"><Text className="text-center font-bold text-white">保存共餐设置</Text></TouchableOpacity>
      <Text className="text-copy-muted">已保存授权：{saved.shared ? "允许" : "不允许"}</Text>
    </> : busy ? <Text className="text-copy-muted">正在读取设置…</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" className="text-ink">{message}</Text> : null}
    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => setReload(value => value+1)}><Text className="text-brand">重新读取设置</Text></TouchableOpacity>
  </View>;
}
