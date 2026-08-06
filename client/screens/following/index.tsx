import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";

type FollowingUser = { id: number; username: string; avatar_url: string | null; created_at: string };

export default function FollowingScreen() {
  const router = useSafeRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [users, setUsers] = useState<FollowingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    try { setLoading(true); setUsers(await communityApi.following<FollowingUser>(authFetch)); }
    catch { setUsers([]); } finally { setLoading(false); }
  }, [authFetch, isAuthenticated]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const unfollow = async (id: number) => {
    const previous = users;
    setUsers((current) => current.filter((user) => user.id !== id));
    try { await communityApi.toggleFollow(authFetch, id); } catch { setUsers(previous); }
  };
  return <Screen backgroundColor="#FDF8F0">
    <View className="flex-row items-center border-b border-[#EBE3D5] bg-white px-4 py-3">
      <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full bg-[#F5EFE6]"><FontAwesome6 name="chevron-left" size={14} color="#2D6A4F" /></TouchableOpacity>
      <View className="ml-3 flex-1"><Text className="text-lg font-black text-[#3D3229]">我关注的人</Text><Text className="text-[11px] text-[#8B7D6B]">关注的健康生活伙伴</Text></View>
      <View className="rounded-full bg-[#E7F1E9] px-3 py-1"><Text className="text-xs font-black text-[#2D6A4F]">{users.length} 人</Text></View>
    </View>
    {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2D6A4F" /></View> : users.length === 0 ? <View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="user-group" size={32} color="#2D6A4F" /><Text className="mt-4 text-lg font-black text-[#3D3229]">还没有关注的人</Text><Text className="mt-2 text-center text-sm leading-6 text-[#8B7D6B]">在社区动态中关注感兴趣的创作者吧。</Text><TouchableOpacity onPress={() => router.replace("/(tabs)/community")} className="mt-5 rounded-2xl bg-[#2D6A4F] px-6 py-3"><Text className="font-bold text-white">去社区看看</Text></TouchableOpacity></View> : <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {users.map((user) => <View key={user.id} className="flex-row items-center rounded-2xl border border-[#EBE3D5] bg-white p-3"><TouchableOpacity onPress={() => router.push("/user-profile", { userId: user.id })} className="flex-1 flex-row items-center active:opacity-75"><Image source={getAvatarSource(user.avatar_url, user.id)} className="h-11 w-11 rounded-full" /><View className="ml-3 flex-1"><Text className="text-sm font-bold text-[#3D3229]">{user.username}</Text><Text className="mt-0.5 text-[10px] text-[#8B7D6B]">查看个人主页</Text></View></TouchableOpacity><TouchableOpacity onPress={() => void unfollow(user.id)} className="ml-2 rounded-full bg-[#F5EFE6] px-3 py-2"><Text className="text-xs font-bold text-[#8B7D6B]">已关注</Text></TouchableOpacity></View>)}
    </ScrollView>}
  </Screen>;
}
