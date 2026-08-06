import { useCallback, useState } from "react";
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { communityApi } from "@/services/api";
import { getAvatarSource } from "@/utils/defaultAvatar";

type ProfilePost = { id: number; content: string; image_url: string | null; likes_count: number; created_at: string; category?: string };
type UserLevel = { level: number; title: string; xp: number; nextXp: number | null; progress: number };
type UserProfile = { id: number; username: string; avatar_url: string | null; bio: string | null; followers_count: number; following_count: number; posts_count: number; is_following: boolean; level: UserLevel; posts: ProfilePost[] };

export default function UserProfileScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const { userId } = useSafeSearchParams<{ userId?: number | string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [followPending, setFollowPending] = useState(false);

  const load = useCallback(async () => {
    if (!userId) { setLoading(false); return; }
    try { setLoading(true); setProfile(await communityApi.userProfile<UserProfile>(authFetch, Number(userId))); }
    catch { setProfile(null); } finally { setLoading(false); }
  }, [authFetch, userId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggleFollow = async () => {
    if (!profile || followPending) return;
    if (!isAuthenticated) { router.push("/login"); return; }
    const previousProfile = profile;
    setFollowPending(true);
    setProfile({ ...profile, is_following: !profile.is_following, followers_count: Math.max(0, profile.followers_count + (profile.is_following ? -1 : 1)) });
    try {
      const result = await communityApi.toggleFollow(authFetch, profile.id);
      setProfile((current) => current?.id === profile.id ? {
        ...current,
        is_following: result.is_following,
        followers_count: Math.max(0, previousProfile.followers_count + (result.is_following ? 1 : 0) - (previousProfile.is_following ? 1 : 0)),
      } : current);
    } catch {
      setProfile((current) => current?.id === previousProfile.id ? previousProfile : current);
    } finally {
      setFollowPending(false);
    }
  };

  if (loading) return <Screen backgroundColor="#F7F5EF"><View className="flex-1 items-center justify-center"><ActivityIndicator color="#2D6A4F" /><Text className="mt-3 text-xs text-[#8B7D6B]">正在打开个人主页</Text></View></Screen>;
  if (!profile) return <Screen backgroundColor="#F7F5EF"><View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="user-slash" size={28} color="#8B7D6B" /><Text className="mt-4 text-base font-bold text-[#3D3229]">该用户暂不可查看</Text><TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-[#2D6A4F] px-6 py-3"><Text className="font-bold text-white">返回社区</Text></TouchableOpacity></View></Screen>;

  const isSelf = user?.id === profile.id;
  return <Screen backgroundColor="#F7F5EF"><ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
    <View className="overflow-hidden bg-[#246044] px-5 pb-10 pt-4">
      <View className="absolute -right-12 -top-10 h-48 w-48 rounded-full bg-[#E9C46A]/15" />
      <View className="absolute -left-16 bottom-0 h-28 w-28 rounded-full bg-white/10" />
      <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/15"><FontAwesome6 name="chevron-left" size={15} color="white" /></TouchableOpacity>
      <View className="mt-7 items-center">
        <View className="rounded-full border-4 border-[#E9C46A] bg-white p-1 shadow-lg"><Image source={getAvatarSource(profile.avatar_url, profile.id)} className="h-20 w-20 rounded-full" /></View>
        <Text className="mt-3 text-xl font-black text-white">{profile.username}</Text>
        <View className="mt-2 flex-row items-center gap-1.5 rounded-full bg-white/15 px-3 py-1"><FontAwesome6 name="medal" size={10} color="#E9C46A" /><Text className="text-[10px] font-bold text-emerald-50">V{profile.level.level} · {profile.level.title}</Text></View>
        <Text className="mt-3 max-w-[290px] text-center text-xs leading-5 text-emerald-100">{profile.bio || "分享日常饮食与健康生活。"}</Text>
      </View>
      <View className="mt-6 flex-row rounded-[22px] border border-white/10 bg-black/15 py-3.5"><Stat label="动态" value={profile.posts_count} /><Stat label="关注" value={profile.following_count} /><Stat label="粉丝" value={profile.followers_count} /></View>
      <View className="mt-3 rounded-2xl border border-white/10 bg-white/10 px-3 py-2.5"><View className="flex-row items-center justify-between"><Text className="text-[10px] font-bold text-emerald-50">成长经验 {profile.level.xp} XP</Text><Text className="text-[10px] text-emerald-100">{profile.level.nextXp ? `${profile.level.progress}%` : "满级"}</Text></View><View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/15"><View className="h-full rounded-full bg-[#E9C46A]" style={{ width: `${profile.level.progress}%` }} /></View></View>
      {!isSelf ? <TouchableOpacity disabled={followPending} onPress={() => void toggleFollow()} className={`mt-4 flex-row items-center justify-center gap-2 rounded-2xl py-3.5 ${followPending ? "opacity-60" : ""} ${profile.is_following ? "border border-white/20 bg-white/15" : "bg-[#E9C46A]"}`}><FontAwesome6 name={profile.is_following ? "check" : "plus"} size={12} color={profile.is_following ? "#FFF" : "#3D3229"} /><Text className={`text-sm font-black ${profile.is_following ? "text-white" : "text-[#3D3229]"}`}>{followPending ? "处理中…" : profile.is_following ? "已关注" : "关注 TA"}</Text></TouchableOpacity> : null}
    </View>
    <View className="-mt-5 rounded-t-[30px] bg-[#F7F5EF] px-4 pt-6">
      <View className="mb-4 flex-row items-center justify-between"><View><Text className="text-base font-black text-[#2F3C32]">TA 的动态</Text><Text className="mt-1 text-[10px] text-[#8B7D6B]">最近发布的健康生活记录</Text></View><View className="h-8 w-8 items-center justify-center rounded-full bg-[#E7F1E9]"><FontAwesome6 name="leaf" size={13} color="#2D6A4F" /></View></View>
      {profile.posts.length ? profile.posts.map((post) => <TouchableOpacity key={post.id} onPress={() => router.push("/post-detail", { id: post.id })} className="mb-3 overflow-hidden rounded-[22px] border border-[#E8E1D5] bg-white shadow-2xs active:opacity-85"><View className="flex-row"><View className="flex-1 p-4"><View className="mb-2 flex-row items-center gap-2"><View className="rounded-full bg-[#E7F1E9] px-2 py-1"><Text className="text-[9px] font-bold text-[#2D6A4F]">#{post.category || "寻味"}</Text></View><Text className="text-[9px] text-[#A09383]">{post.likes_count} 赞</Text></View><Text className="text-[13px] font-bold leading-5 text-[#3D3229]" numberOfLines={3}>{post.content}</Text><View className="mt-3 flex-row items-center gap-1"><FontAwesome6 name="arrow-up-right-from-square" size={9} color="#8B7D6B" /><Text className="text-[10px] text-[#8B7D6B]">查看动态</Text></View></View>{post.image_url ? <Image source={{ uri: post.image_url }} className="h-32 w-28" resizeMode="cover" /> : <View className="w-7 bg-[#E7F1E9]" />}</View></TouchableOpacity>) : <View className="items-center rounded-3xl border border-dashed border-[#DCD5C9] bg-white py-14"><FontAwesome6 name="seedling" size={25} color="#8BA793" /><Text className="mt-3 text-sm font-bold text-[#6F786E]">还没有发布动态</Text></View>}
    </View>
  </ScrollView></Screen>;
}

function Stat({ label, value }: { label: string; value: number }) { return <View className="flex-1 items-center border-r border-white/10 last:border-r-0"><Text className="text-lg font-black text-white">{value}</Text><Text className="mt-1 text-[10px] text-emerald-100">{label}</Text></View>; }
