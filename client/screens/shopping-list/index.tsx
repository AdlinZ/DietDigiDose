import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { FontAwesome6 } from "@expo/vector-icons";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { getUserStorageKey, SHOPPING_LIST_STORAGE_KEY } from "@/utils/userStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { inventoryApi, shoppingListApi } from "@/services/api";
import { dateKeyAfterDays, parseDateKey, toLocalDateKey } from "@/utils/date";
import { normalizeShoppingItems, type ShoppingItem } from "@/utils/shoppingList";
import { inferCategoryByName, inferIngredientDefaults, inferShelfLifeDays } from "@/utils/ingredientRules";
import { addInventoryLog } from "@/utils/inventoryHistory";

const CATEGORY_OPTIONS = [
  { label: "蔬菜", icon: "carrot", color: "#059669", bg: "bg-emerald-50" },
  { label: "肉蛋", icon: "drumstick-bite", color: "#E07A5F", bg: "bg-orange-50" },
  { label: "水果", icon: "apple-whole", color: "#E76F51", bg: "bg-red-50" },
  { label: "调料", icon: "bottle-droplet", color: "#D97706", bg: "bg-amber-50" },
  { label: "其他", icon: "cubes", color: "#0284C7", bg: "bg-sky-50" },
];

const GROUP_SECTION_CONFIG = [
  { key: "蔬菜", title: "蔬菜生鲜区", icon: "carrot", color: "#059669", bg: "bg-emerald-50" },
  { key: "肉蛋", title: "肉蛋水产区", icon: "drumstick-bite", color: "#E07A5F", bg: "bg-orange-50" },
  { key: "水果", title: "水果甜品区", icon: "apple-whole", color: "#E76F51", bg: "bg-red-50" },
  { key: "调料", title: "调料粮油区", icon: "bottle-droplet", color: "#D97706", bg: "bg-amber-50" },
  { key: "其他", title: "其他综合区", icon: "cubes", color: "#0284C7", bg: "bg-sky-50" },
];

export default function ShoppingListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const storageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverReady, setServerReady] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("蔬菜");
  const [smartHint, setSmartHint] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"all" | "pending" | "done">("pending");
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [movingToInventory, setMovingToInventory] = useState(false);
  const importKeys = useRef(new Map<string, string>());

  // Edit Modal State
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("蔬菜");
  const [editPurchaseDate, setEditPurchaseDate] = useState("");

  // 加载数据
  const loadShoppingList = useCallback(async () => {
    if (!storageKey) {
      setLoading(false);
      return;
    }
    try {
      const saved = await AsyncStorage.getItem(storageKey);
      const cachedItems = saved ? normalizeShoppingItems(JSON.parse(saved)) : [];
      setItems(cachedItems);
      const imported = await shoppingListApi.import<{ items: unknown[] }>(
        authFetch,
        `shopping-list-migration-v1:${user?.id || "anonymous"}`,
        cachedItems.map((item) => ({
          clientId: item.clientId || item.id,
          name: item.name,
          amount: item.amount,
          category: item.category,
          checked: item.checked,
          purchaseDate: item.purchaseDate,
          storageLocation: item.storageLocation,
        })),
      );
      const authoritative = normalizeShoppingItems(imported.items);
      setItems(authoritative);
      await AsyncStorage.setItem(storageKey, JSON.stringify(authoritative));
      setServerReady(true);
    } catch (err) {
      console.error("Failed to load shopping list:", err);
      setServerReady(false);
    } finally {
      setLoading(false);
    }
  }, [authFetch, storageKey, user?.id]);

  useEffect(() => {
    loadShoppingList();
  }, [loadShoppingList]);

  // 保存数据
  const cacheItems = async (newItems: ShoppingItem[]) => {
    setItems(newItems);
    if (storageKey) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(newItems));
    }
  };

  // 输入食材名称时智能反应
  const handleNameInputChange = (text: string) => {
    setNameInput(text);
    if (!text.trim()) {
      setSmartHint(null);
      return;
    }
    const defaults = inferIngredientDefaults(text);
    let matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === defaults.category);
    if (!matchedOpt) {
      if (defaults.category === "肉食") matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === "肉蛋");
      else if (defaults.category === "粮油干货") matchedOpt = CATEGORY_OPTIONS.find((c) => c.label === "调料");
    }

    if (matchedOpt) {
      setSelectedCategory(matchedOpt.label);
      setSmartHint(`自动识别为 [${matchedOpt.label}] · 建议存放在 [${defaults.storageLocation}]`);
    } else {
      setSmartHint(null);
    }
  };

  // 添加新食材
  const handleAddItem = async () => {
    if (!nameInput.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    if (!serverReady) {
      Alert.alert("当前为离线缓存", "采购清单以服务端为准，请恢复网络后再修改。");
      return;
    }
    try {
      const created = await shoppingListApi.create<unknown>(authFetch, {
        clientId: `manual:${Date.now()}`,
        name: nameInput.trim(),
        amount: amountInput.trim() || "适量",
        category: selectedCategory,
        checked: false,
        storageLocation: inferIngredientDefaults(nameInput).storageLocation,
      });
      const newItem = normalizeShoppingItems([created])[0];
      if (!newItem) throw new Error("服务端返回了无效采购项");
      await cacheItems([newItem, ...items]);
      setNameInput("");
      setAmountInput("");
      setSmartHint(null);
    } catch (error) {
      Alert.alert("添加失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 打开编辑弹窗
  const openEditModal = (item: ShoppingItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditAmount(item.amount);
    setEditCategory(item.category || "蔬菜");
    setEditPurchaseDate(item.purchaseDate || toLocalDateKey(new Date()));
  };

  const handleSaveEditedItem = async () => {
    if (!editingItem) return;
    if (!editName.trim()) {
      Alert.alert("提示", "食材名称不能为空");
      return;
    }
    if (!serverReady || !editingItem.version) {
      Alert.alert("无法修改", "请联网刷新采购清单后重试。");
      return;
    }
    try {
      const saved = await shoppingListApi.update<unknown>(authFetch, editingItem.id, {
        version: editingItem.version,
        name: editName.trim(),
        amount: editAmount.trim() || "适量",
        category: editCategory,
        purchaseDate: editPurchaseDate.trim() || toLocalDateKey(new Date()),
        storageLocation: inferIngredientDefaults(editName).storageLocation,
      });
      const updatedItem = normalizeShoppingItems([saved])[0];
      if (!updatedItem) throw new Error("服务端返回了无效采购项");
      await cacheItems(items.map((item) => item.id === editingItem.id ? updatedItem : item));
      setEditingItem(null);
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  // 勾选/取消勾选
  const handleToggleCheck = async (id: string) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!serverReady || !item?.version) return Alert.alert("当前为离线缓存", "联网后才能修改采购状态。");
    try {
      const saved = await shoppingListApi.update<unknown>(authFetch, id, { version: item.version, checked: !item.checked });
      const updatedItem = normalizeShoppingItems([saved])[0];
      if (!updatedItem) throw new Error("服务端返回了无效采购项");
      await cacheItems(items.map((candidate) => candidate.id === id ? updatedItem : candidate));
    } catch (error) {
      Alert.alert("更新失败", error instanceof Error ? error.message : "请刷新后重试");
    }
  };

  // 删除单项
  const handleDeleteItem = async (id: string) => {
    if (!serverReady) return Alert.alert("当前为离线缓存", "联网后才能删除采购项。");
    try {
      await shoppingListApi.remove(authFetch, id);
      await cacheItems(items.filter((item) => item.id !== id));
    } catch (error) {
      Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 清空已买项目
  const handleClearChecked = () => {
    const checkedCount = items.filter((i) => i.checked).length;
    if (checkedCount === 0) return;
    Alert.alert("确认清空", `确定要清除 ${checkedCount} 项已采购的项目吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "确认清除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await Promise.all(items.filter((item) => item.checked).map((item) => shoppingListApi.remove(authFetch, item.id)));
              await cacheItems(items.filter((item) => !item.checked));
            } catch (error) {
              Alert.alert("清除失败", error instanceof Error ? error.message : "请稍后重试");
            }
          })();
        },
      },
    ]);
  };

  // 将已买食材一键存入冰箱库 (智能应用保质期与存储位置规则)
  const handleMoveCheckedToInventory = async () => {
    const checkedItems = items.filter((i) => i.checked);
    if (checkedItems.length === 0) {
      Alert.alert("提示", "请先勾选打钩已买到的食材。");
      return;
    }

    setMovingToInventory(true);
    try {
      const signature = checkedItems.map((item) => item.id).sort().join("|");
      const idempotencyKey =
        importKeys.current.get(signature) ||
        `shopping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      importKeys.current.set(signature, idempotencyKey);

      const itemsToImport = checkedItems.map((item) => {
        const defaults = inferIngredientDefaults(item.name);
        const location = item.storageLocation || defaults.storageLocation;
        const shelfDays = inferShelfLifeDays(item.name, location as any);
        const startDate = item.purchaseDate ? parseDateKey(item.purchaseDate) || new Date() : new Date();
        const expDate = dateKeyAfterDays(shelfDays, startDate);

        return {
          food_name: item.name,
          category: defaults.category,
          quantity: item.amount || defaults.defaultQuantity,
          storage_location: location,
          expiration_date: expDate,
          image_url: null,
        };
      });

      await inventoryApi.importShoppingList(authFetch, idempotencyKey, itemsToImport);
      importKeys.current.delete(signature);

      // 记录到库存操作历史
      for (const item of itemsToImport) {
        await addInventoryLog(
          {
            foodName: item.food_name,
            action: "add",
            quantity: item.quantity,
            storageLocation: item.storage_location,
          },
          user?.id
        );
      }

      await Promise.all(checkedItems.map((item) => shoppingListApi.remove(authFetch, item.id)));
      const remainingItems = items.filter((i) => !i.checked);
      await cacheItems(remainingItems);

      Alert.alert(
        "入库成功！",
        `已将 ${checkedItems.length} 件食材智能算期录入【冰箱食材库】，已同步写入操作历史！`,
        [
          { text: "继续买菜", style: "cancel" },
          { text: "查看冰箱库", onPress: () => router.push("/inventory") },
        ]
      );
    } catch (err) {
      console.error("Failed to move items to inventory:", err);
      Alert.alert("入库未完成", err instanceof Error ? err.message : "存入冰箱库失败，请重试。");
    } finally {
      setMovingToInventory(false);
    }
  };

  const pendingItems = items.filter((i) => !i.checked);
  const checkedItems = items.filter((i) => i.checked);
  const filteredItems = items.filter((i) => {
    if (activeTab === "pending") return !i.checked;
    if (activeTab === "done") return i.checked;
    return true;
  });

  const progressPercent = items.length > 0 ? Math.round((checkedItems.length / items.length) * 100) : 0;

  return (
    <Screen backgroundColor="#F6F4F0" safeAreaEdges={["top", "bottom", "left", "right"]}>
      {/* 顶部 Header */}
      <View className="px-5 py-3.5 flex-row items-center justify-between border-b border-line bg-white/80 shadow-xs">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2 active:opacity-70">
          <FontAwesome6 name="chevron-left" size={18} color="#3D3229" />
        </TouchableOpacity>

        <View className="flex-row items-center gap-2">
          <FontAwesome6 name="cart-shopping" size={16} color="#D97706" />
          <Text className="text-base font-black text-ink">智能采购清单</Text>
        </View>

        {checkedItems.length > 0 ? (
          <TouchableOpacity onPress={handleClearChecked} className="p-1 active:opacity-70">
            <Text className="text-xs font-bold text-rose-600">清空已买</Text>
          </TouchableOpacity>
        ) : (
          <View className="w-8" />
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} className="flex-1 px-5 pt-4">
        {/* 采购进度概览 Banner */}
        <View className="bg-white rounded-3xl p-4 border border-line shadow-xs mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <View>
              <Text className="text-xs font-bold text-copy-muted">采购完成度</Text>
              <Text className="text-lg font-black text-ink">
                已购买 {checkedItems.length} / <Text className="text-emerald-700">{items.length}</Text> 项
              </Text>
            </View>
            <View className="bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200/80">
              <Text className="text-xs font-black text-emerald-700">{progressPercent}% 进度</Text>
            </View>
          </View>
          {/* 进度条 */}
          <View className="w-full h-2.5 bg-canvas rounded-full overflow-hidden border border-line">
            <View className="h-full bg-emerald-600 rounded-full" style={{ width: `${progressPercent}%` }} />
          </View>
        </View>

        {/* 快捷录入输入框卡片 */}
        <View className="bg-white p-4 rounded-3xl border border-line shadow-xs mb-4">
          <Text className="text-xs font-black text-ink mb-2">快速添加采购食材</Text>

          <View className="flex-row gap-2 mb-2">
            <TextInput
              value={nameInput}
              onChangeText={handleNameInputChange}
              placeholder="食材名称 (如: 鸡胸肉)"
              placeholderTextColor="#A3A398"
              className="flex-1 bg-canvas px-3.5 py-2.5 rounded-2xl border border-line text-xs text-ink font-medium"
            />
            <TextInput
              value={amountInput}
              onChangeText={setAmountInput}
              placeholder="分量 (如: 500g)"
              placeholderTextColor="#A3A398"
              className="w-28 bg-canvas px-3.5 py-2.5 rounded-2xl border border-line text-xs text-ink font-medium"
            />
          </View>

          {/* 智能保质期推荐提示 */}
          {smartHint && (
            <View className="mb-2 px-2 py-1 rounded-xl bg-amber-50 border border-amber-200/60">
              <Text className="text-[10px] font-bold text-amber-900">{smartHint}</Text>
            </View>
          )}

          {/* 分类 Pills */}
          <View className="flex-row items-center justify-between mb-1">
            <View className="flex-row items-center gap-1.5 flex-wrap">
              {CATEGORY_OPTIONS.map((cat) => (
                <TouchableOpacity
                  key={cat.label}
                  onPress={() => setSelectedCategory(cat.label)}
                  className={`px-2.5 py-1 rounded-full border flex-row items-center gap-1 transition-all ${
                    selectedCategory === cat.label
                      ? "bg-brand border-brand"
                      : "bg-canvas border-line"
                  }`}
                >
                  <FontAwesome6
                    name={cat.icon}
                    size={10}
                    color={selectedCategory === cat.label ? "#FFFFFF" : cat.color}
                  />
                  <Text
                    className={`text-[11px] font-bold ${
                      selectedCategory === cat.label ? "text-white" : "text-ink"
                    }`}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={handleAddItem}
              className="bg-brand px-4 py-2 rounded-2xl flex-row items-center gap-1 active:scale-95 shadow-xs"
            >
              <FontAwesome6 name="plus" size={12} color="#FFF" />
              <Text className="text-xs font-black text-white">添加</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* AI Chef 缺料识别智能 Banner */}
        <TouchableOpacity
          onPress={() => router.push("/ai-assistant")}
          className="bg-emerald-50 border border-emerald-200/80 p-3.5 rounded-2xl flex-row items-center justify-between mb-4 shadow-xs active:opacity-80"
        >
          <View className="flex-row items-center gap-2.5 flex-1 pr-2">
            <View className="w-8 h-8 rounded-full bg-emerald-600 items-center justify-center">
              <FontAwesome6 name="wand-magic-sparkles" size={13} color="#FFF" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-black text-emerald-900">AI 食语智能算料</Text>
              <Text className="text-[10px] text-emerald-700 font-medium">菜谱缺失食材一键精准算料生成采购单</Text>
            </View>
          </View>
          <FontAwesome6 name="chevron-right" size={12} color="#059669" />
        </TouchableOpacity>

        {/* Filter Tabs & View Mode Switcher */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-1.5">
            <TouchableOpacity
              onPress={() => setActiveTab("pending")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "pending"
                  ? "bg-brand border-brand"
                  : "bg-white border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "pending" ? "text-white" : "text-copy-muted"
                }`}
              >
                待买 ({pendingItems.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab("done")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "done"
                  ? "bg-brand border-brand"
                  : "bg-white border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "done" ? "text-white" : "text-copy-muted"
                }`}
              >
                已买 ({checkedItems.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-full border ${
                activeTab === "all"
                  ? "bg-brand border-brand"
                  : "bg-white border-line"
              }`}
            >
              <Text
                className={`text-[11px] font-bold ${
                  activeTab === "all" ? "text-white" : "text-copy-muted"
                }`}
              >
                全部 ({items.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* 视图模式切换 */}
          <View className="flex-row items-center rounded-full bg-white border border-line p-0.5">
            <TouchableOpacity
              onPress={() => setViewMode("grouped")}
              className={`px-2.5 py-1 rounded-full ${
                viewMode === "grouped" ? "bg-brand/10 border border-brand/30" : ""
              }`}
            >
              <Text className={`text-[10px] font-bold ${viewMode === "grouped" ? "text-brand" : "text-copy-muted"}`}>
                分组
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode("flat")}
              className={`px-2.5 py-1 rounded-full ${
                viewMode === "flat" ? "bg-brand/10 border border-brand/30" : ""
              }`}
            >
              <Text className={`text-[10px] font-bold ${viewMode === "flat" ? "text-brand" : "text-copy-muted"}`}>
                列表
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 清单列表 */}
        {loading ? (
          <ActivityIndicator size="small" color="#2D6A4F" className="my-8" />
        ) : filteredItems.length === 0 ? (
          <View className="items-center py-10 bg-white/70 rounded-3xl border border-dashed border-line my-2">
            <FontAwesome6 name="basket-shopping" size={32} color="#D4A276" />
            <Text className="text-xs text-copy-muted mt-2.5 font-bold">
              {activeTab === "pending" ? "暂无待采购食材" : "清单空空如也"}
            </Text>
            <Text className="text-[10px] text-copy-muted mt-1">在上方输入或在 AI 聊天中一键计算生成</Text>
          </View>
        ) : viewMode === "grouped" ? (
          /* 按区域/品类分组视图 */
          <View className="gap-3">
            {GROUP_SECTION_CONFIG.map((section) => {
              const sectionItems = filteredItems.filter((i) => {
                if (section.key === "蔬菜") return i.category === "蔬菜";
                if (section.key === "肉蛋") return i.category === "肉蛋" || i.category === "肉食";
                if (section.key === "水果") return i.category === "水果";
                if (section.key === "调料") return i.category === "调料" || i.category === "粮油干货";
                return !["蔬菜", "肉蛋", "肉食", "水果", "调料", "粮油干货"].includes(i.category);
              });

              if (sectionItems.length === 0) return null;

              return (
                <View key={section.key} className="rounded-3xl border border-line bg-white p-3.5 shadow-2xs">
                  <View className="flex-row items-center justify-between mb-2.5 px-1 border-b border-line/60 pb-2">
                    <View className="flex-row items-center gap-2">
                      <View className={`w-6 h-6 rounded-lg items-center justify-center ${section.bg}`}>
                        <FontAwesome6 name={section.icon} size={11} color={section.color} />
                      </View>
                      <Text className="text-xs font-black text-ink">{section.title}</Text>
                    </View>
                    <Text className="text-[10px] font-bold text-copy-muted">{sectionItems.length} 项</Text>
                  </View>

                  <View className="gap-2">
                    {sectionItems.map((item) => renderShoppingItemCard(item))}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          /* 平铺列表视图 */
          <View className="gap-2">
            {filteredItems.map((item) => renderShoppingItemCard(item))}
          </View>
        )}

        {/* 🧊 将已买食材一键存入【冰箱库】Action */}
        {checkedItems.length > 0 && (
          <TouchableOpacity
            onPress={handleMoveCheckedToInventory}
            disabled={movingToInventory}
            className="mt-5 bg-brand p-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-sm active:scale-95"
          >
            {movingToInventory ? <ActivityIndicator size="small" color="#FFF" /> : <FontAwesome6 name="box-archive" size={14} color="#FFF" />}
            <Text className="text-xs font-black text-white">
              将 {checkedItems.length} 件已买食材一键存入【冰箱食材库】
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* 编辑采购项 Modal */}
      <Modal visible={Boolean(editingItem)} animationType="fade" transparent onRequestClose={() => setEditingItem(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 p-5">
          <View className="w-full rounded-[28px] bg-white p-5">
            <View className="flex-row items-center justify-between border-b border-line pb-3">
              <Text className="text-base font-black text-ink">编辑采购项目</Text>
              <TouchableOpacity onPress={() => setEditingItem(null)} className="w-8 h-8 items-center justify-center rounded-full bg-canvas">
                <FontAwesome6 name="xmark" size={16} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <View className="mt-4 gap-3">
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">食材名称</Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">分量 / 规格</Text>
                <TextInput
                  value={editAmount}
                  onChangeText={setEditAmount}
                  placeholder="如: 500g, 2盒"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">购买日期</Text>
                <TextInput
                  value={editPurchaseDate}
                  onChangeText={setEditPurchaseDate}
                  placeholder="YYYY-MM-DD"
                  className="bg-canvas px-4 py-3 rounded-2xl border border-line text-sm text-ink font-medium"
                />
              </View>

              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">所属品类</Text>
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <TouchableOpacity
                      key={cat.label}
                      onPress={() => setEditCategory(cat.label)}
                      className={`px-3 py-1.5 rounded-full border ${
                        editCategory === cat.label ? "bg-brand border-brand" : "bg-canvas border-line"
                      }`}
                    >
                      <Text className={`text-xs font-bold ${editCategory === cat.label ? "text-white" : "text-ink"}`}>
                        {cat.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity
                onPress={handleSaveEditedItem}
                className="mt-2 bg-brand py-3.5 rounded-2xl items-center shadow-xs active:opacity-90"
              >
                <Text className="text-sm font-black text-white">保存修改</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );

  function renderShoppingItemCard(item: ShoppingItem) {
    const catOpt = CATEGORY_OPTIONS.find((c) => c.label === item.category) || CATEGORY_OPTIONS[0];
    return (
      <TouchableOpacity
        key={item.id}
        onPress={() => handleToggleCheck(item.id)}
        activeOpacity={0.8}
        className={`p-3.5 rounded-2xl border flex-row items-center justify-between transition-all shadow-2xs ${
          item.checked ? "bg-gray-50 border-gray-200 opacity-60" : "bg-white border-line"
        }`}
      >
        <View className="flex-row items-center gap-3 flex-1 mr-2">
          {/* Checkbox */}
          <View
            className={`w-6 h-6 rounded-full items-center justify-center border transition-all ${
              item.checked ? "bg-emerald-600 border-emerald-600" : "bg-white border-line"
            }`}
          >
            {item.checked && <FontAwesome6 name="check" size={11} color="#FFF" />}
          </View>

          {/* Category Icon Badge */}
          <View className={`w-8 h-8 rounded-xl items-center justify-center ${catOpt.bg}`}>
            <FontAwesome6 name={catOpt.icon} size={13} color={catOpt.color} />
          </View>

          {/* Item Details */}
          <View className="flex-1">
            <Text className={`text-xs font-black ${item.checked ? "text-gray-400 line-through" : "text-ink"}`}>
              {item.name}
            </Text>
            <Text className="text-[10px] text-copy-muted mt-0.5">
              分量: {item.amount} {item.purchaseDate ? `· 购于 ${item.purchaseDate}` : ""}
            </Text>
          </View>
        </View>

        {/* Right Actions */}
        <View className="flex-row items-center gap-1.5">
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              openEditModal(item);
            }}
            className="w-7 h-7 rounded-full bg-canvas items-center justify-center border border-line active:bg-brand-soft"
          >
            <FontAwesome6 name="pen" size={9} color="#8B7D6B" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              handleDeleteItem(item.id);
            }}
            className="w-7 h-7 rounded-full bg-rose-50 items-center justify-center border border-rose-100 active:bg-rose-100"
          >
            <FontAwesome6 name="trash-can" size={9} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  }
}
