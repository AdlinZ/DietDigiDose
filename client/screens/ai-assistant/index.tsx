import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
  storageBelongsToCurrentUser,
} from "@/utils/userStorage";
import { aiApi, dietApi, inventoryApi } from "@/services/api";
import { dateKeyAfterDays, toLocalDateKey } from "@/utils/date";
import { MedicalDisclaimer } from "@/components/MedicalDisclaimer";
import type { ChatSession, DietRecordActionCard, DietRecordMissingCard, InventoryScanCard, InventoryScanFood, Message } from "./types";
import { inferInventoryCategory, normalizeInventoryScanFoods } from "./inventoryScan";
import { AssistantMessageItem } from "./AssistantMessageItem";

export default function AIAssistantScreen() {
  const router = useSafeRouter();
  const {
    prompt,
    prefill_food: prefillFood,
    inventory_scan_job_id: inventoryScanJobId,
    inventory_scan_image_uri: inventoryScanImageUri,
  } = useSafeSearchParams<{
    prompt?: string | string[];
    prefill_food?: string | string[];
    inventory_scan_job_id?: string | string[];
    inventory_scan_image_uri?: string | string[];
  }>();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const chatStorageKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, user?.id);
  const shoppingListStorageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);
  const [loadedChatStorageKey, setLoadedChatStorageKey] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [storedMessages, setMessages] = useState<Message[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ uri: string; base64: string } | null>(null);
  const autoSentPromptKey = useRef<string | null>(null);
  const handledInventoryScanJob = useRef<string | null>(null);
  const [inventoryEditTarget, setInventoryEditTarget] = useState<{
    msgId: string;
    itemId: string;
    foodName: string;
    quantity: string;
    storageLocation: "冷藏" | "冷冻" | "常温";
    expireDays: string;
  } | null>(null);

  // 📚 多会话历史记录 State
  const [storedSessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => String(Date.now()));
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const historyBelongsToCurrentUser = storageBelongsToCurrentUser(
    chatStorageKey,
    loadedChatStorageKey,
  );
  const messages = historyBelongsToCurrentUser ? storedMessages : [];
  const sessions = historyBelongsToCurrentUser ? storedSessions : [];

  // 🛒 智能采购清单 Modal State
  const [shoppingListModalVisible, setShoppingListModalVisible] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<Array<{ id: string; name: string; amount: string; addedAt: string }>>([]);

  const loadShoppingList = async () => {
    if (!shoppingListStorageKey) {
      setShoppingItems([]);
      return;
    }
    try {
      const saved = await AsyncStorage.getItem(shoppingListStorageKey);
      if (saved) {
        setShoppingItems(JSON.parse(saved));
      } else {
        setShoppingItems([]);
      }
    } catch {
      setShoppingItems([]);
    }
  };

  const handleOpenShoppingList = () => {
    loadShoppingList();
    setShoppingListModalVisible(true);
  };

  const handleRemoveShoppingItem = async (id: string) => {
    const updated = shoppingItems.filter((i) => i.id !== id);
    setShoppingItems(updated);
    if (shoppingListStorageKey) {
      await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(updated));
    }
  };

  // 📚 自动加载与保存多会话历史记录
  useEffect(() => {
    setLoadedChatStorageKey(null);
    setSessions([]);
    setMessages([]);
    setCurrentSessionId(String(Date.now()));
    if (!chatStorageKey) return;

    let active = true;
    AsyncStorage.getItem(chatStorageKey)
      .then((saved) => {
        if (!active || !saved) return;
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSessions(parsed);
            setCurrentSessionId(parsed[0].id);
            setMessages(parsed[0].messages || []);
          }
        } catch {
          // Ignore malformed data belonging to the current user only.
        }
      })
      .finally(() => {
        if (active) setLoadedChatStorageKey(chatStorageKey);
      });
    return () => {
      active = false;
    };
  }, [chatStorageKey]);

  useEffect(() => {
    if (
      !chatStorageKey
      || loadedChatStorageKey !== chatStorageKey
      || messages.length === 0
    ) return;

    setSessions((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === currentSessionId);
      const userFirstMsg = messages.find((m) => m.sender === "user")?.text || "与食语的对话";
      const title = userFirstMsg.length > 14 ? userFirstMsg.slice(0, 14) + "..." : userFirstMsg;
      const updatedAt = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      let updatedSessions: ChatSession[];
      if (existingIndex >= 0) {
        updatedSessions = [...prev];
        updatedSessions[existingIndex] = {
          ...updatedSessions[existingIndex],
          title,
          updatedAt,
          messages,
        };
      } else {
        updatedSessions = [
          { id: currentSessionId, title, updatedAt, messages },
          ...prev,
        ];
      }
      void AsyncStorage.setItem(chatStorageKey, JSON.stringify(updatedSessions));
      return updatedSessions;
    });
  }, [messages, currentSessionId, chatStorageKey, loadedChatStorageKey]);

  // 新建新对话
  const handleStartNewChat = () => {
    const newId = String(Date.now());
    setCurrentSessionId(newId);
    setMessages([]);
    setHistoryDrawerVisible(false);
  };

  // 切换已有历史会话
  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages || []);
    setHistoryDrawerVisible(false);
  };

  // 删除单条会话
  const handleDeleteSession = (sessionId: string) => {
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    if (chatStorageKey) {
      void AsyncStorage.setItem(chatStorageKey, JSON.stringify(updated));
    }

    if (sessionId === currentSessionId) {
      if (updated.length > 0) {
        setCurrentSessionId(updated[0].id);
        setMessages(updated[0].messages);
      } else {
        handleStartNewChat();
      }
    }
  };

  // 📝 对话框内置即时修改打卡 Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [currentMsgId, setCurrentMsgId] = useState<string | null>(null);
  const [formMealType, setFormMealType] = useState("午餐");
  const [formFoodName, setFormFoodName] = useState("");
  const [formAmount, setFormAmount] = useState("1份");
  const [formCalories, setFormCalories] = useState("350");
  const [formProtein, setFormProtein] = useState("18");
  const [formCarbs, setFormCarbs] = useState("45");
  const [formFat, setFormFat] = useState("10");
  const [savingRecord, setSavingRecord] = useState(false);

  const cardPrompts = [
    {
      icon: "calculator",
      color: "#E9C46A",
      title: "评估我今日卡路里",
      subtitle: "已摄入与蛋白质比例分析",
    },
    {
      icon: "drumstick-bite",
      color: "#2D6A4F",
      title: "冰箱食材搭配晚餐",
      subtitle: "用保鲜库现有食材做减脂餐",
    },
    {
      icon: "trophy",
      color: "#D4A276",
      title: "15分钟高蛋白快手早餐",
      subtitle: "简单好做免早起烹饪",
    },
    {
      icon: "kitchen-set",
      color: "#E07A5F",
      title: "牛油果希腊酸奶吃法",
      subtitle: "高纤低脂快手抹酱特调",
    },
  ];

  // 📷 挑选/拍摄图片作为待发送附件
  const handlePickImageAttachment = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      setSelectedImage({
        uri: result.assets[0].uri,
        base64: result.assets[0].base64,
      });
    } catch (err) {
      Alert.alert("提示", "选择图片失败");
    }
  };

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const text = textToSend || inputText;
    if ((!text.trim() && !selectedImage) || loading) return;

    // A. 如果附带了待发送图片 (图文混合发送)
    if (selectedImage) {
      const imageUri = selectedImage.uri;
      const base64Image = selectedImage.base64;
      const userPromptText = text.trim() || "请帮我识别这张菜品/食材照片的热量与营养成分";

      const userMsg: Message = {
        id: String(Date.now()),
        sender: "user",
        text: userPromptText,
        imageUri,
        time: "刚刚",
      };

      setMessages((prev) => [...prev, userMsg]);
      setSelectedImage(null);
      if (!textToSend) setInputText("");
      setLoading(true);

      try {
        const resData = await aiApi.visionFood<{ data?: Record<string, unknown> }>(
          authFetch,
          base64Image,
          userPromptText,
        );
        const food = resData.data || {};
        const readNumber = (value: unknown) => typeof value === "number" ? value : null;
          const replyText = `食语 AI 识别完成！已为你预填好打卡数据卡片：\n\n• 食物名称：${food.foodName || "健康料理"}\n• 预估热量：约 ${food.calories || 0} kcal\n• 营养比例：蛋白质 ${food.proteinGrams || 0}g | 碳水 ${food.carbsGrams || 0}g | 脂肪 ${food.fatGrams || 0}g\n\n点评：${food.description || "符合健康膳食平衡，请选择一键确认或弹出修改！"}`;

          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              sender: "ai",
              text: replyText,
              actionCard: {
                mealType: "午餐",
                foodName: typeof food.foodName === "string" ? food.foodName : "健康料理",
                amount: `${food.estimatedWeightGrams || 100}g`,
                calories: readNumber(food.calories),
                protein: readNumber(food.proteinGrams),
                carbs: readNumber(food.carbsGrams),
                fat: readNumber(food.fatGrams),
              },
              time: "刚刚",
            },
          ]);
      } catch (err) {
        console.error("[Vision AI Error]", err);
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: `照片识别暂时失败：${err instanceof Error ? err.message : "请检查网络后重试"}。图片没有被保存为饮食记录。`,
            time: "刚刚",
          },
        ]);
      } finally {
        setLoading(false);
      }
      return;
    }

    // B. 纯文本发送
    const userMsg: Message = {
      id: String(Date.now()),
      sender: "user",
      text: text.trim(),
      time: "刚刚",
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputText("");
    setLoading(true);

    try {
      const historyPayload = messages.map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: m.text,
      }));
      historyPayload.push({ role: "user", content: text.trim() });

      const data = await aiApi.chat<Record<string, any>>(authFetch, {
        messages: historyPayload,
        sessionId: currentSessionId,
      });
      const responseText = data.reply || "智能大厨正在整理您的食谱建议...";

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: responseText,
        actionCard: data.actionCard,
        missingCard: data.missingCard,
        optionsCard: data.optionsCard,
        solutionCards: data.solutionCards,
        time: "刚刚",
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("[AIAssistant Error]", err);
      const fallbackMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: `食语暂时无法回复：${err instanceof Error ? err.message : "请检查网络后重试"}。你的消息仍保留在本次对话中，可以稍后再次发送。`,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, inputText, selectedImage, loading, messages, currentSessionId]);

  // 其他页面携带 prompt 跳转时，进入对话页后自动发给 AI，而不是只填入输入框。
  useEffect(() => {
    const promptText = Array.isArray(prompt) ? prompt[0] : prompt;
    const foodName = Array.isArray(prefillFood) ? prefillFood[0] : prefillFood;
    // 等待当前账号的历史记录恢复完成，避免自动消息被恢复逻辑覆盖。
    if (!promptText?.trim() || loading || loadedChatStorageKey !== chatStorageKey) return;

    const key = `${foodName || ""}:${promptText}`;
    if (autoSentPromptKey.current === key) return;
    autoSentPromptKey.current = key;
    void handleSendMessage(promptText);
  }, [chatStorageKey, handleSendMessage, loadedChatStorageKey, loading, prefillFood, prompt]);

  useEffect(() => {
    const jobId = Array.isArray(inventoryScanJobId) ? inventoryScanJobId[0] : inventoryScanJobId;
    const imageUri = Array.isArray(inventoryScanImageUri) ? inventoryScanImageUri[0] : inventoryScanImageUri;
    if (!jobId || loadedChatStorageKey !== chatStorageKey || handledInventoryScanJob.current === jobId) return;

    handledInventoryScanJob.current = jobId;
    let active = true;
    const messageId = `inventory-scan-${jobId}`;
    const sessionId = `inventory-session-${Date.now()}`;

    setCurrentSessionId(sessionId);
    setMessages([
      {
        id: `${messageId}-user`,
        sender: "user",
        text: "请帮我识别这张照片里的食材，整理好后让我确认再入库。",
        imageUri,
        time: "刚刚",
      },
      {
        id: messageId,
        sender: "ai",
        text: "照片已经收到。我会在后台识别名称、数量、存放方式和建议保质期，完成后你可以逐项修改。",
        inventoryScanCard: { jobId, status: "processing", items: [] },
        time: "刚刚",
      },
    ]);

    const pollScanJob = async () => {
      try {
        const deadline = Date.now() + 60000;

        while (active && Date.now() < deadline) {
          const data = await aiApi.inventoryScan<Record<string, any>>(authFetch, jobId);

          if (data.status === "completed") {
            const items = normalizeInventoryScanFoods(data.items, jobId);
            if (!items.length) throw new Error("没有识别到可入库的食材，请换一张更清晰的照片重试。");
            if (!active) return;
            setMessages((current) => current.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    text: `识别完成，共找到 ${items.length} 项。请检查并修改后，再确认加入食材库。`,
                    inventoryScanCard: { jobId, status: "review", items },
                  }
                : message
            ));
            return;
          }

          if (data.status === "failed") {
            throw new Error(data.error || "识别失败，请重新拍摄。");
          }

          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        }

        throw new Error("识别仍在后台进行。稍后重新进入食语，我会继续展示这次任务。");
      } catch (error) {
        if (!active) return;
        setMessages((current) => current.map((message) =>
          message.id === messageId && message.inventoryScanCard
            ? {
                ...message,
                text: "这次识别暂时没有完成。任务记录仍然保留，你可以稍后重试。",
                inventoryScanCard: {
                  ...message.inventoryScanCard,
                  status: "failed",
                  error: error instanceof Error ? error.message : "识别失败，请重新拍摄。",
                },
              }
            : message
        ));
      }
    };

    void pollScanJob();
    return () => { active = false; };
  }, [authFetch, chatStorageKey, inventoryScanImageUri, inventoryScanJobId, loadedChatStorageKey]);

  const toggleInventoryScanItem = (msgId: string, itemId: string) => {
    setMessages((current) => current.map((message) =>
      message.id === msgId && message.inventoryScanCard
        ? {
            ...message,
            inventoryScanCard: {
              ...message.inventoryScanCard,
              items: message.inventoryScanCard.items.map((item) =>
                item.id === itemId ? { ...item, selected: !item.selected } : item
              ),
            },
          }
        : message
    ));
  };

  const openInventoryScanEditor = (msgId: string, item: InventoryScanFood) => {
    setInventoryEditTarget({
      msgId,
      itemId: item.id,
      foodName: item.foodName,
      quantity: item.quantity,
      storageLocation: item.suggestedStorageLocation,
      expireDays: String(item.estimatedExpireDays),
    });
  };

  const saveInventoryScanEdit = () => {
    if (!inventoryEditTarget?.foodName.trim()) {
      Alert.alert("提示", "食材名称不能为空。");
      return;
    }
    const expireDays = Math.max(1, Math.min(Number(inventoryEditTarget.expireDays) || 7, 365));
    setMessages((current) => current.map((message) =>
      message.id === inventoryEditTarget.msgId && message.inventoryScanCard
        ? {
            ...message,
            inventoryScanCard: {
              ...message.inventoryScanCard,
              items: message.inventoryScanCard.items.map((item) =>
                item.id === inventoryEditTarget.itemId
                  ? {
                      ...item,
                      foodName: inventoryEditTarget.foodName.trim(),
                      quantity: inventoryEditTarget.quantity.trim() || "1份",
                      suggestedStorageLocation: inventoryEditTarget.storageLocation,
                      estimatedExpireDays: expireDays,
                    }
                  : item
              ),
            },
          }
        : message
    ));
    setInventoryEditTarget(null);
  };

  const confirmInventoryScanCard = async (msgId: string, card: InventoryScanCard) => {
    const selectedItems = card.items.filter((item) => item.selected);
    if (!selectedItems.length) {
      Alert.alert("请选择食材", "至少保留一项需要加入食材库的食材。");
      return;
    }

    setMessages((current) => current.map((message) =>
      message.id === msgId && message.inventoryScanCard
        ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "saving" } }
        : message
    ));

    try {
      const results = await Promise.allSettled(selectedItems.map((item) =>
        inventoryApi.create(authFetch, {
          food_name: item.foodName,
          category: inferInventoryCategory(item.foodName),
          quantity: item.quantity,
          expiration_date: dateKeyAfterDays(item.estimatedExpireDays),
          storage_location: item.suggestedStorageLocation,
          image_url: null,
        })
      ));
      const addedCount = results.filter((result) => result.status === "fulfilled").length;
      if (addedCount !== selectedItems.length) {
        throw new Error(`已加入 ${addedCount} 项，仍有 ${selectedItems.length - addedCount} 项未成功。`);
      }

      const scanStorageKey = getUserStorageKey(INVENTORY_SCAN_JOB_STORAGE_KEY, user?.id);
      if (scanStorageKey) await AsyncStorage.removeItem(scanStorageKey);
      setMessages((current) => [
        ...current.map((message) =>
          message.id === msgId && message.inventoryScanCard
            ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "saved" as const } }
            : message
        ),
        {
          id: `${msgId}-saved`,
          sender: "ai" as const,
          text: `已经帮你把 ${addedCount} 项食材加入保鲜库。你可以回到食材库继续检查，或直接让我根据这些食材推荐一餐。`,
          time: "刚刚",
        },
      ]);
    } catch (error) {
      setMessages((current) => current.map((message) =>
        message.id === msgId && message.inventoryScanCard
          ? { ...message, inventoryScanCard: { ...message.inventoryScanCard, status: "review" } }
          : message
      ));
      Alert.alert("入库未完成", error instanceof Error ? error.message : "网络异常，请稍后重试。");
    }
  };

  // 🛒 一键存入采购清单
  const handleSaveToShoppingList = async (msgId: string, missingCard: DietRecordMissingCard) => {
    if (!shoppingListStorageKey) {
      Alert.alert("请先登录", "登录后才能保存个人采购清单。");
      return;
    }
    try {
      const existingStr = await AsyncStorage.getItem(shoppingListStorageKey);
      let existingList: Array<{ id: string; name: string; amount: string; addedAt: string }> = [];
      if (existingStr) {
        try {
          existingList = JSON.parse(existingStr);
        } catch {
          existingList = [];
        }
      }

      const newItems = missingCard.missingIngredients.map((item) => ({
        id: String(Date.now() + Math.random()),
        name: item.name,
        amount: item.amount,
        addedAt: new Date().toLocaleDateString(),
      }));

      const updatedList = [...newItems, ...existingList];
      await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(updatedList));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.missingCard
            ? { ...m, missingCard: { ...m.missingCard, savedToList: true } }
            : m
        )
      );

      const itemsStr = missingCard.missingIngredients.map((i) => `【${i.name} ${i.amount}】`).join("、");
      Alert.alert(
        "已存入采购清单",
        `已成功为您将 ${itemsStr} 加入【智能采购清单】！将在离线买菜时随时可用。`
      );
    } catch {
      Alert.alert("提示", "加入采购清单失败");
    }
  };

  // 📷 相机/相册选图直接在 AI 对话框识别菜品热量
  const handleActionVisionFood = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const base64Image = result.assets[0].base64;
      const imageUri = result.assets[0].uri;

      // 在对话流中展示用户发送的图片
      const userMsg: Message = {
        id: String(Date.now()),
        sender: "user",
        text: "[已发送美食/菜品照片进行 AI 多模态识别]",
        imageUri,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      {
        const resData = await aiApi.visionFood<{ data?: Record<string, unknown> }>(authFetch, base64Image);
        const food = resData.data || {};
        const replyText = `食语 AI 多模态识别结果：\n\n• 食物名称：${food.foodName || "健康料理"}\n• 预估分量：${food.estimatedWeightGrams || 100}g\n• 估计热量：约 ${food.calories || 0} kcal\n• 营养元素：蛋白质 ${food.proteinGrams || 0}g | 碳水 ${food.carbsGrams || 0}g | 脂肪 ${food.fatGrams || 0}g\n\n小建议：符合您的今日膳食营养配比，建议结合低盐调味享用！`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: replyText,
            time: "刚刚",
          },
        ]);
      }
    } catch (e: any) {
      console.error("[Vision AI Error]", e);
      Alert.alert("提示", "调起识别失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  // 确认打卡保存 (支持今日打卡 或 明日计划)
  const handleConfirmRecordCard = async (
    msgId: string,
    card: DietRecordActionCard,
    isTomorrow = false
  ) => {
    try {
      const targetDateStr = dateKeyAfterDays(isTomorrow ? 1 : 0);

      await dietApi.create(authFetch, {
        meal_type: card.mealType || "午餐",
        food_name: card.foodName,
        amount: card.amount || "1份",
        calories: card.calories,
        protein: card.protein,
        carbs: card.carbs,
        fat: card.fat,
        recorded_at: targetDateStr,
        image_url: null,
      });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.actionCard
              ? { ...m, actionCard: { ...m.actionCard, saved: true } }
              : m
          )
        );
        Alert.alert(
          "保存成功",
          isTomorrow
            ? `已为您将【${card.foodName}】存入明日(${targetDateStr})饮食计划！`
            : `已成功将【${card.foodName}】记录为今日打卡！`
        );
    } catch (e) {
      Alert.alert("提示", "网络异常");
    }
  };

  // 弹出对话框内置修改弹窗
  const handleOpenEditModal = (msgId: string, card: DietRecordActionCard) => {
    setCurrentMsgId(msgId);
    setFormMealType(card.mealType || "午餐");
    setFormFoodName(card.foodName || "健康餐食");
    setFormAmount(card.amount || "1份");
    setFormCalories(card.calories == null ? "" : String(card.calories));
    setFormProtein(card.protein == null ? "" : String(card.protein));
    setFormCarbs(card.carbs == null ? "" : String(card.carbs));
    setFormFat(card.fat == null ? "" : String(card.fat));
    setEditModalVisible(true);
  };

  // 保存对话框内置修改弹窗数据
  const handleSaveEditModal = async () => {
    if (!formFoodName.trim()) {
      Alert.alert("提示", "请输入食物名称");
      return;
    }
    setSavingRecord(true);
    try {
      const parseOptionalNumber = (value: string) => value.trim() ? Number(value) : null;
      const calories = parseOptionalNumber(formCalories);
      const protein = parseOptionalNumber(formProtein);
      const carbs = parseOptionalNumber(formCarbs);
      const fat = parseOptionalNumber(formFat);

      await dietApi.create(authFetch, {
        meal_type: formMealType,
        food_name: formFoodName.trim(),
        amount: formAmount.trim() || "1份",
        calories,
        protein,
        carbs,
        fat,
        recorded_at: toLocalDateKey(),
        image_url: null,
      });
        if (currentMsgId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === currentMsgId && m.actionCard
                ? {
                    ...m,
                    actionCard: {
                      ...m.actionCard,
                      saved: true,
                      mealType: formMealType,
                      foodName: formFoodName.trim(),
                      amount: formAmount.trim(),
                      calories,
                      protein,
                      carbs,
                      fat,
                    },
                  }
                : m
            )
          );
        }
        setEditModalVisible(false);
        Alert.alert("打卡成功", `已成功记录【${formMealType}】：${formFoodName} (${formCalories} kcal)!`);
    } catch (e) {
      Alert.alert("提示", "网络连接失败");
    } finally {
      setSavingRecord(false);
    }
  };

  // 🧾 扫小票选图直接在 AI 对话框解析
  const handleActionScanReceipt = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });

      if (result.canceled || !result.assets?.[0]?.base64) return;

      const base64Image = result.assets[0].base64;
      const imageUri = result.assets[0].uri;

      const userMsg: Message = {
        id: String(Date.now()),
        sender: "user",
        text: "[已发送超市小票/购物照片进行 AI 自动扫描]",
        imageUri,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      {
        const resData = await aiApi.scanReceipt<{ items?: any[] }>(authFetch, base64Image);
        const items: any[] = resData.items || [];
        const itemsText = items.length > 0
          ? items.map((it: any) => `• ${it.foodName || "食材"} (${it.quantity || "1份"}, 建议存放${it.suggestedStorageLocation || "保鲜库"}, 保质${it.estimatedExpireDays || 7}天)`).join("\n")
          : "• 高山牛油果 (1个, 保鲜库, 5天)\n• 鸡胸肉 (200g, 冷冻库, 14天)";

        const replyText = `食语为您识别出的购物列表：\n\n${itemsText}\n\n已智能分类，可前往【冰箱库存】一键录入保鲜库！`;

        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            sender: "ai",
            text: replyText,
            time: "刚刚",
          },
        ]);
      }
    } catch (e: any) {
      console.error("[Scan Receipt Error]", e);
      Alert.alert("提示", "小票识别失败，请确保文字清晰");
    } finally {
      setLoading(false);
    }
  };

  const handleActionFridgeClean = () => {
    router.push("/inventory");
  };

  const handleActionCookingVoice = () => {
    router.push({
      pathname: "/cooking-mode",
      params: {
        title: "食光 AI 试做菜谱",
        steps: JSON.stringify([
          "备齐食材，主料切丁，热锅冷油",
          "下蒜末爆香，放入主食材翻炒 3 分钟",
          "加入少许生抽与关火焖 2 分钟装盘",
        ]),
        ingredients: JSON.stringify([
          { name: "高山牛油果", amount: "1个" },
          { name: "鸡胸肉", amount: "150g" },
        ]),
      },
    });
  };

  const handleSafeGoBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push("/(tabs)");
    }
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <AssistantMessageItem
      message={item}
      userAvatarUrl={user?.avatar_url}
      userAvatarSeed={user?.id ?? user?.username}
      handleConfirmRecordCard={handleConfirmRecordCard}
      handleOpenEditModal={handleOpenEditModal}
      toggleInventoryScanItem={toggleInventoryScanItem}
      openInventoryScanEditor={openInventoryScanEditor}
      confirmInventoryScanCard={confirmInventoryScanCard}
      handleSaveToShoppingList={handleSaveToShoppingList}
      handleSendMessage={handleSendMessage}
      onOpenInventory={() => router.push("/inventory")}
      onOpenInventoryAdd={() => router.push("/inventory", { action: "add" })}
    />
  );

  return (
    <Screen backgroundColor="#F6F4F0" safeAreaEdges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 flex-col justify-between"
      >
        {/* Full Screen Header */}
        <View className="px-5 py-3.5 flex-row items-center justify-between border-b border-[#EBE3D5] bg-white/70 shadow-xs">
          <TouchableOpacity onPress={handleSafeGoBack} className="p-2 -ml-2 active:opacity-70">
            <FontAwesome6 name="chevron-left" size={18} color="#3D3229" />
          </TouchableOpacity>

          <View className="flex-row items-center gap-2 bg-[#2D6A4F]/10 px-3.5 py-1.5 rounded-full">
            <Text className="text-base font-black text-[#3D3229]">食光</Text>
            <View className="bg-[#2D6A4F] px-2 py-0.5 rounded-md">
              <Text className="text-[10px] font-black text-white">AI 食语</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={handleOpenShoppingList}
              className="w-9 h-9 rounded-full bg-[#D4A276]/20 items-center justify-center border border-[#D4A276]/40 active:opacity-80 relative"
            >
              <FontAwesome6 name="cart-shopping" size={13} color="#D4A276" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setHistoryDrawerVisible(true)}
              className="w-9 h-9 rounded-full bg-white items-center justify-center border border-[#EBE3D5] active:opacity-80"
            >
              <FontAwesome6 name="clock-rotate-left" size={13} color="#2D6A4F" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleStartNewChat}
              className="w-9 h-9 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs active:opacity-80"
            >
              <FontAwesome6 name="plus" size={13} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIsMuted(!isMuted)}
              className="w-9 h-9 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
            >
              <FontAwesome6
                name={isMuted ? "volume-xmark" : "volume-high"}
                size={14}
                color="#3D3229"
              />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSafeGoBack}
              className="w-9 h-9 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
            >
              <FontAwesome6 name="xmark" size={15} color="#3D3229" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Virtualized conversation list */}
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(message) => message.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 16 }}
          className="flex-1 px-5"
          ListEmptyComponent={
            <View className="items-center pt-8 pb-4">
              {/* 2D Anime Avatar Mascot */}
              <View className="relative mb-4 items-center justify-center">
                <View className="w-28 h-28 rounded-full bg-gradient-to-tr from-[#2D6A4F]/20 to-[#E9C46A]/30 items-center justify-center shadow-xl border-4 border-white overflow-hidden">
                  <Image
                    source={require("@/assets/shiyu-avatar.jpg")}
                    className="w-28 h-28 rounded-full"
                    resizeMode="cover"
                  />
                </View>
                <View className="absolute -bottom-1 bg-[#E9C46A] px-3 py-1 rounded-full border border-white shadow-xs">
                  <Text className="text-[10px] font-black text-[#3D3229]">食光 AI 大厨 · 食语</Text>
                </View>
              </View>

              {/* Hero Slogan */}
              <Text className="text-xl font-black text-[#3D3229] tracking-wide mb-1 text-center">
                每一顿膳食与卡路里，食语都能帮你理清楚
              </Text>
              <Text className="text-xs text-[#8B7D6B] mb-6 text-center">
                智能库存配餐 · 拍照识菜算营养 · 双手解放做饭语音
              </Text>

              {/* Horizontal Sliding Cards */}
              <View className="w-full">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 16, paddingRight: 4 }}
                className="w-full flex-row my-2"
              >
                {cardPrompts.map((card, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSendMessage(card.title)}
                    className="w-52 bg-white p-5 rounded-3xl border border-[#EBE3D5] shadow-xs justify-between mr-4 active:scale-95 transition-transform"
                  >
                    <View className="w-10.5 h-10.5 rounded-2xl bg-[#F5EFE6] items-center justify-center mb-5">
                      <FontAwesome6 name={card.icon} size={18} color={card.color} />
                    </View>
                    <View>
                      <Text className="text-xs font-black text-[#3D3229] leading-5 mb-1.5">
                        {card.title}
                      </Text>
                      <Text className="text-[11px] text-[#8B7D6B] leading-4">
                        {card.subtitle}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
            </View>
          }
          ListFooterComponent={loading ? (
            <View className="flex-row items-center gap-2 bg-white p-3.5 rounded-2xl border border-[#EBE3D5] self-start ml-2 mb-4 shadow-xs">
              <ActivityIndicator size="small" color="#2D6A4F" />
              <Text className="text-xs text-[#8B7D6B] font-bold">AI 正在为您检索食材库与营养数据库...</Text>
            </View>
          ) : null}
        />



        {/* Fixed Full Screen Bottom Bar Section */}
        <View className="bg-white px-5 pt-3.5 pb-6 border-t border-[#EBE3D5] shadow-2xl">
          <View className="mb-2">
            <MedicalDisclaimer compact />
          </View>
          {/* Selected Image Attachment Badge */}
          {selectedImage && (
            <View className="mb-2.5 flex-row items-center self-start bg-[#F6F4F0] p-1.5 pr-3 rounded-2xl border border-[#EBE3D5] relative shadow-xs">
              <Image source={{ uri: selectedImage.uri }} className="w-14 h-14 rounded-xl mr-2.5" resizeMode="cover" />
              <View>
                <Text className="text-xs font-bold text-[#3D3229]">已添加待识别照片</Text>
                <Text className="text-[10px] text-[#8B7D6B]">可在下方输入提问，一并发送</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedImage(null)}
                className="absolute -top-1.5 -right-1.5 bg-[#E76F51] w-5.5 h-5.5 rounded-full items-center justify-center border border-white shadow-xs"
              >
                <FontAwesome6 name="xmark" size={10} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}

          {/* Search Pill Bar */}
          <View className="bg-[#F6F4F0] px-4 py-2.5 rounded-full border border-[#EBE3D5] flex-row items-center justify-between mb-4">
            <TouchableOpacity onPress={handlePickImageAttachment} className="p-1 active:opacity-70">
              <FontAwesome6 name="camera" size={17} color={selectedImage ? "#2D6A4F" : "#3D3229"} />
            </TouchableOpacity>

            <TextInput
              value={inputText}
              onChangeText={setInputText}
              placeholder={selectedImage ? "针对照片提问（如：热量高吗？卡路里多少？）..." : "发消息或按住说话..."}
              placeholderTextColor="#A3A398"
              className="flex-1 text-xs text-[#3D3229] px-3"
              onSubmitEditing={() => handleSendMessage()}
            />

            <TouchableOpacity
              onPress={() => handleSendMessage()}
              disabled={(!inputText.trim() && !selectedImage) || loading}
              className="p-1 active:opacity-70"
            >
              <FontAwesome6
                name={inputText.trim() || selectedImage ? "paper-plane" : "microphone"}
                size={17}
                color={inputText.trim() || selectedImage ? "#2D6A4F" : "#3D3229"}
              />
            </TouchableOpacity>
          </View>

          {/* Bottom 4 Core AI Action Grid */}
          <View className="flex-row items-center justify-between px-2">
            <TouchableOpacity
              onPress={handleActionVisionFood}
              className="items-center gap-1.5 active:opacity-80 flex-1"
            >
              <View className="w-12 h-12 rounded-2xl bg-[#F6F4F0] items-center justify-center border border-[#EBE3D5] shadow-xs">
                <FontAwesome6 name="camera" size={20} color="#2D6A4F" />
              </View>
              <Text className="text-xs font-bold text-[#3D3229]">识菜算热量</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleActionScanReceipt}
              className="items-center gap-1.5 active:opacity-80 flex-1"
            >
              <View className="w-12 h-12 rounded-2xl bg-[#F6F4F0] items-center justify-center border border-[#EBE3D5] shadow-xs">
                <FontAwesome6 name="receipt" size={20} color="#E9C46A" />
              </View>
              <Text className="text-xs font-bold text-[#3D3229]">扫小票入库</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleActionFridgeClean}
              className="items-center gap-1.5 active:opacity-80 flex-1"
            >
              <View className="w-12 h-12 rounded-2xl bg-[#F6F4F0] items-center justify-center border border-[#EBE3D5] shadow-xs">
                <FontAwesome6 name="boxes-packing" size={20} color="#D4A276" />
              </View>
              <Text className="text-xs font-bold text-[#3D3229]">冰箱清库</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleActionCookingVoice}
              className="items-center gap-1.5 active:opacity-80 flex-1"
            >
              <View className="w-12 h-12 rounded-2xl bg-[#F6F4F0] items-center justify-center border border-[#EBE3D5] shadow-xs">
                <FontAwesome6 name="kitchen-set" size={20} color="#E07A5F" />
              </View>
              <Text className="text-xs font-bold text-[#3D3229]">做饭语音包</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={Boolean(inventoryEditTarget)}
        animationType="slide"
        transparent
        onRequestClose={() => setInventoryEditTarget(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[32px] bg-white p-6">
            <View className="mb-5 flex-row items-center justify-between border-b border-[#F5EFE6] pb-3">
              <View className="flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-[#2D6A4F]">
                  <FontAwesome6 name="pen" size={12} color="#FFF" />
                </View>
                <View>
                  <Text className="text-base font-black text-[#3D3229]">修改识别结果</Text>
                  <Text className="mt-0.5 text-[10px] text-[#8B7D6B]">确认后只更新当前卡片，不会立即入库</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setInventoryEditTarget(null)} className="p-2">
                <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <Text className="mb-1.5 text-xs font-bold text-[#8B7D6B]">食材名称</Text>
            <TextInput
              value={inventoryEditTarget?.foodName || ""}
              onChangeText={(foodName) => setInventoryEditTarget((current) => current ? { ...current, foodName } : current)}
              className="rounded-2xl border border-[#EBE3D5] bg-[#FDF8F0] px-4 py-3.5 text-sm font-bold text-[#3D3229]"
            />

            <View className="mt-4 flex-row gap-3">
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-[#8B7D6B]">数量</Text>
                <TextInput
                  value={inventoryEditTarget?.quantity || ""}
                  onChangeText={(quantity) => setInventoryEditTarget((current) => current ? { ...current, quantity } : current)}
                  placeholder="如：500g、2盒"
                  className="rounded-2xl border border-[#EBE3D5] bg-[#FDF8F0] px-4 py-3 text-sm font-bold text-[#3D3229]"
                />
              </View>
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-[#8B7D6B]">建议保质期（天）</Text>
                <TextInput
                  value={inventoryEditTarget?.expireDays || ""}
                  onChangeText={(expireDays) => setInventoryEditTarget((current) => current ? { ...current, expireDays } : current)}
                  keyboardType="numeric"
                  className="rounded-2xl border border-[#EBE3D5] bg-[#FDF8F0] px-4 py-3 text-sm font-bold text-[#3D3229]"
                />
              </View>
            </View>

            <Text className="mb-2 mt-4 text-xs font-bold text-[#8B7D6B]">存放位置</Text>
            <View className="flex-row gap-2">
              {(["冷藏", "冷冻", "常温"] as const).map((location) => (
                <TouchableOpacity
                  key={location}
                  onPress={() => setInventoryEditTarget((current) => current ? { ...current, storageLocation: location } : current)}
                  className={`flex-1 items-center rounded-xl border py-2.5 ${inventoryEditTarget?.storageLocation === location ? "border-[#2D6A4F] bg-[#2D6A4F]" : "border-[#EBE3D5] bg-white"}`}
                >
                  <Text className={`text-xs font-bold ${inventoryEditTarget?.storageLocation === location ? "text-white" : "text-[#8B7D6B]"}`}>{location}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={saveInventoryScanEdit}
              className="mt-5 items-center rounded-2xl bg-[#2D6A4F] py-4"
            >
              <Text className="text-sm font-black text-white">保存修改并返回确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 📝 AI 对话内置即时修改打卡 Modal */}
      <Modal visible={editModalVisible} animationType="slide" transparent>
        <View className="flex-1 bg-black/40 justify-end">
          <View className="bg-white rounded-t-[32px] p-6 max-h-[85%]">
            {/* Modal 标题栏 */}
            <View className="flex-row items-center justify-between mb-4 border-b border-[#F5EFE6] pb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center">
                  <FontAwesome6 name="utensils" size={13} color="#FFF" />
                </View>
                <Text className="text-base font-black text-[#3D3229]">
                  修改打卡数据 ({formMealType})
                </Text>
              </View>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} className="p-1 active:opacity-70">
                <FontAwesome6 name="xmark" size={20} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
              {/* 餐别选择 */}
              <View>
                <Text className="text-xs font-bold text-[#8B7D6B] mb-2">餐别选择</Text>
                <View className="flex-row gap-2">
                  {["早餐", "午餐", "晚餐", "加餐"].map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setFormMealType(type)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${
                        formMealType === type
                          ? "bg-[#2D6A4F] border-[#2D6A4F]"
                          : "bg-white border-[#EBE3D5]"
                      }`}
                    >
                      <Text className={`text-xs font-bold ${formMealType === type ? "text-white" : "text-[#3D3229]"}`}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 食物名称 */}
              <View>
                <Text className="text-xs font-bold text-[#8B7D6B] mb-1">食物名称</Text>
                <TextInput
                  value={formFoodName}
                  onChangeText={setFormFoodName}
                  placeholder="如：香煎鸡胸肉、水饺"
                  className="bg-[#F5EFE6]/60 p-3 rounded-xl border border-[#EBE3D5] text-xs font-bold text-[#3D3229]"
                />
              </View>

              {/* 分量与卡路里 */}
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">预估分量</Text>
                  <TextInput
                    value={formAmount}
                    onChangeText={setFormAmount}
                    placeholder="如：1碗、200g"
                    className="bg-[#F5EFE6]/60 p-3 rounded-xl border border-[#EBE3D5] text-xs font-bold text-[#3D3229]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-[#8B7D6B] mb-1">卡路里 (kcal)</Text>
                  <TextInput
                    value={formCalories}
                    onChangeText={setFormCalories}
                    keyboardType="numeric"
                    placeholder="350"
                    className="bg-[#F5EFE6]/60 p-3 rounded-xl border border-[#EBE3D5] text-xs font-bold text-[#3D3229]"
                  />
                </View>
              </View>

              {/* 三大营养素 */}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">蛋白质 (g)</Text>
                  <TextInput
                    value={formProtein}
                    onChangeText={setFormProtein}
                    keyboardType="numeric"
                    className="bg-[#F5EFE6]/60 p-2.5 rounded-xl border border-[#EBE3D5] text-xs text-center font-bold text-[#3D3229]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">碳水 (g)</Text>
                  <TextInput
                    value={formCarbs}
                    onChangeText={setFormCarbs}
                    keyboardType="numeric"
                    className="bg-[#F5EFE6]/60 p-2.5 rounded-xl border border-[#EBE3D5] text-xs text-center font-bold text-[#3D3229]"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-[#8B7D6B] mb-1">脂肪 (g)</Text>
                  <TextInput
                    value={formFat}
                    onChangeText={setFormFat}
                    keyboardType="numeric"
                    className="bg-[#F5EFE6]/60 p-2.5 rounded-xl border border-[#EBE3D5] text-xs text-center font-bold text-[#3D3229]"
                  />
                </View>
              </View>

              {/* 保存按钮 */}
              <TouchableOpacity
                onPress={handleSaveEditModal}
                disabled={savingRecord}
                className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center shadow-sm active:opacity-90 mt-2"
              >
                {savingRecord ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text className="text-sm font-bold text-white">确认打卡保存</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 📚 历史对话会话列表抽屉 Modal */}
      <Modal
        visible={historyDrawerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryDrawerVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-[#F6F4F0] rounded-t-3xl p-5 max-h-[80%] border-t border-[#EBE3D5] shadow-2xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-[#EBE3D5]">
              <View className="flex-row items-center gap-2">
                <FontAwesome6 name="clock-rotate-left" size={16} color="#2D6A4F" />
                <Text className="text-base font-black text-[#3D3229]">历史对话记录</Text>
              </View>

              <TouchableOpacity
                onPress={() => setHistoryDrawerVisible(false)}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
              >
                <FontAwesome6 name="xmark" size={14} color="#3D3229" />
              </TouchableOpacity>
            </View>

            {/* 新建对话按钮 */}
            <TouchableOpacity
              onPress={handleStartNewChat}
              className="my-3 bg-[#2D6A4F] py-3 px-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-xs active:opacity-90"
            >
              <FontAwesome6 name="plus" size={14} color="#FFF" />
              <Text className="text-xs font-bold text-white">开启新的对话</Text>
            </TouchableOpacity>

            <FlatList
              data={sessions}
              keyExtractor={(session) => session.id}
              className="max-h-[400px]"
              contentContainerStyle={{ gap: 6 }}
              ListEmptyComponent={<View className="items-center py-8"><Text className="text-xs text-[#8B7D6B]">暂无历史对话记录</Text></View>}
              renderItem={({ item: session }) => (
                  <View
                    className={`p-3.5 my-1 rounded-2xl border flex-row items-center justify-between ${
                      session.id === currentSessionId
                        ? "bg-[#2D6A4F]/10 border-[#2D6A4F]"
                        : "bg-white border-[#EBE3D5]"
                    }`}
                  >
                    <TouchableOpacity
                      onPress={() => handleSelectSession(session)}
                      className="flex-1 mr-3"
                    >
                      <Text className="text-xs font-black text-[#3D3229] mb-1" numberOfLines={1}>
                        {session.title}
                      </Text>
                      <Text className="text-[11px] text-[#8B7D6B]">
                        {session.updatedAt} · {session.messages?.length || 0} 条对话
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleDeleteSession(session.id)}
                      className="w-8 h-8 rounded-full bg-[#F5EFE6] items-center justify-center active:opacity-70"
                    >
                      <FontAwesome6 name="trash-can" size={12} color="#8B7D6B" />
                    </TouchableOpacity>
                  </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* 🛒 智能采购清单 Drawer Modal */}
      <Modal
        visible={shoppingListModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setShoppingListModalVisible(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-[#F6F4F0] rounded-t-3xl p-5 max-h-[80%] border-t border-[#EBE3D5] shadow-2xl">
            <View className="flex-row items-center justify-between pb-3 border-b border-[#EBE3D5]">
              <View className="flex-row items-center gap-2">
                <FontAwesome6 name="cart-shopping" size={16} color="#D4A276" />
                <Text className="text-base font-black text-[#3D3229]">我的智能采购清单</Text>
              </View>

              <TouchableOpacity
                onPress={() => setShoppingListModalVisible(false)}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
              >
                <FontAwesome6 name="xmark" size={14} color="#3D3229" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={shoppingItems}
              keyExtractor={(item) => item.id}
              className="my-3 max-h-[400px]"
              contentContainerStyle={{ gap: 6 }}
              ListEmptyComponent={<View className="items-center py-10 bg-white/60 rounded-2xl border border-dashed border-[#EBE3D5]">
                  <FontAwesome6 name="basket-shopping" size={28} color="#D4A276" />
                  <Text className="text-xs text-[#8B7D6B] mt-2 font-bold">采购清单空空如也</Text>
                  <Text className="text-[10px] text-[#8B7D6B] mt-1">在 AI 聊天中点【想吃菜品】，缺料会自动加入哦！</Text>
                </View>}
              renderItem={({ item }) => (
                  <View
                    className="p-3 my-1 rounded-2xl bg-white border border-[#EBE3D5] flex-row items-center justify-between shadow-2xs"
                  >
                    <View className="flex-1 mr-3 flex-row items-center gap-2">
                      <View className="w-7 h-7 rounded-full bg-amber-500/10 items-center justify-center">
                        <FontAwesome6 name="carrot" size={12} color="#D4A276" />
                      </View>
                      <View>
                        <Text className="text-xs font-black text-[#3D3229]">{item.name}</Text>
                        <Text className="text-[10px] text-[#8B7D6B]">规格/用量: {item.amount}</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => handleRemoveShoppingItem(item.id)}
                      className="bg-emerald-500/10 px-2.5 py-1 rounded-xl flex-row items-center gap-1 active:opacity-70"
                    >
                      <FontAwesome6 name="check" size={10} color="#2D6A4F" />
                      <Text className="text-[10px] font-bold text-[#2D6A4F]">已买到</Text>
                    </TouchableOpacity>
                  </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
