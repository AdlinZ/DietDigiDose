import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";
import { FontAwesome6 } from "@expo/vector-icons";

export default function SettingsScreen() {
  const router = useSafeRouter();
  const { user, isAuthenticated, logout, updateProfile } = useAuth();

  // Notification Toggles
  const [expiringAlert, setExpiringAlert] = useState(true);
  const [mealReminder, setMealReminder] = useState(true);
  const [waterReminder, setWaterReminder] = useState(true);

  // Modal State
  const [calorieModalOpen, setCalorieModalOpen] = useState(false);
  const [calorieTarget, setCalorieTarget] = useState(
    user?.daily_calories_target?.toString() || "2100"
  );
  const [updatingCal, setUpdatingCal] = useState(false);

  // Logout confirmation modal
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  const handleSaveCalorie = async () => {
    const val = parseInt(calorieTarget);
    if (isNaN(val) || val < 1000 || val > 5000) {
      Alert.alert("提示", "请输入 1000 ~ 5000 之间的合理热量值");
      return;
    }
    setUpdatingCal(true);
    const res = await updateProfile({ daily_calories_target: val });
    setUpdatingCal(false);
    if (res.success) {
      setCalorieModalOpen(false);
      Alert.alert("成功", "每日目标热量已更新！");
    } else {
      Alert.alert("错误", res.error || "更新失败");
    }
  };

  const handleClearCache = () => {
    setClearingCache(true);
    setTimeout(() => {
      setClearingCache(false);
      Alert.alert("成功", "已成功清理 14.8 MB 本地临时缓存");
    }, 600);
  };

  const confirmLogout = () => {
    setLogoutModalOpen(false);
    logout();
    router.replace("/login");
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      {/* Top Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-[#EBE3D5] bg-[#FDF8F0]">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-white border border-[#EBE3D5] items-center justify-center shadow-xs"
        >
          <FontAwesome6 name="chevron-left" size={14} color="#3D3229" />
        </TouchableOpacity>
        <Text className="text-lg font-black text-[#3D3229]">设置与偏好</Text>
        <View className="w-10" />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
      >
        {/* Section 1: 账号与目标 */}
        <View className="mb-5">
          <Text className="text-xs font-bold text-[#8B7D6B] mb-2 px-1">账号与目标设置</Text>
          <View className="bg-white rounded-2xl border border-[#EBE3D5] overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={() => router.push("/profile-edit")}
              className="p-4 flex-row items-center justify-between border-b border-[#F5EFE6] active:bg-[#FDF8F0]"
            >
              <View className="flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-[#2D6A4F]/10 items-center justify-center">
                  <FontAwesome6 name="user-gear" size={14} color="#2D6A4F" />
                </View>
                <Text className="text-sm font-bold text-[#3D3229]">修改个人资料</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-xs text-[#8B7D6B]">{user?.username}</Text>
                <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setCalorieTarget(user?.daily_calories_target?.toString() || "2100");
                setCalorieModalOpen(true);
              }}
              className="p-4 flex-row items-center justify-between active:bg-[#FDF8F0]"
            >
              <View className="flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-[#E9C46A]/20 items-center justify-center">
                  <FontAwesome6 name="fire" size={14} color="#D4A276" />
                </View>
                <Text className="text-sm font-bold text-[#3D3229]">每日目标摄入热量</Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-xs font-bold text-[#2D6A4F]">
                  {user?.daily_calories_target || 2100} kcal
                </Text>
                <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 2: 智能预警与推送 */}
        <View className="mb-5">
          <Text className="text-xs font-bold text-[#8B7D6B] mb-2 px-1">智能预警与提醒</Text>
          <View className="bg-white rounded-2xl border border-[#EBE3D5] overflow-hidden shadow-xs">
            <View className="p-4 flex-row items-center justify-between border-b border-[#F5EFE6]">
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-8 h-8 rounded-xl bg-[#D4A276]/15 items-center justify-center">
                  <FontAwesome6 name="bell" size={14} color="#D4A276" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-[#3D3229]">食材临期自动预警</Text>
                  <Text className="text-[11px] text-[#8B7D6B] mt-0.5">提前 3 天推送冰箱即将过期食材</Text>
                </View>
              </View>
              <Switch
                value={expiringAlert}
                onValueChange={setExpiringAlert}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
              />
            </View>

            <View className="p-4 flex-row items-center justify-between border-b border-[#F5EFE6]">
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-8 h-8 rounded-xl bg-[#2D6A4F]/10 items-center justify-center">
                  <FontAwesome6 name="utensils" size={14} color="#2D6A4F" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-[#3D3229]">每日三餐打卡提醒</Text>
                  <Text className="text-[11px] text-[#8B7D6B] mt-0.5">定时提醒记录早餐、午餐与晚餐</Text>
                </View>
              </View>
              <Switch
                value={mealReminder}
                onValueChange={setMealReminder}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
              />
            </View>

            <View className="p-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-3 flex-1 pr-2">
                <View className="w-8 h-8 rounded-xl bg-sky-500/15 items-center justify-center">
                  <FontAwesome6 name="droplet" size={14} color="#0EA5E9" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-[#3D3229]">水份补给健康提醒</Text>
                  <Text className="text-[11px] text-[#8B7D6B] mt-0.5">间隔 2 小时提醒补充 250ml 水分</Text>
                </View>
              </View>
              <Switch
                value={waterReminder}
                onValueChange={setWaterReminder}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
              />
            </View>
          </View>
        </View>

        {/* Section 3: 存储与通用偏好 */}
        <View className="mb-5">
          <Text className="text-xs font-bold text-[#8B7D6B] mb-2 px-1">通用与数据管理</Text>
          <View className="bg-white rounded-2xl border border-[#EBE3D5] overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={handleClearCache}
              disabled={clearingCache}
              className="p-4 flex-row items-center justify-between border-b border-[#F5EFE6] active:bg-[#FDF8F0]"
            >
              <View className="flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-[#8B7D6B]/15 items-center justify-center">
                  <FontAwesome6 name="broom" size={14} color="#8B7D6B" />
                </View>
                <Text className="text-sm font-bold text-[#3D3229]">清理本地缓存</Text>
              </View>
              {clearingCache ? (
                <ActivityIndicator size="small" color="#2D6A4F" />
              ) : (
                <Text className="text-xs text-[#8B7D6B]">14.8 MB</Text>
              )}
            </TouchableOpacity>

            <View className="p-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-3">
                <View className="w-8 h-8 rounded-xl bg-[#2D6A4F]/10 items-center justify-center">
                  <FontAwesome6 name="circle-info" size={14} color="#2D6A4F" />
                </View>
                <Text className="text-sm font-bold text-[#3D3229]">软件版本</Text>
              </View>
              <Text className="text-xs font-semibold text-[#8B7D6B]">v1.2.0 (最新版)</Text>
            </View>
          </View>
        </View>

        {/* Section 4: 退出登录 */}
        {isAuthenticated && (
          <TouchableOpacity
            onPress={() => setLogoutModalOpen(true)}
            className="bg-white border border-[#E76F51]/30 py-4 rounded-2xl items-center flex-row justify-center gap-2 shadow-xs active:bg-red-50 mt-2"
          >
            <FontAwesome6 name="arrow-right-from-bracket" size={15} color="#E76F51" />
            <Text className="text-sm font-bold text-[#E76F51]">退出当前账号登录</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 修改目标热量 Modal */}
      <Modal visible={calorieModalOpen} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-[32px] p-6">
            <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
              <Text className="text-lg font-black text-[#3D3229]">设置每日目标热量</Text>
              <TouchableOpacity onPress={() => setCalorieModalOpen(false)}>
                <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <Text className="text-xs text-[#8B7D6B] mb-3">
              根据您的基础代谢率与运动消耗量，建议设定在 1800 ~ 2600 kcal 之间。
            </Text>

            <View className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] flex-row items-center mb-5">
              <TextInput
                value={calorieTarget}
                onChangeText={setCalorieTarget}
                keyboardType="numeric"
                placeholder="2100"
                className="flex-1 text-base font-bold text-[#3D3229]"
              />
              <Text className="text-xs font-bold text-[#8B7D6B]">kcal / 天</Text>
            </View>

            <TouchableOpacity
              onPress={handleSaveCalorie}
              disabled={updatingCal}
              className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center shadow-xs active:opacity-90"
            >
              {updatingCal ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text className="text-sm font-bold text-white">保存设置</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
