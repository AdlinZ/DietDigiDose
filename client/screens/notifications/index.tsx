import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { Screen } from "@/components/Screen";
import { useAuth } from "@/contexts/AuthContext";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { authApi } from "@/services/api";

type NotificationFilter = "all" | "pending" | "system";
type NotificationItem = {
  id: number;
  type: "expiring_inventory" | "admin_campaign" | "meal_reminder" | "water_reminder";
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  inventoryItemId: number | null;
  category: "action_required" | "system" | "routine";
  priority: "urgent" | "high" | "normal" | "low";
  actionStatus: "pending" | "completed" | "info";
  snoozedUntil: string | null;
};
type HistoryResponse = { items: NotificationItem[]; nextCursor: number | null; hasMore: boolean };
type ListRow = { kind: "header"; id: string; label: string } | { kind: "item"; id: string; item: NotificationItem };

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "system", label: "系统公告" },
];

function dateGroup(value: string) {
  const date = new Date(value);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startToday - startDate) / 86_400_000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return "更早";
}

function itemVisual(item: NotificationItem) {
  if (item.type === "expiring_inventory") {
    return {
      icon: "clock" as const,
      color: item.priority === "urgent" ? "#C2413A" : "#B7791F",
      background: item.priority === "urgent" ? "bg-red-100" : "bg-highlight/25",
      label: item.priority === "urgent" ? "今天到期" : item.priority === "high" ? "高优先级" : "临期任务",
    };
  }
  if (item.type === "meal_reminder") return { icon: "utensils" as const, color: "#2D6A4F", background: "bg-brand/10", label: "用餐习惯" };
  if (item.type === "water_reminder") return { icon: "droplet" as const, color: "#0EA5E9", background: "bg-sky-100", label: "饮水习惯" };
  return { icon: "bullhorn" as const, color: "#2D6A4F", background: "bg-brand/10", label: "系统公告" };
}

export default function NotificationsScreen() {
  const router = useSafeRouter();
  const { token, isAuthenticated } = useAuth();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh" | "more" = "initial") => {
    if (!token) {
      setLoading(false);
      return;
    }
    if (mode === "more") setLoadingMore(true);
    else if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    try {
      const data = await authApi.notificationHistory<HistoryResponse>(token, {
        filter,
        cursor: mode === "more" ? nextCursor ?? undefined : undefined,
        limit: 20,
      });
      setItems((current) => mode === "more" ? [...current, ...data.items] : data.items);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "通知暂时无法加载");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [filter, nextCursor, token]);

  useEffect(() => {
    setItems([]);
    setNextCursor(null);
    void load("initial");
    // `load` also depends on the pagination cursor; filter/token are the reload triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, token]);

  const rows = useMemo<ListRow[]>(() => {
    const result: ListRow[] = [];
    let lastGroup = "";
    for (const item of items) {
      const group = dateGroup(item.createdAt);
      if (group !== lastGroup) {
        result.push({ kind: "header", id: `header-${group}`, label: group });
        lastGroup = group;
      }
      result.push({ kind: "item", id: `item-${item.id}`, item });
    }
    return result;
  }, [items]);

  const updateLocal = (id: number, changes: Partial<NotificationItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const runAction = async (item: NotificationItem, action: "open" | "complete" | "snooze_today" | "plan_recipe") => {
    if (!token) return;
    try {
      await authApi.notificationAction(token, item.id, action, { source: "notification_center" });
      if (action === "complete") {
        updateLocal(item.id, { isRead: true, actionStatus: "completed" });
        if (filter === "pending") setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        return;
      }
      if (action === "snooze_today") {
        setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        return;
      }
      updateLocal(item.id, { isRead: true });
      if (action === "plan_recipe") {
        router.push("/ai-assistant", { prompt: "请优先使用我即将到期的库存食材，安排一份今天能完成的餐单。" });
      } else if (item.type === "expiring_inventory") {
        router.push("/(tabs)/inventory", { highlightItemId: item.inventoryItemId });
      } else if (item.type === "meal_reminder") {
        router.push("/diet-record");
      }
    } catch (actionError) {
      Alert.alert("操作未完成", actionError instanceof Error ? actionError.message : "请稍后再试");
    }
  };

  const markAllRead = async () => {
    if (!token) return;
    try {
      await authApi.markAllNotificationsRead(token);
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    } catch (markError) {
      Alert.alert("操作未完成", markError instanceof Error ? markError.message : "请稍后再试");
    }
  };

  const renderItem = ({ item: row }: { item: ListRow }) => {
    if (row.kind === "header") {
      return <Text className="mb-2 mt-3 px-5 text-xs font-black text-copy-muted">{row.label}</Text>;
    }
    const item = row.item;
    const visual = itemVisual(item);
    return (
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={() => void runAction(item, "open")}
        className={`mx-5 mb-3 rounded-2xl border bg-white p-4 ${item.isRead ? "border-line" : "border-brand/30"}`}
      >
        <View className="flex-row items-start gap-3">
          <View className={`mt-0.5 h-10 w-10 items-center justify-center rounded-xl ${visual.background}`}>
            <FontAwesome6 name={visual.icon} size={15} color={visual.color} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className={`flex-1 text-sm text-ink ${item.isRead ? "font-bold" : "font-black"}`}>{item.title}</Text>
              {!item.isRead && <View className="mt-1.5 h-2 w-2 rounded-full bg-brand" />}
            </View>
            <Text className="mt-1 text-xs leading-5 text-copy-muted">{item.body}</Text>
            <View className="mt-2 flex-row items-center justify-between">
              <Text className="text-[10px] font-bold" style={{ color: visual.color }}>{visual.label}</Text>
              <Text className="text-[10px] text-[#B0A495]">{new Date(item.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
            {item.type === "expiring_inventory" && item.actionStatus === "pending" && (
              <View className="mt-3 flex-row flex-wrap gap-2 border-t border-background-secondary pt-3">
                <TouchableOpacity onPress={() => void runAction(item, "plan_recipe")} className="rounded-lg bg-brand px-3 py-2">
                  <Text className="text-[10px] font-black text-white">安排食谱</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert("标记已处理", "会同时把关联食材标记为已用完，是否继续？", [
                    { text: "取消", style: "cancel" },
                    { text: "确认", onPress: () => void runAction(item, "complete") },
                  ])}
                  className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2"
                >
                  <Text className="text-[10px] font-black text-brand">已处理</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => void runAction(item, "snooze_today")} className="rounded-lg bg-background-secondary px-3 py-2">
                  <Text className="text-[10px] font-black text-copy-muted">今天不再提醒</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <View className="flex-row items-center justify-between border-b border-line bg-canvas px-5 pb-3 pt-4">
        <TouchableOpacity onPress={() => router.back()} className="h-10 w-10 items-center justify-center rounded-full border border-line bg-white">
          <FontAwesome6 name="chevron-left" size={14} color="#3D3229" />
        </TouchableOpacity>
        <Text className="text-lg font-black text-ink">通知中心</Text>
        <TouchableOpacity onPress={() => router.push("/settings")} className="h-10 w-10 items-center justify-center">
          <FontAwesome6 name="gear" size={16} color="#8B7D6B" />
        </TouchableOpacity>
      </View>

      {!isAuthenticated ? (
        <View className="flex-1 items-center justify-center px-8">
          <FontAwesome6 name="bell" size={28} color="#2D6A4F" />
          <Text className="mt-4 text-base font-black text-ink">登录后查看通知</Text>
          <TouchableOpacity onPress={() => router.push("/login")} className="mt-4 rounded-xl bg-brand px-5 py-3">
            <Text className="font-bold text-white">去登录</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View className="flex-row items-center gap-2 px-5 pb-2 pt-4">
            {FILTERS.map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => setFilter(option.key)}
                className={`rounded-full border px-3 py-2 ${filter === option.key ? "border-brand bg-brand" : "border-line bg-white"}`}
              >
                <Text className={`text-xs font-black ${filter === option.key ? "text-white" : "text-copy-muted"}`}>{option.label}</Text>
              </TouchableOpacity>
            ))}
            <View className="flex-1" />
            {items.some((item) => !item.isRead) && (
              <TouchableOpacity onPress={() => void markAllRead()}><Text className="text-xs font-bold text-brand">全部已读</Text></TouchableOpacity>
            )}
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2D6A4F" /></View>
          ) : error && items.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <FontAwesome6 name="triangle-exclamation" size={26} color="#B7791F" />
              <Text className="mt-3 text-sm font-bold text-copy-muted">{error}</Text>
              <TouchableOpacity onPress={() => void load("initial")} className="mt-4 rounded-xl bg-brand px-5 py-3"><Text className="text-xs font-black text-white">重新加载</Text></TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={rows}
              renderItem={renderItem}
              keyExtractor={(row) => row.id}
              contentContainerStyle={{ paddingBottom: 32, flexGrow: rows.length ? 0 : 1 }}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} tintColor="#2D6A4F" />}
              onEndReached={() => { if (hasMore && !loadingMore) void load("more"); }}
              onEndReachedThreshold={0.35}
              ListFooterComponent={loadingMore ? <ActivityIndicator className="my-4" color="#2D6A4F" /> : null}
              ListEmptyComponent={(
                <View className="flex-1 items-center justify-center px-8">
                  <FontAwesome6 name="bell-slash" size={28} color="#B0A495" />
                  <Text className="mt-4 text-sm font-bold text-copy-muted">{filter === "pending" ? "没有待处理提醒" : "暂时没有新通知"}</Text>
                  <Text className="mt-1 text-xs text-[#B0A495]">可以在设置中管理提醒偏好</Text>
                </View>
              )}
            />
          )}
        </>
      )}
    </Screen>
  );
}
