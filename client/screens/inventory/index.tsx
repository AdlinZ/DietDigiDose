import { useState, useEffect, useCallback, useRef } from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  DeviceEventEmitter,
  Platform,
  PanResponder,
  useWindowDimensions,
} from "react-native";
import { Screen } from "@/components/Screen";
import { RecipeCover } from "@/components/RecipeCover";
import { useFocusEffect } from "expo-router";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import { SmartDateInput } from "@/components/SmartDateInput";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  getUserStorageKey,
} from "@/utils/userStorage";
import { dateKeyAfterDays } from "@/utils/date";
import { daysUntilDateKey, getExpirationBadgeConfig, getInventoryStatus } from "@/utils/inventory";
import { aiApi, foodsApi, householdApi, inventoryApi, kitchenwareApi, type Household, type HouseholdActivityLog, type HouseholdInventoryItem } from "@/services/api";
import type { DetectedFood, InventoryItem, KitchenwareCatalogItem, KitchenwareItem, StorageLocation } from "./types";
import { inferFoodCategory, MAX_AI_IMAGE_BASE64_LENGTH, normalizeDetectedFoods } from "./scan";
import { useInventoryData } from "./useInventoryData";
import { normalizeShoppingItems } from "@/utils/shoppingList";
import { analyzeRecipeInventoryMatch, filterAndRankRecipes, filterInventoryItems, filterKitchenware, recipeMatchesInventory } from "./selectors";
import { BatchReviewModal, CatalogDetailModal, InventoryHistoryModal, QuickAddPresetChips } from "./InventoryModals";
import { FamilyShareModal } from "./FamilyShareModal";
import {
  addInventoryLog,
  clearInventoryHistory,
  getInventoryHistory,
  type InventoryLogEntry,
} from "@/utils/inventoryHistory";
import { scheduleExpiringStockAlerts } from "@/utils/notifications";
import {
  COMMON_INGREDIENTS,
  inferCategoryByName,
  inferIngredientDefaults,
  inferShelfLifeDays,
  searchCommonIngredients,
  type CommonIngredient,
} from "@/utils/ingredientRules";

const KITCHENWARE_STARTER_KITS = [
  { name: "轻食减脂", items: ["空气炸锅", "平底锅", "电子秤", "玻璃保鲜盒"] },
  { name: "中式家常", items: ["炒锅", "汤锅", "蒸锅", "菜刀", "砧板"] },
  { name: "烘焙入门", items: ["烤箱", "烤盘", "蛋糕模具", "打蛋器", "硅胶刮刀"] },
] as const;

export default function InventoryScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const noticeCardWidth = Math.max(windowWidth - 40, 280);
  const [inventoryGridWidth, setInventoryGridWidth] = useState(0);
  const inventoryCardWidth = inventoryGridWidth > 0
    ? Math.floor((inventoryGridWidth - 10) / 2)
    : undefined;
  const router = useSafeRouter();
  const { action } = useSafeSearchParams<{ action?: string }>();
  const { isAuthenticated, user } = useAuth();
  const inventoryScanJobStorageKey = getUserStorageKey(
    INVENTORY_SCAN_JOB_STORAGE_KEY,
    user?.id,
  );
  const authFetch = useAuthFetch();
  const {
    items,
    setItems,
    recipes,
    kitchenware,
    kitchenwareCatalog,
    loadingItems,
    loadingRecipes,
    loadingKitchenware,
    sectionErrors,
    refresh: fetchData,
  } = useInventoryData(authFetch, isAuthenticated, user?.id);

  // Top Level Segment State
  const [activeSegment, setActiveSegment] = useState<"inventory" | "recipes" | "kitchenware">("inventory");

  // Kitchenware State
  const [activeKitchenwareCategory, setActiveKitchenwareCategory] = useState("全部");
  const [kitchenwareModalVisible, setKitchenwareModalVisible] = useState(false);
  const [editingKitchenware, setEditingKitchenware] = useState<KitchenwareItem | null>(null);
  const [kwName, setKwName] = useState("");
  const [kwCategory, setKwCategory] = useState("小家电");
  const [kwStatus, setKwStatus] = useState("良好");
  const [kwNote, setKwNote] = useState("");
  const [kwImageUrl, setKwImageUrl] = useState("");
  const [kwPurchaseDate, setKwPurchaseDate] = useState("");
  const [savingKitchenware, setSavingKitchenware] = useState(false);
  const [selectedCatalogKitchenware, setSelectedCatalogKitchenware] = useState<KitchenwareCatalogItem | null>(null);
  const [addingStarterKit, setAddingStarterKit] = useState<string | null>(null);

  const openKitchenwareModal = (item?: KitchenwareItem) => {
    setEditingKitchenware(item || null);
    setKwName(item?.name || "");
    setKwCategory(item?.category || "小家电");
    setKwStatus(item?.status || "良好");
    setKwNote(item?.note || "");
    setKwImageUrl(item?.image_url || "");
    setKwPurchaseDate(item?.purchase_date || "");
    setKitchenwareModalVisible(true);
  };

  const handleSaveKitchenware = async () => {
    if (!kwName.trim()) {
      Alert.alert("提示", "请输入厨具名称");
      return;
    }
    try {
      setSavingKitchenware(true);
      const payload = {
          name: kwName,
          category: kwCategory,
          status: kwStatus,
          note: kwNote,
          image_url: kwImageUrl.trim() || null,
          purchase_date: kwPurchaseDate || null,
      };
      if (editingKitchenware) await kitchenwareApi.update(authFetch, editingKitchenware.id, payload);
      else await kitchenwareApi.create(authFetch, payload);
      setKitchenwareModalVisible(false);
      await fetchData();
      Alert.alert("保存成功", `厨具【${kwName}】已保存到我的装备库。`);
    } catch {
      Alert.alert("保存失败", "网络异常，请稍后重试");
    } finally {
      setSavingKitchenware(false);
    }
  };

  const addCatalogKitchenware = async (item: KitchenwareCatalogItem) => {
    if (kitchenware.some((owned) => owned.name === item.name)) {
      Alert.alert("已在装备库", `你已录入【${item.name}】。`);
      return;
    }
    try {
      setSavingKitchenware(true);
      await kitchenwareApi.create(authFetch, {
        name: item.name, category: item.category, status: "良好", note: item.care_note || "", image_url: null, purchase_date: null,
      });
      setSelectedCatalogKitchenware(null);
      await fetchData();
      Alert.alert("已加入装备库", `已添加【${item.name}】，现在可用于食谱匹配和保养提醒。`);
    } catch {
      Alert.alert("添加失败", "网络异常，请稍后重试");
    } finally {
      setSavingKitchenware(false);
    }
  };

  const addStarterKit = async (kit: typeof KITCHENWARE_STARTER_KITS[number]) => {
    const targets = kitchenwareCatalog.filter((item) => kit.items.some((name) => name === item.name) && !kitchenware.some((owned) => owned.name === item.name));
    if (!targets.length) {
      Alert.alert("已配置完成", `「${kit.name}」套装中的厨具已都在你的装备库。`);
      return;
    }
    try {
      setAddingStarterKit(kit.name);
      await Promise.all(targets.map((item) => kitchenwareApi.create(authFetch, {
        name: item.name, category: item.category, status: "良好", note: item.care_note || "", image_url: null, purchase_date: null,
      })));
      await fetchData();
      Alert.alert("套装已加入", `已将 ${targets.length} 件「${kit.name}」装备加入你的资产库。`);
    } catch {
      Alert.alert("添加失败", "部分厨具可能未保存，请刷新后重试。");
    } finally {
      setAddingStarterKit(null);
    }
  };

  // Inventory State
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const dragPan = useRef(new Animated.ValueXY()).current;
  const longPressedItemId = useRef<number | null>(null);
  const storageFolderRefs = useRef<Partial<Record<StorageLocation, View | null>>>({});
  const [activeInventoryCategory, setActiveInventoryCategory] = useState("全部");
  const [activeNoticeSlide, setActiveNoticeSlide] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [entryMode, setEntryMode] = useState<"choose" | "manual">("choose");

  // Form State for Inventory Item
  const [foodName, setFoodName] = useState("");
  const [category, setCategory] = useState("蔬菜");
  const [quantity, setQuantity] = useState("1份");
  const [expirationDate, setExpirationDate] = useState(
    dateKeyAfterDays(7)
  );
  const [storageLocation, setStorageLocation] = useState("冷藏");
  const [imageUrl, setImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [batchReviewVisible, setBatchReviewVisible] = useState(false);
  const [detectedFoods, setDetectedFoods] = useState<DetectedFood[]>([]);
  const [savingDetectedFoods, setSavingDetectedFoods] = useState(false);
  const [pendingScanJobId, setPendingScanJobId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; category?: string }>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  // Recipe Filter State (Phase 2: 今天吃什么)
  const [cookTimeLimit, setCookTimeLimit] = useState<number>(0);
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>("全部");

  // Inventory Maintenance State (Phase 3: 扣减、过期清理、操作历史、提醒)
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyLogs, setHistoryLogs] = useState<InventoryLogEntry[]>([]);
  const [clearingExpired, setClearingExpired] = useState(false);

  // Household Family Sharing State (Phase 5)
  const [familyModalVisible, setFamilyModalVisible] = useState(false);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeHousehold, setActiveHousehold] = useState<Household | null>(null);

  const refreshHouseholds = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const list = await householdApi.mine(authFetch);
      setHouseholds(list);
    } catch {
      // ignore
    }
  }, [authFetch, isAuthenticated]);

  useEffect(() => {
    void refreshHouseholds();
  }, [refreshHouseholds]);

  const loadFamilyInventory = useCallback(async () => {
    if (!activeHousehold || !isAuthenticated) return;
    try {
      const familyItems = await householdApi.inventoryList(authFetch, activeHousehold.id);
      const mapped: InventoryItem[] = familyItems.map((fi: HouseholdInventoryItem) => ({
        id: fi.id,
        user_id: fi.created_by_user_id,
        food_name: fi.food_name,
        category: fi.category,
        quantity: fi.quantity,
        expiration_date: fi.expiration_date,
        storage_location: fi.storage_location as StorageLocation,
        image_url: fi.image_url || null,
        is_available: fi.is_available,
        scope: "shared",
        created_at: fi.created_at,
        creator_name: fi.creator_name,
      }));
      setItems(mapped);
    } catch {
      // ignore
    }
  }, [activeHousehold, authFetch, isAuthenticated, setItems]);

  useEffect(() => {
    if (activeHousehold) {
      void loadFamilyInventory();
    } else {
      void fetchData();
    }
  }, [activeHousehold, loadFamilyInventory, fetchData]);

  useEffect(() => {
    if (items.length > 0) {
      void scheduleExpiringStockAlerts(items);
    }
  }, [items]);

  const openHistoryModal = async () => {
    if (activeHousehold) {
      try {
        const familyLogs = await householdApi.historyList(authFetch, activeHousehold.id);
        const mappedLogs: InventoryLogEntry[] = familyLogs.map((l: HouseholdActivityLog) => ({
          id: String(l.id),
          foodName: `${l.food_name} (@${l.operator_name || "成员"})`,
          action: l.action,
          quantity: l.quantity,
          storageLocation: l.storage_location,
          timestamp: Date.parse(l.created_at) || Date.now(),
        }));
        setHistoryLogs(mappedLogs);
      } catch {
        setHistoryLogs([]);
      }
    } else {
      const logs = await getInventoryHistory(user?.id);
      setHistoryLogs(logs);
    }
    setHistoryModalVisible(true);
  };

  const handleClearHistory = async () => {
    if (!activeHousehold) {
      await clearInventoryHistory(user?.id);
    }
    setHistoryLogs([]);
  };

  const handleQuickConsumeItem = async (item: InventoryItem) => {
    Alert.alert("确认用完", `是否将【${item.food_name}】标记为已用完并移出保鲜库？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认用完",
        style: "destructive",
        onPress: async () => {
          try {
            if (activeHousehold) {
              await householdApi.inventoryRemove(authFetch, activeHousehold.id, item.id);
              await loadFamilyInventory();
            } else {
              await inventoryApi.remove(authFetch, item.id);
              await addInventoryLog(
                {
                  foodName: item.food_name,
                  action: "consume",
                  quantity: item.quantity,
                  storageLocation: item.storage_location,
                },
                user?.id
              );
              await fetchData();
            }
          } catch {
            Alert.alert("错误", "操作失败，请重试。");
          }
        },
      },
    ]);
  };

  const handleBatchClearExpired = async () => {
    const expiredItems = items.filter((item) => {
      const status = getInventoryStatus(item);
      return status.freshness === "expired";
    });

    if (expiredItems.length === 0) return;

    Alert.alert("确认清理", `确定要批量清理 ${expiredItems.length} 种已过期的食材吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "一键清理",
        style: "destructive",
        onPress: async () => {
          setClearingExpired(true);
          try {
            await Promise.allSettled(
              expiredItems.map(async (item) => {
                if (activeHousehold) {
                  await householdApi.inventoryRemove(authFetch, activeHousehold.id, item.id);
                } else {
                  await inventoryApi.remove(authFetch, item.id);
                  await addInventoryLog(
                    {
                      foodName: item.food_name,
                      action: "expire_clear",
                      quantity: item.quantity,
                      storageLocation: item.storage_location,
                    },
                    user?.id
                  );
                }
              })
            );
            if (activeHousehold) {
              await loadFamilyInventory();
            } else {
              await fetchData();
            }
            Alert.alert("清理完成", `已将 ${expiredItems.length} 种已过期食材移除保鲜库。`);
          } catch {
            Alert.alert("部分清理失败", "请稍后重试。");
          } finally {
            setClearingExpired(false);
          }
        },
      },
    ]);
  };

  const handleAddMissingFromCard = async (recipeTitle: string, missingItems: Array<{ name: string; amount?: string }>) => {
    if (!missingItems.length) return;
    try {
      const shoppingKey = getUserStorageKey("shopping_list", user?.id);
      const existingStr = shoppingKey ? await AsyncStorage.getItem(shoppingKey) : null;
      const existing = existingStr ? JSON.parse(existingStr) : [];
      const normalized = normalizeShoppingItems(existing);
      const existingNames = new Set(normalized.map((i) => i.name));

      const newItems = missingItems
        .filter((item) => !existingNames.has(item.name))
        .map((item, idx) => ({
          id: `recipe-missing-${Date.now()}-${idx}`,
          name: item.name,
          amount: item.amount || "适量",
          category: inferCategoryByName(item.name),
          checked: false,
          createdAt: Date.now(),
        }));

      if (newItems.length === 0) {
        Alert.alert("已在采购清单", "缺失食材已在你的采购清单中。");
        return;
      }

      const updated = [...newItems, ...normalized];
      if (shoppingKey) {
        await AsyncStorage.setItem(shoppingKey, JSON.stringify(updated));
      }
      Alert.alert("已加入采购清单", `已为【${recipeTitle}】将 ${newItems.length} 种缺少食材加入采购清单！`, [
        { text: "查看清单", onPress: () => router.push("/shopping-list") },
        { text: "好的", style: "cancel" },
      ]);
    } catch {
      Alert.alert("添加失败", "保存采购清单失败，请重试。");
    }
  };

  const applyIngredientDefaults = (name: string, explicitLocation?: StorageLocation) => {
    const defaults = inferIngredientDefaults(name, explicitLocation || (storageLocation as StorageLocation));
    setFoodName(name);
    setCategory(defaults.category);
    setStorageLocation(defaults.storageLocation);
    setExpirationDate(defaults.expirationDate);
    setQuantity(defaults.defaultQuantity);
    setSuggestions([]);
  };

  const handleFoodNameChange = (text: string) => {
    setFoodName(text);
    if (!text.trim()) {
      setSuggestions([]);
      return;
    }
    const local = searchCommonIngredients(text).map((item) => ({ name: item.name, category: item.category }));
    setSuggestions(local);
  };

  useEffect(() => {
    if (foodName.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        setLoadingSuggestions(true);
        const remote = await foodsApi.search<{ name: string; category?: string }>(foodName.trim());
        if (active && Array.isArray(remote) && remote.length > 0) {
          setSuggestions((prev) => {
            const names = new Set(prev.map((p) => p.name));
            const newItems = remote.filter((r) => r.name && !names.has(r.name)).slice(0, 5);
            return [...prev, ...newItems];
          });
        }
      } catch {
        // ignore network failure
      } finally {
        if (active) setLoadingSuggestions(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [foodName]);

  const handleStorageLocationChange = (newLoc: StorageLocation) => {
    setStorageLocation(newLoc);
    if (foodName.trim()) {
      const days = inferShelfLifeDays(foodName.trim(), newLoc);
      setExpirationDate(dateKeyAfterDays(days));
    }
  };

  const handleAddPresetToBatch = (preset: CommonIngredient) => {
    const defaults = inferIngredientDefaults(preset.name);
    const newItem: DetectedFood = {
      id: `batch-${Date.now()}-${Math.random()}`,
      foodName: preset.name,
      quantity: preset.defaultQuantity,
      suggestedStorageLocation: defaults.storageLocation,
      estimatedExpireDays: defaults.shelfLifeDays,
      selected: true,
    };
    setDetectedFoods((prev) => [newItem, ...prev]);
  };

  useEffect(() => {
    if (isAuthenticated) return;
    setModalVisible(false);
    setBatchReviewVisible(false);
    setKitchenwareModalVisible(false);
    setSelectedCatalogKitchenware(null);
  }, [isAuthenticated]);

  const suggestedDate = (days: number) => dateKeyAfterDays(days);

  const getScanJob = async (jobId: string) => {
    return aiApi.inventoryScan<{ status: string; items?: unknown; error?: string }>(authFetch, jobId);
  };

  const waitForScanJob = async (jobId: string): Promise<DetectedFood[]> => {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const job = await getScanJob(jobId);
      if (job.status === "completed") {
        return normalizeDetectedFoods(job.items);
      }
      if (job.status === "failed") {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
        throw new Error(job.error || "识别失败，请换一张更清晰的图片重试");
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("识别仍在后台进行。你可以关闭窗口或退出 App，稍后回到库存页即可继续查看结果。");
  };

  const startScanConversation = async (base64: string, imageUri: string) => {
    if (base64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
      throw new Error("图片文件过大，请裁剪到只保留订单或商品区域后重试。");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const data = await aiApi.createInventoryScan<{ jobId?: string }>(authFetch, base64, controller.signal);
      if (!data.jobId) throw new Error("AI 识别任务创建失败，请稍后重试");

      setPendingScanJobId(data.jobId);
      if (inventoryScanJobStorageKey) {
        await AsyncStorage.setItem(inventoryScanJobStorageKey, data.jobId);
      }
      setModalVisible(false);
      router.push("/ai-assistant", {
        inventory_scan_job_id: data.jobId,
        inventory_scan_image_uri: imageUri,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("图片上传等待超时，请检查网络后重试。");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  useEffect(() => {
    setPendingScanJobId(null);
    if (!isAuthenticated || !inventoryScanJobStorageKey) return;
    let active = true;
    const restorePendingScan = async () => {
      const jobId = await AsyncStorage.getItem(inventoryScanJobStorageKey);
      if (!jobId || !active) return;
      setPendingScanJobId(jobId);
      setScanningReceipt(true);
      try {
        const job = await getScanJob(jobId);
        if (!active) return;
        if (job.status === "completed") {
          presentRecognition(normalizeDetectedFoods(job.items), true);
        } else if (job.status === "failed") {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
          setPendingScanJobId(null);
          Alert.alert("上次图片识别失败", job.error || "请换一张更清晰的图片重试。");
        } else {
          const recognized = await waitForScanJob(jobId);
          if (active) presentRecognition(recognized, true);
        }
      } catch {
        // Keep the job id: a temporary network failure must not discard a recoverable result.
      } finally {
        if (active) setScanningReceipt(false);
      }
    };
    void restorePendingScan();
    return () => { active = false; };
  }, [isAuthenticated, inventoryScanJobStorageKey]);

  const presentRecognition = (recognized: DetectedFood[], openManualForm = false) => {
    if (recognized.length === 0) {
      Alert.alert("暂未识别到食材", "请确认图片清晰、商品名称可见；你也可以改为手动录入。");
      return;
    }
    if (recognized.length === 1) {
      const suggestion = recognized[0];
      setFoodName(suggestion.foodName);
      setCategory(inferFoodCategory(suggestion.foodName));
      setQuantity(suggestion.quantity);
      setStorageLocation(suggestion.suggestedStorageLocation);
      setExpirationDate(suggestedDate(suggestion.estimatedExpireDays));
      setEntryMode("manual");
      if (openManualForm) setModalVisible(true);
      Alert.alert("AI 已补全", "已填写食材名称、数量、存放位置和建议到期日；请确认后入库。");
      return;
    }

    setDetectedFoods(recognized);
    setModalVisible(false);
    setBatchReviewVisible(true);
  };

  const openPendingScanResult = async () => {
    if (!pendingScanJobId) return;
    setScanningReceipt(true);
    try {
      const job = await getScanJob(pendingScanJobId);
      if (job.status === "completed") {
        presentRecognition(normalizeDetectedFoods(job.items), true);
      } else if (job.status === "failed") {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
        Alert.alert("图片识别失败", job.error || "请换一张更清晰的图片重试。");
      } else {
        presentRecognition(await waitForScanJob(pendingScanJobId), true);
      }
    } catch (error) {
      Alert.alert("识别仍在处理中", error instanceof Error ? error.message : "请稍后再查看结果。");
    } finally {
      setScanningReceipt(false);
    }
  };

  const saveDetectedFoods = async () => {
    const selectedFoods = detectedFoods.filter((item) => item.selected);
    if (selectedFoods.length === 0) {
      Alert.alert("请至少选择一项", "勾选需要加入食材库的食材后再保存。");
      return;
    }

    setSavingDetectedFoods(true);
    try {
      const itemsToImport = selectedFoods.map((item) => {
        const defaults = inferIngredientDefaults(item.foodName, item.suggestedStorageLocation as StorageLocation);
        return {
          food_name: item.foodName,
          category: defaults.category,
          quantity: item.quantity || defaults.defaultQuantity,
          expiration_date: suggestedDate(item.estimatedExpireDays) || defaults.expirationDate,
          storage_location: item.suggestedStorageLocation || defaults.storageLocation,
          image_url: null,
        };
      });

      const idempotencyKey = `batch-import-${Date.now()}`;
      await inventoryApi.importShoppingList(authFetch, idempotencyKey, itemsToImport);
      for (const item of itemsToImport) {
        await addInventoryLog({ foodName: item.food_name, action: "add", quantity: item.quantity, storageLocation: item.storage_location }, user?.id);
      }
      await fetchData();

      if (inventoryScanJobStorageKey) {
        await AsyncStorage.removeItem(inventoryScanJobStorageKey);
      }
      setPendingScanJobId(null);
      setBatchReviewVisible(false);
      Alert.alert("已一键批量入库", `已成功将 ${itemsToImport.length} 种食材导入你的保鲜库！`);
    } catch {
      Alert.alert("批量入库失败", "网络异常，请稍后重试。");
    } finally {
      setSavingDetectedFoods(false);
    }
  };

  const selectFoodPhoto = async (source: "camera" | "library", useAiAssist = false) => {
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("需要相机权限", "允许相机权限后，即可直接拍摄食材照片。");
          return;
        }
      }

      const result = source === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.45, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.45, base64: true });
      const asset = result.assets?.[0];
      if (result.canceled || !asset?.base64) return;

      const imageData = `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
      setImageUrl(imageData);
      if (!useAiAssist) return;

      setAiAssisting(true);
      await startScanConversation(asset.base64, asset.uri);
    } catch (error) {
      Alert.alert("图片识别失败", error instanceof Error ? error.message : "请检查网络或重新拍摄一张清晰的食材照片。");
    } finally {
      setAiAssisting(false);
    }
  };

  const openAiFoodAssist = () => {
    // React Native 的 Alert 在 Web 端没有稳定的操作按钮支持；浏览器里直接打开相册选择器。
    if (Platform.OS === "web") {
      void selectFoodPhoto("library", true);
      return;
    }
    Alert.alert("AI 辅助录入", "单个食材、购物清单或订单截图都可以。识别出多项时，你可以逐项确认后批量入库。", [
      { text: "取消", style: "cancel" },
      { text: "相册选择", onPress: () => selectFoodPhoto("library", true) },
      { text: "现在拍照", onPress: () => selectFoodPhoto("camera", true) },
    ]);
  };

  const handleScanReceiptAndBatchAdd = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      setScanningReceipt(true);
      await startScanConversation(result.assets[0].base64, result.assets[0].uri);
    } catch (error) {
      Alert.alert("图片识别失败", error instanceof Error ? error.message : "小票识别过程出现错误");
    } finally {
      setScanningReceipt(false);
    }
  };

  // Recipe State
  const [activeRecipeCategory, setActiveRecipeCategory] = useState("全部");
  const [recipeSearchQuery, setRecipeSearchQuery] = useState("");
  const [visibleRecipeCount, setVisibleRecipeCount] = useState(12);

  useEffect(() => {
    setVisibleRecipeCount(12);
  }, [activeRecipeCategory, recipeSearchQuery]);

  const inventoryCategories = ["全部", "家庭共享", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"];
  const recipeCategories = ["全部", "减脂", "增肌", "营养餐单", "快手菜"];

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const openAddModal = useCallback(() => {
    if (!isAuthenticated) {
      Alert.alert("登录后录入食材", "登录后才能保存和管理你的食材。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login") },
      ]);
      return;
    }
    setEditingItem(null);
    setFoodName("");
    setCategory("蔬菜");
    setQuantity("100g");
    setExpirationDate(dateKeyAfterDays(5));
    setStorageLocation("冷藏");
    setImageUrl("");
    setEntryMode("choose");
    setModalVisible(true);
  }, [isAuthenticated, router]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("open-add-food", () => {
      setActiveSegment("inventory");
      openAddModal();
    });
    return () => sub.remove();
  }, [openAddModal]);

  useEffect(() => {
    if (action !== "add") return;
    setActiveSegment("inventory");
    openAddModal();
    router.setParams({ action: undefined });
  }, [action, openAddModal]);

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFoodName(item.food_name);
    setCategory(item.category);
    setQuantity(item.quantity);
    setExpirationDate(item.expiration_date);
    setStorageLocation(item.storage_location);
    setImageUrl(item.image_url || "");
    setEntryMode("manual");
    setModalVisible(true);
  };

  const handleSaveItem = async () => {
    if (!isAuthenticated) {
      setModalVisible(false);
      Alert.alert("请先登录", "登录后才能将食材保存到食材库。", [
        { text: "取消", style: "cancel" },
        { text: "去登录", onPress: () => router.push("/login") },
      ]);
      return;
    }
    if (!foodName.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        food_name: foodName,
        category,
        quantity,
        expiration_date: expirationDate,
        storage_location: storageLocation,
        image_url: imageUrl.trim() || null,
      };

      if (activeHousehold && editingItem) {
        await householdApi.inventoryUpdate(authFetch, activeHousehold.id, editingItem.id, payload);
        await loadFamilyInventory();
      } else if (activeHousehold) {
        await householdApi.inventoryCreate(authFetch, activeHousehold.id, payload);
        await loadFamilyInventory();
      } else if (editingItem) {
        await inventoryApi.update(authFetch, editingItem.id, payload);
        await addInventoryLog({ foodName: payload.food_name, action: "edit", quantity: payload.quantity, storageLocation: payload.storage_location }, user?.id);
        await fetchData();
      } else {
        await inventoryApi.create(authFetch, payload);
        await addInventoryLog({ foodName: payload.food_name, action: "add", quantity: payload.quantity, storageLocation: payload.storage_location }, user?.id);
        await fetchData();
      }
      if (!editingItem && pendingScanJobId) {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
      }
      setModalVisible(false);
    } catch (e) {
      Alert.alert("错误", "网络异常");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteItem = (id: number) => {
    Alert.alert("确认删除", "确定要移除该食材吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            if (activeHousehold) {
              await householdApi.inventoryRemove(authFetch, activeHousehold.id, id);
              await loadFamilyInventory();
            } else {
              await inventoryApi.remove(authFetch, id);
              await fetchData();
            }
            setModalVisible(false);
            setEditingItem(null);
          } catch (e) {
            console.error(e);
          }
        },
      },
    ]);
  };

  const getStorageLocationAtPoint = useCallback((pageX: number, pageY: number) => {
    return new Promise<StorageLocation | null>((resolve) => {
      const folders = Object.entries(storageFolderRefs.current) as Array<[StorageLocation, View | null]>;
      const measurableFolders = folders.filter(([, folder]) => folder);
      if (measurableFolders.length === 0) {
        resolve(null);
        return;
      }

      let remaining = measurableFolders.length;
      let destination: StorageLocation | null = null;
      measurableFolders.forEach(([location, folder]) => {
        folder?.measureInWindow((x, y, width, height) => {
          if (pageX >= x && pageX <= x + width && pageY >= y && pageY <= y + height) {
            destination = location;
          }
          remaining -= 1;
          if (remaining === 0) resolve(destination);
        });
      });
    });
  }, []);

  const moveItemToStorage = useCallback(async (item: InventoryItem, storageLocation: StorageLocation) => {
    if (item.storage_location === storageLocation) return;

    const previousLocation = item.storage_location;
    setItems((currentItems) =>
      currentItems.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, storage_location: storageLocation } : currentItem,
      ),
    );

    try {
      if (activeHousehold) {
        await householdApi.inventoryUpdate(authFetch, activeHousehold.id, item.id, { storage_location: storageLocation });
      } else {
        await inventoryApi.update(authFetch, item.id, { storage_location: storageLocation });
      }
    } catch {
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, storage_location: previousLocation } : currentItem,
        ),
      );
      Alert.alert("移动失败", "未能更新食材的存放位置，请稍后重试。");
    }
  }, [activeHousehold, authFetch]);

  const handleItemDrop = useCallback(async (item: InventoryItem, pageX: number, pageY: number) => {
    const destination = await getStorageLocationAtPoint(pageX, pageY);
    longPressedItemId.current = null;
    setDraggedItemId(null);
    dragPan.setValue({ x: 0, y: 0 });
    if (destination) await moveItemToStorage(item, destination);
  }, [dragPan, getStorageLocationAtPoint, moveItemToStorage]);

  const handleItemLongPress = (itemId: number) => {
    longPressedItemId.current = itemId;
    setDraggedItemId(itemId);
    void Haptics.selectionAsync();
  };

  const createItemPanResponder = (item: InventoryItem) => PanResponder.create({
    // 长按已进入拖拽态时，优先由卡片接管手势，避免 ScrollView 抢走上下滑动。
    onMoveShouldSetPanResponderCapture: () => longPressedItemId.current === item.id,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 5 || Math.abs(gesture.dy) > 5,
    onPanResponderGrant: () => {
      dragPan.setValue({ x: 0, y: 0 });
      setDraggedItemId(item.id);
    },
    onPanResponderMove: Animated.event(
      [null, { dx: dragPan.x, dy: dragPan.y }],
      { useNativeDriver: false },
    ),
    onPanResponderRelease: (_event, gesture) => {
      void handleItemDrop(item, gesture.moveX, gesture.moveY);
    },
    onPanResponderTerminate: () => {
      longPressedItemId.current = null;
      setDraggedItemId(null);
      dragPan.setValue({ x: 0, y: 0 });
    },
  });

  const handleMaintainKitchenware = async (item: KitchenwareItem) => {
    try {
      await kitchenwareApi.maintain(authFetch, item.id);
      await fetchData();
      Alert.alert("保养完成", `已更新【${item.name}】的保养记录。`);
    } catch {
      Alert.alert("更新失败", "网络异常，请稍后重试");
    }
  };

  const handleDeleteKitchenware = (item: KitchenwareItem) => {
    Alert.alert("移除厨具", `确定要移除【${item.name}】吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: async () => {
          try {
            await kitchenwareApi.remove(authFetch, item.id);
            await fetchData();
          } catch {
            Alert.alert("移除失败", "请稍后重试");
          }
        },
      },
    ]);
  };

  // Status helper for inventory items
  const getStatusBadge = (expDate: string) => {
    const diffDays = daysUntilDateKey(expDate);

    if (diffDays === null) {
      return { text: "日期异常", bg: "bg-gray-500/15", color: "text-gray-600" };
    } else if (diffDays < 0) {
      return { text: "已过期", bg: "bg-red-500/15", color: "text-red-600" };
    } else if (diffDays <= 3) {
      return { text: `临期 ${diffDays}天`, bg: "bg-amber-500/15", color: "text-amber-700" };
    } else {
      return { text: `新鲜 ${diffDays}天`, bg: "bg-brand/15", color: "text-brand" };
    }
  };

  const filteredItems = filterInventoryItems(items, activeInventoryCategory);

  const priorityItems = items.filter((item) => {
    const status = getInventoryStatus(item).freshness;
    return status === "expired" || status === "expiring";
  });
  const expiringCount = priorityItems.length;

  const activeSegmentMeta = {
    inventory: {
      title: "食材保鲜库",
      subtitle: "分区保鲜 · 临期提醒 · 智能配餐",
      status: expiringCount > 0 ? `${expiringCount} 件待处理` : "状态良好",
    },
    recipes: {
      title: "今日精选食谱",
      subtitle: "结合库存，找到更合适的一餐",
      status: `${recipes.length} 道`,
    },
    kitchenware: {
      title: "厨房装备库",
      subtitle: "厨具状态、保养与专属食谱",
      status: `${kitchenware.length} 件`,
    },
  }[activeSegment];

  const filteredRecipes = filterAndRankRecipes(recipes, items, activeRecipeCategory, recipeSearchQuery, cookTimeLimit, matchStatusFilter);
  const filteredKitchenware = filterKitchenware(kitchenware, activeKitchenwareCategory);
  const visibleRecipes = filteredRecipes.slice(0, visibleRecipeCount);
  const hasMoreRecipes = visibleRecipeCount < filteredRecipes.length;

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 132 }}
        className="bg-canvas"
      >
        {/* 统一品牌头部：标题、状态和三类资产在首屏内形成清晰层级。 */}
        <View className="relative overflow-hidden rounded-b-[30px] bg-brand px-5 pt-4 pb-5 shadow-sm">
          <View className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/5" />
          <View className="absolute left-1/3 -bottom-12 h-32 w-32 rounded-full bg-highlight/10" />

          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-[10px] font-bold tracking-[2px] text-emerald-100/75">膳食资产</Text>
              <Text className="mt-1 text-[21px] font-black leading-7 text-white">{activeSegmentMeta.title}</Text>
              <Text className="mt-0.5 text-[11px] font-medium text-emerald-50/75">{activeSegmentMeta.subtitle}</Text>
            </View>
            <View className="flex-col items-end gap-1.5">
              <View className="mt-1 flex-row items-center gap-1.5 rounded-full border border-white/15 bg-black/15 px-3 py-1.5">
                <View className={`h-1.5 w-1.5 rounded-full ${activeSegment === "inventory" && expiringCount > 0 ? "bg-highlight" : "bg-emerald-200"}`} />
                <Text className="text-[10px] font-bold text-white">{activeSegmentMeta.status}</Text>
              </View>

              <TouchableOpacity
                onPress={() => setFamilyModalVisible(true)}
                className="flex-row items-center gap-1 rounded-full bg-white/20 px-2.5 py-1 border border-white/30 active:bg-white/30"
              >
                <FontAwesome6 name={activeHousehold ? "house-user" : "user"} size={10} color="#FFFFFF" />
                <Text className="text-[10px] font-black text-white">
                  {activeHousehold ? activeHousehold.name : "个人私享库"}
                </Text>
                <FontAwesome6 name="chevron-down" size={8} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>

          <View className="mt-4 flex-row rounded-[18px] border border-white/30 bg-white/95 p-1.5 shadow-sm">
            {[
              { key: "inventory" as const, label: "食材", count: items.length, icon: "boxes-stacked" },
              { key: "recipes" as const, label: "食谱", count: recipes.length, icon: "utensils" },
              { key: "kitchenware" as const, label: "厨具", count: kitchenware.length, icon: "fire-burner" },
            ].map((segment) => {
              const isActive = activeSegment === segment.key;
              return (
                <TouchableOpacity
                  key={segment.key}
                  onPress={() => setActiveSegment(segment.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-[14px] py-2.5 ${
                    isActive ? "bg-[#E5F0E8]" : "bg-transparent"
                  }`}
                >
                  <FontAwesome6
                    name={segment.icon as any}
                    size={12}
                    color={isActive ? "#2D6A4F" : "#9B8E7D"}
                  />
                  <Text className={`text-xs ${isActive ? "font-black text-brand" : "font-bold text-copy-muted"}`}>
                    {segment.label}
                  </Text>
                  <View className={`min-w-5 items-center rounded-full px-1.5 py-0.5 ${isActive ? "bg-white/80" : "bg-[#F3EEE7]"}`}>
                    <Text className={`text-[9px] font-black ${isActive ? "text-brand" : "text-[#9B8E7D]"}`}>
                      {segment.count}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {sectionErrors[activeSegment] ? (
          <TouchableOpacity
            onPress={() => void fetchData()}
            className="mx-5 mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3"
          >
            <Text className="text-xs font-bold text-amber-800">{sectionErrors[activeSegment]} · 点击重试</Text>
          </TouchableOpacity>
        ) : null}

        {/* CONTENT SEGMENT 1: INVENTORY */}
        {activeSegment === "inventory" && (
          <View className="flex-1">
            {!isAuthenticated ? (
              <View className="flex-1 items-center justify-center p-6">
                <View className="w-20 h-20 bg-brand/10 rounded-full items-center justify-center mb-4">
                  <FontAwesome6 name="basket-shopping" size={32} color="#2D6A4F" />
                </View>
                <Text className="text-xl font-bold text-ink">解锁智能食材保鲜库</Text>
                <Text className="text-sm text-copy-muted text-center mt-2 mb-6">
                  登录后可随时记录冰箱食材、自动临期提醒并智能生成美味菜单。
                </Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => router.push("/login")}
                    className="bg-brand px-6 py-3 rounded-2xl shadow-sm active:opacity-90"
                  >
                    <Text className="text-sm font-bold text-white">立即登录</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push("/login")}
                    className="bg-highlight px-6 py-3 rounded-2xl shadow-sm active:opacity-90 flex-row items-center gap-1.5"
                  >
                    <FontAwesome6 name="wand-magic-sparkles" size={13} color="#3D3229" />
                    <Text className="text-sm font-black text-ink">登录后体验</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Category Slider & Smart Storage Filter */}
                <View className="bg-canvas pt-4 pb-3">
                  <View className="mb-2 flex-row items-center justify-between px-5">
                    <Text className="text-[11px] font-black text-ink">按位置或品类查看</Text>
                    <View className="flex-row items-center gap-2">
                      <TouchableOpacity
                        onPress={openHistoryModal}
                        className="flex-row items-center gap-1.5 rounded-full border border-[#E7DED1] bg-white px-2.5 py-1"
                      >
                        <FontAwesome6 name="clock-rotate-left" size={10} color="#8B7D6B" />
                        <Text className="text-[10px] font-bold text-copy-muted">操作历史</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="gap-2 px-5"
                  >
                    {["全部", "冷藏库", "冷冻库", "常温库", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"].map((cat) => {
                      const cleanCat = cat.split(" ")[0];
                      const isActive = activeInventoryCategory === cleanCat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => setActiveInventoryCategory(cleanCat)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActive }}
                          className={`rounded-full border px-3.5 py-2 ${
                            isActive
                              ? "border-brand bg-brand"
                              : "border-[#E7DED1] bg-white"
                          }`}
                        >
                          <Text
                            className={`text-xs font-bold ${
                              isActive ? "font-black text-white" : "text-[#756858]"
                            }`}
                          >
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  </View>
                </View>

                {/* Phase 3: 已过期食材一键清理 Alert Banner */}
                {(() => {
                  const expiredCount = items.filter((i) => getInventoryStatus(i).freshness === "expired").length;
                  if (expiredCount === 0) return null;
                  return (
                    <View className="mx-5 mb-3 flex-row items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-3 shadow-2xs">
                      <View className="flex-row items-center gap-2.5 flex-1 pr-2">
                        <View className="h-8 w-8 items-center justify-center rounded-full bg-rose-100">
                          <FontAwesome6 name="triangle-exclamation" size={13} color="#C2413A" />
                        </View>
                        <View className="flex-1">
                          <Text className="text-xs font-black text-rose-900">有 {expiredCount} 种食材已过期</Text>
                          <Text className="text-[10px] text-rose-700">及时下架移出，保持食材库新鲜健康</Text>
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={handleBatchClearExpired}
                        disabled={clearingExpired}
                        className="rounded-xl bg-rose-600 px-3 py-1.5 active:bg-rose-700 disabled:opacity-50"
                      >
                        {clearingExpired ? (
                          <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                          <Text className="text-xs font-bold text-white">一键清理</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })()}

                {/* 🎠 单行极简横向轮播通知卡片集 (Single Swipeable Smart Notice Carousel) */}
                <View className="bg-canvas px-5 pb-1">
                  {(() => {
                    const urgentExpiringItems = priorityItems;
                    const firstUrgentItem = urgentExpiringItems[0];

                    return (
                      <View>
                        <View>
                        <ScrollView
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          className="flex-row"
                          contentContainerStyle={{ gap: 10 }}
                          onScroll={(e) => {
                            const slideWidth = e.nativeEvent.layoutMeasurement.width;
                            const offset = e.nativeEvent.contentOffset.x;
                            const index = Math.round(offset / (slideWidth || 300));
                            if (index !== activeNoticeSlide && index >= 0 && index <= 2) {
                              setActiveNoticeSlide(index);
                            }
                          }}
                          scrollEventThrottle={16}
                        >
                          {/* Slide 1: ⏰ 临期预警 / 保鲜周报 */}
                          <View style={{ width: noticeCardWidth }}>
                            {urgentExpiringItems.length > 0 ? (
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: {
                                      prefill_food: firstUrgentItem?.food_name || "",
                                      prompt: `我保鲜库里有【${urgentExpiringItems
                                        .map((i) => i.food_name)
                                        .join("、")}】等临期食材，请帮我生成一份今晚就能消耗它们的美味救急餐单！`,
                                    },
                                  })
                                }
                                className="flex-row items-center justify-between rounded-[20px] border border-[#F1DFC0] bg-[#FFF6E7] p-3.5 active:opacity-90"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#F6E1BD]">
                                    <FontAwesome6 name="bell" size={12} color="#A8641D" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="mb-0.5 text-[13px] font-black text-ink">
                                      {urgentExpiringItems.length} 件需要优先处理
                                    </Text>
                                    <Text numberOfLines={1} className="text-[11px] font-medium text-[#756858]">
                                      {firstUrgentItem?.food_name}{urgentExpiringItems.length > 1 ? "等食材临近到期" : "临近到期"}
                                    </Text>
                                  </View>
                                </View>

                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-[#A8641D]">去处理</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#A8641D" />
                                </View>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: { prompt: "帮我用冰箱库现有食材搭配一份健康营养的餐单" },
                                  })
                                }
                                className="flex-row items-center justify-between rounded-[20px] border border-[#D9E8DD] bg-[#EDF5EF] p-3.5"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-9 h-9 rounded-xl bg-white/70 items-center justify-center">
                                    <FontAwesome6 name="heart-pulse" size={14} color="#2D6A4F" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-xs font-black text-ink mb-0.5">智能保鲜周报</Text>
                                    <Text className="text-[11px] text-copy-muted font-medium">
                                      全库 {items.length} 件食材均在最佳赏味期
                                    </Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">去配餐</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#2D6A4F" />
                                </View>
                              </TouchableOpacity>
                            )}
                          </View>

                          {/* Slide 2: 📸 AI 拍照小票/食材一键入库 */}
                          <View style={{ width: noticeCardWidth }}>
                            <TouchableOpacity
                              onPress={pendingScanJobId ? openPendingScanResult : handleScanReceiptAndBatchAdd}
                              disabled={scanningReceipt}
                              className="bg-[#F3F0EA] p-3 rounded-2xl flex-row items-center justify-between active:opacity-90"
                            >
                              <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                <View className="w-9 h-9 rounded-xl bg-[#EAF2EC] items-center justify-center">
                                  <FontAwesome6 name="receipt" size={14} color="#2D6A4F" />
                                </View>
                                <View className="flex-1">
                                  <Text className="text-xs font-black text-ink mb-0.5">{pendingScanJobId ? "上次识别结果待确认" : "AI 拍照小票/食材一键入库"}</Text>
                                  <Text className="text-[10px] text-copy-muted">{pendingScanJobId ? "点此继续查看并确认入库" : "自动识别食材名分量与建议保质期"}</Text>
                                </View>
                              </View>
                              {scanningReceipt ? (
                                <ActivityIndicator size="small" color="#3D3229" />
                              ) : pendingScanJobId ? (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">查看</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#2D6A4F" />
                                </View>
                              ) : (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">拍照</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#2D6A4F" />
                                </View>
                              )}
                            </TouchableOpacity>
                          </View>

                          {/* Slide 3: 🪄 现有食材极速烹饪匹配 */}
                          {items.length > 0 && (
                            <View style={{ width: noticeCardWidth }}>
                              <TouchableOpacity
                                onPress={() =>
                                  router.push({
                                    pathname: "/ai-assistant",
                                    params: { prompt: "帮我用冰箱库现有食材搭配一份减脂晚餐食谱" },
                                  })
                                }
                                className="bg-[#EDF5EF] p-3 rounded-2xl flex-row items-center justify-between"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-9 h-9 rounded-xl bg-white/70 items-center justify-center">
                                    <FontAwesome6 name="wand-magic-sparkles" size={14} color="#2D6A4F" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-xs font-black text-ink mb-0.5">现有食材极速烹饪匹配</Text>
                                    <Text className="text-[10px] text-copy-muted">用现有 {items.length} 种食材极速匹配食谱</Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-brand">去匹配</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#2D6A4F" />
                                </View>
                              </TouchableOpacity>
                            </View>
                          )}
                        </ScrollView>
                        </View>

                        {/* 轮播指示点 */}
                        <View className="flex-row items-center justify-center gap-1.5 mt-1.5">
                          {[0, 1, items.length > 0 ? 2 : 1].slice(0, items.length > 0 ? 3 : 2).map((idx) => (
                            <View
                              key={idx}
                              className={`h-1 rounded-full ${
                                activeNoticeSlide === idx ? "w-3 bg-[#7C9D8B]" : "w-1 bg-[#DED6CA]"
                              }`}
                            />
                          ))}
                        </View>
                      </View>
                    );
                  })()}
                </View>

                {/* 保鲜分区：由页面主滚动容器统一承载，避免底部导航遮挡嵌套列表 */}
                <View className="px-4 pt-3">
                  {loadingItems ? (
                    <View className="py-16 items-center">
                      <ActivityIndicator size="large" color="#2D6A4F" />
                    </View>
                  ) : filteredItems.length === 0 ? (
                    <View className="py-16 items-center bg-white/60 rounded-[28px] border border-line p-6">
                      <FontAwesome6 name="snowflake" size={36} color="#D4A276" />
                      <Text className="text-base font-bold text-ink mt-3">保鲜仓暂无此类食材</Text>
                      <Text className="text-xs text-copy-muted mt-1">点击右上角“录入食材”添加食材到冰箱吧！</Text>
                    </View>
                  ) : (
                    <View>
                      {[
                        {
                          key: "冷藏",
                          title: "冷藏保鲜仓",
                          subtitle: "4°C · 智能保鲜中",
                          icon: "snowflake",
                          iconColor: "#2D6A4F",
                          iconBg: "bg-[#EAF2EC]",
                          folderBg: "bg-white border-[#DDE9E1]",
                          items: filteredItems.filter((i) => (i.storage_location || "冷藏") === "冷藏"),
                        },
                        {
                          key: "冷冻",
                          title: "冷冻冰封仓",
                          subtitle: "-18°C · 深度锁鲜中",
                          icon: "snowflake",
                          iconColor: "#3D7EA6",
                          iconBg: "bg-sky-50",
                          folderBg: "bg-white border-sky-100",
                          items: filteredItems.filter((i) => i.storage_location === "冷冻"),
                        },
                        {
                          key: "常温",
                          title: "常温阴凉仓",
                          subtitle: "20°C · 阴凉储存",
                          icon: "box-open",
                          iconColor: "#9A7250",
                          iconBg: "bg-[#F8F1E8]",
                          folderBg: "bg-white border-[#EEE2D3]",
                          items: filteredItems.filter(
                            (i) => i.storage_location === "常温" || !["冷藏", "冷冻"].includes(i.storage_location)
                          ),
                        },
                      ].map((group) => {
                        // 若过滤了特定分类，允许无食材的大文件夹隐藏
                        if (group.items.length === 0 && activeInventoryCategory !== "全部") return null;

                        return (
                          <View
                            key={group.key}
                            ref={(node) => {
                              storageFolderRefs.current[group.key as StorageLocation] = node;
                            }}
                            className={`mb-4 rounded-[26px] border p-4 ${group.folderBg}`}
                          >
                            {/* 手机系统大文件夹 标题 Header */}
                            <View className="flex-row items-center justify-between mb-3 px-1">
                              <View className="flex-1 flex-row items-center gap-2.5 pr-2">
                                <View className={`h-10 w-10 items-center justify-center rounded-2xl ${group.iconBg}`}>
                                  <FontAwesome6 name={group.icon as any} size={14} color={group.iconColor} />
                                </View>
                                <View>
                                  <Text className="text-[15px] font-black text-ink">{group.title}</Text>
                                  <Text className="text-[11px] text-copy-muted font-medium mt-0.5">{group.subtitle}</Text>
                                </View>
                              </View>

                              <View className="flex-row items-center gap-2">
                                <View className="bg-[#F6F2EC] px-2.5 py-1 rounded-full">
                                  <Text className="text-[11px] font-bold text-[#6F6254]">
                                    {group.items.length} 项
                                  </Text>
                                </View>
                                <TouchableOpacity
                                  onPress={() => {
                                    setStorageLocation(group.key);
                                    openAddModal();
                                  }}
                                  accessibilityLabel={`存入${group.key}食材`}
                                  className="h-9 w-9 items-center justify-center rounded-full bg-brand active:opacity-80"
                                >
                                  <FontAwesome6 name="plus" size={11} color="#FFFFFF" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            {/* 手机系统大文件夹核心：App 图标式多列网格 (Grid Layout) */}
                            {group.items.length === 0 ? (
                              <View className="py-6 items-center bg-white/60 rounded-[22px] border border-dashed border-line">
                                <Text className="text-xs text-copy-muted">文件夹空空如也，点击右上角 + 入库</Text>
                              </View>
                            ) : (
                              <View
                                className="flex-row flex-wrap gap-2.5"
                                onLayout={(event) => {
                                  const nextWidth = Math.floor(event.nativeEvent.layout.width);
                                  if (nextWidth !== inventoryGridWidth) setInventoryGridWidth(nextWidth);
                                }}
                              >
                                {group.items.map((item) => {
                                  const status = getInventoryStatus(item);
                                  const badge = getExpirationBadgeConfig(status);

                                  return (
                                    <Animated.View
                                      key={item.id}
                                      {...createItemPanResponder(item).panHandlers}
                                      style={[
                                        { width: inventoryCardWidth || "48%" },
                                        draggedItemId === item.id && {
                                          zIndex: 30,
                                          elevation: 30,
                                          opacity: 0.92,
                                          transform: [...dragPan.getTranslateTransform(), { scale: 1.04 }],
                                        },
                                      ]}
                                      className="relative min-h-[154px] items-start overflow-hidden rounded-[20px] border border-[#EDF0EA] bg-[#FAFBF8] p-3"
                                    >
                                      {/* 点击查看详情；长按可拖动到其他保鲜分区 */}
                                      <TouchableOpacity
                                        activeOpacity={0.8}
                                        delayLongPress={250}
                                        onLongPress={() => handleItemLongPress(item.id)}
                                        onPress={() => {
                                          if (longPressedItemId.current === item.id) {
                                            longPressedItemId.current = null;
                                            setDraggedItemId(null);
                                            return;
                                          }
                                          openEditModal(item);
                                        }}
                                        accessibilityLabel={`${item.food_name}，${item.quantity}，${badge.label}`}
                                        className="w-full items-start"
                                      >
                                        <View className="w-full flex-row items-start justify-between">
                                          {item.image_url ? (
                                            <Image
                                              source={{ uri: item.image_url }}
                                              className="h-12 w-12 rounded-2xl bg-[#EDF3EF]"
                                            />
                                          ) : (
                                            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-[#EAF2EC]">
                                              <FontAwesome6 name="lemon" size={19} color="#2D6A4F" />
                                            </View>
                                          )}
                                          <View className={`ml-2 rounded-full px-2 py-1 ${badge.badgeBg}`}>
                                            <Text className={`text-[9px] font-black ${badge.textColor}`}>{badge.label}</Text>
                                          </View>
                                        </View>

                                        <Text
                                          numberOfLines={2}
                                          className="mt-2.5 min-h-[34px] text-[13px] font-black leading-[17px] text-ink"
                                        >
                                          {item.food_name}
                                        </Text>
                                        <View className="mt-2 flex-row items-center gap-1.5">
                                          <FontAwesome6 name="weight-scale" size={9} color="#8B7D6B" />
                                          <Text className="text-[11px] font-semibold text-[#6F6254]">{item.quantity}</Text>
                                        </View>
                                      </TouchableOpacity>
                                    </Animated.View>
                                  );
                                })}

                                {/* 结尾智能 + 入库网格槽位 (类似于手机大文件夹里的 + 按钮) */}
                                <TouchableOpacity
                                  onPress={() => {
                                    setStorageLocation(group.key);
                                    openAddModal();
                                  }}
                                  style={{ width: inventoryCardWidth || "48%" }}
                                  className="min-h-[146px] items-center justify-center rounded-[20px] border border-dashed border-[#D8CCBA] bg-[#FFFDF9] p-3 active:bg-white"
                                >
                                  <View className="mb-2 h-10 w-10 items-center justify-center rounded-full bg-background-secondary">
                                    <FontAwesome6 name="plus" size={14} color="#8B7D6B" />
                                  </View>
                                  <Text className="text-[11px] font-black text-[#756858]">存入{group.key}</Text>
                                  <Text className="mt-1 text-[9px] text-[#9B8E7D]">拍照或手动录入</Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        )}
        {activeSegment === "recipes" && (
          <View className="flex-1">
            <View className="mx-5 mb-3 mt-4 flex-row items-center justify-between">
              <View>
                <Text className="text-[17px] font-black text-ink">今天想吃什么？</Text>
                <Text className="mt-0.5 text-[11px] text-copy-muted">优先展示与你现有食材更匹配的菜谱</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push("/recipe-submit")}
                className="flex-row items-center rounded-full border border-[#D8E7DD] bg-[#E7F0EA] px-3 py-2.5"
              >
                <FontAwesome6 name="pen" size={10} color="#2D6A4F" />
                <Text className="ml-1.5 text-[11px] font-black text-brand">投稿与收藏</Text>
              </TouchableOpacity>
            </View>
            {/* Search Input & Filter */}
            <View className="mb-3">
              <View className="mx-5 mb-3 flex-row items-center rounded-[18px] border border-[#E7DED1] bg-white px-4 py-3 shadow-2xs">
                <FontAwesome6 name="magnifying-glass" size={13} color="#8B7D6B" className="mr-2" />
                <TextInput
                  value={recipeSearchQuery}
                  onChangeText={setRecipeSearchQuery}
                  placeholder="搜索菜名、食材或营养目标"
                  placeholderTextColor="#A99D8E"
                  className="flex-1 text-[13px] text-ink"
                />
                {recipeSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setRecipeSearchQuery("")}>
                    <FontAwesome6 name="xmark" size={13} color="#8B7D6B" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Recipe Filter Categories */}
              <View className="gap-2">
                <View>
                  <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2 px-5 pb-1"
                >
                  {["全部", "冰箱全可做", "减脂低卡", "增肌高蛋白", "15分钟快手菜"].map((cat) => {
                    const cleanCat = cat.replace(/[^a-z0-9\u4e00-\u9fa5]/gi, "");
                    const isActive =
                      activeRecipeCategory === cleanCat ||
                      (cat.includes("冰箱") && activeRecipeCategory === "冰箱可做") ||
                      (cat === "全部" && activeRecipeCategory === "全部");
                    return (
                      <TouchableOpacity
                        key={cat}
                        onPress={() => {
                          if (cat.includes("冰箱")) setActiveRecipeCategory("冰箱可做");
                          else if (cat.includes("减脂")) setActiveRecipeCategory("减脂");
                          else if (cat.includes("增肌")) setActiveRecipeCategory("增肌");
                          else if (cat.includes("快手")) setActiveRecipeCategory("快手菜");
                          else setActiveRecipeCategory("全部");
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isActive }}
                        className={`rounded-full border px-3.5 py-1.5 ${
                          isActive
                            ? "border-brand bg-brand"
                            : "border-[#E7DED1] bg-white"
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold ${
                            isActive ? "font-black text-white" : "text-[#756858]"
                          }`}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  </ScrollView>
                </View>

                {/* Phase 2: 今天吃什么 Quick Filter Pills */}
                <View>
                  <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerClassName="gap-2 px-5 pb-1"
                >
                  {[
                    { label: "全部时间", limit: 0 },
                    { label: "15分快手", limit: 15 },
                    { label: "30分内", limit: 30 },
                  ].map((timeOption) => (
                    <TouchableOpacity
                      key={timeOption.limit}
                      onPress={() => setCookTimeLimit(timeOption.limit)}
                      className={`rounded-full border px-3 py-1 ${
                        cookTimeLimit === timeOption.limit
                          ? "border-brand/40 bg-brand/10"
                          : "border-line bg-canvas"
                      }`}
                    >
                      <Text
                        className={`text-[11px] ${
                          cookTimeLimit === timeOption.limit ? "font-bold text-brand" : "text-copy-muted"
                        }`}
                      >
                        {timeOption.label}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  <View className="h-4 w-px bg-line self-center mx-1" />

                  {[
                    { label: "匹配全部", key: "全部" },
                    { label: "完全可做", key: "完全可做" },
                    { label: "缺1-2样", key: "缺1-2样" },
                    { label: "优先临期", key: "优先临期" },
                  ].map((statusOption) => (
                    <TouchableOpacity
                      key={statusOption.key}
                      onPress={() => setMatchStatusFilter(statusOption.key)}
                      className={`rounded-full border px-3 py-1 ${
                        matchStatusFilter === statusOption.key
                          ? "border-amber-500/40 bg-amber-50"
                          : "border-line bg-canvas"
                      }`}
                    >
                      <Text
                        className={`text-[11px] ${
                          matchStatusFilter === statusOption.key ? "font-bold text-amber-900" : "text-copy-muted"
                        }`}
                      >
                        {statusOption.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  </ScrollView>
                </View>
              </View>
            </View>

            {/* Recipe List: 2-Column Waterfall Bento Cards */}
            <View className="px-4 pb-4 pt-1">
              {loadingRecipes ? (
                <View className="py-16 items-center">
                  <ActivityIndicator size="large" color="#2D6A4F" />
                </View>
              ) : filteredRecipes.length === 0 ? (
                <View className="py-16 items-center bg-white/60 rounded-[28px] border border-line p-6">
                  <FontAwesome6 name="utensils" size={36} color="#D4A276" />
                  <Text className="mt-3 text-base font-bold text-ink">
                    {activeRecipeCategory === "冰箱可做" ? "暂时没有库存可做的食谱" : "未找到符合条件的食谱"}
                  </Text>
                  <Text className="mt-1 text-center text-xs text-copy-muted">
                    尝试重置筛选条件，或拍照录入更多冰箱食材
                  </Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap justify-between gap-y-3.5">
                  {visibleRecipes.map((recipe) => {
                    const analysis = analyzeRecipeInventoryMatch(recipe, items);
                    const expiringMatch = analysis.expiringIngredients[0];

                    return (
                      <View
                        key={recipe.id}
                        style={{ width: "48.5%" }}
                        className="flex-col justify-between overflow-hidden rounded-[22px] border border-[#E9E1D5] bg-white active:opacity-95"
                      >
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => router.push("/recipe-detail", { id: recipe.id })}
                        >
                          <View className="relative">
                            <RecipeCover
                              uri={recipe.image_url}
                              className="h-32 w-full"
                              placeholderClassName="h-32 w-full items-center justify-center bg-[#EAF2EC]"
                              iconSize={20}
                            />
                            {/* 卡路里胶囊 */}
                            <View className="absolute top-2 right-2 flex-row items-center gap-1 rounded-full bg-black/60 px-2 py-0.5">
                              <FontAwesome6 name="fire" size={9} color="#E9C46A" />
                              <Text className="text-[10px] font-black text-white">
                                {recipe.calories} kcal
                              </Text>
                            </View>

                            {/* 冰箱食材匹配角标 (优先展示临期 > 完全可做 > 缺少X种) */}
                            {expiringMatch ? (
                              <View className="absolute top-2 left-2 rounded-full bg-amber-600 px-2 py-0.5">
                                <Text className="text-[9px] font-black text-white">
                                  优先消耗{expiringMatch.name}(剩{expiringMatch.daysLeft}天)
                                </Text>
                              </View>
                            ) : analysis.matchStatus === "full" ? (
                              <View className="absolute top-2 left-2 rounded-full bg-brand px-2 py-0.5">
                                <Text className="text-[9px] font-black text-white">完全可做</Text>
                              </View>
                            ) : analysis.missingIngredients.length > 0 ? (
                              <View className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5">
                                <Text className="text-[9px] font-bold text-amber-200">
                                  缺 {analysis.missingIngredients.length} 种
                                </Text>
                              </View>
                            ) : (
                              <View className="absolute top-2 left-2 rounded-full bg-black/35 px-2 py-0.5">
                                <Text className="text-[9px] font-bold text-white">{recipe.category}</Text>
                              </View>
                            )}
                          </View>

                          <View className="p-3 pb-2.5">
                            <Text numberOfLines={2} className="min-h-[36px] text-sm font-black leading-[18px] text-ink">
                              {recipe.title}
                            </Text>
                            <Text className="mt-1 min-h-[32px] text-[10px] font-medium leading-4 text-copy-muted" numberOfLines={2}>
                              {recipe.description}
                            </Text>

                            {/* 缺失/已有食材标签提醒 */}
                            {analysis.missingIngredients.length > 0 ? (
                              <Text className="mt-1.5 text-[10px] font-medium text-amber-800" numberOfLines={1}>
                                缺: {analysis.missingIngredients.map((i) => i.name).slice(0, 2).join("、")}
                              </Text>
                            ) : analysis.matchedIngredients.length > 0 ? (
                              <Text className="mt-1.5 text-[10px] font-medium text-brand" numberOfLines={1}>
                                已备: {analysis.matchedIngredients.map((i) => i.name).slice(0, 2).join("、")}
                              </Text>
                            ) : null}

                            <View className="mt-2 flex-row items-center gap-1.5">
                              <FontAwesome6 name="clock" size={9} color="#8B7D6B" />
                              <Text className="text-[9px] font-bold text-[#6F6254]">{recipe.cook_time} 分钟</Text>
                              <View className="h-1 w-1 rounded-full bg-[#D7CCBE]" />
                              <Text className="text-[9px] font-bold text-brand">蛋白 {recipe.protein}g</Text>
                            </View>
                          </View>
                        </TouchableOpacity>

                        {/* 底部快捷操作 */}
                        <View className="px-3 pb-3">
                          {analysis.missingIngredients.length > 0 ? (
                            <TouchableOpacity
                              onPress={() => handleAddMissingFromCard(recipe.title, analysis.missingIngredients)}
                              className="flex-row items-center justify-center gap-1 rounded-xl bg-amber-50 border border-amber-200/80 py-2 active:opacity-80"
                            >
                              <FontAwesome6 name="cart-plus" size={9} color="#9A6B10" />
                              <Text className="text-[10px] font-black text-amber-900">补齐缺料到采购单</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              onPress={() =>
                                router.push({
                                  pathname: "/ai-assistant",
                                  params: {
                                    prompt: `请作为我的私厨，为我指导烹饪【${recipe.title}】的详细步骤、调料配比与注意事项。`,
                                  },
                                })
                              }
                              className="flex-row items-center justify-center gap-1.5 rounded-xl bg-[#E7F0EA] py-2 active:opacity-80"
                            >
                              <FontAwesome6 name="wand-magic-sparkles" size={9} color="#2D6A4F" />
                              <Text className="text-[10px] font-black text-brand">AI 烹饪指导</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  {hasMoreRecipes && (
                    <View className="w-full items-center pt-1">
                      <TouchableOpacity
                        onPress={() => setVisibleRecipeCount((count) => count + 12)}
                        className="flex-row items-center gap-2 rounded-full border border-[#D8CCBA] bg-white px-6 py-3"
                      >
                        <Text className="text-xs font-black text-[#6F6254]">再看 12 道</Text>
                        <FontAwesome6 name="chevron-down" size={9} color="#8B7D6B" />
                      </TouchableOpacity>
                      <Text className="mt-2 text-[10px] text-[#9B8E7D]">
                        已展示 {visibleRecipes.length} / {filteredRecipes.length} 道
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        )}

        {/* CONTENT SEGMENT 3: KITCHENWARE */}
        {activeSegment === "kitchenware" && !isAuthenticated && (
          <View className="mx-5 mt-8 items-center rounded-[28px] border border-line bg-white px-6 py-10">
            <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-brand/10">
              <FontAwesome6 name="fire-burner" size={22} color="#2D6A4F" />
            </View>
            <Text className="text-base font-black text-ink">登录后管理你的厨具</Text>
            <Text className="mt-2 text-center text-xs leading-5 text-copy-muted">
              记录锅具、刀具和小家电，获得更匹配的食谱与保养提醒。
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/login")}
              className="mt-5 rounded-2xl bg-brand px-8 py-3"
            >
              <Text className="text-sm font-black text-white">立即登录</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeSegment === "kitchenware" && isAuthenticated && (
          <View className="px-4 pt-4">
            {/* 厨具智能保养与闲置唤醒 Banner */}
            <View className="mb-4 flex-row items-center gap-3 rounded-[22px] border border-[#CFE1D5] bg-[#E8F1EA] p-4 shadow-2xs">
              <View className="h-11 w-11 items-center justify-center rounded-2xl bg-brand shadow-xs">
                <FontAwesome6 name="plug" size={16} color="#FFF" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[13px] font-black text-brand">装备状态管家</Text>
                  <View className="rounded-full bg-white/70 px-2 py-1">
                    <Text className="text-[9px] font-black text-brand">自动提醒</Text>
                  </View>
                </View>
                <Text className="mt-1 text-[11px] text-[#4B4037]" numberOfLines={1}>
                  {kitchenware.some((item) => item.status === "需保养" || item.status === "维修中")
                    ? `有 ${kitchenware.filter((item) => item.status === "需保养" || item.status === "维修中").length} 件厨具需要关注`
                    : kitchenware.length
                      ? "当前装备状态良好，可随时记录保养"
                      : "录入厨具后可获得状态与保养提醒"}
                </Text>
              </View>
            </View>

            <View className="mb-4 rounded-[24px] border border-[#E7DED1] bg-white p-4">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-[13px] font-black text-ink">按烹饪习惯快速配置</Text>
                  <Text className="mt-1 text-[10px] text-copy-muted">选择一套常用装备，之后仍可逐件调整</Text>
                </View>
                <FontAwesome6 name="wand-magic-sparkles" size={15} color="#D4A276" />
              </View>
              <View className="mt-3">
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2 pr-3">
                  {KITCHENWARE_STARTER_KITS.map((kit) => (
                    <TouchableOpacity key={kit.name} disabled={Boolean(addingStarterKit)} onPress={() => addStarterKit(kit)} className="w-44 rounded-2xl border border-[#D8E7DD] bg-[#F0F6F2] px-3.5 py-3 disabled:opacity-50">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-[12px] font-black text-brand">{addingStarterKit === kit.name ? "添加中…" : kit.name}</Text>
                        <FontAwesome6 name="plus" size={9} color="#2D6A4F" />
                      </View>
                      <Text numberOfLines={2} className="mt-1 text-[9px] leading-4 text-[#6F6254]">{kit.items.join(" · ")}</Text>
                    </TouchableOpacity>
                  ))}
                  </View>
                </ScrollView>
              </View>
            </View>

            {/* 厨具分类 Selector + 录入新厨具按键 */}
            <View className="mb-3 flex-row items-center justify-between">
              <View>
                <Text className="text-[15px] font-black text-ink">我的厨具</Text>
                <Text className="mt-0.5 text-[10px] text-copy-muted">{kitchenware.length} 件装备 · 点卡片可查看与维护</Text>
              </View>
              <TouchableOpacity
                onPress={() => openKitchenwareModal()}
                className="flex-row items-center gap-1.5 rounded-full bg-brand px-4 py-2.5 shadow-2xs active:scale-95"
              >
                <FontAwesome6 name="plus" size={10} color="#FFF" />
                <Text className="text-xs font-black text-white">录入厨具</Text>
              </TouchableOpacity>
            </View>

            <View className="mb-4 -mx-4">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4">
                  {["全部", "小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setActiveKitchenwareCategory(cat)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activeKitchenwareCategory === cat }}
                      className={`rounded-full border px-3.5 py-2 ${
                        activeKitchenwareCategory === cat
                          ? "bg-brand border-brand"
                          : "border-[#E7DED1] bg-white"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${
                          activeKitchenwareCategory === cat ? "text-white font-black" : "text-copy-muted"
                        }`}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
            </View>

            {/* 厨具卡片双列 Bento 布局 */}
            {loadingKitchenware ? (
              <View className="items-center py-16">
                <ActivityIndicator color="#2D6A4F" />
                <Text className="mt-3 text-xs text-copy-muted">正在加载厨具装备...</Text>
              </View>
            ) : filteredKitchenware.length === 0 ? (
              <View className="items-center rounded-[26px] border border-dashed border-[#D8CCBA] bg-white px-6 py-10">
                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-background-secondary">
                  <FontAwesome6 name="kitchen-set" size={24} color="#8B7D6B" />
                </View>
                <Text className="mt-4 text-sm font-black text-ink">
                  {kitchenware.length === 0 ? "建立你的厨房装备库" : "这个分类还没有厨具"}
                </Text>
                <Text className="mt-1 max-w-64 text-center text-xs leading-5 text-copy-muted">
                  {kitchenware.length === 0 ? "添加常用锅具或小家电，就能获得更准确的食谱与保养提醒。" : "切换其他分类查看，或录入一件新厨具。"}
                </Text>
                <TouchableOpacity
                  onPress={() => openKitchenwareModal()}
                  className="mt-5 rounded-full bg-brand px-5 py-2.5"
                >
                  <Text className="text-xs font-black text-white">{kitchenware.length === 0 ? "录入第一件厨具" : "录入新厨具"}</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <View className="flex-row flex-wrap justify-between gap-y-3.5">
              {filteredKitchenware.map((kw) => (
                  <View
                    key={kw.id}
                    style={{ width: "48.5%" }}
                    className="bg-white rounded-[24px] overflow-hidden border border-line shadow-xs flex-col justify-between p-3"
                  >
                    <View>
                      <View className="relative mb-2">
                        {kw.image_url ? (
                          <Image
                            source={{ uri: kw.image_url }}
                            className="w-full h-28 rounded-2xl border border-line"
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="h-28 w-full items-center justify-center rounded-2xl border border-line bg-background-secondary">
                            <FontAwesome6 name="kitchen-set" size={28} color="#8B7D6B" />
                          </View>
                        )}
                        <View className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full">
                          <Text className="text-[9px] font-bold text-white">{kw.status}</Text>
                        </View>
                        <View className="absolute left-2 top-2 flex-row gap-1">
                          <TouchableOpacity
                            onPress={() => openKitchenwareModal(kw)}
                            className="h-6 w-6 items-center justify-center rounded-full bg-white/90"
                          >
                            <FontAwesome6 name="pen" size={8} color="#2D6A4F" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleDeleteKitchenware(kw)}
                            className="h-6 w-6 items-center justify-center rounded-full bg-white/90"
                          >
                            <FontAwesome6 name="trash" size={8} color="#C2413A" />
                          </TouchableOpacity>
                        </View>
                      </View>

                      <Text numberOfLines={1} className="text-sm font-black text-ink">
                        {kw.name}
                      </Text>
                      <Text numberOfLines={2} className="text-[10px] text-copy-muted mt-0.5 font-medium">
                        {kw.note}
                      </Text>
                    </View>

                    {/* 底部功能栏 */}
                    <View className="mt-2.5 pt-2 border-t border-background-secondary flex-row items-center justify-between gap-1">
                      <TouchableOpacity
                        onPress={() =>
                          router.push({
                            pathname: "/ai-assistant",
                            params: {
                              prompt: `请为我的【${kw.name}】推荐 3 道专属极速美味食谱，附带所需食材与操作技巧！`,
                            },
                          })
                        }
                        className="bg-brand/10 border border-brand/20 flex-1 py-1 rounded-xl items-center flex-row justify-center gap-1 active:opacity-80"
                      >
                        <FontAwesome6 name="wand-magic-sparkles" size={8} color="#2D6A4F" />
                        <Text className="text-[9px] font-black text-brand">AI 菜谱</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleMaintainKitchenware(kw)}
                        className="bg-background-secondary px-2 py-1 rounded-xl items-center flex-row justify-center gap-1"
                      >
                        <FontAwesome6 name="wrench" size={8} color="#8B7D6B" />
                        <Text className="text-[9px] font-bold text-copy-muted">保养</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
            </View>
            )}
          </View>
        )}

        {/* Inventory Add/Edit Modal */}
        <Modal visible={modalVisible && isAuthenticated} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] px-5 pt-5 pb-6 max-h-[90%]">
              <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
                <View>
                  <Text className="text-lg font-black text-ink">
                    {editingItem ? "编辑食材" : entryMode === "choose" ? "添加食材" : "手动录入"}
                  </Text>
                  {!editingItem && <Text className="text-[11px] text-copy-muted mt-0.5">{entryMode === "choose" ? "选一种最适合你的录入方式" : "填好名称、数量和到期日即可入库"}</Text>}
                </View>
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  accessibilityLabel="关闭录入食材弹窗"
                  className="w-9 h-9 -mr-2 items-center justify-center rounded-full bg-canvas"
                >
                  <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              {!editingItem && entryMode === "choose" ? (
                <View className="pb-2">
                  <Text className="mt-1 text-xl font-black text-ink">这次怎么添加？</Text>
                  <Text className="mt-1 text-xs leading-5 text-copy-muted">单个食材、购物清单或订单截图都可以，识别多项后再由你确认。</Text>

                  <TouchableOpacity
                    onPress={openAiFoodAssist}
                    disabled={aiAssisting}
                    className="mt-5 overflow-hidden rounded-[24px] bg-brand p-5 active:opacity-90 disabled:opacity-60"
                  >
                    <View className="absolute -right-5 -top-5 h-28 w-28 rounded-full bg-white/10" />
                    <View className="h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                      {aiAssisting ? <ActivityIndicator color="#FFF" /> : <FontAwesome6 name="wand-magic-sparkles" size={18} color="#FFF" />}
                    </View>
                    <View className="mt-5 flex-row items-end justify-between">
                      <View>
                        <Text className="text-base font-black text-white">{aiAssisting ? "AI 正在识别…" : "拍照，让 AI 整理入库"}</Text>
                        <Text className="mt-1 text-[11px] text-emerald-50">支持多种食材，名称、数量、保存位置、建议到期日</Text>
                      </View>
                      {!aiAssisting && <FontAwesome6 name="arrow-right" size={15} color="#FFF" />}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setEntryMode("manual")} className="mt-3 flex-row items-center rounded-[22px] border border-line bg-canvas p-4 active:opacity-80">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
                      <FontAwesome6 name="pen" size={14} color="#8B7D6B" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-black text-ink">手动填写</Text>
                      <Text className="mt-0.5 text-[10px] text-copy-muted">适合没有照片，或想自己精确填写时</Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} color="#8B7D6B" />
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => { setModalVisible(false); handleScanReceiptAndBatchAdd(); }} className="mt-4 flex-row items-center justify-center gap-2 py-3">
                    <FontAwesome6 name="receipt" size={13} color="#2D6A4F" />
                    <Text className="text-xs font-bold text-brand">有一整张小票或多种食材？批量导入</Text>
                  </TouchableOpacity>
                </View>
              ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="pb-2">
                {!editingItem && (
                  <QuickAddPresetChips onSelect={(item) => applyIngredientDefaults(item.name, item.storageLocation)} />
                )}
                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1.5">食材名称 <Text className="text-[#C2413A]">*</Text></Text>
                  <TextInput
                    value={foodName}
                    onChangeText={handleFoodNameChange}
                    placeholder="例如：牛油果、希腊酸奶"
                    autoFocus={!editingItem}
                    returnKeyType="next"
                    className="bg-canvas px-4 py-3.5 rounded-2xl border border-line text-base font-semibold text-ink"
                  />
                  {suggestions.length > 0 && (
                    <View className="mt-2 flex-row flex-wrap gap-1.5 rounded-2xl border border-line bg-canvas p-2.5">
                      {suggestions.map((sug) => (
                        <TouchableOpacity
                          key={sug.name}
                          onPress={() => applyIngredientDefaults(sug.name)}
                          className="flex-row items-center gap-1 rounded-xl bg-brand/10 px-2.5 py-1.5 active:bg-brand/20"
                        >
                          <FontAwesome6 name="plus" size={10} color="#2D6A4F" />
                          <Text className="text-xs font-bold text-brand">{sug.name}</Text>
                          {sug.category && <Text className="text-[10px] text-copy-muted">({sug.category})</Text>}
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>

                <View className="mt-4">
                  <Text className="text-xs font-bold text-copy-muted mb-2">分类</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row" contentContainerClassName="gap-2 pr-4">
                      {["蔬菜", "肉食", "水果", "乳制品", "粮油干货", "水产海鲜", "调味品", "休闲零食", "熟食面点"].map((c) => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setCategory(c)}
                          className={`px-3.5 py-2 rounded-xl border ${
                            category === c ? "bg-brand border-brand" : "bg-white border-line"
                          }`}
                        >
                          <Text className={`text-xs ${category === c ? "text-white font-bold" : "text-copy-muted font-medium"}`}>
                            {c}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                <View className="flex-row gap-3 mt-4">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1.5">数量 <Text className="text-[#C2413A]">*</Text></Text>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      placeholder="如: 500g, 2盒"
                      className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm font-semibold text-ink"
                    />
                    <View className="flex-row gap-1.5 mt-2">
                      {["100g", "1份", "2盒", "500g"].map((value) => (
                        <TouchableOpacity key={value} onPress={() => setQuantity(value)} className="px-2 py-1 rounded-lg bg-background-secondary">
                          <Text className="text-[10px] font-semibold text-copy-muted">{value}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-copy-muted mb-1.5">存放位置</Text>
                    <View className="flex-row gap-1">
                      {(["冷藏", "冷冻", "常温"] as const).map((loc) => (
                        <TouchableOpacity
                          key={loc}
                          onPress={() => handleStorageLocationChange(loc)}
                          className={`flex-1 py-2 rounded-xl border items-center ${
                            storageLocation === loc ? "bg-ink border-ink" : "bg-canvas border-line"
                          }`}
                        >
                          <Text className={`text-xs ${storageLocation === loc ? "text-white font-bold" : "text-copy-muted"}`}>
                            {loc}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </View>

                <View className="mt-4 rounded-2xl bg-[#F8F3EA] p-3.5">
                  <View className="flex-row items-center justify-between mb-2.5">
                    <View className="flex-row items-center gap-2">
                      <View className="w-7 h-7 rounded-full bg-highlight/30 items-center justify-center">
                        <FontAwesome6 name="bell" size={11} color="#9A6B10" />
                      </View>
                      <View>
                        <Text className="text-xs font-black text-ink">到期提醒</Text>
                        <Text className="text-[10px] text-copy-muted">我们会在临期时提醒你优先食用</Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-bold text-brand">{storageLocation}</Text>
                  </View>
                  <View className="flex-row gap-2 mb-3">
                    {[{ label: "3天", days: 3 }, { label: "7天", days: 7 }, { label: "30天", days: 30 }].map(({ label, days }) => {
                      const date = dateKeyAfterDays(days);
                      const selected = expirationDate === date;
                      return (
                        <TouchableOpacity key={label} onPress={() => setExpirationDate(date)} className={`flex-1 items-center py-1.5 rounded-xl border ${selected ? "bg-brand border-brand" : "bg-white border-line"}`}>
                          <Text className={`text-[11px] font-bold ${selected ? "text-white" : "text-copy-muted"}`}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <SmartDateInput value={expirationDate} onChange={setExpirationDate} />
                </View>

                <View className="mt-3 rounded-2xl border border-line bg-white p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} className="h-9 w-9 rounded-xl bg-background-secondary" />
                      ) : (
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-background-secondary">
                          <FontAwesome6 name="image" size={14} color="#8B7D6B" />
                        </View>
                      )}
                      <View>
                        <Text className="text-xs font-bold text-ink">食材照片 <Text className="font-medium text-copy-muted">（可选）</Text></Text>
                        <Text className="mt-0.5 text-[10px] text-copy-muted">{imageUrl ? "照片已添加" : "方便以后快速辨认"}</Text>
                      </View>
                    </View>
                    <View className="flex-row gap-2">
                      <TouchableOpacity onPress={() => selectFoodPhoto("camera")} className="h-9 w-9 items-center justify-center rounded-xl bg-brand/10">
                        <FontAwesome6 name="camera" size={13} color="#2D6A4F" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => selectFoodPhoto("library")} className="h-9 w-9 items-center justify-center rounded-xl bg-background-secondary">
                        <FontAwesome6 name="images" size={13} color="#8B7D6B" />
                      </TouchableOpacity>
                      {imageUrl && (
                        <TouchableOpacity onPress={() => setImageUrl("")} className="h-9 w-9 items-center justify-center rounded-xl bg-red-50">
                          <FontAwesome6 name="trash" size={12} color="#C2413A" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>

                {editingItem && (
                  <View className="mt-4 flex-row gap-2.5">
                    <TouchableOpacity
                      onPress={() => {
                        setModalVisible(false);
                        router.push({
                          pathname: "/ai-assistant",
                          params: {
                            prefill_food: editingItem.food_name,
                            prompt: `我冰箱里有【${editingItem.food_name}】(${editingItem.quantity})，请帮我生成一份优先消耗它的营养餐单！`,
                          },
                        });
                      }}
                      className="flex-1 py-3.5 rounded-2xl bg-highlight/20 items-center border border-highlight/40"
                    >
                      <Text className="text-xs font-bold text-amber-900">AI 生成菜谱</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDeleteItem(editingItem.id)}
                      className="flex-row items-center justify-center gap-1.5 rounded-2xl bg-red-50 px-4 py-3"
                    >
                      <FontAwesome6 name="trash-can" size={11} color="#B5483F" />
                      <Text className="text-xs font-bold text-[#B5483F]">移除</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleSaveItem}
                  disabled={saving}
                  className="bg-brand py-4 rounded-2xl items-center mt-4 shadow-sm active:opacity-90"
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text className="text-base font-bold text-white">{editingItem ? "保存修改" : "加入食材库"}</Text>
                  )}
                </TouchableOpacity>
                {!editingItem && (
                  <TouchableOpacity onPress={() => setEntryMode("choose")} className="items-center py-3">
                    <Text className="text-xs font-bold text-copy-muted">选择其他录入方式</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        <BatchReviewModal
          visible={batchReviewVisible}
          foods={detectedFoods}
          saving={savingDetectedFoods}
          onClose={() => setBatchReviewVisible(false)}
          onChange={setDetectedFoods}
          onSave={saveDetectedFoods}
        />

        <CatalogDetailModal
          item={selectedCatalogKitchenware}
          saving={savingKitchenware}
          owned={Boolean(selectedCatalogKitchenware && kitchenware.some((item) => item.name === selectedCatalogKitchenware.name))}
          onClose={() => setSelectedCatalogKitchenware(null)}
          onAdd={addCatalogKitchenware}
        />

        {/* Kitchenware Add Modal */}
        <Modal visible={kitchenwareModalVisible} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] p-6 max-h-[85%]">
              <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
                <Text className="text-lg font-black text-ink">
                  {editingKitchenware ? "编辑厨具" : "录入我的新厨具/家电"}
                </Text>
                <TouchableOpacity onPress={() => setKitchenwareModalVisible(false)}>
                  <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">厨具名称</Text>
                  <TextInput
                    value={kwName}
                    onChangeText={setKwName}
                    placeholder="搜索或输入厨具名称，如空气炸锅"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                  {!editingKitchenware && (
                    <View className="mt-2">
                      <Text className="text-[11px] font-bold text-copy-muted mb-1.5">常用厨具类型</Text>
                      <View><ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2 pr-4">
                          {kitchenwareCatalog.filter((item) => !kwName.trim() || item.name.includes(kwName.trim())).slice(0, 8).map((item) => (
                            <TouchableOpacity key={item.id} onPress={() => setSelectedCatalogKitchenware(item)} className="bg-brand/10 border border-brand/15 px-3 py-2 rounded-xl">
                              <Text className="text-xs font-bold text-brand">{item.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView></View>
                    </View>
                  )}
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">厨具类型</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((cat) => (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => setKwCategory(cat)}
                            className={`items-center rounded-xl border px-3 py-2.5 ${
                              kwCategory === cat
                                ? "bg-brand border-brand"
                                : "bg-canvas border-line"
                            }`}
                          >
                            <Text
                              className={`text-xs ${
                                kwCategory === cat ? "text-white font-bold" : "text-copy-muted"
                              }`}
                            >
                              {cat}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">当前状态</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["常用", "良好", "需保养", "维修中", "闲置"].map((status) => (
                          <TouchableOpacity
                            key={status}
                            onPress={() => setKwStatus(status)}
                            className={`rounded-xl border px-3 py-2 ${
                              kwStatus === status
                                ? "border-brand bg-brand"
                                : "border-line bg-canvas"
                            }`}
                          >
                            <Text className={`text-xs font-bold ${kwStatus === status ? "text-white" : "text-copy-muted"}`}>
                              {status}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">规格 / 备注</Text>
                  <TextInput
                    value={kwNote}
                    onChangeText={setKwNote}
                    placeholder="如: 32L 大容量 双温双控"
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">购买日期（可选）</Text>
                  <SmartDateInput value={kwPurchaseDate} onChange={setKwPurchaseDate} />
                </View>

                <View>
                  <Text className="text-xs font-bold text-copy-muted mb-1">图片 URL（可选）</Text>
                  <TextInput
                    value={kwImageUrl}
                    onChangeText={setKwImageUrl}
                    placeholder="https://..."
                    className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveKitchenware}
                  disabled={savingKitchenware}
                  className="bg-brand py-4 rounded-2xl items-center mt-4 shadow-sm active:opacity-90"
                >
                  {savingKitchenware ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text className="text-base font-bold text-white">
                      {editingKitchenware ? "保存修改" : "确认入库装备"}
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
        <InventoryHistoryModal
          visible={historyModalVisible}
          logs={historyLogs}
          onClose={() => setHistoryModalVisible(false)}
          onClear={handleClearHistory}
        />
        <FamilyShareModal
          visible={familyModalVisible}
          activeHousehold={activeHousehold}
          households={households}
          onClose={() => setFamilyModalVisible(false)}
          onSelectHousehold={(h) => setActiveHousehold(h)}
          onRefreshHouseholds={refreshHouseholds}
        />
      </ScrollView>
    </Screen>
  );
}
