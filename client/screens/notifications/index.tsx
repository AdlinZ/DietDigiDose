import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";

type NotificationItem = { type: "expiring_inventory" | "admin_campaign"; status: string; createdAt: string; title: string; body: string };

export default function NotificationsScreen() {
  const router = useSafeRouter();
  const { token, isAuthenticated } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try { setItems((await authApi.notificationHistory<{ items: NotificationItem[] }>(token)).items); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  return <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
    <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-[#EBE3D5] bg-[#FDF8F0]"><TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-white border border-[#EBE3D5] items-center justify-center"><FontAwesome6 name="chevron-left" size={14} color="#3D3229" /></TouchableOpacity><Text className="text-lg font-black text-[#3D3229]">通知中心</Text><TouchableOpacity onPress={() => router.push("/settings")} className="w-10 h-10 items-center justify-center"><FontAwesome6 name="gear" size={16} color="#8B7D6B" /></TouchableOpacity></View>
    {!isAuthenticated ? <View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="bell" size={28} color="#2D6A4F" /><Text className="mt-4 text-base font-black text-[#3D3229]">登录后查看通知</Text><TouchableOpacity onPress={() => router.push("/login")} className="mt-4 rounded-xl bg-[#2D6A4F] px-5 py-3"><Text className="font-bold text-white">去登录</Text></TouchableOpacity></View> : loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2D6A4F" /></View> : <View className="px-5 pt-4 gap-3">{items.length ? items.map((item, index) => <View key={`${item.type}-${item.createdAt}-${index}`} className="rounded-2xl border border-[#EBE3D5] bg-white p-4"><View className="flex-row items-start gap-3"><View className={`mt-0.5 w-9 h-9 rounded-xl items-center justify-center ${item.type === "expiring_inventory" ? "bg-[#E9C46A]/25" : "bg-[#2D6A4F]/10"}`}><FontAwesome6 name={item.type === "expiring_inventory" ? "clock" : "bullhorn"} size={15} color={item.type === "expiring_inventory" ? "#B7791F" : "#2D6A4F"} /></View><View className="flex-1"><Text className="text-sm font-black text-[#3D3229]">{item.title}</Text><Text className="mt-1 text-xs leading-5 text-[#8B7D6B]">{item.body}</Text><Text className="mt-2 text-[10px] text-[#B0A495]">{new Date(item.createdAt).toLocaleString("zh-CN")}</Text></View></View></View>) : <View className="mt-28 items-center"><FontAwesome6 name="bell-slash" size={28} color="#B0A495" /><Text className="mt-4 text-sm font-bold text-[#8B7D6B]">暂时没有新通知</Text><Text className="mt-1 text-xs text-[#B0A495]">可以在设置中管理提醒偏好</Text></View>}</View>}
  </Screen>;
}
