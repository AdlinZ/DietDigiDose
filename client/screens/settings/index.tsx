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
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import { authApi, voicePackApi, type VoicePackManifest } from "@/services/api";
import { useThemePreference, type ThemePreference } from "@/contexts/ThemeContext";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getExpoPushToken,
  syncLocalNotificationSchedules,
  type NotificationPreferences,
} from "@/utils/notifications";
import { APP_RELEASE_LABEL } from "@/utils/appVersion";
import { formatStorageBytes, getTotalClearableCacheSize, purgeClearableCache, purgeUserPrivateStorage } from "@/utils/userStorage";
import { Image as ExpoImage } from "expo-image";
import { useAppThemeColors } from "@/hooks/useAppThemeColors";
import { clearApiCacheScope, getApiCacheDiagnostics } from "@/services/api/cache";
import {
  applyVoicePreference,
  deleteVoicePack,
  getVoicePackState,
  installVoicePack,
  pauseVoicePackDownload,
  purgeVoiceAudioCache,
  removeRevokedVoicePacks,
  resumeVoicePackDownload,
  speakWithVoiceFallback,
  stopVoiceOutput,
  type VoicePackState,
  type VoiceSource,
} from "@/services/voicePackManager";

export default function SettingsScreen() {
  const router = useSafeRouter();
  const { user, token, isAuthenticated, logout, updateProfile, deleteAccount } = useAuth();
  const authFetch = useAuthFetch();
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const colors = useAppThemeColors();

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
        await syncLocalNotificationSchedules(next, user?.id);
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
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [cacheDiagnostics, setCacheDiagnostics] = useState(() => getApiCacheDiagnostics());
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [aiDataBusy, setAIDataBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<VoicePackState | null>(null);
  const [voiceCatalog, setVoiceCatalog] = useState<VoicePackManifest[]>([]);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceDownloading, setVoiceDownloading] = useState(false);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [lastVoiceSource, setLastVoiceSource] = useState<VoiceSource | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await getVoicePackState(user?.id);
      if (active) setVoiceState(local);
      if (!token || !user) {
        if (active) setVoiceCatalog([]);
        return;
      }
      try {
        const [{ items, revoked }, remotePreference] = await Promise.all([
          voicePackApi.catalog(authFetch),
          voicePackApi.preference(authFetch),
        ]);
        if (!active) return;
        setVoiceCatalog(items);
        const remoteSelectionRevoked = revoked.some((item) => (
          item.voiceId === remotePreference.selectedVoiceId && item.version === remotePreference.selectedVersion
        ));
        const nextPreference = remoteSelectionRevoked
          ? await voicePackApi.updatePreference(authFetch, {
            ...remotePreference,
            selectedVoiceId: null,
            selectedVersion: null,
          })
          : remotePreference;
        await removeRevokedVoicePacks(revoked);
        if (active) setVoiceState(await applyVoicePreference(user.id, nextPreference));
      } catch {
        if (active) setVoiceCatalog([]);
      }
    })();
    return () => { active = false; };
  }, [authFetch, token, user]);

  const persistVoicePreference = async (input: {
    selectedVoiceId: string | null;
    selectedVersion: string | null;
    preference: "automatic" | "system-only";
  }) => {
    if (!user) throw new Error("请先登录后保存音色偏好");
    const remote = await voicePackApi.preference(authFetch);
    const updated = await voicePackApi.updatePreference(authFetch, { ...remote, ...input });
    return applyVoicePreference(user.id, updated);
  };

  const installSelectedVoice = async (manifest: VoicePackManifest, allowCellular = false) => {
    setVoiceBusy(true);
    setVoiceDownloading(true);
    setVoiceProgress(0);
    try {
      await installVoicePack(manifest, { allowCellular, onProgress: setVoiceProgress, userId: user?.id });
      setVoiceState(await persistVoicePreference({
        selectedVoiceId: manifest.voiceId,
        selectedVersion: manifest.version,
        preference: voiceState?.preference || "automatic",
      }));
      Alert.alert("音色包已安装", "这是合成语音。模型只负责朗读，不会替代 AI 权限和安全校验。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "音色包安装失败";
      if (message === "下载已暂停") {
        // The paused state is rendered below and can be resumed safely.
      } else if (!allowCellular && message.includes("移动网络")) {
        Alert.alert("使用移动网络下载？", message, [
          { text: "取消", style: "cancel" },
          { text: "继续下载", onPress: () => void installSelectedVoice(manifest, true) },
        ]);
      } else Alert.alert("安装失败", message);
    } finally {
      setVoiceBusy(false);
      setVoiceDownloading(false);
      setVoiceState(await getVoicePackState(user?.id));
    }
  };

  const resumeSelectedVoice = async () => {
    const paused = voiceState?.pausedDownload;
    if (!paused) return;
    setVoiceBusy(true);
    setVoiceDownloading(true);
    setVoiceProgress(paused.completedBytes / Math.max(1, paused.manifest.resources.reduce((sum, item) => sum + item.bytes, 0)));
    try {
      await resumeVoicePackDownload({ onProgress: setVoiceProgress, userId: user?.id });
      setVoiceState(await persistVoicePreference({
        selectedVoiceId: paused.manifest.voiceId,
        selectedVersion: paused.manifest.version,
        preference: voiceState?.preference || "automatic",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复下载失败";
      if (message !== "下载已暂停") Alert.alert("恢复失败", message);
    } finally {
      setVoiceBusy(false);
      setVoiceDownloading(false);
      setVoiceState(await getVoicePackState(user?.id));
    }
  };

  const deleteInstalledVoice = async (manifest: VoicePackManifest, deleteGeneratedAudio: boolean) => {
    setVoiceBusy(true);
    try {
      const selected = voiceState?.selectedVoiceId === manifest.voiceId && voiceState.selectedVersion === manifest.version;
      await deleteVoicePack(user?.id, deleteGeneratedAudio, { voiceId: manifest.voiceId, version: manifest.version });
      setVoiceState(selected
        ? await persistVoicePreference({ selectedVoiceId: null, selectedVersion: null,
          preference: voiceState?.preference || "automatic" })
        : await getVoicePackState(user?.id));
    } catch (error) {
      Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setVoiceBusy(false);
    }
  };

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
      await Promise.all([
        purgeClearableCache(user?.id),
        purgeVoiceAudioCache(),
        clearApiCacheScope("public"),
        clearApiCacheScope(user?.id),
        ExpoImage.clearDiskCache(),
        ExpoImage.clearMemoryCache(),
      ]);
      setCacheSize(await getTotalClearableCacheSize(user?.id));
      setCacheDiagnostics(getApiCacheDiagnostics());
      Alert.alert("成功", "本地数据缓存和图片缓存已清理；系统仍占用的临时缓存会按实际大小显示");
    } catch {
      Alert.alert("清理失败", "暂时无法清理本地缓存，请稍后重试");
    } finally {
      setClearingCache(false);
    }
  };

  useEffect(() => {
    void getTotalClearableCacheSize(user?.id).then(setCacheSize).catch(() => setCacheSize(null));
    setCacheDiagnostics(getApiCacheDiagnostics());
  }, [user?.id]);

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

  const confirmLogout = async () => {
    setLogoutModalOpen(false);
    await stopVoiceOutput();
    await logout();
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
    <Screen safeAreaEdges={["top", "left", "right"]}>
      {/* Top Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-line/80 bg-canvas/90">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-2xl bg-surface border border-line items-center justify-center shadow-xs active:scale-95 transition-transform"
          accessibilityRole="button"
          accessibilityLabel="返回"
        >
          <FontAwesome6 name="chevron-left" size={14} colorClassName="accent-ink" />
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
        <View className="mb-6">
          <Text className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-copy-muted">
            外观
          </Text>
          <View className="rounded-3xl border border-line bg-surface p-2 shadow-xs">
            <View className="flex-row gap-2">
              {([
                { value: "system", label: "跟随系统", icon: "circle-half-stroke" },
                { value: "light", label: "浅色", icon: "sun" },
                { value: "dark", label: "深色", icon: "moon" },
              ] as const satisfies ReadonlyArray<{
                value: ThemePreference;
                label: string;
                icon: "circle-half-stroke" | "sun" | "moon";
              }>).map((option) => {
                const selected = themePreference === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => void setThemePreference(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    className={`flex-1 items-center gap-2 rounded-2xl border px-2 py-3 ${selected ? "border-brand bg-brand-soft" : "border-transparent bg-background-secondary"}`}
                  >
                    <FontAwesome6
                      name={option.icon}
                      size={15}
                      colorClassName={selected ? "accent-brand" : "accent-copy-muted"}
                    />
                    <Text className={`text-[11px] font-bold ${selected ? "text-brand" : "text-copy-muted"}`}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text className="px-2 pb-1 pt-2.5 text-[10px] leading-4 text-copy-muted">
              跟随系统会在设备外观变化时自动切换，重启应用后仍会保留你的选择。
            </Text>
          </View>
        </View>

        <View className="mb-6">
          <Text className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wider text-copy-muted">
            做饭语音
          </Text>
          <View className="overflow-hidden rounded-3xl border border-line bg-surface shadow-xs">
            <View className="border-b border-background-secondary p-4">
              <View className="flex-row items-center justify-between gap-3">
                <View className="flex-1 flex-row items-center gap-3.5">
                  <View className="h-9 w-9 items-center justify-center rounded-2xl bg-info-soft">
                    <FontAwesome6 name="wave-square" size={15} colorClassName="accent-info" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-ink">语音来源</Text>
                    <Text className="mt-0.5 text-[11px] leading-4 text-copy-muted">
                      {voiceState?.preference === "system-only"
                        ? "仅系统语音"
                        : voiceState?.installed
                          ? `本地个人音色 · ${voiceState.installed.name} ${voiceState.installed.version}`
                          : lastVoiceSource === "server" ? "云端语音" : "自动：云端 → 系统语音"}
                    </Text>
                  </View>
                </View>
                <Switch
                  value={voiceState?.preference === "system-only"}
                  disabled={voiceBusy || !isAuthenticated}
                  onValueChange={(systemOnly) => {
                    setVoiceBusy(true);
                    void persistVoicePreference({
                      selectedVoiceId: voiceState?.selectedVoiceId || null,
                      selectedVersion: voiceState?.selectedVersion || null,
                      preference: systemOnly ? "system-only" : "automatic",
                    }).then(setVoiceState)
                      .catch((error) => Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试"))
                      .finally(() => setVoiceBusy(false));
                  }}
                  trackColor={{ false: colors.line, true: colors["brand-fill"] }}
                  thumbColor={colors["on-brand"]}
                />
              </View>
              <Text className="mt-2 text-[10px] leading-4 text-copy-muted">
                开关开启表示强制仅使用系统语音。本地模型是合成音色，下载后可能被设备使用者提取；敏感回答缓存按账号隔离。
              </Text>
              {voiceState?.benchmark ? (
                <Text className={`mt-2 text-[10px] font-bold ${voiceState.benchmark.passed ? "text-brand" : "text-critical"}`}>
                  设备基准：首段 {voiceState.benchmark.firstAudioMs}ms · 实时系数 {voiceState.benchmark.realtimeFactor.toFixed(2)} · {voiceState.benchmark.passed ? "可用" : "已自动降级"}
                </Text>
              ) : null}
            </View>

            {voiceState?.installed ? (
              <View className="flex-row gap-2 p-4">
                <TouchableOpacity
                  disabled={voiceBusy}
                  onPress={() => {
                    setVoiceBusy(true);
                    void speakWithVoiceFallback(authFetch, "水温八十五摄氏度，加入二百克番茄和十五毫升清水。", { userId: user?.id, sensitive: false })
                      .then(setLastVoiceSource)
                      .catch((error) => Alert.alert("试听失败", error instanceof Error ? error.message : "请稍后重试"))
                      .finally(() => setVoiceBusy(false));
                  }}
                  className="flex-1 items-center rounded-xl bg-brand-fill py-3"
                >
                  <Text className="text-xs font-black text-white">试听固定回归句</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={voiceBusy}
                  onPress={() => void installSelectedVoice(voiceState.installed!)}
                  className="items-center rounded-xl border border-line px-3 py-3"
                >
                  <Text className="text-xs font-black text-ink">重装</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={voiceBusy}
                  onPress={() => Alert.alert("删除本地音色包", "是否同时删除由该音色生成的音频缓存？", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "仅删除模型",
                      onPress: () => void deleteInstalledVoice(voiceState.installed!, false),
                    },
                    {
                      text: "模型与音频",
                      style: "destructive",
                      onPress: () => void deleteInstalledVoice(voiceState.installed!, true),
                    },
                  ])}
                  className="items-center rounded-xl border border-critical/30 px-4 py-3"
                >
                  <Text className="text-xs font-black text-critical">删除</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {voiceDownloading ? (
              <TouchableOpacity
                onPress={() => void pauseVoicePackDownload().then(async (paused) => {
                  if (paused) setVoiceState(await getVoicePackState(user?.id));
                })}
                className="mx-4 mb-3 items-center rounded-xl border border-warning/30 bg-warning-soft py-2.5"
              >
                <Text className="text-xs font-black text-warning">暂停下载</Text>
              </TouchableOpacity>
            ) : voiceState?.pausedDownload ? (
              <TouchableOpacity
                onPress={() => void resumeSelectedVoice()}
                className="mx-4 mb-3 items-center rounded-xl border border-brand/30 bg-brand-soft py-2.5"
              >
                <Text className="text-xs font-black text-brand">继续下载 {voiceState.pausedDownload.manifest.name}</Text>
              </TouchableOpacity>
            ) : null}
            <View className="gap-2 border-t border-background-secondary p-4">
              {voiceCatalog.length ? voiceCatalog.map((manifest) => {
                const installedOnDevice = voiceState?.installedPacks.some((item) => item.voiceId === manifest.voiceId && item.version === manifest.version);
                const selected = voiceState?.selectedVoiceId === manifest.voiceId && voiceState.selectedVersion === manifest.version;
                return (
                  <View key={`${manifest.voiceId}@${manifest.version}`}
                    className={`flex-row items-center rounded-2xl border ${selected ? "border-brand bg-brand-soft" : "border-line bg-canvas"}`}>
                    <TouchableOpacity
                      disabled={voiceBusy || !isAuthenticated || selected}
                      onPress={() => {
                        if (!installedOnDevice) {
                          void installSelectedVoice(manifest);
                          return;
                        }
                        setVoiceBusy(true);
                        void persistVoicePreference({
                          selectedVoiceId: manifest.voiceId,
                          selectedVersion: manifest.version,
                          preference: voiceState?.preference || "automatic",
                        }).then(setVoiceState)
                          .catch((error) => Alert.alert("选择失败", error instanceof Error ? error.message : "请稍后重试"))
                          .finally(() => setVoiceBusy(false));
                      }}
                      className="flex-1 p-3 active:bg-brand-soft"
                    >
                      <View className="flex-row items-center justify-between">
                      <View className="flex-1">
                        <View className="flex-row items-center gap-2"><Text className="text-sm font-black text-ink">{manifest.name}</Text>
                          {manifest.distribution === "internal-test" ? <Text className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-black text-purple-700">内部测试</Text> : null}
                        </View>
                        <Text className="mt-1 text-[10px] leading-4 text-copy-muted">
                          {manifest.version} · {(manifest.resources.reduce((sum, resource) => sum + resource.bytes, 0) / 1024 / 1024).toFixed(1)} MB · {manifest.license.name}
                        </Text>
                      </View>
                      {voiceDownloading ? <ActivityIndicator size="small" colorClassName="accent-brand" /> : <Text className="text-xs font-bold text-brand">{selected ? "已选择" : installedOnDevice ? "选择" : "下载"}</Text>}
                      </View>
                      {voiceDownloading && !installedOnDevice ? <Text className="mt-2 text-[10px] font-bold text-brand">已下载 {Math.round(voiceProgress * 100)}%</Text> : null}
                    </TouchableOpacity>
                    {installedOnDevice && !selected ? <TouchableOpacity disabled={voiceBusy}
                      onPress={() => Alert.alert("删除本地音色包", `删除 ${manifest.name}？`, [
                        { text: "取消", style: "cancel" },
                        { text: "仅删除模型", onPress: () => void deleteInstalledVoice(manifest, false) },
                        { text: "模型与音频", style: "destructive", onPress: () => void deleteInstalledVoice(manifest, true) },
                      ])}
                      className="mr-3 rounded-xl border border-critical/30 px-3 py-2">
                      <Text className="text-[10px] font-black text-critical">删除</Text>
                    </TouchableOpacity> : null}
                  </View>
                );
              }) : (
                  <Text className="text-[11px] leading-5 text-copy-muted">
                    当前部署尚未发布通过许可与摘要审核的个人音色包；做饭模式会自动使用云端或系统语音。
                  </Text>
              )}
            </View>
          </View>
        </View>

        {/* Section 1: 账号与目标 */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-copy-muted uppercase tracking-wider mb-2.5 px-1">
            账号与目标设置
          </Text>
          <View className="bg-surface rounded-3xl border border-line overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={() => router.push("/profile-edit")}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="user-gear" size={15} colorClassName="accent-brand" />
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
                <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
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
                  <FontAwesome6 name="fire" size={15} colorClassName="accent-warm" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">每日目标摄入热量</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">定制专属每日卡路里控制线</Text>
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <View className="bg-brand/10 px-2.5 py-1 rounded-full flex-row items-center gap-1">
                  <FontAwesome6 name="bolt" size={10} colorClassName="accent-brand" />
                  <Text className="text-xs font-extrabold text-brand">
                    {user?.daily_calories_target || 2100} kcal
                  </Text>
                </View>
                <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 2: 智能预警与推送 */}
        <View className="mb-6">
          <Text className="text-xs font-bold text-copy-muted uppercase tracking-wider mb-2.5 px-1">
            智能预警与提醒
          </Text>
          <View className="bg-surface rounded-3xl border border-line overflow-hidden shadow-xs">
            <View className="p-4 flex-row items-center justify-between border-b border-background-secondary">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-warm/15 items-center justify-center">
                  <FontAwesome6 name="bell" size={15} colorClassName="accent-warm" />
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
                trackColor={{ false: colors.line, true: colors["brand-fill"] }}
                thumbColor={colors["on-brand"]}
              />
            </View>

            <View className="p-4 flex-row items-center justify-between border-b border-background-secondary">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="utensils" size={15} colorClassName="accent-brand" />
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
                trackColor={{ false: colors.line, true: colors["brand-fill"] }}
                thumbColor={colors["on-brand"]}
              />
            </View>

            <View className="p-4 flex-row items-center justify-between">
              <View className="flex-row items-center gap-3.5 flex-1 pr-2">
                <View className="w-9 h-9 rounded-2xl bg-info/15 items-center justify-center">
                  <FontAwesome6 name="droplet" size={15} colorClassName="accent-info" />
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
                trackColor={{ false: colors.line, true: colors["brand-fill"] }}
                thumbColor={colors["on-brand"]}
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
                className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-brand-fill py-3 active:opacity-80"
              >
                {savingNotifications && <ActivityIndicator size="small" colorClassName="accent-on-brand" />}
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
          <View className="bg-surface rounded-3xl border border-line overflow-hidden shadow-xs">
            <TouchableOpacity
              onPress={() => void handleClearCache()}
              disabled={clearingCache}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-copy-muted/15 items-center justify-center">
                  <FontAwesome6 name="broom" size={15} colorClassName="accent-copy-muted" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">清理本地缓存</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">
                    {cacheSize == null ? "正在统计缓存…" : `当前本地缓存 ${formatStorageBytes(cacheSize)}`}
                  </Text>
                  {__DEV__ ? (
                    <Text className="text-[10px] text-copy-muted mt-0.5">
                      命中率 {Math.round(cacheDiagnostics.hitRate * 100)}% · {cacheDiagnostics.entries} 项 · 陈旧回退 {cacheDiagnostics.staleFallbacks} 次
                    </Text>
                  ) : null}
                </View>
              </View>
              {clearingCache ? (
                <ActivityIndicator size="small" colorClassName="accent-brand" />
              ) : (
                <Text className="text-xs font-bold text-brand bg-brand/10 px-2.5 py-1 rounded-full">
                  {cacheSize === 0 ? "已清理" : "清理"}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push({ pathname: "/legal", params: { type: "privacy" } })}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-warm/10 items-center justify-center">
                  <FontAwesome6 name="shield-halved" size={15} colorClassName="accent-warm" />
                </View>
                <Text className="text-sm font-bold text-ink">隐私政策</Text>
              </View>
              <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
            </TouchableOpacity>

            {isAuthenticated ? (
              <View className="border-b border-background-secondary">
                <TouchableOpacity
                  onPress={() => void handleExportAIData()}
                  disabled={aiDataBusy}
                  className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60"
                >
                  <Text className="text-sm font-bold text-ink">导出我的 AI 数据</Text>
                  <FontAwesome6 name="file-export" size={13} colorClassName="accent-brand" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDeleteAIData}
                  disabled={aiDataBusy}
                  className="p-4 flex-row items-center justify-between active:bg-danger-soft"
                >
                  <Text className="text-sm font-bold text-critical">删除我的 AI 数据</Text>
                  {aiDataBusy ? <ActivityIndicator size="small" colorClassName="accent-critical" /> : <FontAwesome6 name="trash-can" size={13} colorClassName="accent-critical" />}
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={() => router.push({ pathname: "/legal", params: { type: "terms" } })}
              className="p-4 flex-row items-center justify-between border-b border-background-secondary active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-info-soft items-center justify-center">
                  <FontAwesome6 name="file-contract" size={15} colorClassName="accent-info" />
                </View>
                <Text className="text-sm font-bold text-ink">服务与用户协议</Text>
              </View>
              <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push("/about")}
              className="p-4 flex-row items-center justify-between active:bg-canvas/60 transition-colors"
            >
              <View className="flex-row items-center gap-3.5">
                <View className="w-9 h-9 rounded-2xl bg-brand/10 items-center justify-center">
                  <FontAwesome6 name="circle-info" size={15} colorClassName="accent-brand" />
                </View>
                <View>
                  <Text className="text-sm font-bold text-ink">关于食光烙记</Text>
                  <Text className="text-[11px] text-copy-muted mt-0.5">版本 {APP_RELEASE_LABEL}</Text>
                </View>
              </View>
              <FontAwesome6 name="chevron-right" size={12} colorClassName="accent-copy-muted" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 4: 退出登录 */}
        {isAuthenticated && (
          <View className="gap-3 mt-2">
            <TouchableOpacity
              onPress={() => setLogoutModalOpen(true)}
              className="bg-surface border border-critical/30 py-4 rounded-3xl items-center flex-row justify-center gap-2 shadow-xs active:bg-danger-soft active:scale-[0.99] transition-all"
            >
              <FontAwesome6 name="arrow-right-from-bracket" size={15} colorClassName="accent-critical" />
              <Text className="text-sm font-bold text-critical">退出当前账号登录</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setDeleteModalOpen(true)}
              className="py-2.5 items-center active:opacity-75"
            >
              <Text className="text-xs font-bold text-critical underline">永久删除账号与所有数据</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 修改目标热量 Modal */}
      <Modal visible={calorieModalOpen} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-surface rounded-t-[36px] p-6 shadow-2xl border-t border-line">
            <View className="flex-row items-center justify-between mb-3 border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2.5">
                <View className="w-8 h-8 rounded-xl bg-highlight/20 items-center justify-center">
                  <FontAwesome6 name="fire" size={14} colorClassName="accent-warm" />
                </View>
                <Text className="text-lg font-black text-ink">设置每日目标热量</Text>
              </View>
              <TouchableOpacity
                onPress={() => setCalorieModalOpen(false)}
                className="w-8 h-8 rounded-full bg-background-secondary items-center justify-center"
              >
                <FontAwesome6 name="xmark" size={14} colorClassName="accent-copy-muted" />
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
                        ? "bg-brand-fill border-brand"
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
                className="w-9 h-9 rounded-xl bg-surface border border-line items-center justify-center"
              >
                <FontAwesome6 name="minus" size={12} colorClassName="accent-ink" />
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
                className="w-9 h-9 rounded-xl bg-surface border border-line items-center justify-center"
              >
                <FontAwesome6 name="plus" size={12} colorClassName="accent-ink" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleSaveCalorie}
              disabled={updatingCal}
              className="bg-brand-fill py-4 rounded-2xl items-center shadow-md active:opacity-90"
            >
              {updatingCal ? (
                <ActivityIndicator colorClassName="accent-on-brand" />
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
          <View className="bg-surface rounded-[32px] p-6 w-full max-w-sm items-center shadow-2xl border border-line">
            <View className="w-16 h-16 rounded-full bg-danger-soft border border-critical/30 items-center justify-center mb-4">
              <FontAwesome6 name="arrow-right-from-bracket" size={24} colorClassName="accent-critical" />
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
                className="flex-1 bg-critical-fill py-3.5 rounded-2xl items-center shadow-xs active:opacity-90"
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
          <View className="bg-surface rounded-[32px] p-6 w-full max-w-sm shadow-2xl border border-line">
            <View className="w-14 h-14 rounded-full bg-danger-soft border border-critical/40 items-center justify-center mb-3 self-center">
              <FontAwesome6 name="triangle-exclamation" size={22} colorClassName="accent-critical" />
            </View>
            <Text className="text-lg font-black text-critical text-center">永久删除账号</Text>
            <Text className="text-xs text-copy-muted mt-2 mb-4 leading-5 text-center">
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
                <Text className="text-xs font-bold text-copy-muted">取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deletingAccount}
                onPress={confirmDeleteAccount}
                className="flex-1 bg-critical-fill py-3.5 rounded-2xl items-center shadow-xs"
              >
                {deletingAccount ? (
                  <ActivityIndicator colorClassName="accent-on-brand" />
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
