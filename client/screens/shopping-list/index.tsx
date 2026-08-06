import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { FontAwesome6 } from "@expo/vector-icons";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { getUserStorageKey, SHOPPING_LIST_STORAGE_KEY } from "@/utils/userStorage";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { inventoryApi } from "@/services/api";
import { dateKeyAfterDays } from "@/utils/date";
import { normalizeShoppingItems, type ShoppingItem } from "@/utils/shoppingList";

const CATEGORY_OPTIONS = [
  { label: "蔬菜", icon: "carrot", color: "#059669", bg: "bg-emerald-50" },
  { label: "肉蛋", icon: "drumstick-bite", color: "#E07A5F", bg: "bg-orange-50" },
  { label: "水果", icon: "apple-whole", color: "#E76F51", bg: "bg-red-50" },
  { label: "调料", icon: "bottle-droplet", color: "#D97706", bg: "bg-amber-50" },
  { label: "其他", icon: "cubes", color: "#0284C7", bg: "bg-sky-50" },
];

export default function ShoppingListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const storageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);

  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("蔬菜");
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "done">("pending");
  const [movingToInventory, setMovingToInventory] = useState(false);
  const importKeys = useRef(new Map<string, string>());

  // 加载数据
  const loadShoppingList = useCallback(async () => {
    if (!storageKey) {
      setLoading(false);
      return;
    }
    try {
      const saved = await AsyncStorage.getItem(storageKey);
      if (saved) {
        setItems(normalizeShoppingItems(JSON.parse(saved)));
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error("Failed to load shopping list:", err);
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    loadShoppingList();
  }, [loadShoppingList]);

  // 保存数据
  const saveItems = async (newItems: ShoppingItem[]) => {
    setItems(newItems);
    if (storageKey) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(newItems));
    }
  };

  // 添加新食材
  const handleAddItem = () => {
    if (!nameInput.trim()) {
      Alert.alert("提示", "请输入食材名称");
      return;
    }
    const newItem: ShoppingItem = {
      id: String(Date.now()),
      name: nameInput.trim(),
      amount: amountInput.trim() || "适量",
      category: selectedCategory,
      checked: false,
      createdAt: Date.now(),
    };
    const updated = [newItem, ...items];
    saveItems(updated);
    setNameInput("");
    setAmountInput("");
  };

  // 勾选/取消勾选
  const handleToggleCheck = (id: string) => {
    const updated = items.map((item) =>
      item.id === id ? { ...item, checked: !item.checked } : item
    );
    saveItems(updated);
  };

  // 删除单项
  const handleDeleteItem = (id: string) => {
    const updated = items.filter((item) => item.id !== id);
    saveItems(updated);
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
          const updated = items.filter((i) => !i.checked);
          saveItems(updated);
        },
      },
    ]);
  };

  // 将已买食材一键存入冰箱库
  const handleMoveCheckedToInventory = async () => {
    const checkedItems = items.filter((i) => i.checked);
    if (checkedItems.length === 0) {
      Alert.alert("提示", "请先勾选打钩已买到的食材。");
      return;
    }

    setMovingToInventory(true);
    try {
      const signature = checkedItems.map((item) => item.id).sort().join("|");
      const idempotencyKey = importKeys.current.get(signature)
        || `shopping-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      importKeys.current.set(signature, idempotencyKey);
      await inventoryApi.importShoppingList(authFetch, idempotencyKey, checkedItems.map((item) => ({
        food_name: item.name,
        category: item.category || "蔬菜",
        quantity: item.amount || "适量",
        storage_location: "冷藏",
        expiration_date: dateKeyAfterDays(7),
        image_url: null,
      })));
      importKeys.current.delete(signature);

      const remainingItems = items.filter((i) => !i.checked);
      await saveItems(remainingItems);

      Alert.alert(
        "入库成功！",
        `已将 ${checkedItems.length} 件食材一键录入【冰箱食材库】，采购清单已自动更新！`,
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
            <Text className="text-xs font-bold text-red-500">清空已买</Text>
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

          <View className="flex-row gap-2 mb-2.5">
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
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

          {/* 分类 Pills */}
          <View className="flex-row items-center justify-between mb-3">
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
              <Text className="text-[10px] text-emerald-700 font-medium">向食语提问菜谱，缺失食材将自动计算精准加入清单</Text>
            </View>
          </View>
          <FontAwesome6 name="chevron-right" size={12} color="#059669" />
        </TouchableOpacity>

        {/* Filter Tabs */}
        <View className="flex-row items-center gap-2 mb-3">
          <TouchableOpacity
            onPress={() => setActiveTab("pending")}
            className={`px-3.5 py-1.5 rounded-full border ${
              activeTab === "pending"
                ? "bg-brand border-brand"
                : "bg-white border-line"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                activeTab === "pending" ? "text-white" : "text-copy-muted"
              }`}
            >
              待采购 ({pendingItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab("done")}
            className={`px-3.5 py-1.5 rounded-full border ${
              activeTab === "done"
                ? "bg-brand border-brand"
                : "bg-white border-line"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                activeTab === "done" ? "text-white" : "text-copy-muted"
              }`}
            >
              已买到 ({checkedItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            className={`px-3.5 py-1.5 rounded-full border ${
              activeTab === "all"
                ? "bg-brand border-brand"
                : "bg-white border-line"
            }`}
          >
            <Text
              className={`text-xs font-bold ${
                activeTab === "all" ? "text-white" : "text-copy-muted"
              }`}
            >
              全部 ({items.length})
            </Text>
          </TouchableOpacity>
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
        ) : (
          <View className="gap-2">
            {filteredItems.map((item) => {
              const catOpt = CATEGORY_OPTIONS.find((c) => c.label === item.category) || CATEGORY_OPTIONS[0];
              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => handleToggleCheck(item.id)}
                  activeOpacity={0.8}
                  className={`p-3.5 rounded-2xl border flex-row items-center justify-between transition-all shadow-2xs ${
                    item.checked
                      ? "bg-gray-50 border-gray-200 opacity-60"
                      : "bg-white border-line"
                  }`}
                >
                  <View className="flex-row items-center gap-3 flex-1 mr-2">
                    {/* Checkbox */}
                    <View
                      className={`w-6 h-6 rounded-full items-center justify-center border transition-all ${
                        item.checked
                          ? "bg-emerald-600 border-emerald-600"
                          : "bg-white border-line"
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
                      <Text
                        className={`text-xs font-black ${
                          item.checked ? "text-gray-400 line-through" : "text-ink"
                        }`}
                      >
                        {item.name}
                      </Text>
                      <Text className="text-[10px] text-copy-muted mt-0.5">
                        分量/规格: {item.amount}
                      </Text>
                    </View>
                  </View>

                  {/* Right Actions */}
                  <TouchableOpacity
                    onPress={() => handleDeleteItem(item.id)}
                    className="w-7 h-7 rounded-full bg-red-50 items-center justify-center border border-red-100 active:bg-red-100"
                  >
                    <FontAwesome6 name="trash-can" size={10} color="#EF4444" />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
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
    </Screen>
  );
}
