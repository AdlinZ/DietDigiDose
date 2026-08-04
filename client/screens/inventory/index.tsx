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
import { daysUntilDateKey, getInventoryStatus } from "@/utils/inventory";
import { aiApi, inventoryApi, kitchenwareApi, recipesApi } from "@/services/api";
import type { DetectedFood, InventoryItem, KitchenwareCatalogItem, KitchenwareItem, Recipe, StorageLocation } from "./types";
import { inferFoodCategory, MAX_AI_IMAGE_BASE64_LENGTH, normalizeDetectedFoods } from "./scan";

const KITCHENWARE_STARTER_KITS = [
  { name: "轻食减脂", items: ["空气炸锅", "平底锅", "电子秤", "玻璃保鲜盒"] },
  { name: "中式家常", items: ["炒锅", "汤锅", "蒸锅", "菜刀", "砧板"] },
  { name: "烘焙入门", items: ["烤箱", "烤盘", "蛋糕模具", "打蛋器", "硅胶刮刀"] },
] as const;

function catalogList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default function InventoryScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const noticeCardWidth = Math.max(windowWidth - 40, 280);
  const [inventoryGridWidth, setInventoryGridWidth] = useState(0);
  const inventoryCardWidth = inventoryGridWidth > 0
    ? Math.floor((inventoryGridWidth - 20) / 3)
    : undefined;
  const router = useSafeRouter();
  const { action } = useSafeSearchParams<{ action?: string }>();
  const { isAuthenticated, user } = useAuth();
  const inventoryScanJobStorageKey = getUserStorageKey(
    INVENTORY_SCAN_JOB_STORAGE_KEY,
    user?.id,
  );
  const authFetch = useAuthFetch();

  // Top Level Segment State
  const [activeSegment, setActiveSegment] = useState<"inventory" | "recipes" | "kitchenware">("inventory");

  // Kitchenware State
  const [kitchenware, setKitchenware] = useState<KitchenwareItem[]>([]);
  const [kitchenwareCatalog, setKitchenwareCatalog] = useState<KitchenwareCatalogItem[]>([]);
  const [loadingKitchenware, setLoadingKitchenware] = useState(true);
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
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
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
      const results = await Promise.allSettled(selectedFoods.map((item) =>
        inventoryApi.create(authFetch, {
            food_name: item.foodName,
            category: inferFoodCategory(item.foodName),
            quantity: item.quantity,
            expiration_date: suggestedDate(item.estimatedExpireDays),
            storage_location: item.suggestedStorageLocation,
            image_url: null,
        })
      ));
      const addedCount = results.filter((result) => result.status === "fulfilled").length;
      const failedCount = selectedFoods.length - addedCount;
      if (addedCount > 0) await fetchData();
      if (failedCount === 0) {
        if (inventoryScanJobStorageKey) {
          await AsyncStorage.removeItem(inventoryScanJobStorageKey);
        }
        setPendingScanJobId(null);
        setBatchReviewVisible(false);
        Alert.alert("已加入食材库", `已成功入库 ${addedCount} 种食材。`);
      } else {
        Alert.alert("部分入库完成", `已入库 ${addedCount} 种，${failedCount} 种未成功，请重试。`);
      }
    } catch {
      Alert.alert("入库失败", "网络异常，请稍后重试。");
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
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [activeRecipeCategory, setActiveRecipeCategory] = useState("全部");
  const [recipeSearchQuery, setRecipeSearchQuery] = useState("");

  const inventoryCategories = ["全部", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"];
  const recipeCategories = ["全部", "减脂", "增肌", "营养餐单", "快手菜"];

  const fetchData = useCallback(async () => {
    // Fetch recipes regardless of auth state
    try {
      setLoadingRecipes(true);
      const data = await recipesApi.list<Recipe>();
      setRecipes(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Fetch recipes error:", e);
    } finally {
      setLoadingRecipes(false);
    }

    // Fetch inventory if logged in
    if (!isAuthenticated) {
      setLoadingItems(false);
      setLoadingKitchenware(false);
      setKitchenware([]);
      return;
    }
    try {
      setLoadingItems(true);
      setLoadingKitchenware(true);
      const [inventoryData, kitchenwareData, catalogData] = await Promise.all([
        inventoryApi.list(authFetch),
        kitchenwareApi.list<KitchenwareItem>(authFetch),
        kitchenwareApi.catalog<KitchenwareCatalogItem>(authFetch),
      ]);
      setItems(Array.isArray(inventoryData) ? inventoryData : []);
      setKitchenware(Array.isArray(kitchenwareData) ? kitchenwareData : []);
      setKitchenwareCatalog(Array.isArray(catalogData) ? catalogData : []);
    } catch (e) {
      console.error("Fetch inventory or kitchenware error:", e);
    } finally {
      setLoadingItems(false);
      setLoadingKitchenware(false);
    }
  }, [isAuthenticated, authFetch]);

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

      if (editingItem) await inventoryApi.update(authFetch, editingItem.id, payload);
      else await inventoryApi.create(authFetch, payload);
        if (!editingItem && pendingScanJobId) {
          if (inventoryScanJobStorageKey) {
            await AsyncStorage.removeItem(inventoryScanJobStorageKey);
          }
          setPendingScanJobId(null);
        }
        setModalVisible(false);
        fetchData();
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
            await inventoryApi.remove(authFetch, id);
              setModalVisible(false);
              setEditingItem(null);
              fetchData();
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
      await inventoryApi.update(authFetch, item.id, { storage_location: storageLocation });
    } catch {
      setItems((currentItems) =>
        currentItems.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, storage_location: previousLocation } : currentItem,
        ),
      );
      Alert.alert("移动失败", "未能更新食材的存放位置，请稍后重试。");
    }
  }, [authFetch]);

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
      return { text: `新鲜 ${diffDays}天`, bg: "bg-[#2D6A4F]/15", color: "text-[#2D6A4F]" };
    }
  };

  const filteredItems = items.filter((item) => {
    if (activeInventoryCategory === "全部") return true;
    const storageFilterMap: Record<string, StorageLocation> = {
      冷藏库: "冷藏",
      冷冻库: "冷冻",
      常温库: "常温",
    };
    const storageFilter = storageFilterMap[activeInventoryCategory];
    if (storageFilter) {
      const itemStorage = (["冷藏", "冷冻", "常温"].includes(item.storage_location)
        ? item.storage_location
        : "常温") as StorageLocation;
      return itemStorage === storageFilter;
    }
    return item.category === activeInventoryCategory;
  });

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

  const filteredRecipes = recipes
    .filter((r) => {
      const matchCategory =
        activeRecipeCategory === "全部" ||
        activeRecipeCategory === "冰箱可做" ||
        r.category === activeRecipeCategory;
      const matchSearch =
        !recipeSearchQuery ||
        r.title.includes(recipeSearchQuery) ||
        r.description?.includes(recipeSearchQuery);
      return matchCategory && matchSearch;
    })
    .sort((a, b) => {
      const itemNames = items.map((i) => i.food_name);

      const scoreA = itemNames.reduce((acc, name) => {
        return a.title.includes(name) || a.description?.includes(name) ? acc + 10 : acc;
      }, 0);

      const scoreB = itemNames.reduce((acc, name) => {
        return b.title.includes(name) || b.description?.includes(name) ? acc + 10 : acc;
      }, 0);

      // 冰箱中匹配食材种类越多的菜谱，自动置顶优先推荐！
      return scoreB - scoreA;
    });

  return (
    <Screen backgroundColor="#FDF8F0" safeAreaEdges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 160 }}
        className="bg-[#FDF8F0]"
      >
        {/* 与首页统一的深绿品牌头部 */}
        <View className="relative overflow-hidden rounded-b-[26px] bg-[#2D6A4F] px-5 pt-3 pb-4 shadow-sm">
          <View className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/5" />
          <View className="absolute left-1/3 -bottom-12 h-32 w-32 rounded-full bg-[#E9C46A]/10" />

          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-[10px] font-bold tracking-wider text-emerald-100/80">膳食资产</Text>
              <Text className="mt-0.5 text-lg font-black text-white">{activeSegmentMeta.title}</Text>
              <Text className="mt-0.5 text-[10px] font-medium text-emerald-100/80">{activeSegmentMeta.subtitle}</Text>
            </View>
            <View className="mt-1 flex-row items-center gap-1.5 rounded-full border border-white/15 bg-black/15 px-3 py-1.5">
              <View className={`h-1.5 w-1.5 rounded-full ${activeSegment === "inventory" && expiringCount > 0 ? "bg-[#E9C46A]" : "bg-emerald-200"}`} />
              <Text className="text-[10px] font-bold text-white">{activeSegmentMeta.status}</Text>
            </View>
          </View>

          <View className="mt-3 flex-row rounded-2xl border border-white/30 bg-white/95 p-1 shadow-sm">
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
                  className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-xl py-2 ${
                    isActive ? "bg-[#EDF4EF]" : "bg-transparent"
                  }`}
                >
                  <FontAwesome6
                    name={segment.icon as any}
                    size={12}
                    color={isActive ? "#2D6A4F" : "#9B8E7D"}
                  />
                  <Text className={`text-xs ${isActive ? "font-black text-[#2D6A4F]" : "font-bold text-[#8B7D6B]"}`}>
                    {segment.label}
                  </Text>
                  <Text className={`text-[9px] font-bold ${isActive ? "text-[#2D6A4F]/65" : "text-[#B2A89A]"}`}>
                    {segment.count}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* CONTENT SEGMENT 1: INVENTORY */}
        {activeSegment === "inventory" && (
          <View className="flex-1">
            {!isAuthenticated ? (
              <View className="flex-1 items-center justify-center p-6">
                <View className="w-20 h-20 bg-[#2D6A4F]/10 rounded-full items-center justify-center mb-4">
                  <FontAwesome6 name="basket-shopping" size={32} color="#2D6A4F" />
                </View>
                <Text className="text-xl font-bold text-[#3D3229]">解锁智能食材保鲜库</Text>
                <Text className="text-sm text-[#8B7D6B] text-center mt-2 mb-6">
                  登录后可随时记录冰箱食材、自动临期提醒并智能生成美味菜单。
                </Text>
                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => router.push("/login")}
                    className="bg-[#2D6A4F] px-6 py-3 rounded-2xl shadow-sm active:opacity-90"
                  >
                    <Text className="text-sm font-bold text-white">立即登录</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push("/login")}
                    className="bg-[#E9C46A] px-6 py-3 rounded-2xl shadow-sm active:opacity-90 flex-row items-center gap-1.5"
                  >
                    <FontAwesome6 name="wand-magic-sparkles" size={13} color="#3D3229" />
                    <Text className="text-sm font-black text-[#3D3229]">登录后体验</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                {/* Category Slider & Smart Storage Filter */}
                <View className="bg-[#FDF8F0] py-2">
                  <View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerClassName="gap-1 px-5"
                  >
                    {["全部", "冷藏库", "冷冻库", "常温库", "蔬菜", "肉食", "水果", "乳制品", "粮油干货"].map((cat) => {
                      const cleanCat = cat.split(" ")[0];
                      const isActive = activeInventoryCategory === cleanCat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => setActiveInventoryCategory(cleanCat)}
                          className={`px-3 py-1.5 rounded-full ${
                            isActive
                              ? "bg-[#E4EFE8]"
                              : "bg-transparent"
                          }`}
                        >
                          <Text
                            className={`text-xs font-bold ${
                              isActive ? "text-[#2D6A4F] font-black" : "text-[#8B7D6B]"
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

                {/* 🎠 单行极简横向轮播通知卡片集 (Single Swipeable Smart Notice Carousel) */}
                <View className="bg-[#FDF8F0] px-5 pb-2.5">
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
                                className="bg-[#FFF6E7] p-2.5 rounded-2xl flex-row items-center justify-between active:opacity-90"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-8 h-8 rounded-xl bg-[#F6E1BD] items-center justify-center">
                                    <FontAwesome6 name="bell" size={12} color="#A8641D" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-xs font-black text-[#3D3229] mb-0.5">
                                      {urgentExpiringItems.length} 件需要优先处理
                                    </Text>
                                    <Text numberOfLines={1} className="text-[11px] text-[#8B7D6B] font-medium">
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
                                className="bg-[#EDF5EF] p-3 rounded-2xl flex-row items-center justify-between"
                              >
                                <View className="flex-row items-center gap-2.5 flex-1 mr-2">
                                  <View className="w-9 h-9 rounded-xl bg-white/70 items-center justify-center">
                                    <FontAwesome6 name="heart-pulse" size={14} color="#2D6A4F" />
                                  </View>
                                  <View className="flex-1">
                                    <Text className="text-xs font-black text-[#3D3229] mb-0.5">智能保鲜周报</Text>
                                    <Text className="text-[11px] text-[#8B7D6B] font-medium">
                                      全库 {items.length} 件食材均在最佳赏味期
                                    </Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-[#2D6A4F]">去配餐</Text>
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
                                  <Text className="text-xs font-black text-[#3D3229] mb-0.5">{pendingScanJobId ? "上次识别结果待确认" : "AI 拍照小票/食材一键入库"}</Text>
                                  <Text className="text-[10px] text-[#8B7D6B]">{pendingScanJobId ? "点此继续查看并确认入库" : "自动识别食材名分量与建议保质期"}</Text>
                                </View>
                              </View>
                              {scanningReceipt ? (
                                <ActivityIndicator size="small" color="#3D3229" />
                              ) : pendingScanJobId ? (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-[#2D6A4F]">查看</Text>
                                  <FontAwesome6 name="chevron-right" size={9} color="#2D6A4F" />
                                </View>
                              ) : (
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-[#2D6A4F]">拍照</Text>
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
                                    <Text className="text-xs font-black text-[#3D3229] mb-0.5">现有食材极速烹饪匹配</Text>
                                    <Text className="text-[10px] text-[#8B7D6B]">用现有 {items.length} 种食材极速匹配食谱</Text>
                                  </View>
                                </View>
                                <View className="flex-row items-center gap-1">
                                  <Text className="text-[11px] font-black text-[#2D6A4F]">去匹配</Text>
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
                    <View className="py-16 items-center bg-white/60 rounded-[28px] border border-[#EBE3D5] p-6">
                      <FontAwesome6 name="snowflake" size={36} color="#D4A276" />
                      <Text className="text-base font-bold text-[#3D3229] mt-3">保鲜仓暂无此类食材</Text>
                      <Text className="text-xs text-[#8B7D6B] mt-1">点击右上角“录入食材”添加食材到冰箱吧！</Text>
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
                            className={`mb-4 rounded-[24px] border p-4 ${group.folderBg}`}
                          >
                            {/* 手机系统大文件夹 标题 Header */}
                            <View className="flex-row items-center justify-between mb-3 px-1">
                              <View className="flex-row items-center gap-2">
                                <View className={`w-9 h-9 rounded-xl items-center justify-center ${group.iconBg}`}>
                                  <FontAwesome6 name={group.icon as any} size={14} color={group.iconColor} />
                                </View>
                                <View>
                                  <Text className="text-[15px] font-black text-[#3D3229]">{group.title}</Text>
                                  <Text className="text-[11px] text-[#8B7D6B] font-medium mt-0.5">{group.subtitle}</Text>
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
                                  className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center active:opacity-80"
                                >
                                  <FontAwesome6 name="plus" size={11} color="#FFFFFF" />
                                </TouchableOpacity>
                              </View>
                            </View>

                            {/* 手机系统大文件夹核心：App 图标式多列网格 (Grid Layout) */}
                            {group.items.length === 0 ? (
                              <View className="py-6 items-center bg-white/60 rounded-[22px] border border-dashed border-[#EBE3D5]">
                                <Text className="text-xs text-[#8B7D6B]">文件夹空空如也，点击右上角 + 入库</Text>
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
                                  const diffDays = daysUntilDateKey(item.expiration_date) ?? 0;

                                  let badgeBg = "bg-emerald-500/15";
                                  let statusBadgeText = `保鲜${diffDays}天`;
                                  let textColor = "text-emerald-700";

                                  if (diffDays < 0) {
                                    badgeBg = "bg-rose-500/15";
                                    statusBadgeText = "已到期";
                                    textColor = "text-rose-700";
                                  } else if (diffDays <= 1) {
                                    badgeBg = "bg-amber-500/15";
                                    statusBadgeText = "急需消耗";
                                    textColor = "text-amber-800";
                                  } else if (diffDays <= 3) {
                                    badgeBg = "bg-amber-400/15";
                                    statusBadgeText = `剩${diffDays}天`;
                                    textColor = "text-amber-700";
                                  }

                                  return (
                                    <Animated.View
                                      key={item.id}
                                      {...createItemPanResponder(item).panHandlers}
                                      style={[
                                        { width: inventoryCardWidth || "30%" },
                                        draggedItemId === item.id && {
                                          zIndex: 30,
                                          elevation: 30,
                                          opacity: 0.92,
                                          transform: [...dragPan.getTranslateTransform(), { scale: 1.04 }],
                                        },
                                      ]}
                                      className="bg-[#FAFBF8] p-3 rounded-2xl items-center relative overflow-hidden"
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
                                        className="items-center w-full"
                                      >
                                        {item.image_url ? (
                                          <Image
                                            source={{ uri: item.image_url }}
                                            className="w-13 h-13 rounded-2xl bg-[#EDF3EF]"
                                          />
                                        ) : (
                                          <View className="w-13 h-13 rounded-2xl bg-[#EAF2EC] items-center justify-center">
                                            <FontAwesome6 name="lemon" size={20} color="#2D6A4F" />
                                          </View>
                                        )}

                                        <Text
                                          numberOfLines={1}
                                          className="text-[13px] font-black text-[#3D3229] mt-2.5 text-center"
                                        >
                                          {item.food_name}
                                        </Text>
                                        <Text className="text-[11px] text-[#6F6254] mt-1 font-semibold">
                                          {item.quantity}
                                        </Text>
                                        <View
                                          className={`mt-2 px-2 py-1 rounded-full ${badgeBg}`}
                                        >
                                          <Text className={`text-[10px] font-black ${textColor}`}>{statusBadgeText}</Text>
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
                                  style={{ width: inventoryCardWidth || "30%" }}
                                  className="bg-transparent p-2.5 rounded-2xl border border-dashed border-[#DDD2C3] items-center justify-center min-h-[132px] active:bg-white/70"
                                >
                                  <View className="w-9 h-9 rounded-full bg-[#F5EFE6] items-center justify-center mb-1">
                                    <FontAwesome6 name="plus" size={14} color="#8B7D6B" />
                                  </View>
                                  <Text className="text-[10px] font-bold text-[#8B7D6B]">存入{group.key}</Text>
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
            <View className="mx-5 mt-3 mb-2.5 flex-row items-center justify-between">
              <View>
                <Text className="text-base font-black text-[#3D3229]">食谱广场</Text>
                <Text className="mt-0.5 text-[10px] text-[#8B7D6B]">官方精选与食友投稿</Text>
              </View>
              <TouchableOpacity
                onPress={() => router.push("/recipe-submit")}
                className="flex-row items-center rounded-xl bg-[#E7F0EA] px-3 py-2"
              >
                <FontAwesome6 name="pen" size={10} color="#2D6A4F" />
                <Text className="ml-1.5 text-[11px] font-black text-[#2D6A4F]">投稿 / 我的</Text>
              </TouchableOpacity>
            </View>
            {/* Search Input & Filter */}
            <View className="mb-2">
              <View className="mx-5 mb-2.5 flex-row items-center rounded-2xl border border-[#EBE3D5] bg-white px-4 py-2.5">
                <FontAwesome6 name="magnifying-glass" size={13} color="#8B7D6B" className="mr-2" />
                <TextInput
                  value={recipeSearchQuery}
                  onChangeText={setRecipeSearchQuery}
                  placeholder="搜索食材名、卡路里或菜谱..."
                  className="flex-1 text-xs text-[#3D3229]"
                />
                {recipeSearchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setRecipeSearchQuery("")}>
                    <FontAwesome6 name="xmark" size={13} color="#8B7D6B" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Recipe Filter Categories */}
              <View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="gap-1 px-5 pb-1"
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
                      className={`px-3 py-1.5 rounded-full ${
                        isActive
                          ? "bg-[#E4EFE8]"
                          : "bg-transparent"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${
                          isActive ? "text-[#2D6A4F] font-black" : "text-[#8B7D6B]"
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

            {/* Recipe List: 2-Column Waterfall Bento Cards */}
            <View className="px-4 pt-1 pb-4">
              {loadingRecipes ? (
                <View className="py-16 items-center">
                  <ActivityIndicator size="large" color="#2D6A4F" />
                </View>
              ) : filteredRecipes.length === 0 ? (
                <View className="py-16 items-center bg-white/60 rounded-[28px] border border-[#EBE3D5] p-6">
                  <FontAwesome6 name="utensils" size={36} color="#D4A276" />
                  <Text className="text-base font-bold text-[#3D3229] mt-3">未找到匹配的食谱</Text>
                  <Text className="text-xs text-[#8B7D6B] mt-1">尝试搜索其他食材或切换分类</Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap justify-between gap-y-3.5">
                  {filteredRecipes.map((recipe) => {
                    // 计算冰箱食材与食谱的匹配度
                    const itemNames = items.map((i) => i.food_name);
                    const isFullyMatched = itemNames.some(
                      (name) => recipe.title.includes(name) || recipe.description?.includes(name)
                    );

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
                            {recipe.image_url ? (
                              <Image
                                source={{ uri: recipe.image_url }}
                                className="h-28 w-full"
                                resizeMode="cover"
                              />
                            ) : (
                              <View className="h-28 w-full items-center justify-center bg-[#EAF2EC]">
                                <View className="h-11 w-11 items-center justify-center rounded-2xl bg-white/70">
                                  <FontAwesome6 name="utensils" size={18} color="#2D6A4F" />
                                </View>
                              </View>
                            )}
                            {/* 卡路里胶囊 */}
                            <View className="absolute top-2 right-2 flex-row items-center gap-1 rounded-full bg-black/60 px-2 py-0.5">
                              <FontAwesome6 name="fire" size={9} color="#E9C46A" />
                              <Text className="text-[10px] font-black text-white">
                                {recipe.calories} kcal
                              </Text>
                            </View>

                            {/* 冰箱食材匹配角标 */}
                            {isFullyMatched ? (
                              <View className="absolute top-2 left-2 rounded-full bg-[#2D6A4F] px-2 py-0.5">
                                <Text className="text-[9px] font-black text-white">库存可做</Text>
                              </View>
                            ) : (
                              <View className="absolute top-2 left-2 rounded-full bg-black/35 px-2 py-0.5">
                                <Text className="text-[9px] font-bold text-white">{recipe.category}</Text>
                              </View>
                            )}
                          </View>

                          <View className="p-3 pb-2.5">
                            <Text numberOfLines={1} className="text-sm font-black text-[#3D3229]">
                              {recipe.title}
                            </Text>
                            <Text className="mt-1 min-h-[30px] text-[10px] font-medium leading-4 text-[#8B7D6B]" numberOfLines={2}>
                              {recipe.description}
                            </Text>

                            {/* 首页同款轻量信息行：列表只保留决策所需信息 */}
                            <View className="mt-2 flex-row items-center gap-1.5">
                              <FontAwesome6 name="clock" size={9} color="#8B7D6B" />
                              <Text className="text-[9px] font-bold text-[#6F6254]">{recipe.cook_time} 分钟</Text>
                              <View className="h-1 w-1 rounded-full bg-[#D7CCBE]" />
                              <Text className="text-[9px] font-bold text-[#2D6A4F]">蛋白 {recipe.protein}g</Text>
                            </View>
                          </View>
                        </TouchableOpacity>

                        {/* 整卡查看详情，只保留一个明确的快捷动作 */}
                        <View className="px-3 pb-3">
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
                            <Text className="text-[10px] font-black text-[#2D6A4F]">AI 烹饪指导</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        )}

        {/* CONTENT SEGMENT 3: KITCHENWARE */}
        {activeSegment === "kitchenware" && !isAuthenticated && (
          <View className="mx-5 mt-8 items-center rounded-[28px] border border-[#EBE3D5] bg-white px-6 py-10">
            <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-[#2D6A4F]/10">
              <FontAwesome6 name="fire-burner" size={22} color="#2D6A4F" />
            </View>
            <Text className="text-base font-black text-[#3D3229]">登录后管理你的厨具</Text>
            <Text className="mt-2 text-center text-xs leading-5 text-[#8B7D6B]">
              记录锅具、刀具和小家电，获得更匹配的食谱与保养提醒。
            </Text>
            <TouchableOpacity
              onPress={() => router.push("/login")}
              className="mt-5 rounded-2xl bg-[#2D6A4F] px-8 py-3"
            >
              <Text className="text-sm font-black text-white">立即登录</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeSegment === "kitchenware" && isAuthenticated && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, paddingTop: 6 }}
            className="flex-1"
          >
            {/* 厨具智能保养与闲置唤醒 Banner */}
            <View className="bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 p-3.5 rounded-[22px] mb-3.5 flex-row items-center gap-3 shadow-2xs">
              <View className="w-10 h-10 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs">
                <FontAwesome6 name="plug" size={16} color="#FFF" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-xs font-black text-[#2D6A4F]">厨具保养与闲置唤醒</Text>
                  <Text className="text-[10px] font-bold text-[#8B7D6B]">智能监视中</Text>
                </View>
                <Text className="text-[11px] text-[#3D3229] mt-0.5" numberOfLines={1}>
                  {kitchenware.some((item) => item.status === "需保养" || item.status === "维修中")
                    ? `有 ${kitchenware.filter((item) => item.status === "需保养" || item.status === "维修中").length} 件厨具需要关注`
                    : kitchenware.length
                      ? "当前装备状态良好，可随时记录保养"
                      : "录入厨具后可获得状态与保养提醒"}
                </Text>
              </View>
            </View>

            <View className="mb-4 rounded-[22px] border border-[#EBE3D5] bg-white p-3.5">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-xs font-black text-[#3D3229]">一键配置厨房装备</Text>
                  <Text className="mt-0.5 text-[10px] text-[#8B7D6B]">从官方标准库选择，之后仍可单独编辑</Text>
                </View>
                <FontAwesome6 name="wand-magic-sparkles" size={15} color="#D4A276" />
              </View>
              <View className="mt-3">
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View className="flex-row gap-2 pr-3">
                  {KITCHENWARE_STARTER_KITS.map((kit) => (
                    <TouchableOpacity key={kit.name} disabled={Boolean(addingStarterKit)} onPress={() => addStarterKit(kit)} className="rounded-xl border border-[#2D6A4F]/20 bg-[#E7F0EA] px-3 py-2 disabled:opacity-50">
                      <Text className="text-[11px] font-black text-[#2D6A4F]">{addingStarterKit === kit.name ? "添加中…" : kit.name}</Text>
                      <Text className="mt-0.5 text-[9px] text-[#6F6254]">{kit.items.join(" · ")}</Text>
                    </TouchableOpacity>
                  ))}
                  </View>
                </ScrollView>
              </View>
            </View>

            {/* 厨具分类 Selector + 录入新厨具按键 */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="mr-2 flex-1">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row gap-2">
                  {["全部", "小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setActiveKitchenwareCategory(cat)}
                      className={`px-3.5 py-1.5 rounded-full border ${
                        activeKitchenwareCategory === cat
                          ? "bg-[#2D6A4F] border-[#2D6A4F]"
                          : "bg-white border-[#EBE3D5]"
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold ${
                          activeKitchenwareCategory === cat ? "text-white font-black" : "text-[#8B7D6B]"
                        }`}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <TouchableOpacity
                onPress={() => openKitchenwareModal()}
                className="bg-[#2D6A4F] px-3 py-1.5 rounded-full flex-row items-center gap-1 shadow-2xs active:scale-95"
              >
                <FontAwesome6 name="plus" size={10} color="#FFF" />
                <Text className="text-xs font-black text-white">录入厨具</Text>
              </TouchableOpacity>
            </View>

            {/* 厨具卡片双列 Bento 布局 */}
            {loadingKitchenware ? (
              <View className="items-center py-16">
                <ActivityIndicator color="#2D6A4F" />
                <Text className="mt-3 text-xs text-[#8B7D6B]">正在加载厨具装备...</Text>
              </View>
            ) : kitchenware.length === 0 ? (
              <View className="items-center rounded-[24px] border border-dashed border-[#D8CCBA] bg-white px-6 py-12">
                <FontAwesome6 name="kitchen-set" size={28} color="#8B7D6B" />
                <Text className="mt-4 text-sm font-black text-[#3D3229]">还没有录入厨具</Text>
                <Text className="mt-1 text-center text-xs text-[#8B7D6B]">
                  添加空气炸锅、炒锅或烘焙工具，数据会同步保存。
                </Text>
                <TouchableOpacity
                  onPress={() => openKitchenwareModal()}
                  className="mt-5 rounded-full bg-[#2D6A4F] px-5 py-2.5"
                >
                  <Text className="text-xs font-black text-white">录入第一件厨具</Text>
                </TouchableOpacity>
              </View>
            ) : (
            <View className="flex-row flex-wrap justify-between gap-y-3.5">
              {kitchenware
                .filter(
                  (kw) =>
                    activeKitchenwareCategory === "全部" ||
                    kw.category === activeKitchenwareCategory
                )
                .map((kw) => (
                  <View
                    key={kw.id}
                    style={{ width: "48.5%" }}
                    className="bg-white rounded-[24px] overflow-hidden border border-[#EBE3D5] shadow-xs flex-col justify-between p-3"
                  >
                    <View>
                      <View className="relative mb-2">
                        {kw.image_url ? (
                          <Image
                            source={{ uri: kw.image_url }}
                            className="w-full h-28 rounded-2xl border border-[#EBE3D5]"
                            resizeMode="cover"
                          />
                        ) : (
                          <View className="h-28 w-full items-center justify-center rounded-2xl border border-[#EBE3D5] bg-[#F5EFE6]">
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

                      <Text numberOfLines={1} className="text-sm font-black text-[#3D3229]">
                        {kw.name}
                      </Text>
                      <Text numberOfLines={2} className="text-[10px] text-[#8B7D6B] mt-0.5 font-medium">
                        {kw.note}
                      </Text>
                    </View>

                    {/* 底部功能栏 */}
                    <View className="mt-2.5 pt-2 border-t border-[#F5EFE6] flex-row items-center justify-between gap-1">
                      <TouchableOpacity
                        onPress={() =>
                          router.push({
                            pathname: "/ai-assistant",
                            params: {
                              prompt: `请为我的【${kw.name}】推荐 3 道专属极速美味食谱，附带所需食材与操作技巧！`,
                            },
                          })
                        }
                        className="bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 flex-1 py-1 rounded-xl items-center flex-row justify-center gap-1 active:opacity-80"
                      >
                        <FontAwesome6 name="wand-magic-sparkles" size={8} color="#2D6A4F" />
                        <Text className="text-[9px] font-black text-[#2D6A4F]">AI 菜谱</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleMaintainKitchenware(kw)}
                        className="bg-[#F5EFE6] px-2 py-1 rounded-xl items-center flex-row justify-center gap-1"
                      >
                        <FontAwesome6 name="wrench" size={8} color="#8B7D6B" />
                        <Text className="text-[9px] font-bold text-[#8B7D6B]">保养</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
            </View>
            )}
          </ScrollView>
        )}

        {/* Inventory Add/Edit Modal */}
        <Modal visible={modalVisible && isAuthenticated} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] px-5 pt-5 pb-6 max-h-[90%]">
              <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
                <View>
                  <Text className="text-lg font-black text-[#3D3229]">
                    {editingItem ? "编辑食材" : entryMode === "choose" ? "添加食材" : "手动录入"}
                  </Text>
                  {!editingItem && <Text className="text-[11px] text-[#8B7D6B] mt-0.5">{entryMode === "choose" ? "选一种最适合你的录入方式" : "填好名称、数量和到期日即可入库"}</Text>}
                </View>
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  accessibilityLabel="关闭录入食材弹窗"
                  className="w-9 h-9 -mr-2 items-center justify-center rounded-full bg-[#FDF8F0]"
                >
                  <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              {!editingItem && entryMode === "choose" ? (
                <View className="pb-2">
                  <Text className="mt-1 text-xl font-black text-[#3D3229]">这次怎么添加？</Text>
                  <Text className="mt-1 text-xs leading-5 text-[#8B7D6B]">单个食材、购物清单或订单截图都可以，识别多项后再由你确认。</Text>

                  <TouchableOpacity
                    onPress={openAiFoodAssist}
                    disabled={aiAssisting}
                    className="mt-5 overflow-hidden rounded-[24px] bg-[#2D6A4F] p-5 active:opacity-90 disabled:opacity-60"
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

                  <TouchableOpacity onPress={() => setEntryMode("manual")} className="mt-3 flex-row items-center rounded-[22px] border border-[#EBE3D5] bg-[#FDF8F0] p-4 active:opacity-80">
                    <View className="h-10 w-10 items-center justify-center rounded-xl bg-white">
                      <FontAwesome6 name="pen" size={14} color="#8B7D6B" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-sm font-black text-[#3D3229]">手动填写</Text>
                      <Text className="mt-0.5 text-[10px] text-[#8B7D6B]">适合没有照片，或想自己精确填写时</Text>
                    </View>
                    <FontAwesome6 name="chevron-right" size={12} color="#8B7D6B" />
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => { setModalVisible(false); handleScanReceiptAndBatchAdd(); }} className="mt-4 flex-row items-center justify-center gap-2 py-3">
                    <FontAwesome6 name="receipt" size={13} color="#2D6A4F" />
                    <Text className="text-xs font-bold text-[#2D6A4F]">有一整张小票或多种食材？批量导入</Text>
                  </TouchableOpacity>
                </View>
              ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerClassName="pb-2">
                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1.5">食材名称 <Text className="text-[#C2413A]">*</Text></Text>
                  <TextInput
                    value={foodName}
                    onChangeText={setFoodName}
                    placeholder="例如：牛油果、希腊酸奶"
                    autoFocus={!editingItem}
                    returnKeyType="next"
                    className="bg-[#FDF8F0] px-4 py-3.5 rounded-2xl border border-[#EBE3D5] text-base font-semibold text-[#3D3229]"
                  />
                </View>

                <View className="mt-4">
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-2">分类</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row" contentContainerClassName="gap-2 pr-4">
                      {["蔬菜", "肉食", "水果", "乳制品", "粮油干货"].map((c) => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setCategory(c)}
                          className={`px-3.5 py-2 rounded-xl border ${
                            category === c ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-[#EBE3D5]"
                          }`}
                        >
                          <Text className={`text-xs ${category === c ? "text-white font-bold" : "text-[#8B7D6B] font-medium"}`}>
                            {c}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>

                <View className="flex-row gap-3 mt-4">
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-[#8B7D6B] mb-1.5">数量 <Text className="text-[#C2413A]">*</Text></Text>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      placeholder="如: 500g, 2盒"
                      className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm font-semibold text-[#3D3229]"
                    />
                    <View className="flex-row gap-1.5 mt-2">
                      {["100g", "1份", "2盒"].map((value) => (
                        <TouchableOpacity key={value} onPress={() => setQuantity(value)} className="px-2 py-1 rounded-lg bg-[#F5EFE6]">
                          <Text className="text-[10px] font-semibold text-[#8B7D6B]">{value}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View className="flex-1">
                    <Text className="text-xs font-bold text-[#8B7D6B] mb-1.5">存放位置</Text>
                    <View className="flex-row gap-1">
                      {["冷藏", "冷冻", "常温"].map((loc) => (
                        <TouchableOpacity
                          key={loc}
                          onPress={() => setStorageLocation(loc)}
                          className={`flex-1 py-2 rounded-xl border items-center ${
                            storageLocation === loc ? "bg-[#3D3229] border-[#3D3229]" : "bg-[#FDF8F0] border-[#EBE3D5]"
                          }`}
                        >
                          <Text className={`text-xs ${storageLocation === loc ? "text-white font-bold" : "text-[#8B7D6B]"}`}>
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
                      <View className="w-7 h-7 rounded-full bg-[#E9C46A]/30 items-center justify-center">
                        <FontAwesome6 name="bell" size={11} color="#9A6B10" />
                      </View>
                      <View>
                        <Text className="text-xs font-black text-[#3D3229]">到期提醒</Text>
                        <Text className="text-[10px] text-[#8B7D6B]">我们会在临期时提醒你优先食用</Text>
                      </View>
                    </View>
                    <Text className="text-[10px] font-bold text-[#2D6A4F]">{storageLocation}</Text>
                  </View>
                  <View className="flex-row gap-2 mb-3">
                    {[{ label: "3天", days: 3 }, { label: "7天", days: 7 }, { label: "30天", days: 30 }].map(({ label, days }) => {
                      const date = dateKeyAfterDays(days);
                      const selected = expirationDate === date;
                      return (
                        <TouchableOpacity key={label} onPress={() => setExpirationDate(date)} className={`flex-1 items-center py-1.5 rounded-xl border ${selected ? "bg-[#2D6A4F] border-[#2D6A4F]" : "bg-white border-[#EBE3D5]"}`}>
                          <Text className={`text-[11px] font-bold ${selected ? "text-white" : "text-[#8B7D6B]"}`}>{label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <SmartDateInput value={expirationDate} onChange={setExpirationDate} />
                </View>

                <View className="mt-3 rounded-2xl border border-[#EBE3D5] bg-white p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      {imageUrl ? (
                        <Image source={{ uri: imageUrl }} className="h-9 w-9 rounded-xl bg-[#F5EFE6]" />
                      ) : (
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-[#F5EFE6]">
                          <FontAwesome6 name="image" size={14} color="#8B7D6B" />
                        </View>
                      )}
                      <View>
                        <Text className="text-xs font-bold text-[#3D3229]">食材照片 <Text className="font-medium text-[#8B7D6B]">（可选）</Text></Text>
                        <Text className="mt-0.5 text-[10px] text-[#8B7D6B]">{imageUrl ? "照片已添加" : "方便以后快速辨认"}</Text>
                      </View>
                    </View>
                    <View className="flex-row gap-2">
                      <TouchableOpacity onPress={() => selectFoodPhoto("camera")} className="h-9 w-9 items-center justify-center rounded-xl bg-[#2D6A4F]/10">
                        <FontAwesome6 name="camera" size={13} color="#2D6A4F" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => selectFoodPhoto("library")} className="h-9 w-9 items-center justify-center rounded-xl bg-[#F5EFE6]">
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
                      className="flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl bg-[#EAF2EC] py-3"
                    >
                      <FontAwesome6 name="wand-magic-sparkles" size={11} color="#2D6A4F" />
                      <Text className="text-xs font-black text-[#2D6A4F]">用它配餐</Text>
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
                  className="bg-[#2D6A4F] py-4 rounded-2xl items-center mt-4 shadow-sm active:opacity-90"
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text className="text-base font-bold text-white">{editingItem ? "保存修改" : "加入食材库"}</Text>
                  )}
                </TouchableOpacity>
                {!editingItem && (
                  <TouchableOpacity onPress={() => setEntryMode("choose")} className="items-center py-3">
                    <Text className="text-xs font-bold text-[#8B7D6B]">选择其他录入方式</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* AI multi-item review modal */}
        <Modal visible={batchReviewVisible} animationType="slide" transparent onRequestClose={() => setBatchReviewVisible(false)}>
          <View className="flex-1 justify-end bg-black/40">
            <View className="max-h-[88%] rounded-t-[32px] bg-white px-5 pt-5 pb-6">
              <View className="flex-row items-start justify-between border-b border-[#F5EFE6] pb-4">
                <View className="flex-1 pr-3">
                  <Text className="text-lg font-black text-[#3D3229]">确认识别结果</Text>
                  <Text className="mt-1 text-[11px] leading-4 text-[#8B7D6B]">识别到 {detectedFoods.length} 种食材；取消勾选不需要入库的项目。</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setBatchReviewVisible(false)}
                  accessibilityLabel="关闭识别结果"
                  className="h-9 w-9 items-center justify-center rounded-full bg-[#FDF8F0]"
                >
                  <FontAwesome6 name="xmark" size={17} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <ScrollView className="mt-3" showsVerticalScrollIndicator={false} contentContainerClassName="gap-2 pb-3">
                {detectedFoods.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => setDetectedFoods((current) => current.map((food) => food.id === item.id ? { ...food, selected: !food.selected } : food))}
                    className={`flex-row items-center rounded-2xl border p-3.5 ${item.selected ? "border-[#2D6A4F]/30 bg-[#2D6A4F]/5" : "border-[#EBE3D5] bg-[#FDF8F0] opacity-60"}`}
                  >
                    <View className={`mr-3 h-6 w-6 items-center justify-center rounded-full ${item.selected ? "bg-[#2D6A4F]" : "border border-[#CFC4B4] bg-white"}`}>
                      {item.selected && <FontAwesome6 name="check" size={11} color="#FFF" />}
                    </View>
                    <View className="flex-1">
                      <Text className="text-sm font-black text-[#3D3229]">{item.foodName}</Text>
                      <Text className="mt-1 text-[11px] text-[#8B7D6B]">{item.quantity} · {item.suggestedStorageLocation} · 建议 {item.estimatedExpireDays} 天内食用</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View className="mt-3 flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setDetectedFoods((current) => current.map((item) => ({ ...item, selected: !current.every((food) => food.selected) })))}
                  className="items-center justify-center rounded-2xl border border-[#EBE3D5] bg-[#FDF8F0] px-4"
                >
                  <Text className="text-xs font-bold text-[#8B7D6B]">全选</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={saveDetectedFoods}
                  disabled={savingDetectedFoods}
                  className="flex-1 items-center rounded-2xl bg-[#2D6A4F] py-4 active:opacity-90 disabled:opacity-60"
                >
                  {savingDetectedFoods ? <ActivityIndicator color="#FFF" /> : <Text className="text-base font-black text-white">加入 {detectedFoods.filter((item) => item.selected).length} 项食材</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Official kitchenware detail: separate catalog knowledge from a user's owned asset. */}
        <Modal visible={Boolean(selectedCatalogKitchenware)} animationType="fade" transparent>
          <View className="flex-1 items-center justify-center bg-black/40 p-5">
            {selectedCatalogKitchenware ? (
              <View className="w-full rounded-[28px] bg-white p-5">
                <View className="flex-row items-start justify-between">
                  <View className="flex-1 pr-3">
                    <Text className="text-lg font-black text-[#3D3229]">{selectedCatalogKitchenware.name}</Text>
                    <Text className="mt-1 text-xs font-bold text-[#2D6A4F]">官方标准库 · {selectedCatalogKitchenware.category}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedCatalogKitchenware(null)} className="p-1"><FontAwesome6 name="xmark" size={17} color="#8B7D6B" /></TouchableOpacity>
                </View>
                {catalogList(selectedCatalogKitchenware.aliases).length ? <View className="mt-4"><Text className="text-[10px] font-bold text-[#8B7D6B]">常用别名</Text><Text className="mt-1 text-xs text-[#3D3229]">{catalogList(selectedCatalogKitchenware.aliases).join("、")}</Text></View> : null}
                <View className="mt-4"><Text className="text-[10px] font-bold text-[#8B7D6B]">适用方式</Text><Text className="mt-1 text-xs text-[#3D3229]">{catalogList(selectedCatalogKitchenware.cooking_methods).join("、") || "暂未标注"}</Text></View>
                <View className="mt-4 rounded-2xl bg-[#F5EFE6] p-3"><Text className="text-[10px] font-bold text-[#8B7D6B]">官方保养提示</Text><Text className="mt-1 text-xs leading-5 text-[#3D3229]">{selectedCatalogKitchenware.care_note || "保持清洁干燥，按产品说明书进行保养。"}</Text></View>
                <TouchableOpacity disabled={savingKitchenware} onPress={() => addCatalogKitchenware(selectedCatalogKitchenware)} className="mt-5 items-center rounded-2xl bg-[#2D6A4F] py-3.5 disabled:opacity-50"><Text className="text-sm font-black text-white">{savingKitchenware ? "添加中…" : kitchenware.some((item) => item.name === selectedCatalogKitchenware.name) ? "已在我的装备库" : "加入我的装备"}</Text></TouchableOpacity>
              </View>
            ) : null}
          </View>
        </Modal>

        {/* Kitchenware Add Modal */}
        <Modal visible={kitchenwareModalVisible} animationType="slide" transparent>
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-white rounded-t-[32px] p-6 max-h-[85%]">
              <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
                <Text className="text-lg font-black text-[#3D3229]">
                  {editingKitchenware ? "编辑厨具" : "录入我的新厨具/家电"}
                </Text>
                <TouchableOpacity onPress={() => setKitchenwareModalVisible(false)}>
                  <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">厨具名称</Text>
                  <TextInput
                    value={kwName}
                    onChangeText={setKwName}
                    placeholder="搜索或输入厨具名称，如空气炸锅"
                    className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                  {!editingKitchenware && (
                    <View className="mt-2">
                      <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1.5">常用厨具类型</Text>
                      <View><ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <View className="flex-row gap-2 pr-4">
                          {kitchenwareCatalog.filter((item) => !kwName.trim() || item.name.includes(kwName.trim())).slice(0, 8).map((item) => (
                            <TouchableOpacity key={item.id} onPress={() => setSelectedCatalogKitchenware(item)} className="bg-[#2D6A4F]/10 border border-[#2D6A4F]/15 px-3 py-2 rounded-xl">
                              <Text className="text-xs font-bold text-[#2D6A4F]">{item.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </ScrollView></View>
                    </View>
                  )}
                </View>

                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">厨具类型</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"].map((cat) => (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => setKwCategory(cat)}
                            className={`items-center rounded-xl border px-3 py-2.5 ${
                              kwCategory === cat
                                ? "bg-[#2D6A4F] border-[#2D6A4F]"
                                : "bg-[#FDF8F0] border-[#EBE3D5]"
                            }`}
                          >
                            <Text
                              className={`text-xs ${
                                kwCategory === cat ? "text-white font-bold" : "text-[#8B7D6B]"
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
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">当前状态</Text>
                  <View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        {["常用", "良好", "需保养", "维修中", "闲置"].map((status) => (
                          <TouchableOpacity
                            key={status}
                            onPress={() => setKwStatus(status)}
                            className={`rounded-xl border px-3 py-2 ${
                              kwStatus === status
                                ? "border-[#2D6A4F] bg-[#2D6A4F]"
                                : "border-[#EBE3D5] bg-[#FDF8F0]"
                            }`}
                          >
                            <Text className={`text-xs font-bold ${kwStatus === status ? "text-white" : "text-[#8B7D6B]"}`}>
                              {status}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                </View>

                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">规格 / 备注</Text>
                  <TextInput
                    value={kwNote}
                    onChangeText={setKwNote}
                    placeholder="如: 32L 大容量 双温双控"
                    className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                </View>

                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">购买日期（可选）</Text>
                  <SmartDateInput value={kwPurchaseDate} onChange={setKwPurchaseDate} />
                </View>

                <View>
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">图片 URL（可选）</Text>
                  <TextInput
                    value={kwImageUrl}
                    onChangeText={setKwImageUrl}
                    placeholder="https://..."
                    className="bg-[#FDF8F0] px-4 py-3 rounded-2xl border border-[#EBE3D5] text-sm text-[#3D3229]"
                  />
                </View>

                <TouchableOpacity
                  onPress={handleSaveKitchenware}
                  disabled={savingKitchenware}
                  className="bg-[#2D6A4F] py-4 rounded-2xl items-center mt-4 shadow-sm active:opacity-90"
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
      </ScrollView>
    </Screen>
  );
}
