import { useEffect, useState } from "react";
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
  Share,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth } from "@/contexts/AuthContext";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { authApi } from "@/services/api";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getExpoPushToken,
  syncLocalNotificationSchedules,
  type NotificationPreferences,
} from "@/utils/notifications";
import { APP_VERSION } from "@/utils/appVersion";
import { purgeUserPrivateStorage } from "@/utils/userStorage";

export default function SettingsScreen() {
  const router = useSafeRouter();
  const { user, token, isAuthenticated, logout, updateProfile, deleteAccount } = useAuth();

  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [savingNotifications, setSavingNotifications] = useState(false);

  useEffect(() => {
    if (!token) return;
    void authApi.notificationPreferences<NotificationPreferences>(token).then((preferences) => {
      setNotificationPreferences(preferences);
    }).catch(() => undefined);
  }, [token]);

  const saveNotificationPreferences = async (next: NotificationPreferences, requestPermission = false) => {
    if (!token) {
      Alert.alert("登录后开启提醒", "登录后可保存提醒偏好，并接收食材临期推送。");
      return;
    }
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (![next.breakfast_time, next.lunch_time, next.dinner_time, next.water_start_time, next.water_end_time, next.quiet_start_time, next.quiet_end_time].every((value) => timePattern.test(value))) {
      Alert.alert("时间格式有误", "请使用 24 小时制 HH:mm，例如 08:30。");
      return;
    }
    const previous = notificationPreferences;
    setNotificationPreferences(next);
    setSavingNotifications(true);
    try {
      const pushToken = requestPermission ? await getExpoPushToken() : null;
      await authApi.updateNotificationPreferences<NotificationPreferences>(token, next);
      if (pushToken && Platform.OS !== "web") {
        const platform = Platform.OS === "android" ? "android" : "ios";
        await authApi.registerPushDevice(token, { expo_push_token: pushToken, platform });
      }
      if (Platform.OS !== "web") {
        await syncLocalNotificationSchedules(next);
      }
      if (requestPermission && Platform.OS !== "web" && !pushToken) {
        Alert.alert("未获得通知权限", "系统通知未授权；你仍可稍后在系统设置中允许通知后再次开启提醒。");
      }
    } catch (error) {
      setNotificationPreferences(previous);
      Alert.alert("保存失败", error instanceof Error ? error.message : "提醒设置暂未保存，请稍后重试");
    } finally {
      setSavingNotifications(false);
    }
  };

  const updateNotificationPreference = (key: "expiring_alert" | "meal_reminder" | "water_reminder", value: boolean) => {
    void saveNotificationPreferences({ ...notificationPreferences, [key]: value }, value);
  };

  // Modal State
  const [calorieModalOpen, setCalorieModalOpen] = useState(false);
  const [calorieTarget, setCalorieTarget] = useState(
    user?.daily_calories_target?.toString() || "2100"
  );
  const [updatingCal, setUpdatingCal] = useState(false);

  // Logout confirmation modal
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [aiDataBusy, setAIDataBusy] = useState(false);

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

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await purgeUserPrivateStorage(user?.id);
      Alert.alert("成功", "AI 对话、采购清单和未完成识别等本地缓存已清理");
    } catch {
      Alert.alert("清理失败", "暂时无法清理本地缓存，请稍后重试");
    } finally {
      setClearingCache(false);
    }
  };

  const handleExportAIData = async () => {
    if (!token) return;
    setAIDataBusy(true);
    try {
      const data = await authApi.exportAIData<Record<string, unknown>>(token);
      await Share.share({ title: "食光烙记 AI 数据导出", message: JSON.stringify(data, null, 2) });
    } catch (error) {
      Alert.alert("导出失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setAIDataBusy(false);
    }
  };

  const handleDeleteAIData = () => {
    if (!token) return;
    Alert.alert("删除 AI 数据", "将永久删除服务端 AI 对话、识别任务和相关用量记录，并清理本地 AI 缓存。此操作不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "永久删除",
        style: "destructive",
        onPress: () => {
          setAIDataBusy(true);
          void authApi.deleteAIData(token)
            .then(() => purgeUserPrivateStorage(user?.id))
            .then(() => Alert.alert("已删除", "你的 AI 对话与识别数据已删除。"))
            .catch((error) => Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试"))
            .finally(() => setAIDataBusy(false));
        },
      },
    ]);
  };

  const confirmLogout = () => {
    setLogoutModalOpen(false);
    logout();
    router.replace("/login");
  };

  const confirmDeleteAccount = async () => {
    if (!deletePassword) {
      Alert.alert("请输入密码", "需要验证当前密码后才能永久删除账号。");
      return;
    }
    setDeletingAccount(true);
    const result = await deleteAccount(deletePassword);
    setDeletingAccount(false);
    if (!result.success) {
      Alert.alert("删除失败", result.error || "请稍后重试");
      return;
    }
    setDeleteModalOpen(false);
    setDeletePassword("");
    router.replace("/login");
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      {/* Top Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-line/80 bg-canvas/90">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-2xl bg-white border border-line items-center justify-center shadow-xs active:scale-95 transition-transform"
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <FontAwesome6 name="chevron-left" size={14} color="#3D3229" />
        </TouchableOpacity>
        <View className="items-center">
          <Text className="text-lg font-black text-ink">设置与偏好</Text>
          <Text className="text-[10px] text-copy-muted mt-0.5">个性化配置与应用管理</Text>
        </View>
        <View className="w-10" />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 100 }}
      >
        {/* Section 1: 账号与目标 */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-copy-muted uppercase tracking-wider mb-2.5 px-1">
            账号与目标设置
          </Text>
          <View className="bg-white rounded-3xl border border-line overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={() => router.push("/profile-edit")}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="user-gear" size={15} color="#2D6A4F" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">修改个人资料</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">修改用户名、头像与联系方式</Text>
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="text-xs font-semibold text-copy-muted bg-background-secondary px-2.5 py-1 rounded-full">
                  {user?.username || "未登录"}
                </Text>
                <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setCalorieTarget(user?.daily_calories_target?.toString() || "2100");
                setCalorieModalOpen(true);
              }}
              className="p-4 flex-row items-center justify-between active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-highlight/20 items-center justify-center">
                  <FontAwesome6 name="fire" size={15} color="#D4A276" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">每日目标摄入热量</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">定制专属每日卡路里控制线</Text>
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <View className="bg-brand/10 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                  <FontAwesome6 name="bolt" size={10} color="#2D6A4F" />
                  <Text className="text-xs font-extrabold text-brand">
                    {user?.daily_calories_target || 2100} kcal
                  </Text>
                </View>
                <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 2: 智能预警与推送 */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-copy-muted uppercase tracking-wider mb-2.5 px-1">
            智能预警与提醒
          </Text>
          <View className="bg-white rounded-3xl border border-line overflow-hidden shadow-xs">
            <View className="p-4 flex-row items-center justify-between border-b border-background-secondary">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-[#D4A276]/15 items-center justify-center">
                  <FontAwesome6 name="bell" size={15} color="#D4A276" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink">食材临期自动预警</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5 leading-4">
                    提前 3 天推送冰箱即将过期食材，减少浪费
                  </Text>
                </View>
              </View>
              <Switch
                value={notificationPreferences.expiring_alert}
                onValueChange={(value) => void updateNotificationPreference("expiring_alert", value)}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View className="p-4 flex-row items-center justify-between border-b border-background-secondary">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="utensils" size={15} color="#2D6A4F" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink">每日三餐打卡提醒</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5 leading-4">
                    按时提醒记录早、午、晚餐，建立健康饮食习惯
                  </Text>
                </View>
              </View>
              <Switch
                value={notificationPreferences.meal_reminder}
                onValueChange={(value) => void updateNotificationPreference("meal_reminder", value)}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View className="p-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-sky-500/15 items-center justify-center">
                  <FontAwesome6 name="droplet" size={15} color="#0EA5E9" />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink">水份补给健康提醒</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5 leading-4">
                    间隔 2 小时定时提醒补充 250ml 饮水量
                  </Text>
                </View>
              </View>
              <Switch
                value={notificationPreferences.water_reminder}
                onValueChange={(value) => void updateNotificationPreference("water_reminder", value)}
                trackColor={{ false: "#EBE3D5", true: "#2D6A4F" }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View className="border-t border-background-secondary p-4">
              <Text className="text-sm font-black text-ink">个性化提醒计划</Text>
              <Text className="mt-1 text-[11px] leading-4 text-copy-muted">24 小时制；静默时段内不会安排三餐和饮水提醒。</Text>

              <View className="mt-3 flex-row gap-2">
                {([
                  ["早餐", "breakfast_time"],
                  ["午餐", "lunch_time"],
                  ["晚餐", "dinner_time"],
                ] as const).map(([label, key]) => (
                  <View key={key} className="flex-1">
                    <Text className="mb-1 text-[10px] font-bold text-copy-muted">{label}</Text>
                    <TextInput
                      value={notificationPreferences[key]}
                      onChangeText={(value) => setNotificationPreferences((current) => ({ ...current, [key]: value }))}
                      placeholder="08:00"
                      maxLength={5}
                      className="rounded-xl border border-line bg-canvas px-3 py-2 text-center text-xs font-bold text-ink"
                    />
                  </View>
                ))}
              </View>

              <View className="mt-3 flex-row gap-2">
                {([
                  ["饮水开始", "water_start_time"],
                  ["饮水结束", "water_end_time"],
                  ["静默开始", "quiet_start_time"],
                  ["静默结束", "quiet_end_time"],
                ] as const).map(([label, key]) => (
                  <View key={key} className="flex-1">
                    <Text className="mb-1 text-center text-[9px] font-bold text-copy-muted">{label}</Text>
                    <TextInput
                      value={notificationPreferences[key]}
                      onChangeText={(value) => setNotificationPreferences((current) => ({ ...current, [key]: value }))}
                      maxLength={5}
                      className="rounded-xl border border-line bg-canvas px-1 py-2 text-center text-[11px] font-bold text-ink"
                    />
                  </View>
                ))}
              </View>

              <Text className="mb-2 mt-3 text-[10px] font-bold text-copy-muted">饮水间隔</Text>
              <View className="flex-row gap-2">
                {[60, 120, 180].map((minutes) => (
                  <TouchableOpacity
                    key={minutes}
                    onPress={() => setNotificationPreferences((current) => ({ ...current, water_interval_minutes: minutes }))}
                    className={`flex-1 rounded-xl border py-2 ${notificationPreferences.water_interval_minutes === minutes ? "border-brand bg-brand/10" : "border-line bg-canvas"}`}
                  >
                    <Text className={`text-center text-[11px] font-bold ${notificationPreferences.water_interval_minutes === minutes ? "text-brand" : "text-copy-muted"}`}>{minutes / 60} 小时</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View className="mt-3 flex-row gap-2">
                {([
                  ["工作日", "weekdays_enabled"],
                  ["周末", "weekends_enabled"],
                ] as const).map(([label, key]) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setNotificationPreferences((current) => ({ ...current, [key]: !current[key] }))}
                    className={`flex-1 rounded-xl border py-2.5 ${notificationPreferences[key] ? "border-brand bg-brand/10" : "border-line bg-canvas"}`}
                  >
                    <Text className={`text-center text-xs font-bold ${notificationPreferences[key] ? "text-brand" : "text-copy-muted"}`}>{label} · {notificationPreferences[key] ? "开启" : "关闭"}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                disabled={savingNotifications}
                onPress={() => void saveNotificationPreferences(notificationPreferences, notificationPreferences.meal_reminder || notificationPreferences.water_reminder || notificationPreferences.expiring_alert)}
                className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-brand py-3 active:opacity-80"
              >
                {savingNotifications && <ActivityIndicator size="small" color="#FFFFFF" />}
                <Text className="text-xs font-black text-white">保存并重排提醒</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Section 3: 存储与通用偏好 */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-copy-muted uppercase tracking-wider mb-2.5 px-1">
            通用与数据管理
          </Text>
          <View className="bg-white rounded-3xl border border-line overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={() => void handleClearCache()}
              disabled={clearingCache}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-copy-muted/15 items-center justify-center">
                  <FontAwesome6 name="broom" size={15} color="#8B7D6B" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">清理本地缓存</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">释放临时数据与离线缓存资源</Text>
                </View>
              </View>
              {clearingCache ? (
                <ActivityIndicator size="small" color="#2D6A4F" />
              ) : (
                <Text className="text-xs font-bold text-brand bg-brand/10 px-2.5 py-1 rounded-full">
                  清理
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push({ pathname: "/legal", params: { type: "privacy" } })}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-amber-500/10 items-center justify-center">
                  <FontAwesome6 name="shield-halved" size={15} color="#D97706" />
                </View>
                <Text className="text-sm font-bold text-ink">隐私政策</Text>
              </View>
              <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
            </TouchableOpacity>

            {isAuthenticated ? (
              <View className="border-b border-background-secondary">
                <TouchableOpacity
                  onPress={() => void handleExportAIData()}
                  disabled={aiDataBusy}
                  className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60"
                >
                  <Text className="text-sm font-bold text-ink">导出我的 AI 数据</Text>
                  <FontAwesome6 name="file-export" size={13} color="#2D6A4F" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDeleteAIData}
                  disabled={aiDataBusy}
                  className="p-4 flex-row items-center justify-between active:bg-red-50"
                >
                  <Text className="text-sm font-bold text-red-600">删除我的 AI 数据</Text>
                  {aiDataBusy ? <ActivityIndicator size="small" color="#DC2626" /> : <FontAwesome6 name="trash-can" size={13} color="#DC2626" />}
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={() => router.push({ pathname: "/legal", params: { type: "terms" } })}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-indigo-500/10 items-center justify-center">
                  <FontAwesome6 name="file-contract" size={15} color="#6366F1" />
                </View>
                <Text className="text-sm font-bold text-ink">服务与用户协议</Text>
              </View>
              <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/about")}
              className="p-4 flex-row items-center justify-between active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="circle-info" size={15} color="#2D6A4F" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">关于食光烙记</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">版本 {APP_VERSION} • DietDigiDose</Text>
                </View>
              </View>
              <FontAwesome6 name="chevron-right" size={12} color="#B0A495" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 4: 退出登录 */}
        {isAuthenticated && (
          <View className="gap-3 mt-2">
            <TouchableOpacity
              onPress={() => setLogoutModalOpen(true)}
              className="bg-white border border-critical/30 py-4 rounded-3xl items-center flex-row justify-center gap-2 shadow-xs active:bg-red-50 active:scale-[0.99] transition-all"
            >
              <FontAwesome6 name="arrow-right-from-bracket" size={15} color="#E76F51" />
              <Text className="text-sm font-bold text-critical">退出当前账号登录</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setDeleteModalOpen(true)}
              className="py-2.5 items-center active:opacity-75"
            >
              <Text className="text-xs font-bold text-[#A33A2B] underline">永久删除账号与所有数据</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 修改目标热量 Modal */}
      <Modal visible={calorieModalOpen} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-[36px] p-6 shadow-2xl border-t border-line">
            <View className="flex-row items-center justify-between mb-3 border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2.5">
                <View className="w-8 h-8 rounded-xl bg-highlight/20 items-center justify-center">
                  <FontAwesome6 name="fire" size={14} color="#D4A276" />
                </View>
                <Text className="text-lg font-black text-ink">设置每日目标热量</Text>
              </View>
              <TouchableOpacity
                onPress={() => setCalorieModalOpen(false)}
                className="w-8 h-8 rounded-full bg-background-secondary items-center justify-center"
              >
                <FontAwesome6 name="xmark" size={14} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <Text className="text-xs text-copy-muted mb-4 leading-5">
              根据您的基础代谢率与日常运动量，建议将每日摄入目标设定在 1800 ~ 2600 kcal 之间。
            </Text>

            {/* Quick preset selector pills */}
            <Text className="text-xs font-bold text-ink mb-2 px-1">快速选择目标热量：</Text>
            <View className="flex-row gap-2 mb-4 flex-wrap">
              {["1800", "2000", "2200", "2500"].map((preset) => {
                const isSelected = calorieTarget === preset;
                return (
                  <TouchableOpacity
                    key={preset}
                    onPress={() => setCalorieTarget(preset)}
                    className={`px-4 py-2 rounded-2xl border ${
                      isSelected
                        ? "bg-brand border-brand"
                        : "bg-canvas border-line"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        isSelected ? "text-white" : "text-ink"
                      }`}
                    >
                      {preset} kcal
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Input with step buttons */}
            <View className="bg-canvas px-4 py-3 rounded-2xl border border-line flex-row items-center mb-5 shadow-inner">
              <TouchableOpacity
                onPress={() => {
                  const curr = parseInt(calorieTarget) || 2000;
                  setCalorieTarget(Math.max(1000, curr - 50).toString());
                }}
                className="w-9 h-9 rounded-xl bg-white border border-line items-center justify-center"
              >
                <FontAwesome6 name="minus" size={12} color="#3D3229" />
              </TouchableOpacity>
              <TextInput
                value={calorieTarget}
                onChangeText={setCalorieTarget}
                keyboardType="numeric"
                placeholder="2100"
                className="flex-1 text-center text-xl font-black text-ink"
              />
              <Text className="text-xs font-bold text-copy-muted mr-3">kcal</Text>
              <TouchableOpacity
                onPress={() => {
                  const curr = parseInt(calorieTarget) || 2000;
                  setCalorieTarget(Math.min(5000, curr + 50).toString());
                }}
                className="w-9 h-9 rounded-xl bg-white border border-line items-center justify-center"
              >
                <FontAwesome6 name="plus" size={12} color="#3D3229" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleSaveCalorie}
              disabled={updatingCal}
              className="bg-brand py-4 rounded-2xl items-center shadow-md active:opacity-90"
            >
              {updatingCal ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text className="text-sm font-bold text-white">保存目标设置</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 退出登录确认 Modal */}
      <Modal visible={logoutModalOpen} animationType="fade" transparent>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-[32px] p-6 w-full max-w-sm items-center shadow-2xl border border-line">
            <View className="w-16 h-16 rounded-full bg-red-50 border border-red-100 items-center justify-center mb-4">
              <FontAwesome6 name="arrow-right-from-bracket" size={24} color="#E76F51" />
            </View>
            <Text className="text-lg font-black text-ink">确认退出登录</Text>
            <Text className="text-xs text-copy-muted text-center mt-2 mb-6 leading-5">
              退出后需要重新登录才能继续管理您的食材与饮食打卡记录。确定要退出吗？
            </Text>

            <View className="flex-row gap-3 w-full">
              <TouchableOpacity
                onPress={() => setLogoutModalOpen(false)}
                className="flex-1 bg-background-secondary py-3.5 rounded-2xl items-center border border-line"
              >
                <Text className="text-xs font-bold text-copy-muted">取消</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={confirmLogout}
                className="flex-1 bg-critical py-3.5 rounded-2xl items-center shadow-xs active:opacity-90"
              >
                <Text className="text-xs font-bold text-white">确认退出</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 永久删除账号 Modal */}
      <Modal visible={deleteModalOpen} animationType="fade" transparent>
        <View className="flex-1 bg-black/50 items-center justify-center p-6">
          <View className="bg-white rounded-[32px] p-6 w-full max-w-sm shadow-2xl border border-line">
            <View className="w-14 h-14 rounded-full bg-red-50 border border-red-200 items-center justify-center mb-3 self-center">
              <FontAwesome6 name="triangle-exclamation" size={22} color="#A33A2B" />
            </View>
            <Text className="text-lg font-black text-[#A33A2B] text-center">永久删除账号</Text>
            <Text className="text-xs text-[#66594D] mt-2 mb-4 leading-5 text-center">
              库存、饮食打卡、健康档案、社区内容及本机数据均会被永久注销且无法恢复。请输入密码确认。
            </Text>
            <TextInput
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="请输入当前登录密码"
              className="bg-canvas border border-line rounded-2xl px-4 py-3.5 text-sm text-ink mb-4"
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                disabled={deletingAccount}
                onPress={() => { setDeleteModalOpen(false); setDeletePassword(""); }}
                className="flex-1 bg-background-secondary py-3.5 rounded-2xl items-center border border-line"
              >
                <Text className="text-xs font-bold text-[#66594D]">取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deletingAccount}
                onPress={confirmDeleteAccount}
                className="flex-1 bg-[#A33A2B] py-3.5 rounded-2xl items-center shadow-xs"
              >
                {deletingAccount ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text className="text-xs font-bold text-white">永久删除</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
