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
          <View className="flex-row items-center justify-between rounded-full border border-line bg-white/95 px-3 py-2 shadow-lg backdrop-blur-md">
            <View className="flex-row items-center gap-2">
              <Image
                source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                className="h-7 w-7 rounded-full"
                style={{ width: 28, height: 28, borderRadius: 14 }}
              />
              <Text className="text-sm font-black text-ink">{user?.username || "个人中心"}</Text>
              <View className="rounded-full bg-brand/10 px-2 py-0.5">
                <Text className="text-[10px] font-black text-brand">V{userLevel?.level ?? 1}</Text>
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
        {/* 个人概览：身份、成长和饮食足迹合并在同一卡片中。 */}
        <View className="px-5 pb-4 pt-3">
          <View className="rounded-[28px] border border-line bg-white px-4 pb-4 pt-4 shadow-xs">
            <View className="flex-row items-center justify-between">
            <TouchableOpacity
              onPress={() => user?.id && router.push("/user-profile", { userId: user.id })}
              className="flex-row items-center flex-1 mr-2 active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel="查看我的个人主页"
            >
              <Image
                source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                className="mr-3 rounded-full border-2 border-brand/15"
                style={{ width: 52, height: 52, borderRadius: 26 }}
              />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="shrink text-lg font-black text-ink" numberOfLines={1}>
                    {user?.username || "健康体验家"}
                  </Text>
                  <View className="rounded-full bg-brand/10 px-2.5 py-0.5">
                    <Text className="text-[10px] font-black text-brand">V{userLevel?.level ?? 1} · {userLevel?.title ?? "健康新芽"}</Text>
                  </View>
                </View>
                <Text className="mt-1 text-[11px] text-copy-muted" numberOfLines={1}>
                  {user?.bio?.trim() || "记录饮食，也记录身体的每一点变化"}
                </Text>
              </View>
            </TouchableOpacity>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => router.push("/profile-edit")}
                className="h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas active:bg-brand/10"
                accessibilityLabel="编辑个人资料"
              >
                <FontAwesome6 name="pen" size={12} color="#2D6A4F" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/settings")}
                className="h-9 w-9 items-center justify-center rounded-full border border-line bg-canvas active:bg-brand/10"
                accessibilityLabel="打开设置"
              >
                <FontAwesome6 name="gear" size={13} color="#2D6A4F" />
              </TouchableOpacity>
            </View>
            </View>

            {userLevel ? (
              <View className="mt-4 border-t border-[#F1EDE6] pt-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[10px] font-bold text-copy-muted">成长经验 <Text className="text-brand">{userLevel.xp} XP</Text></Text>
                  <Text className="text-[10px] text-copy-muted">{userLevel.nextXp ? `再获得 ${userLevel.nextXp - userLevel.xp} XP 升级` : "已达最高等级"}</Text>
                </View>
                <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand/10">
                  <View className="h-full rounded-full bg-brand" style={{ width: `${userLevel.progress}%` }} />
                </View>
              </View>
            ) : null}

            <View className="mt-4 border-t border-[#F1EDE6] pt-3">
              <View className="mb-2.5 flex-row items-center justify-between">
                <Text className="text-xs font-black text-ink">我的饮食足迹</Text>
                <TouchableOpacity onPress={() => router.push("/diet-record")} className="flex-row items-center gap-1">
                  <Text className="text-[11px] font-bold text-brand">查看记录</Text>
                  <FontAwesome6 name="chevron-right" size={8} color="#2D6A4F" />
                </TouchableOpacity>
              </View>
              <View className="flex-row items-center justify-around">
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
          </View>
        </View>

        {/* 健康总览：保留完整数据，但用分区代替多层嵌套卡片。 */}
        <View className="mx-5 mb-4 rounded-[28px] border border-line bg-white p-4 shadow-xs">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-9 w-9 items-center justify-center rounded-2xl bg-brand/10">
                <FontAwesome6 name="heart-pulse" size={14} color="#2D6A4F" />
              </View>
              <View>
                <Text className="text-base font-black text-ink">健康总览</Text>
                <Text className="mt-0.5 text-[10px] text-copy-muted">身体数据、饮食安全与今日补水</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/health-profile")}
              className="flex-row items-center gap-1 rounded-full bg-brand/10 px-3 py-1.5 active:opacity-80"
              accessibilityRole="button"
              accessibilityLabel="管理健康档案"
            >
              <Text className="text-[11px] font-bold text-brand">管理档案</Text>
              <FontAwesome6 name="chevron-right" size={8} color="#2D6A4F" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => router.push("/health-profile")}
            className="mt-4 border-y border-[#F1EDE6] py-3 active:opacity-85"
            accessibilityRole="button"
            accessibilityLabel={safetyProfileSaved ? "查看饮食安全信息" : "完善饮食安全信息"}
          >
            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2.5">
                <View className={`h-8 w-8 items-center justify-center rounded-xl ${safetyProfileSaved ? "bg-[#FCE4DC]" : "bg-brand/10"}`}>
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
              <View className="mt-2.5 flex-row flex-wrap gap-1.5 pl-10">
                {visibleSafetyHighlights.map((item) => (
                  <View key={item.key} className={`rounded-full px-2.5 py-1 ${item.danger ? "bg-[#FCE4DC]" : "bg-canvas"}`}>
                    <Text className={`text-[10px] font-bold ${item.danger ? "text-[#9B3D2B]" : "text-[#655B4F]"}`}>{item.label}</Text>
                  </View>
                ))}
                {safetyHighlights.length > visibleSafetyHighlights.length ? (
                  <View className="rounded-full bg-canvas px-2.5 py-1"><Text className="text-[10px] font-bold text-copy-muted">+{safetyHighlights.length - visibleSafetyHighlights.length} 项</Text></View>
                ) : null}
              </View>
            ) : null}
          </TouchableOpacity>

          <View className="mt-4 flex-row items-center justify-between px-0.5">
            <Text className="text-xs font-black text-[#6E6256]">身体数据</Text>
            <TouchableOpacity onPress={() => router.push("/health-data")} className="flex-row items-center gap-1" accessibilityRole="button" accessibilityLabel="更新身体数据">
              <Text className="text-[11px] font-bold text-brand">更新</Text>
              <FontAwesome6 name="chevron-right" size={8} color="#2D6A4F" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => router.push("/health-data")} className="mt-2.5 flex-row flex-wrap overflow-hidden rounded-2xl border border-line/70 bg-canvas active:opacity-80">
            <HealthStat className="border-b border-r border-line/70" label="身高" value={heightVal == null ? "待完善" : `${heightVal}`} unit={heightVal == null ? "" : "cm"} color={heightVal == null ? "#8B7D6B" : "#3D3229"} />
            <HealthStat className="border-b border-line/70" label="体重" value={weightVal == null ? "待完善" : `${weightVal}`} unit={weightVal == null ? "" : "kg"} color={weightVal == null ? "#8B7D6B" : "#3D3229"} />
            <HealthStat className="border-r border-line/70" label="体脂率" value={bodyFatVal == null ? "待完善" : `${bodyFatVal}`} unit={bodyFatVal == null ? "" : "%"} color={bodyFatVal == null ? "#8B7D6B" : "#3D3229"} />
            <HealthStat
              className=""
              label="BMI"
              value={bmi == null ? "待完善" : bmi.toFixed(1)}
              unit={bmi == null ? "" : bmiStatus}
              color={bmi == null ? "#8B7D6B" : bmiColor}
            />
          </TouchableOpacity>

          {/* 动态水分监测栏 */}
          <View className="mt-3.5 rounded-2xl bg-[#F2F8F3] p-3.5">
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center rounded-2xl bg-white">
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
            <View className="mt-3 flex-row items-center gap-2 pl-12">
              <TouchableOpacity
                onPress={() => handleAddWater(250)}
                className="flex-1 items-center rounded-xl border border-brand/20 bg-white py-2 active:opacity-80"
              >
                <Text className="text-[11px] font-bold text-brand">记录 +250ml</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddWater(500)}
                className="flex-1 items-center rounded-xl bg-brand py-2 active:opacity-80"
              >
                <Text className="text-[11px] font-bold text-white">+500ml</Text>
              </TouchableOpacity>
            </View>
          </View>

        </View>

        {/* 7日热量趋势 Chart */}
        <View className="mx-5 mb-4 rounded-[28px] border border-line bg-white p-4 shadow-xs">
          <View className="mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <View className="h-8 w-8 items-center justify-center rounded-xl bg-brand/10">
                <FontAwesome6 name="chart-line" size={13} color="#2D6A4F" />
              </View>
              <View>
                <Text className="text-sm font-black text-ink">近 7 日热量趋势</Text>
                <Text className="mt-0.5 text-[10px] text-copy-muted">观察摄入变化，不追求单日完美</Text>
              </View>
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
            <View className="flex-row items-center rounded-2xl bg-canvas/60 px-3.5 py-4">
              <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand/10">
                <FontAwesome6 name="chart-line" size={15} color="#2D6A4F" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-xs font-black text-ink">还没有形成趋势</Text>
                <Text className="mt-1 text-[10px] text-copy-muted">记录第一餐后开始生成热量曲线</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push("/diet-record")}
                className="rounded-full bg-brand px-3 py-2 active:opacity-90"
              >
                <Text className="text-[11px] font-bold text-white">记录一餐</Text>
              </TouchableOpacity>
            </View>
          )}
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
              icon="list-check"
              title="烹饪队列"
              subtitle="统一安排待做菜谱与开始顺序"
              color="#2D6A4F"
              onPress={() => router.push("/cooking-queue")}
            />
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
              icon="comment-dots"
              title="帮助与反馈"
              subtitle="问题反馈、功能建议与客服支持"
              color="#2D6A4F"
              onPress={() => router.push("/feedback")}
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
  className,
  label,
  value,
  unit,
  color,
}: {
  className: string;
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  return (
    <View className={`w-1/2 px-3 py-3 ${className}`}>
      <Text className="text-[10px] font-medium text-copy-muted">{label}</Text>
      <Text className="mt-1 text-lg font-black" style={{ color }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="mt-0.5 text-[10px] text-[#B0A495]">{unit || "尚未记录"}</Text>
    </View>
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
