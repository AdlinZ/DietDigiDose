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
import { FontAwesome6 } from "@expo/vector-icons";
import { getAvatarSource } from "@/utils/defaultAvatar";
import { LineChart } from "react-native-chart-kit";

const API_BASE = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

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

export default function ProfileScreen() {
  const router = useSafeRouter();
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const authFetch = useAuthFetch();

  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [recentRecords, setRecentRecords] = useState<DietRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dietTrend, setDietTrend] = useState<{ date: string; calories: number }[]>([]);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [waterMl, setWaterMl] = useState(1450);
  const [favoriteCount, setFavoriteCount] = useState(0);

  const today = new Date().toISOString().split("T")[0];

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
    try {
      setLoading(true);
      const [healthRes, dietRes, favoriteRes] = await Promise.all([
        authFetch(`${API_BASE}/api/v1/health-data/latest`),
        authFetch(`${API_BASE}/api/v1/diet-records`),
        authFetch(`${API_BASE}/api/v1/recipes/favorites/count`),
      ]);
      const healthJson = await healthRes.json();
      const dietJson = await dietRes.json();
      const favoriteJson = await favoriteRes.json();
      setFavoriteCount(favoriteRes.ok ? Number(favoriteJson?.count || 0) : 0);

      const latestHealth = Array.isArray(healthJson) ? healthJson[0] : healthJson;
      setHealthData(latestHealth);
      if (latestHealth?.water_ml) {
        setWaterMl(latestHealth.water_ml);
      }

      const dietList = Array.isArray(dietJson) ? dietJson : [];
      setRecentRecords(dietList.slice(0, 5));

      // Compute diet trend for last 7 days
      const last7Days: { date: string; calories: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const dayRecords = dietList.filter((r: DietRecord) => r.recorded_at === dateStr);
        const totalCalories = dayRecords.reduce(
          (sum: number, r: DietRecord) => sum + (r.calories || 0),
          0
        );
        last7Days.push({ date: dateStr, calories: totalCalories });
      }
      setDietTrend(last7Days);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, authFetch]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const handleAddWater = async (addAmount: number) => {
    const newWater = waterMl + addAmount;
    setWaterMl(newWater);

    if (!isAuthenticated) return;
    try {
      await authFetch(`${API_BASE}/api/v1/health-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recorded_date: today,
          water_ml: newWater,
          height: healthData?.height || 175,
          weight: healthData?.weight || 62.5,
          body_fat: healthData?.body_fat || 18.5,
        }),
      });
    } catch (e) {
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
          <View className="w-20 h-20 rounded-full bg-[#2D6A4F]/10 items-center justify-center mb-6 border border-[#2D6A4F]/20">
            <FontAwesome6 name="user" size={36} color="#2D6A4F" />
          </View>
          <Text className="text-xl font-black text-[#3D3229] mb-2">
            欢迎来到食光烙记
          </Text>
          <Text className="text-sm text-[#8B7D6B] text-center mb-8 leading-6 px-4">
            登录后精准记录三餐营养、追踪身体健康指标与食材保鲜。
          </Text>
          <TouchableOpacity
            className="bg-[#2D6A4F] px-10 py-4 rounded-2xl w-full items-center shadow-md active:opacity-90"
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
          <Text className="text-xs text-[#8B7D6B] mt-2">载入个人档案中...</Text>
        </View>
      </Screen>
    );
  }

  const heightVal = healthData?.height || 175;
  const weightVal = healthData?.weight || 62.5;
  const bodyFatVal = healthData?.body_fat || 18.5;
  const calculatedBmi = weightVal ? weightVal / Math.pow(heightVal / 100, 2) : null;
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
  const waterPercent = Math.min(Math.round((waterMl / 2000) * 100), 100);

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      {/* 悬浮 Mini 胶囊顶栏 */}
      {isScrolled && (
        <View style={{ top: miniTopOffset }} className="absolute left-4 right-4 z-50">
          <View className="bg-white/95 px-4 py-2 rounded-full flex-row items-center justify-between shadow-lg border border-[#EBE3D5] backdrop-blur-md">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-full bg-[#2D6A4F]/15 items-center justify-center border border-[#2D6A4F]">
                <FontAwesome6 name="user" size={11} color="#2D6A4F" />
              </View>
              <Text className="text-sm font-black text-[#3D3229]">
                {user?.username || "个人中心"}
              </Text>
              <View className="bg-[#E9C46A] px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-black text-[#3D3229]">V3 达人</Text>
              </View>
            </View>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => router.push("/profile-edit")}
                className="w-7 h-7 rounded-full bg-[#F5EFE6] items-center justify-center"
              >
                <FontAwesome6 name="pen" size={10} color="#3D3229" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push("/settings")}
                className="w-7 h-7 rounded-full bg-[#F5EFE6] items-center justify-center"
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
        contentContainerStyle={{ paddingBottom: 120 }}
        className="bg-[#FDF8F0]"
      >
        {/* Emerald Header 顶栏 */}
        <View className="bg-[#2D6A4F] px-5 pt-5 pb-9 rounded-b-[36px] shadow-sm relative overflow-hidden">
          <View className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-white/5" />
          <View className="absolute left-1/3 -bottom-8 w-32 h-32 rounded-full bg-[#E9C46A]/10" />

          {/* User Info & Actions */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1 mr-2">
              <Image
                source={getAvatarSource(user?.avatar_url, user?.id ?? user?.username)}
                className="w-12 h-12 rounded-full border-2 border-[#E9C46A] mr-3"
              />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-white text-lg font-black" numberOfLines={1}>
                    {user?.username || "健康体验家"}
                  </Text>
                  <View className="bg-[#E9C46A] px-2.5 py-0.5 rounded-full shadow-xs">
                    <Text className="text-[10px] font-black text-[#3D3229]">V3 达人</Text>
                  </View>
                </View>
                <Text className="text-emerald-100/90 text-xs mt-0.5" numberOfLines={1}>
                  {user?.bio || "追求自然原味与有氧健康生活的记录者。"}
                </Text>
              </View>
            </View>

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

          {/* Achievement Statistics */}
          <View className="flex-row items-center justify-around bg-black/15 rounded-2xl py-2.5 px-2 border border-white/10">
            <TouchableOpacity className="items-center">
              <Text className="text-white text-base font-black">14</Text>
              <Text className="text-emerald-100 text-[10px] mt-0.5">连续打卡(天)</Text>
            </TouchableOpacity>
            <View className="w-[1px] h-4 bg-white/20" />
            <TouchableOpacity className="items-center">
              <Text className="text-white text-base font-black">42</Text>
              <Text className="text-emerald-100 text-[10px] mt-0.5">记录餐数</Text>
            </TouchableOpacity>
            <View className="w-[1px] h-4 bg-white/20" />
            <TouchableOpacity onPress={() => router.push("/favorites")} className="items-center">
              <Text className="text-white text-base font-black">{favoriteCount}</Text>
              <Text className="text-emerald-100 text-[10px] mt-0.5">收藏菜谱</Text>
            </TouchableOpacity>
            <View className="w-[1px] h-4 bg-white/20" />
            <TouchableOpacity className="items-center">
              <Text className="text-white text-base font-black">8</Text>
              <Text className="text-emerald-100 text-[10px] mt-0.5">关注好友</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 身体健康概览 Card */}
        <View className="mx-5 -mt-6 mb-5 bg-white rounded-3xl p-5 shadow-md border border-[#EBE3D5]">
          <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-lg bg-[#2D6A4F]/10 items-center justify-center">
                <FontAwesome6 name="heart-pulse" size={13} color="#2D6A4F" />
              </View>
              <Text className="text-base font-black text-[#3D3229]">身体健康概览</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/health-data")}
              className="flex-row items-center gap-1 bg-[#2D6A4F]/10 px-2.5 py-1 rounded-full active:opacity-80"
            >
              <Text className="text-xs font-bold text-[#2D6A4F]">更新数据</Text>
              <FontAwesome6 name="chevron-right" size={10} color="#2D6A4F" />
            </TouchableOpacity>
          </View>

          {/* 4维健康指标 */}
          <View className="flex-row justify-between bg-[#FDF8F0] p-3.5 rounded-2xl mb-3.5 border border-[#EBE3D5]/50">
            <HealthStat label="身高" value={`${heightVal}`} unit="cm" color="#2D6A4F" />
            <HealthStat label="体重" value={`${weightVal}`} unit="kg" color="#D4A276" />
            <HealthStat label="体脂率" value={`${bodyFatVal}`} unit="%" color="#E07A5F" />
            <HealthStat
              label="BMI"
              value={bmi ? bmi.toFixed(1) : "--"}
              unit={bmiStatus}
              color={bmiColor}
            />
          </View>

          {/* 动态水分监测栏 */}
          <View className="bg-blue-50/70 p-3.5 rounded-2xl flex-row items-center justify-between border border-blue-100">
            <View className="flex-row items-center gap-3 flex-1">
              <View className="w-8 h-8 rounded-full bg-blue-500/10 items-center justify-center">
                <FontAwesome6 name="glass-water" size={15} color="#3B82F6" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center justify-between mb-1.5">
                  <Text className="text-xs font-bold text-[#1E3A8A]">今日饮水目标</Text>
                  <Text className="text-xs font-black text-[#3B82F6]">
                    {waterMl} / 2000 ml
                  </Text>
                </View>
                <View className="w-full h-2 bg-blue-200/60 rounded-full overflow-hidden">
                  <View
                    className="h-full bg-[#3B82F6] rounded-full"
                    style={{ width: `${waterPercent}%` }}
                  />
                </View>
              </View>
            </View>

            <View className="flex-row items-center gap-1.5 ml-3">
              <TouchableOpacity
                onPress={() => handleAddWater(250)}
                className="bg-[#3B82F6] px-2.5 py-1.5 rounded-xl active:opacity-80 shadow-2xs"
              >
                <Text className="text-[11px] font-bold text-white">+250ml</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddWater(500)}
                className="bg-blue-600 px-2.5 py-1.5 rounded-xl active:opacity-80 shadow-2xs"
              >
                <Text className="text-[11px] font-bold text-white">+500ml</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 7日热量趋势 Chart */}
        <View className="mx-5 mb-5 bg-white rounded-3xl p-5 shadow-xs border border-[#EBE3D5]">
          <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
            <View className="flex-row items-center gap-2">
              <View className="w-7 h-7 rounded-lg bg-[#2D6A4F]/10 items-center justify-center">
                <FontAwesome6 name="chart-line" size={13} color="#2D6A4F" />
              </View>
              <Text className="text-base font-black text-[#3D3229]">近7日热量趋势</Text>
            </View>
            {avgCalories > 0 && (
              <View className="bg-[#2D6A4F]/10 px-2.5 py-1 rounded-full">
                <Text className="text-[10px] font-bold text-[#2D6A4F]">
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
            <View className="py-8 items-center justify-center bg-[#FDF8F0]/50 rounded-2xl border border-dashed border-[#EBE3D5]">
              <View className="w-12 h-12 rounded-full bg-[#D4A276]/15 items-center justify-center mb-2">
                <FontAwesome6 name="chart-line" size={20} color="#D4A276" />
              </View>
              <Text className="text-xs font-bold text-[#8B7D6B]">暂无 7 日饮食热量数据</Text>
              <TouchableOpacity
                onPress={() => router.push("/diet-record")}
                className="mt-3 bg-[#2D6A4F] px-4 py-1.5 rounded-full active:opacity-90 shadow-2xs"
              >
                <Text className="text-xs font-bold text-white">+ 记录今日饮食</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* 2x2 核心功能矩阵 */}
        <View className="mx-5 mb-5">
          <Text className="text-base font-black text-[#3D3229] mb-3">快捷核心服务</Text>
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
              icon="id-card"
              label="健康档案"
              desc="基础代谢与目标"
              color="#3B82F6"
              onPress={() => router.push("/health-profile")}
            />
          </View>
        </View>

        {/* 今日饮食小记 */}
        <View className="mx-5 mb-5">
          <View className="bg-white rounded-3xl p-5 border border-[#EBE3D5] shadow-xs">
            <View className="flex-row items-center justify-between mb-3.5 pb-2.5 border-b border-[#F4EFE6]">
              <View className="flex-row items-center gap-2">
                <View className="w-7 h-7 rounded-lg bg-[#2D6A4F]/10 items-center justify-center">
                  <FontAwesome6 name="receipt" size={13} color="#2D6A4F" />
                </View>
                <Text className="text-base font-black text-[#3D3229]">今日饮食小记</Text>
              </View>
              <TouchableOpacity onPress={() => router.push("/diet-record")}>
                <Text className="text-xs font-bold text-[#2D6A4F]">查看全部 →</Text>
              </TouchableOpacity>
            </View>

            {todayRecords.length === 0 ? (
              <View className="bg-[#FDF8F0] p-4 rounded-2xl items-center border border-dashed border-[#EBE3D5]">
                <Text className="text-xs text-[#8B7D6B] font-medium">
                  今天还没有打卡食物哦
                </Text>
                <TouchableOpacity
                  onPress={() => router.push("/diet-record")}
                  className="mt-2.5 bg-[#2D6A4F] px-4 py-1.5 rounded-full active:opacity-90"
                >
                  <Text className="text-xs font-bold text-white">+ 去记录一餐</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="space-y-2">
                <View className="flex-row items-center justify-between mb-2 px-1">
                  <Text className="text-xs font-bold text-[#8B7D6B]">今日已累计摄入</Text>
                  <Text className="text-sm font-black text-[#2D6A4F]">
                    {todayCalories} kcal
                  </Text>
                </View>
                {todayRecords.slice(0, 3).map((record) => (
                  <View
                    key={record.id}
                    className="flex-row items-center justify-between bg-[#FFFDF9] p-3 rounded-2xl border border-[#F4EBE0]"
                  >
                    <View className="flex-row items-center gap-2.5 flex-1">
                      <View className="w-8 h-8 rounded-xl bg-[#2D6A4F]/10 items-center justify-center">
                        <FontAwesome6 name="utensils" size={12} color="#2D6A4F" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-xs font-bold text-[#3D3229]" numberOfLines={1}>
                          {record.food_name}
                        </Text>
                        <Text className="text-[10px] text-[#8B7D6B]">
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
          <Text className="text-base font-black text-[#3D3229] mb-3">更多服务与设置</Text>
          <View className="bg-white rounded-3xl p-2 border border-[#EBE3D5] shadow-xs">
            <ServiceRow
              icon="book-bookmark"
              title="我的收藏菜谱"
              subtitle="灵感菜谱与配餐收藏"
              color="#E9C46A"
              onPress={() => router.push("/favorites")}
            />
            <ServiceRow
              icon="rotate"
              title="数据同步与连接"
              subtitle="与健康数据实时同步"
              color="#2D6A4F"
              onPress={() => Alert.alert("提示", "同步服务正常运行")}
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
            <Text className="text-lg font-black text-[#3D3229]">确认退出登录</Text>
            <Text className="text-xs text-[#8B7D6B] text-center mt-1 mb-6 leading-5">
              退出后需要重新登录才能继续管理您的食材与饮食记录。确定要退出吗？
            </Text>

            <View className="flex-row gap-3 w-full">
              <TouchableOpacity
                onPress={() => setLogoutModalOpen(false)}
                className="flex-1 bg-[#F5EFE6] py-3 rounded-2xl items-center"
              >
                <Text className="text-xs font-bold text-[#8B7D6B]">取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmLogout}
                className="flex-1 bg-[#E76F51] py-3 rounded-2xl items-center shadow-xs active:opacity-90"
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
      <Text className="text-xs text-[#8B7D6B] mb-1 font-medium">{label}</Text>
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
      className="bg-white rounded-3xl p-4 border border-[#EBE3D5] shadow-xs active:scale-95 transition-transform"
      style={{ width: "48%" }}
    >
      <View
        className="w-10 h-10 rounded-2xl items-center justify-center mb-3"
        style={{ backgroundColor: `${color}15` }}
      >
        <FontAwesome6 name={icon as any} size={18} color={color} />
      </View>
      <Text className="text-sm font-black text-[#3D3229]">{label}</Text>
      <Text className="text-[10px] text-[#8B7D6B] mt-0.5" numberOfLines={1}>
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
      className="flex-row items-center justify-between p-3.5 rounded-2xl active:bg-[#FDF8F0]"
    >
      <View className="flex-row items-center gap-3 flex-1">
        <View
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${color}15` }}
        >
          <FontAwesome6 name={icon as any} size={14} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-xs font-bold text-[#3D3229]">{title}</Text>
          <Text className="text-[10px] text-[#8B7D6B] mt-0.5">{subtitle}</Text>
        </View>
      </View>
      <FontAwesome6 name="chevron-right" size={11} color="#B0A495" />
    </TouchableOpacity>
  );
}
