import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { RecipeCover } from "@/components/RecipeCover";
import { Screen } from "@/components/Screen";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { inventoryApi, recipesApi, shoppingListApi, type InventoryItem } from "@/services/api";
import {
  clearCookingQueue,
  getCookingQueue,
  moveCookingQueueItem,
  removeFromCookingQueue,
  saveCookingQueue,
  updateCookingQueueItem,
  type CookingQueueItem,
} from "@/utils/cookingQueue";
import {
  cancelCookingReminder,
  formatCookingReminderTime,
  getCookingReminderPresets,
  scheduleCookingReminder,
} from "@/utils/cookingReminders";
import { inferCategoryByName, inferIngredientDefaults } from "@/utils/ingredientRules";
import { ingredientNamesMatch, normalizeIngredientName } from "@/utils/ingredients";
import { normalizeShoppingItems } from "@/utils/shoppingList";

function getMissingIngredients(item: CookingQueueItem, inventory: InventoryItem[]) {
  return item.ingredients.filter((ingredient) => !inventory.some((stock) => (
    stock.is_available && ingredientNamesMatch(ingredient.name, stock.food_name)
  )));
}

export default function CookingQueueScreen() {
  const router = useSafeRouter();
  const { highlightRecipeId } = useSafeSearchParams<{ highlightRecipeId?: number }>();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const userId = user?.id;
  const [items, setItems] = useState<CookingQueueItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [shoppingSavingId, setShoppingSavingId] = useState<number | null>(null);
  const [reminderItem, setReminderItem] = useState<CookingQueueItem | null>(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Set<number>>(() => new Set());
  const dueAlertedRecipeId = useRef<number | null>(null);
  const initializedExpansion = useRef(false);

  const loadQueue = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setInventory([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [storedItems, inventoryItems] = await Promise.all([
        getCookingQueue(userId),
        inventoryApi.list(authFetch).catch(() => []),
      ]);
      const hydratedItems = await Promise.all(storedItems.map(async (item) => {
        if (item.ingredients.length) return item;
        try {
          const recipe = await recipesApi.detail(item.recipeId);
          return {
            ...item,
            title: recipe.title || item.title,
            imageUrl: recipe.image_url ?? item.imageUrl,
            cookTime: recipe.cook_time || item.cookTime,
            calories: recipe.calories || item.calories,
            difficulty: recipe.difficulty || item.difficulty,
            ingredients: (recipe.ingredients || []).map((ingredient) => ({
              name: ingredient.name,
              amount: ingredient.amount || "适量",
            })),
          };
        } catch {
          return item;
        }
      }));
      if (hydratedItems.some((item, index) => item !== storedItems[index])) {
        await saveCookingQueue(userId, hydratedItems);
      }
      setItems(hydratedItems);
      setInventory(inventoryItems);
      if (!initializedExpansion.current && hydratedItems.length) {
        initializedExpansion.current = true;
        setExpandedRecipeIds(new Set([Number(highlightRecipeId) || hydratedItems[0].recipeId]));
      }

    } finally {
      setLoading(false);
    }
  }, [authFetch, highlightRecipeId, userId]);

  useFocusEffect(useCallback(() => { void loadQueue(); }, [loadQueue]));

  useEffect(() => {
    const dueItem = items.find((item) => item.reminderAt && item.reminderAt <= Date.now());
    if (!dueItem || dueAlertedRecipeId.current === dueItem.recipeId) return;
    dueAlertedRecipeId.current = dueItem.recipeId;
    Alert.alert("烹饪提醒", `计划烹饪【${dueItem.title}】的时间到了，现在开始准备吗？`, [
      { text: "稍后", style: "cancel" },
      { text: "开始烹饪", onPress: () => router.push("/cooking-mode", { recipeId: dueItem.recipeId, fromQueue: true }) },
    ]);
  }, [items, router]);

  const removeItem = async (item: CookingQueueItem) => {
    if (!userId) return;
    await cancelCookingReminder(item.reminderNotificationId);
    setItems(await removeFromCookingQueue(userId, item.recipeId));
  };

  const moveItem = async (item: CookingQueueItem, offset: -1 | 1) => {
    if (!userId) return;
    setItems(await moveCookingQueueItem(userId, item.recipeId, offset));
  };

  const toggleIngredientPrepared = async (item: CookingQueueItem, ingredientName: string) => {
    if (!userId) return;
    const normalizedTarget = normalizeIngredientName(ingredientName);
    const alreadyPrepared = item.preparedIngredientNames.some((name) => (
      normalizeIngredientName(name) === normalizedTarget
    ));
    const preparedIngredientNames = alreadyPrepared
      ? item.preparedIngredientNames.filter((name) => normalizeIngredientName(name) !== normalizedTarget)
      : [...item.preparedIngredientNames, ingredientName];
    setItems(await updateCookingQueueItem(userId, item.recipeId, { preparedIngredientNames }));
  };

  const toggleExpanded = (recipeId: number) => {
    setExpandedRecipeIds((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  };

  const startCooking = async (item: CookingQueueItem) => {
    if (!userId) return;
    await cancelCookingReminder(item.reminderNotificationId);
    const nextItems = await updateCookingQueueItem(userId, item.recipeId, {
      reminderAt: undefined,
      reminderNotificationId: undefined,
    });
    setItems(nextItems);
    router.push("/cooking-mode", { recipeId: item.recipeId, fromQueue: true });
  };

  const addMissingToShoppingList = async (item: CookingQueueItem) => {
    if (!userId || shoppingSavingId) return;
    const missing = getMissingIngredients(item, inventory);
    if (!missing.length) return;
    setShoppingSavingId(item.recipeId);
    try {
      const existing = normalizeShoppingItems(await shoppingListApi.list<unknown[]>(authFetch));
      const additions = missing.filter((ingredient) => !existing.some((shoppingItem) => (
        !shoppingItem.checked && ingredientNamesMatch(ingredient.name, shoppingItem.name)
      )));
      await Promise.all(additions.map((ingredient) => {
        const defaults = inferIngredientDefaults(ingredient.name);
        return shoppingListApi.create(authFetch, {
          clientId: `queue:${item.recipeId}:${normalizeIngredientName(ingredient.name)}`,
          name: ingredient.name,
          amount: ingredient.amount || "适量",
          category: inferCategoryByName(ingredient.name),
          checked: false,
          storageLocation: defaults.storageLocation,
        });
      }));
      const nextItems = await updateCookingQueueItem(userId, item.recipeId, { shoppingListSyncedAt: Date.now() });
      setItems(nextItems);
      Alert.alert(
        additions.length ? "已补入采购清单" : "采购清单已有这些食材",
        additions.length ? `已添加 ${additions.length} 种缺少食材。` : "没有重复添加，可直接查看采购清单。",
        [
          { text: "查看清单", onPress: () => router.push("/shopping-list") },
          { text: "好的", style: "cancel" },
        ],
      );
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : "采购清单暂时无法更新，请稍后重试。");
    } finally {
      setShoppingSavingId(null);
    }
  };

  const saveReminder = async (item: CookingQueueItem, date: Date) => {
    if (!userId || reminderSaving) return;
    setReminderSaving(true);
    try {
      await cancelCookingReminder(item.reminderNotificationId);
      const scheduled = await scheduleCookingReminder({
        recipeId: item.recipeId,
        recipeTitle: item.title,
        userId,
        date,
      });
      const nextItems = await updateCookingQueueItem(userId, item.recipeId, {
        reminderAt: date.getTime(),
        reminderNotificationId: scheduled.notificationId,
      });
      setItems(nextItems);
      setReminderItem(null);
      Alert.alert(
        "提醒已设置",
        scheduled.delivery === "device"
          ? `将在${formatCookingReminderTime(date)}提醒你开始烹饪。`
          : `已保存${formatCookingReminderTime(date)}的站内提醒；Web 端需打开应用后提示。`,
      );
    } catch (error) {
      Alert.alert("提醒设置失败", error instanceof Error ? error.message : "请检查系统通知权限后重试。");
    } finally {
      setReminderSaving(false);
    }
  };

  const clearReminder = async (item: CookingQueueItem) => {
    if (!userId) return;
    await cancelCookingReminder(item.reminderNotificationId);
    const nextItems = await updateCookingQueueItem(userId, item.recipeId, {
      reminderAt: undefined,
      reminderNotificationId: undefined,
    });
    setItems(nextItems);
    setReminderItem(null);
  };

  const confirmClear = () => {
    if (!userId || !items.length) return;
    Alert.alert("清空烹饪队列", "确定移除队列中的全部菜谱和烹饪提醒吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "清空",
        style: "destructive",
        onPress: () => void Promise.all(items.map((item) => cancelCookingReminder(item.reminderNotificationId)))
          .then(() => clearCookingQueue(userId))
          .then(() => setItems([])),
      },
    ]);
  };

  const readyCount = items.filter((item) => item.ingredients.length > 0 && getMissingIngredients(item, inventory).length === 0).length;
  const reminderCount = items.filter((item) => item.reminderAt && item.reminderAt > Date.now()).length;
  const totalCookTime = items.reduce((total, item) => total + item.cookTime, 0);

  return (
    <Screen backgroundColor="#F6F1E8" safeAreaEdges={["top", "bottom"]}>
      <View className="flex-row items-center border-b border-[#E8DFD2] bg-[#FFFDF9] px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="返回" className="h-10 w-10 items-center justify-center rounded-full bg-[#F2ECE3]">
          <FontAwesome6 name="chevron-left" size={14} color="#304238" />
        </TouchableOpacity>
        <View className="ml-3 flex-1">
          <Text className="text-lg font-black text-[#273A2E]">烹饪队列</Text>
          <Text className="mt-0.5 text-[11px] text-copy-muted">备料、提醒、开火，在这里一次安排好</Text>
        </View>
        {items.length ? <TouchableOpacity onPress={confirmClear} className="px-2 py-2"><Text className="text-xs font-bold text-[#A85A49]">清空</Text></TouchableOpacity> : null}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2D6A4F" /></View>
      ) : items.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="h-16 w-16 items-center justify-center rounded-[24px] bg-[#E5EFE7]"><FontAwesome6 name="list-check" size={24} color="#2D6A4F" /></View>
          <Text className="mt-5 text-lg font-black text-ink">队列还是空的</Text>
          <Text className="mt-2 text-center text-sm leading-6 text-copy-muted">在菜谱详情页加入想做的菜，之后可统一补齐食材、设置提醒并开始烹饪。</Text>
          <TouchableOpacity onPress={() => router.replace("/")} className="mt-6 rounded-2xl bg-brand px-6 py-3"><Text className="font-bold text-white">去找菜谱</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
          <View className="mb-4 w-full max-w-[760px] self-center flex-row rounded-[22px] bg-[#244D37] p-4">
            <QueueSummary value={items.length} label="待烹饪" />
            <QueueSummary value={totalCookTime} label="总分钟" />
            <QueueSummary value={readyCount} label="食材已齐" />
            <QueueSummary value={reminderCount} label="已设提醒" />
          </View>
          <View className="w-full max-w-[760px] self-center gap-3">
            {items.map((item, index) => {
              const missing = getMissingIngredients(item, inventory);
              const ingredientDataReady = item.ingredients.length > 0;
              const highlighted = Number(highlightRecipeId) === item.recipeId;
              const reminderDue = Boolean(item.reminderAt && item.reminderAt <= Date.now());
              const expanded = expandedRecipeIds.has(item.recipeId);
              const preparedCount = item.ingredients.filter((ingredient) => item.preparedIngredientNames.some((name) => (
                normalizeIngredientName(name) === normalizeIngredientName(ingredient.name)
              ))).length;
              const preparedPercent = ingredientDataReady ? Math.round((preparedCount / item.ingredients.length) * 100) : 0;
              const expectedFinishAt = item.reminderAt
                ? item.reminderAt + item.cookTime * 60 * 1000
                : null;
              return (
                <View key={item.recipeId} className={`overflow-hidden rounded-[22px] border bg-[#FFFDF9] ${highlighted ? "border-[#D49A2A]" : "border-[#E8DFD2]"}`}>
                  <View className="flex-row">
                    <View className="relative h-32 w-32 shrink-0">
                      <RecipeCover uri={item.imageUrl} className="h-full w-full" placeholderClassName="h-full w-full" />
                      <View className="absolute left-2 top-2 h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2"><Text className="text-[10px] font-black text-white">{index + 1}</Text></View>
                    </View>
                    <View className="min-w-0 flex-1 p-3.5">
                      <View className="flex-row items-start">
                        <Text className="min-w-0 flex-1 text-base font-black text-ink" numberOfLines={2}>{item.title}</Text>
                        {items.length > 1 ? (
                          <View className="ml-2 flex-row gap-1">
                            <TouchableOpacity onPress={() => void moveItem(item, -1)} disabled={index === 0} accessibilityLabel={`将${item.title}上移`} className="h-7 w-7 items-center justify-center rounded-lg bg-[#F2ECE3] disabled:opacity-30">
                              <FontAwesome6 name="arrow-up" size={9} color="#6E6256" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => void moveItem(item, 1)} disabled={index === items.length - 1} accessibilityLabel={`将${item.title}下移`} className="h-7 w-7 items-center justify-center rounded-lg bg-[#F2ECE3] disabled:opacity-30">
                              <FontAwesome6 name="arrow-down" size={9} color="#6E6256" />
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                      <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
                        <Text className="text-[10px] font-bold text-copy-muted">{item.cookTime} 分钟</Text>
                        <Text className="text-[10px] font-bold text-[#C26A4C]">{item.calories} kcal</Text>
                        <Text className={`text-[10px] font-black ${!ingredientDataReady || missing.length ? "text-[#A85A49]" : "text-brand"}`}>
                          {!ingredientDataReady ? "食材待同步" : missing.length ? `缺 ${missing.length} 种食材` : "食材已齐"}
                        </Text>
                      </View>
                      {item.reminderAt ? (
                        <TouchableOpacity onPress={() => setReminderItem(item)} className={`mt-2 flex-row items-center ${reminderDue ? "opacity-100" : "opacity-80"}`}>
                          <FontAwesome6 name={reminderDue ? "bell" : "clock"} size={10} color={reminderDue ? "#A63D2B" : "#6A765F"} />
                          <Text className={`ml-1.5 text-[10px] font-bold ${reminderDue ? "text-[#A63D2B]" : "text-[#596A5C]"}`}>
                            {reminderDue ? "计划时间已到" : formatCookingReminderTime(item.reminderAt)}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      <Text className="mt-2 text-[9px] font-medium text-copy-muted">
                        {expectedFinishAt
                          ? `按计划预计 ${formatCookingReminderTime(expectedFinishAt)} 完成`
                          : `开始后预计约 ${item.cookTime} 分钟完成`}
                      </Text>
                    </View>
                  </View>
                  <View className="border-t border-[#EFE7DC] px-3 py-3">
                    <View className="flex-row items-center justify-between">
                      <View>
                        <Text className="text-[10px] font-black text-ink">备料进度</Text>
                        <Text className="mt-0.5 text-[9px] text-copy-muted">
                          {ingredientDataReady ? `${preparedCount}/${item.ingredients.length} 种已备好` : "正在同步食材明细"}
                        </Text>
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <View className={`rounded-full px-2 py-1 ${missing.length ? "bg-[#F8E7DF]" : "bg-[#E4F0E7]"}`}>
                          <Text className={`text-[9px] font-black ${missing.length ? "text-[#A85A49]" : "text-brand"}`}>
                            {missing.length ? `采购 ${missing.length} 项` : "库存已齐"}
                          </Text>
                        </View>
                        <Text className="text-[10px] font-black text-brand">{preparedPercent}%</Text>
                      </View>
                    </View>
                    <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand/10">
                      <View className="h-full rounded-full bg-brand" style={{ width: `${preparedPercent}%` }} />
                    </View>

                    <TouchableOpacity onPress={() => toggleExpanded(item.recipeId)} className="mt-3 flex-row items-center justify-between rounded-xl bg-canvas px-3 py-2.5">
                      <View className="flex-row items-center">
                        <FontAwesome6 name="clipboard-check" size={11} color="#2D6A4F" />
                        <Text className="ml-2 text-[11px] font-black text-ink">备料清单与库存状态</Text>
                      </View>
                      <FontAwesome6 name={expanded ? "chevron-up" : "chevron-down"} size={9} color="#776C60" />
                    </TouchableOpacity>

                    {expanded ? (
                      <View className="mt-2 overflow-hidden rounded-2xl border border-[#E8DFD2] bg-white">
                        {ingredientDataReady ? item.ingredients.map((ingredient, ingredientIndex) => {
                          const prepared = item.preparedIngredientNames.some((name) => (
                            normalizeIngredientName(name) === normalizeIngredientName(ingredient.name)
                          ));
                          const inInventory = inventory.some((stock) => (
                            stock.is_available && ingredientNamesMatch(ingredient.name, stock.food_name)
                          ));
                          return (
                            <TouchableOpacity
                              key={`${ingredient.name}-${ingredientIndex}`}
                              onPress={() => void toggleIngredientPrepared(item, ingredient.name)}
                              className={`flex-row items-center px-3 py-3 ${ingredientIndex < item.ingredients.length - 1 ? "border-b border-[#F1EDE6]" : ""}`}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: prepared }}
                              accessibilityLabel={`${ingredient.name} ${ingredient.amount}`}
                            >
                              <View className={`h-5 w-5 items-center justify-center rounded-md border ${prepared ? "border-brand bg-brand" : "border-[#CFC5B7] bg-white"}`}>
                                {prepared ? <FontAwesome6 name="check" size={9} color="#FFFFFF" /> : null}
                              </View>
                              <View className="ml-2.5 min-w-0 flex-1">
                                <Text className={`text-[11px] font-bold ${prepared ? "text-copy-muted line-through" : "text-ink"}`}>{ingredient.name}</Text>
                                <Text className="mt-0.5 text-[9px] text-copy-muted">{ingredient.amount}</Text>
                              </View>
                              <View className={`rounded-full px-2 py-1 ${inInventory ? "bg-[#E4F0E7]" : "bg-[#F8E7DF]"}`}>
                                <Text className={`text-[9px] font-black ${inInventory ? "text-brand" : "text-[#A85A49]"}`}>
                                  {inInventory ? "库存已有" : "仍需采购"}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        }) : (
                          <View className="items-center px-4 py-5"><Text className="text-[10px] text-copy-muted">食材详情暂时无法读取，请稍后刷新。</Text></View>
                        )}
                      </View>
                    ) : null}

                    <View className="mt-3 flex-row gap-2">
                      {ingredientDataReady && missing.length ? (
                        <TouchableOpacity onPress={() => void addMissingToShoppingList(item)} disabled={shoppingSavingId === item.recipeId} className="h-10 flex-1 flex-row items-center justify-center rounded-xl bg-[#F5EEDD] disabled:opacity-60">
                          {shoppingSavingId === item.recipeId ? <ActivityIndicator size="small" color="#80682D" /> : <FontAwesome6 name="basket-shopping" size={11} color="#80682D" />}
                          <Text className="ml-1.5 text-[11px] font-black text-[#80682D]">{item.shoppingListSyncedAt ? "核对采购" : "补齐采购"}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity onPress={() => setReminderItem(item)} className="h-10 flex-1 flex-row items-center justify-center rounded-xl bg-[#E8F0E9]">
                        <FontAwesome6 name="bell" size={11} color="#2D6A4F" />
                        <Text className="ml-1.5 text-[11px] font-black text-brand">{item.reminderAt ? "调整提醒" : "提醒我"}</Text>
                      </TouchableOpacity>
                    </View>
                    <View className="mt-2 flex-row gap-2">
                      <TouchableOpacity onPress={() => router.push("/recipe-detail", { id: item.recipeId })} className="h-10 flex-1 flex-row items-center justify-center rounded-xl border border-line bg-white">
                        <FontAwesome6 name="book-open" size={11} color="#5D685F" />
                        <Text className="ml-1.5 text-[11px] font-black text-[#5D685F]">查看菜谱</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void startCooking(item)} className="h-10 flex-[1.4] flex-row items-center justify-center rounded-xl bg-brand">
                        <FontAwesome6 name="kitchen-set" size={11} color="#FFFFFF" />
                        <Text className="ml-1.5 text-[11px] font-black text-white">开始烹饪</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => void removeItem(item)} accessibilityLabel={`从队列移除${item.title}`} className="h-10 w-10 items-center justify-center rounded-xl bg-[#F2ECE3]">
                        <FontAwesome6 name="trash-can" size={11} color="#8B6F63" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      <Modal visible={Boolean(reminderItem)} animationType="fade" transparent onRequestClose={() => setReminderItem(null)}>
        <View className="flex-1 justify-end bg-black/45">
          <View className="rounded-t-[30px] bg-[#FFFDF9] px-5 pb-8 pt-5">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="flex-1 pr-4">
                <Text className="text-lg font-black text-ink">设置烹饪提醒</Text>
                <Text className="mt-1 text-xs text-copy-muted" numberOfLines={1}>{reminderItem?.title}</Text>
              </View>
              <TouchableOpacity onPress={() => setReminderItem(null)} className="h-9 w-9 items-center justify-center rounded-full bg-[#F2ECE3]"><FontAwesome6 name="xmark" size={14} color="#776C60" /></TouchableOpacity>
            </View>
            <View className="gap-2">
              {getCookingReminderPresets().map((preset) => (
                <TouchableOpacity key={preset.key} onPress={() => reminderItem && void saveReminder(reminderItem, preset.date)} disabled={reminderSaving} className="flex-row items-center rounded-2xl border border-[#E8DFD2] bg-white px-4 py-3.5 disabled:opacity-60">
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#E8F0E9]"><FontAwesome6 name="clock" size={13} color="#2D6A4F" /></View>
                  <Text className="ml-3 flex-1 text-sm font-black text-ink">{preset.label}</Text>
                  <Text className="text-xs font-bold text-copy-muted">{preset.detail}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {reminderItem?.reminderAt ? (
              <TouchableOpacity onPress={() => void clearReminder(reminderItem)} disabled={reminderSaving} className="mt-3 items-center py-3"><Text className="text-xs font-bold text-[#A85A49]">取消当前提醒</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function QueueSummary({ value, label }: { value: number; label: string }) {
  return (
    <View className="flex-1 items-center border-r border-white/15 last:border-r-0">
      <Text className="text-xl font-black text-white">{value}</Text>
      <Text className="mt-0.5 text-[10px] font-bold text-white/70">{label}</Text>
    </View>
  );
}
