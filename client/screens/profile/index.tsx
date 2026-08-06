import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Alert,
  Modal,
  DeviceEventEmitter,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Screen } from "@/components/Screen";
import { useFocusEffect } from "expo-router";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { LineChart } from "react-native-chart-kit";
import { addLocalDays, toLocalDateKey } from "@/utils/date";
import { communityApi, dietApi, healthApi, recipesApi } from "@/services/api";
import { ALLERGY_LABELS, hasSafetyProfile, type HealthProfile as SavedHealthProfile } from "@/utils/healthProfile";


interface HealthData {
  id: number;
  weight: number | null;
  height: number | null;
  body_fat?: number | null;
  bmi: number | null;
  water_ml?: number | null;
  recorded_date?: string;
  created_at: string;
}

interface DietRecord {
  id: number;
  meal_type: string;
  food_name: string;
  amount: string;
  calories: number | null;
  recorded_at: string;
}

interface UserLevel { level: number; title: string; xp: number; nextXp: number | null; progress: number; }

export default function ProfileScreen() {
  const router = useSafeRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const authFetch = useAuthFetch();

  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [healthProfile, setHealthProfile] = useState<SavedHealthProfile | null>(null);
  const [recentRecords, setRecentRecords] = useState<DietRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dietTrend, setDietTrend] = useState<{ date: string; calories: number }[]>([]);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [waterMl, setWaterMl] = useState<number | null>(null);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [dietRecordCount, setDietRecordCount] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [userLevel, setUserLevel] = useState<UserLevel | null>(null);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  const today = toLocalDateKey();

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-quick-record", () => {
      router.push("/");
    });
    return () => sub.remove();
  }, [router]);

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadWarning(null);
    const results = await Promise.allSettled([
      healthApi.latest(authFetch),
      healthApi.list(authFetch),
      healthApi.profile<SavedHealthProfile>(authFetch),
      dietApi.list(authFetch),
      recipesApi.favoriteCount(authFetch),
      communityApi.following<{ id: number }>(authFetch),
      communityApi.level<UserLevel>(authFetch),
    ]);
    const [healthResult, healthLogsResult, healthProfileResult, dietResult, favoriteResult, followingResult, levelResult] = results;
    const failedSections: string[] = [];

    if (favoriteResult.status === "fulfilled") setFavoriteCount(Number(favoriteResult.value?.count || 0));
    else failedSections.push("收藏");
    if (followingResult.status === "fulfilled") setFollowingCount(Array.isArray(followingResult.value) ? followingResult.value.length : 0);
    else failedSections.push("关注");
    if (levelResult.status === "fulfilled") setUserLevel(levelResult.value);
    else failedSections.push("等级");

    if (healthResult.status === "fulfilled") {
      const latestHealth = Array.isArray(healthResult.value) ? healthResult.value[0] : healthResult.value;
      setHealthData(latestHealth);
    } else failedSections.push("健康概览");
    if (healthProfileResult.status === "fulfilled") setHealthProfile(healthProfileResult.value);
    else failedSections.push("健康档案");
    if (healthLogsResult.status === "fulfilled") {
      const todayHealth = Array.isArray(healthLogsResult.value)
        ? healthLogsResult.value.find((entry) => entry.recorded_date === today)
        : null;
      setWaterMl(todayHealth?.water_ml ?? null);
    } else failedSections.push("饮水记录");

    if (dietResult.status === "fulfilled") {
      const dietList = Array.isArray(dietResult.value) ? dietResult.value : [];
      setRecentRecords(dietList.slice(0, 5));
      setDietRecordCount(dietList.length);
      const recordedDays = new Set(dietList.map((record: DietRecord) => record.recorded_at));
      let streak = 0;
      for (let dayOffset = 0; recordedDays.has(toLocalDateKey(addLocalDays(-dayOffset))); dayOffset += 1) streak += 1;
      setStreakDays(streak);

      // Compute diet trend for last 7 days
      const last7Days: { date: string; calories: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = addLocalDays(-i);
        const dateStr = toLocalDateKey(d);
        const dayRecords = dietList.filter((r: DietRecord) => r.recorded_at === dateStr);
        const totalCalories = dayRecords.reduce(
          (sum: number, r: DietRecord) => sum + (r.calories || 0),
          0
        );
        last7Days.push({ date: dateStr, calories: totalCalories });
      }
      setDietTrend(last7Days);
    } else failedSections.push("饮食趋势");

    if (failedSections.length > 0) {
      console.warn("Profile partial fetch failure", failedSections);
      setLoadWarning(`${failedSections.join("、")}暂时无法加载，其他资料仍可使用`);
    }
    setLoading(false);
  }, [isAuthenticated, authFetch, today]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleAddWater = async (addAmount: number) => {
    const previousWater = waterMl;
    const newWater = (waterMl ?? 0) + addAmount;
    setWaterMl(newWater);

    if (!isAuthenticated) return;
    try {
      await healthApi.saveLog(authFetch, { recorded_date: today, water_ml: newWater });
    } catch (e) {
      setWaterMl(previousWater);
      console.error("Update water failed", e);
    }
  };

  const handleLogout = () => {
    setLogoutModalOpen(true);
  };

  const confirmLogout = () => {
    setLogoutModalOpen(false);
    logout();
    router.replace("/login");
  };

  if (!authLoading && !isAuthenticated) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-20 h-20 rounded-full bg-brand/10 items-center justify-center mb-6 border border-brand/20">
            <FontAwesome6 name="user" size={36} color="#2D6A4F" />
          </View>
          <Text className="text-xl font-black text-ink mb-2">
            欢迎来到食光烙记
          </Text>
          <Text className="text-sm text-copy-muted text-center mb-8 leading-6 px-4">
            登录后精准记录三餐营养、追踪身体健康指标与食材保鲜。
          </Text>
          <TouchableOpacity
            className="bg-brand px-10 py-4 rounded-2xl w-full items-center shadow-md active:opacity-90"
            onPress={() => router.push("/login")}
          >
            <Text className="text-white text-base font-bold">登录 / 注册</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen backgroundColor="#FDF8F0">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#2D6A4F" />
          <Text className="text-xs text-copy-muted mt-2">载入个人档案中...</Text>
        </View>
      </Screen>
    );
  }

  const heightVal = healthProfile?.height ?? healthData?.height ?? null;
  const weightVal = healthProfile?.weight ?? healthData?.weight ?? null;
  const bodyFatVal = healthData?.body_fat ?? null;
  const calculatedBmi = weightVal != null && heightVal != null
    ? weightVal / Math.pow(heightVal / 100, 2)
    : null;
  const bmi = healthData?.bmi ?? calculatedBmi;

  const bmiStatus =
    bmi === null
      ? "未设置"
      : bmi < 18.5
      ? "偏瘦"
      : bmi < 24
      ? "正常"
      : bmi < 28
      ? "偏胖"
      : "肥胖";
  const bmiColor =
    bmi === null
      ? "#A3A398"
      : bmi < 18.5
      ? "#E9C46A"
      : bmi < 24
      ? "#2D6A4F"
      : bmi < 28
      ? "#E9C46A"
      : "#E07A5F";

  const todayRecords = recentRecords.filter((r) => r.recorded_at === today);
  const todayCalories = todayRecords.reduce((sum, r) => sum + (r.calories || 0), 0);
  const avgCalories =
    dietTrend.length > 0
      ? Math.round(
          dietTrend.reduce((sum, d) => sum + d.calories, 0) /
            (dietTrend.filter((d) => d.calories > 0).length || 1)
        )
      : 0;

  const miniTopOffset = Platform.OS === "web" ? 12 : Math.max(insets.top + 6, 12);
  const waterPercent = Math.min(Math.round(((waterMl ?? 0) / 2000) * 100), 100);
  const safetyProfileSaved = hasSafetyProfile(healthProfile);
  const safetyHighlights = [
    ...(healthProfile?.allergies || []).map((item) => ({
      key: `allergy-${item.name}`,
      label: `${item.name} · ${ALLERGY_LABELS[item.severity]}`,
      danger: item.severity === "severe",
    })),
    ...(healthProfile?.medical_conditions || []).map((item) => ({ key: `condition-${item}`, label: item, danger: true })),
    ...(healthProfile?.medications?.trim() ? [{ key: "medications", label: "用药已记录", danger: true }] : []),
    ...(healthProfile?.dietary_restrictions || []).map((item) => ({ key: `restriction-${item}`, label: item, danger: false })),
  ];
  const visibleSafetyHighlights = safetyHighlights.slice(0, 5);

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      {loadWarning ? (
        <TouchableOpacity
          onPress={() => void fetchData()}
          className="absolute left-4 right-4 top-4 z-[60] rounded-2xl border border-amber-200 bg-amber-50 p-3"
        >
          <Text className="text-xs font-bold text-amber-800">{loadWarning} · 点击重试</Text>
        </TouchableOpacity>
      ) : null}
      {/* 悬浮 Mini 胶囊顶栏 */}
      {isScrolled && (
        <View style={{ top: miniTopOffset }} className="absolute left-4 right-4 z-50">
          <View className="bg-white/95 px-4 py-2 rounded-full flex-row items-center justify-between shadow-lg border border-line backdrop-blur-md">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-full bg-brand/15 items-center justify-center border border-brand">
                <FontAwesome6 name="user" size={11} color="#2D6A4F" />
              </View>
              <Text className="text-sm font-black text-ink">
                {user?.username || "个人中心"}
              </Text>
                <View className="bg-highlight px-2 py-0.5 rounded-full">
                  <Text className="text-[10px] font-black text-ink">V{userLevel?.level ?? 1}</Text>
              </View>
            </View>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => router.push("/profile-edit")}
                className="w-7 h-7 rounded-full bg-background-secondary items-center justify-center"
              >
                <FontAwesome6 name="pen" size={10} color="#3D3229" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/settings")}
                className="w-7 h-7 rounded-full bg-background-secondary items-center justify-center"
              >
                <FontAwesome6 name="gear" size={11} color="#3D3229" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={(e) => {
          const offsetY = e.nativeEvent.contentOffset.y;
          if (offsetY > 70 && !isScrolled) setIsScrolled(true);
          else if (offsetY <= 70 && isScrolled) setIsScrolled(false);
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 144 }}
        className="bg-canvas"
      >
        {/* Emerald Header 顶栏 */}
        <View className="bg-brand px-5 pt-5 pb-11 rounded-b-[36px] shadow-sm relative overflow-hidden">
          <View className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/5" />
          <View className="absolute left-1/3 -bottom-8 w-32 h-32 rounded-full bg-highlight/10" />

          {/* User Info & Actions */}
          <View className="flex-row items-center justify-between mb-4">
            <TouchableOpacity
              onPress={() => user?.id && router.push("/user-profile", { userId: user.id })}
              className="flex-row items-center flex-1 mr-2 active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel="查看我的个人主页"
            >
              <Image
                source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                className="w-12 h-12 rounded-full border-2 border-highlight mr-3"
                style={{ width: 48, height: 48, borderRadius: 24 }}
              />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-white text-lg font-black" numberOfLines={1}>
                    {user?.username || "健康体验家"}
                  </Text>
                  <View className="bg-highlight px-2.5 py-0.5 rounded-full shadow-xs">
                    <Text className="text-[10px] font-black text-ink">V{userLevel?.level ?? 1} {userLevel?.title ?? "健康新芽"}</Text>
                  </View>
                </View>
                <Text className="text-emerald-100/90 text-xs mt-0.5" numberOfLines={1}>
                  {user?.bio || "追求自然原味与有氧健康生活的记录者。"}
                </Text>
              </View>
            </TouchableOpacity>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => router.push("/profile-edit")}
                className="w-9 h-9 rounded-full bg-white/15 border border-white/20 items-center justify-center backdrop-blur-md shadow-xs active:bg-white/30"
              >
                <FontAwesome6 name="pen" size={13} color="#FFF" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/settings")}
                className="w-9 h-9 rounded-full bg-white/15 border border-white/20 items-center justify-center backdrop-blur-md shadow-xs active:bg-white/30"
              >
                <FontAwesome6 name="gear" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>

          {userLevel ? (
            <View className="mt-1 rounded-xl bg-white/10 px-3 py-2 border border-white/10">
              <View className="flex-row items-center justify-between">
                <Text className="text-[10px] font-bold text-emerald-50">成长经验 {userLevel.xp} XP</Text>
                <Text className="text-[10px] text-emerald-100">{userLevel.nextXp ? `距离下一等级 ${userLevel.nextXp - userLevel.xp} XP` : "已达最高等级"}</Text>
              </View>
              <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/15"><View className="h-full rounded-full bg-highlight" style={{ width: `${userLevel.progress}%` }} /></View>
            </View>
          ) : null}

        </View>

        <View className="mx-5 -mt-6 mb-5 rounded-3xl border border-line bg-white p-4 shadow-md">
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xs font-black text-ink">我的饮食足迹</Text>
            <TouchableOpacity onPress={() => router.push("/diet-record")} className="flex-row items-center gap-1">
              <Text className="text-[11px] font-bold text-brand">查看记录</Text>
              <FontAwesome6 name="chevron-right" size={8} color="#2D6A4F" />
            </TouchableOpacity>
          </View>
          <View className="flex-row items-center justify-around rounded-2xl bg-[#F7FAF8] py-3">
            <TouchableOpacity
              onPress={() => router.push("/diet-record")}
              className="items-center active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="查看连续打卡记录"
            >
              <Text className="text-base font-black text-brand">{streakDays}</Text>
              <Text className="mt-0.5 text-[10px] text-copy-muted">连续打卡</Text>
            </TouchableOpacity>
            <View className="h-7 w-px bg-[#DDE8DF]" />
            <TouchableOpacity
              onPress={() => router.push("/diet-record")}
              className="items-center active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="查看饮食记录"
            >
              <Text className="text-base font-black text-brand">{dietRecordCount}</Text>
              <Text className="mt-0.5 text-[10px] text-copy-muted">记录餐数</Text>
            </TouchableOpacity>
            <View className="h-7 w-px bg-[#DDE8DF]" />
            <TouchableOpacity onPress={() => router.push("/favorites")} className="items-center">
              <Text className="text-base font-black text-brand">{favoriteCount}</Text>
              <Text className="mt-0.5 text-[10px] text-copy-muted">收藏菜谱</Text>
            </TouchableOpacity>
            <View className="h-7 w-px bg-[#DDE8DF]" />
            <TouchableOpacity
              onPress={() => router.push("/following")}
              className="items-center active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="查看关注好友"
            >
              <Text className="text-base font-black text-brand">{followingCount}</Text>
              <Text className="mt-0.5 text-[10px] text-copy-muted">关注好友</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 健康快照：安全、身体数据与饮水集中在一张卡中 */}
        <View className="mx-5 mb-5 bg-white rounded-3xl p-5 shadow-xs border border-line">
          <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                <FontAwesome6 name="heart-pulse" size={13} color="#2D6A4F" />
              </View>
              <View>
                <Text className="text-base font-black text-ink">今日健康快照</Text>
                <Text className="mt-0.5 text-[10px] text-copy-muted">健康资料与今日补水</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/health-profile")}
              className="flex-row items-center gap-1 rounded-full bg-brand px-3 py-1.5 active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel="管理健康档案"
            >
              <Text className="text-[11px] font-bold text-white">管理</Text>
              <FontAwesome6 name="chevron-right" size={9} color="white" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => router.push("/health-profile")}
            className={`mb-4 rounded-2xl border p-3.5 active:opacity-85 ${safetyProfileSaved ? "border-[#F1C8BC] bg-[#FFF6F2]" : "border-[#D8E5DC] bg-[#F5FAF6]"}`}
            accessibilityRole="button"
            accessibilityLabel={safetyProfileSaved ? "查看饮食安全信息" : "完善饮食安全信息"}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2.5">
                <View className={`h-8 w-8 items-center justify-center rounded-xl ${safetyProfileSaved ? "bg-[#FCE4DC]" : "bg-[#E1F0E5]"}`}>
                  <FontAwesome6 name="shield-halved" size={13} color={safetyProfileSaved ? "#B64D36" : "#2D6A4F"} />
                </View>
                <View>
                  <Text className={`text-xs font-black ${safetyProfileSaved ? "text-[#7D3020]" : "text-brand"}`}>
                    {safetyProfileSaved ? "饮食安全提醒" : "完善饮食安全信息"}
                  </Text>
                  <Text className="mt-0.5 text-[10px] text-copy-muted">
                    {safetyProfileSaved ? "推荐时将优先避开以下风险" : "补充过敏、疾病或用药信息"}
                  </Text>
                </View>
              </View>
              <FontAwesome6 name="chevron-right" size={11} color={safetyProfileSaved ? "#B64D36" : "#2D6A4F"} />
            </View>
            {safetyProfileSaved ? (
              <View className="mt-3 flex-row flex-wrap gap-1.5">
                {visibleSafetyHighlights.map((item) => (
                  <View key={item.key} className={`rounded-full px-2.5 py-1 ${item.danger ? "bg-[#FCE4DC]" : "bg-white"}`}>
                    <Text className={`text-[10px] font-bold ${item.danger ? "text-[#9B3D2B]" : "text-[#655B4F]"}`}>{item.label}</Text>
                  </View>
                ))}
                {safetyHighlights.length > visibleSafetyHighlights.length ? (
                  <View className="rounded-full bg-white px-2.5 py-1"><Text className="text-[10px] font-bold text-copy-muted">+{safetyHighlights.length - visibleSafetyHighlights.length} 项</Text></View>
                ) : null}
              </View>
            ) : null}
          </TouchableOpacity>

          <View className="mb-2 flex-row items-center justify-between px-1">
            <Text className="text-xs font-black text-[#6E6256]">身体数据</Text>
            <TouchableOpacity onPress={() => router.push("/health-data")} className="flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel="更新身体数据">
              <Text className="text-[11px] font-bold text-brand">更新</Text>
              <FontAwesome6 name="chevron-right" size={8} color="#2D6A4F" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push("/health-data")} className="flex-row justify-between bg-canvas p-3.5 rounded-2xl mb-3.5 border border-line/50 active:opacity-80">
            <HealthStat label="身高" value={heightVal == null ? "待完善" : `${heightVal}`} unit={heightVal == null ? "" : "cm"} color="#2D6A4F" />
            <HealthStat label="体重" value={weightVal == null ? "待完善" : `${weightVal}`} unit={weightVal == null ? "" : "kg"} color="#D4A276" />
            <HealthStat label="体脂率" value={bodyFatVal == null ? "待完善" : `${bodyFatVal}`} unit={bodyFatVal == null ? "" : "%"} color="#E07A5F" />
            <HealthStat
              label="BMI"
              value={bmi == null ? "待完善" : bmi.toFixed(1)}
              unit={bmi == null ? "" : bmiStatus}
              color={bmiColor}
            />
          </TouchableOpacity>

          {/* 动态水分监测栏 */}
          <View className="bg-[#F2F8F3] p-3.5 rounded-2xl flex-row items-center justify-between border border-[#D8E9DC]">
            <View className="flex-row items-center gap-3 flex-1">
              <View className="w-8 h-8 rounded-full bg-brand/10 items-center justify-center">
                <FontAwesome6 name="glass-water" size={15} color="#2D6A4F" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-xs font-bold text-[#315A42]">今天喝水了吗？</Text>
                  <Text className="text-xs font-black text-brand">
                    {waterMl == null ? "尚未记录" : `${waterMl} / 2000 ml`}
                  </Text>
                </View>
                <View className="w-full h-2 bg-[#D8E9DC] rounded-full overflow-hidden">
                  <View
                    className="h-full bg-brand rounded-full"
                    style={{ width: `${waterPercent}%` }}
                  />
                </View>
              </View>
            </View>

            <View className="flex-row items-center gap-1.5 ml-3">
              <TouchableOpacity
                onPress={() => handleAddWater(250)}
                className="bg-brand px-2.5 py-1.5 rounded-xl active:opacity-80 shadow-2xs"
              >
                <Text className="text-[11px] font-bold text-white">+250ml</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddWater(500)}
                className="bg-[#215E43] px-2.5 py-1.5 rounded-xl active:opacity-80 shadow-2xs"
              >
                <Text className="text-[11px] font-bold text-white">+500ml</Text>
              </TouchableOpacity>
            </View>
          </View>

        </View>

        {/* 7日热量趋势 Chart */}
        <View className="mx-5 mb-5 bg-white rounded-3xl p-5 shadow-xs border border-line">
          <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                <FontAwesome6 name="chart-line" size={13} color="#2D6A4F" />
              </View>
              <Text className="text-base font-black text-ink">近7日热量趋势</Text>
            </View>
            {avgCalories > 0 && (
              <View className="bg-brand/10 px-2.5 py-1 rounded-full">
                <Text className="text-[10px] font-bold text-brand">
                  日均摄入 {avgCalories} kcal
                </Text>
              </View>
            )}
          </View>

          {dietTrend.length > 0 && dietTrend.some((d) => d.calories > 0) ? (
            <View className="items-center overflow-hidden">
              {/* @ts-ignore */}
              <LineChart
                data={{
                  labels: dietTrend.map((item) => item.date.slice(5)),
                  datasets: [{ data: dietTrend.map((item) => item.calories || 0) }],
                }}
                width={Dimensions.get("window").width - 80}
                height={180}
                fromZero
                yAxisSuffix="k"
                chartConfig={{
                  backgroundColor: "#ffffff",
                  backgroundGradientFrom: "#FFFDF9",
                  backgroundGradientTo: "#FFFDF9",
                  color: (opacity = 1) => `rgba(45, 106, 79, ${opacity})`,
                  labelColor: (opacity = 1) => `rgba(139, 125, 107, ${opacity})`,
                  propsForDots: {
                    r: "4",
                    strokeWidth: "2",
                    stroke: "#2D6A4F",
                  },
                }}
                bezier
                style={{ borderRadius: 16, marginVertical: 4 }}
              />
            </View>
          ) : (
            <View className="py-8 items-center justify-center bg-canvas/50 rounded-2xl border border-dashed border-line">
              <View className="w-12 h-12 rounded-full bg-[#D4A276]/15 items-center justify-center mb-2">
                <FontAwesome6 name="chart-line" size={20} color="#D4A276" />
              </View>
              <Text className="text-xs font-bold text-copy-muted">暂无 7 日饮食热量数据</Text>
              <TouchableOpacity
                onPress={() => router.push("/diet-record")}
                className="mt-3 bg-brand px-4 py-1.5 rounded-full active:opacity-90 shadow-2xs"
              >
                <Text className="text-xs font-bold text-white">+ 记录今日饮食</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 2x2 核心功能矩阵 */}
        <View className="mx-5 mb-5">
          <Text className="text-base font-black text-ink mb-3">快捷核心服务</Text>
          <View className="flex-row flex-wrap justify-between gap-y-3">
            <QuickActionTile
              icon="utensils"
              label="饮食日志"
              desc="卡路里与三餐打卡"
              color="#2D6A4F"
              onPress={() => router.push("/diet-record")}
            />
            <QuickActionTile
              icon="heart-pulse"
              label="健康数据"
              desc="体重体脂趋势分析"
              color="#E07A5F"
              onPress={() => router.push("/health-data")}
            />
            <QuickActionTile
              icon="basket-shopping"
              label="食材管理"
              desc="保鲜库与临期预警"
              color="#D4A276"
              onPress={() => router.push("/inventory")}
            />
            <QuickActionTile
              icon="heart"
              label="收藏菜谱"
              desc={`${favoriteCount} 道灵感待尝试`}
              color="#E07A5F"
              onPress={() => router.push("/favorites")}
            />
          </View>
        </View>

        {/* 今日饮食小记 */}
        <View className="mx-5 mb-5">
          <View className="bg-white rounded-3xl p-5 border border-line shadow-xs">
            <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="receipt" size={13} color="#2D6A4F" />
                </View>
                <Text className="text-base font-black text-ink">今日饮食小记</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/diet-record")}>
                <Text className="text-xs font-bold text-brand">查看全部 →</Text>
              </TouchableOpacity>
            </View>

            {todayRecords.length === 0 ? (
              <View className="bg-canvas p-4 rounded-2xl items-center border border-dashed border-line">
                <Text className="text-xs text-copy-muted font-medium">
                  今天还没有打卡食物哦
                </Text>
                <TouchableOpacity
                  onPress={() => router.push("/diet-record")}
                  className="mt-2.5 bg-brand px-4 py-1.5 rounded-full active:opacity-90"
                >
                  <Text className="text-xs font-bold text-white">+ 去记录一餐</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="space-y-2">
                <View className="flex-row items-center justify-between mb-2 px-1">
                  <Text className="text-xs font-bold text-copy-muted">今日已累计摄入</Text>
                  <Text className="text-sm font-black text-brand">
                    {todayCalories} kcal
                  </Text>
                </View>
                {todayRecords.slice(0, 3).map((record) => (
                  <View
                    key={record.id}
                    className="flex-row items-center justify-between bg-[#FFFDF9] p-3 rounded-2xl border border-[#F4EBE0]"
                  >
                    <View className="flex-row items-center gap-2.5 flex-1">
                      <View className="w-8 h-8 rounded-xl bg-brand/10 items-center justify-center">
                        <FontAwesome6 name="utensils" size={12} color="#2D6A4F" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs font-bold text-ink" numberOfLines={1}>
                          {record.food_name}
                        </Text>
                        <Text className="text-[10px] text-copy-muted">
                          {record.meal_type} · {record.amount}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs font-black text-[#E07A5F]">
                      {record.calories || 0} kcal
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 更多服务列表 */}
        <View className="mx-5 mb-5">
          <Text className="text-base font-black text-ink mb-3">更多服务与设置</Text>
          <View className="bg-white rounded-3xl p-2 border border-line shadow-xs">
            <ServiceRow
              icon="book-bookmark"
              title="我的收藏菜谱"
              subtitle="灵感菜谱与配餐收藏"
              color="#E9C46A"
              onPress={() => router.push("/favorites")}
            />
            <ServiceRow
              icon="heart-pulse"
              title="健康数据记录"
              subtitle="查看并维护已保存的健康记录"
              color="#2D6A4F"
              onPress={() => router.push("/health-data")}
            />
            <ServiceRow
              icon="gear"
              title="系统与隐私设置"
              subtitle="个人资料修改、主题与版本"
              color="#8B7D6B"
              onPress={() => router.push("/settings")}
            />
          </View>
        </View>

        {/* 退出登录按钮 */}
        <View className="mx-5 mb-8">
          <TouchableOpacity
            onPress={handleLogout}
            className="bg-white rounded-2xl py-3.5 items-center border border-[#E07A5F]/30 active:bg-red-50"
          >
            <Text className="text-[#E07A5F] text-sm font-bold">退出登录</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 退出登录确认 Modal */}
      <Modal visible={logoutModalOpen} animationType="fade" transparent>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-[28px] p-6 w-full max-w-sm items-center shadow-lg">
            <View className="w-14 h-14 rounded-full bg-red-100 items-center justify-center mb-3">
              <FontAwesome6 name="arrow-right-from-bracket" size={22} color="#E76F51" />
            </View>
            <Text className="text-lg font-black text-ink">确认退出登录</Text>
            <Text className="text-xs text-copy-muted text-center mt-1 mb-6 leading-5">
              退出后需要重新登录才能继续管理您的食材与饮食记录。确定要退出吗？
            </Text>

            <View className="flex-row gap-3 w-full">
              <TouchableOpacity
                onPress={() => setLogoutModalOpen(false)}
                className="flex-1 bg-background-secondary py-3 rounded-2xl items-center"
              >
                <Text className="text-xs font-bold text-copy-muted">取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmLogout}
                className="flex-1 bg-critical py-3 rounded-2xl items-center shadow-xs active:opacity-90"
              >
                <Text className="text-xs font-bold text-white">确认退出</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function HealthStat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <View className="items-center flex-1">
      <Text className="text-xs text-copy-muted mb-1 font-medium">{label}</Text>
      <Text className="text-xl font-black" style={{ color }}>
        {value}
      </Text>
      <Text className="text-[10px] text-[#B0A495] mt-0.5">{unit}</Text>
    </View>
  );
}

function QuickActionTile({
  icon,
  label,
  desc,
  color,
  onPress,
}: {
  icon: string;
  label: string;
  desc: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white rounded-3xl p-4 border border-line shadow-xs active:scale-95 transition-transform"
      style={{ width: "48%" }}
    >
      <View
        className="w-10 h-10 rounded-2xl items-center justify-center mb-3"
        style={{ backgroundColor: `${color}15` }}
      >
        <FontAwesome6 name={icon as any} size={18} color={color} />
      </View>
      <Text className="text-sm font-black text-ink">{label}</Text>
      <Text className="text-[10px] text-copy-muted mt-0.5" numberOfLines={1}>
        {desc}
      </Text>
    </TouchableOpacity>
  );
}

function ServiceRow({
  icon,
  title,
  subtitle,
  color,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center justify-between p-3.5 rounded-2xl active:bg-canvas"
    >
      <View className="flex-row items-center gap-3 flex-1">
        <View
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <FontAwesome6 name={icon as any} size={14} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-xs font-bold text-ink">{title}</Text>
          <Text className="text-[10px] text-copy-muted mt-0.5">{subtitle}</Text>
        </View>
      </View>
      <FontAwesome6 name="chevron-right" size={11} color="#B0A495" />
    </TouchableOpacity>
  );
}
