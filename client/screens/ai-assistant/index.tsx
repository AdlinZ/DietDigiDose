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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeRouter, useSafeSearchParams } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  AI_DATA_CONSENT_STORAGE_KEY,
  CHAT_SESSIONS_STORAGE_KEY,
  INVENTORY_SCAN_JOB_STORAGE_KEY,
  SHOPPING_LIST_STORAGE_KEY,
  getUserStorageKey,
  storageBelongsToCurrentUser,
} from "@/utils/userStorage";
import { aiApi, ApiError, dietApi, healthApi, inventoryApi, recipesApi, shoppingListApi, waitForAgentRun } from "@/services/api";
import { dateKeyAfterDays, toLocalDateKey, toLocalTimeKey } from "@/utils/date";
import { hasSafetyProfile, safetySummary, type HealthProfile } from "@/utils/healthProfile";
import { MedicalDisclaimer } from "@/components/MedicalDisclaimer";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useTTS } from "@/hooks/useTTS";
import { VoiceWaveform, type VoiceState } from "@/components/VoiceWaveform";
import type { AgentActionProposal, AgentResponse, AgentRunEvent, AgentRunSummary, AIWriteConfirmation, ChatSession, DietRecordActionCard, DietRecordMissingCard, InventoryScanCard, InventoryScanFood, Message, SolutionCard } from "./types";
import { inferInventoryCategory, normalizeInventoryScanFoods } from "./inventoryScan";
import { AssistantMessageItem } from "./AssistantMessageItem";
import { normalizeShoppingItems, type ShoppingItem } from "@/utils/shoppingList";
import { HistoryDrawer, ShoppingListDrawer } from "./AssistantDrawers";

type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

function parseSolutionMacros(macros: string) {
  const parseValue = (match: RegExpMatchArray | null) => match ? Number(match[1]) : undefined;
  return {
    calories: parseValue(macros.match(/(\d+(?:\.\d+)?)\s*kcal/i)),
    protein: parseValue(macros.match(/蛋白质\s*(\d+(?:\.\d+)?)\s*g/i)),
    carbs: parseValue(macros.match(/碳水\s*(\d+(?:\.\d+)?)\s*g/i)),
    fat: parseValue(macros.match(/脂肪\s*(\d+(?:\.\d+)?)\s*g/i)),
  };
}

function serializeMessageForAI(message: Message) {
  if (message.sender === "user") return message.text.trim();

  const cards: string[] = [];
  if (message.actionCard) {
    const { mealType, foodName, amount, calories, protein, carbs, fat } = message.actionCard;
    cards.push(`饮食打卡卡片：${mealType} ${foodName}（${amount}，${calories ?? "未知"} kcal，蛋白质 ${protein ?? "未知"}g，碳水 ${carbs ?? "未知"}g，脂肪 ${fat ?? "未知"}g）`);
  }
  if (message.missingCard) {
    cards.push(`缺料采购卡片：${message.missingCard.dishName}；缺少 ${message.missingCard.missingIngredients.map((item) => `${item.name} ${item.amount}`).join("、")}`);
  }
  if (message.optionsCard) {
    cards.push(`选项卡片：${message.optionsCard.title}；${message.optionsCard.options.map((item) => `${item.label}=${item.actionText}`).join("；")}`);
  }
  if (message.solutionCards?.length) {
    cards.push(`方案卡片：${message.solutionCards.map((card) => `${card.schemeTag}：${card.title}；食材：${card.ingredients}；做法提示：${card.cookingTip}；营养：${card.macros}`).join("\n")}`);
  }

  return [message.text.trim(), ...cards].filter(Boolean).join("\n\n【界面卡片上下文】\n");
}

function buildChatHistory(messages: Message[], userText: string): ChatHistoryMessage[] {
  return messages
    .filter((message) => message.status !== "failed" && typeof message.text === "string" && message.text.trim().length > 0)
    .slice(-49)
    .map((message): ChatHistoryMessage => ({
      role: message.sender === "user" ? "user" as const : "assistant" as const,
      content: serializeMessageForAI(message).slice(0, 12_000),
    }))
    .concat({ role: "user", content: userText.trim().slice(0, 12_000) });
}

function agentMessageText(run: AgentRunSummary, reply?: string) {
  if (reply || run.reply) return reply || run.reply || "";
  if (run.status === "failed") return run.error?.message || "Agent 执行失败，请重试。";
  if (run.status === "awaiting_input") return run.pendingInput?.question || "Supervisor 需要你补充一些信息。";
  if (run.status === "awaiting_approval") return "方案已经准备好，请检查并确认下方操作。";
  if (run.status === "queued") return "任务正在排队，我会在这里持续更新进度。";
  return "Supervisor 正在协调专业 Agent 处理这项任务…";
}

export default function AIAssistantScreen() {
  const router = useSafeRouter();
  const insets = useSafeAreaInsets();
  const {
    prompt,
    prefill_food: prefillFood,
    inventory_scan_job_id: inventoryScanJobId,
    inventory_scan_image_uri: inventoryScanImageUri,
    open_shopping_list: openShoppingList,
  } = useSafeSearchParams<{
    prompt?: string | string[];
    prefill_food?: string | string[];
    inventory_scan_job_id?: string | string[];
    inventory_scan_image_uri?: string | string[];
    open_shopping_list?: string | string[];
  }>();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const [healthProfile, setHealthProfile] = useState<HealthProfile | null>(null);
  const chatStorageKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, user?.id);
  const shoppingListStorageKey = getUserStorageKey(SHOPPING_LIST_STORAGE_KEY, user?.id);
  const aiConsentStorageKey = getUserStorageKey(AI_DATA_CONSENT_STORAGE_KEY, user?.id);
  const [loadedChatStorageKey, setLoadedChatStorageKey] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToolsGrid, setShowToolsGrid] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTTSEnabled, setVoiceTTSEnabled] = useState(true);
  const [currentRecognizedText, setCurrentRecognizedText] = useState("");
  const [lastAIReplyText, setLastAIReplyText] = useState("");
  const [isDeepThink, setIsDeepThink] = useState(false);
  const [isWebSearch, setIsWebSearch] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [storedMessages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ uri: string; base64: string } | null>(null);
  const autoSentPromptKey = useRef<string | null>(null);
  const handledInventoryScanJob = useRef<string | null>(null);
  const historyLimitNoticeShown = useRef(false);
  const [inventoryEditTarget, setInventoryEditTarget] = useState<{
    msgId: string;
    itemId: string;
    foodName: string;
    quantity: string;
    storageLocation: "冷藏" | "冷冻" | "常温";
    expireDays: string;
  } | null>(null);
  const [storedSessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => String(Date.now()));
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const [headerMoreVisible, setHeaderMoreVisible] = useState(false);
  const [aiConsentVisible, setAIConsentVisible] = useState(false);
  const [aiConsentSaving, setAIConsentSaving] = useState(false);
  const [aiConsentError, setAIConsentError] = useState("");
  const pendingConsentSend = useRef<{ textToSend?: string } | null>(null);
  const [selectedPendingInputMessageId, setSelectedPendingInputMessageId] = useState<string | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState("");
  const historyBelongsToCurrentUser = storageBelongsToCurrentUser(
    chatStorageKey,
    loadedChatStorageKey,
  );
  const messages = historyBelongsToCurrentUser ? storedMessages : [];
  const sessions = historyBelongsToCurrentUser ? storedSessions : [];
  const pendingInputMessages = messages.filter((message) => message.agentRun?.run.status === "awaiting_input" && message.agentRun.run.pendingInput);
  const pendingInputTarget = pendingInputMessages.find((message) => message.id === selectedPendingInputMessageId)
    || pendingInputMessages[pendingInputMessages.length - 1];

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const agentPollingKey = messages
    .filter((message) => message.agentRun && (["queued", "running"].includes(message.agentRun.run.status) || message.agentRun.events.length === 0 || message.agentCardsHydrated !== true))
    .map((message) => `${message.id}:${message.agentRun!.run.id}:${message.agentRun!.run.status}:${message.agentRun!.events.length}:${message.agentCardsHydrated === true}`)
    .join("|");

  useEffect(() => {
    if (!agentPollingKey) return;
    let active = true;
    const poll = async () => {
      const targets = messagesRef.current.filter((message) => message.agentRun
        && (["queued", "running"].includes(message.agentRun.run.status) || message.agentRun.events.length === 0 || message.agentCardsHydrated !== true));
      await Promise.all(targets.map(async (target) => {
        try {
          const result = await aiApi.agentRun<{ run: AgentRunSummary; events: AgentRunEvent[]; solutionCards?: SolutionCard[] }>(authFetch, target.agentRun!.run.id);
          if (!active) return;
          setMessages((current) => current.map((message) => message.id === target.id ? {
            ...message,
            text: agentMessageText(result.run),
            status: result.run.status === "failed" ? "failed" : result.run.status === "completed" ? "completed" : message.status,
            responseTimeMs: result.run.durationMs ?? message.responseTimeMs,
            solutionCards: result.solutionCards ?? message.solutionCards,
            agentCardsHydrated: true,
            agentRun: { ...message.agentRun!, run: result.run, events: result.events },
          } : message));
          if (result.run.reply) setLastAIReplyText(result.run.reply);
        } catch (error) {
          console.warn("[Agent polling]", error);
        }
      }));
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [agentPollingKey, authFetch]);

  useEffect(() => {
    if (!user?.id) {
      setHealthProfile(null);
      return;
    }
    let active = true;
    void healthApi.profile<HealthProfile>(authFetch)
      .then((profile) => { if (active) setHealthProfile(profile); })
      .catch(() => { if (active) setHealthProfile(null); });
    return () => { active = false; };
  }, [authFetch, user?.id]);

  // --- TTS 语音播报 ---
  const { speak, stop: stopTTS, isSpeaking, error: ttsError } = useTTS();

  // 同步 TTS 的 isSpeaking 到 voiceState
  useEffect(() => {
    if (!isSpeaking && voiceState === "speaking") {
      setVoiceState("completed");
    }
  }, [isSpeaking, voiceState]);

  // --- 语音管线：ASR → LLM → TTS ---
  const handleVoiceQuery = useCallback(async (userText: string) => {
    if (!userText.trim()) return;

    setVoiceState("thinking");
    stopTTS();

    const userMsg: Message = {
      id: String(Date.now()),
      sender: "user",
      text: userText,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setCurrentRecognizedText("");

    try {
      const sessionId = typeof currentSessionId === "string" && currentSessionId.trim().length <= 120
        ? currentSessionId.trim()
        : undefined;
      const res = (await aiApi.chat(authFetch, {
        messages: buildChatHistory(messagesRef.current, userText),
        source: "voice",
        ...(sessionId ? { sessionId } : {}),
      })) as AgentResponse & { solutionCards?: SolutionCard[] };
      const completedRun = await waitForAgentRun(authFetch, res.run);
      const replyText = agentMessageText(completedRun, completedRun.reply || res.reply);

      const aiMsg: Message = {
        id: String(Date.now() + 1),
        sender: "ai",
        text: replyText,
        solutionCards: res.solutionCards,
        agentCardsHydrated: res.solutionCards !== undefined,
        agentRun: { run: completedRun, events: [] },
        responseTimeMs: res.responseTimeMs,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setLastAIReplyText(replyText);
      // 聊天回复已经落入消息列表，不能让浏览器的 TTS 初始化或回调异常
      // 继续占用“思考中”状态。
      setVoiceState("completed");

      if (voiceTTSEnabled) {
        speak(replyText);
      }
    } catch (err) {
      console.error("Voice pipeline error:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "AI 对话请求失败，请稍后重试";
      setMessages((prev) => [
        ...prev,
        {
          id: String(Date.now() + 1),
          sender: "ai",
          text: message,
          status: "failed",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      setVoiceState("completed");
    }
  }, [authFetch, currentSessionId, messages, speak, stopTTS, voiceTTSEnabled]);

  const { isRecording, toggleRecording, stopRecording } = useVoiceRecorder({
    onSpeechResult: (recognizedText) => {
      setCurrentRecognizedText(recognizedText);
    },
    onSpeechFinal: (recognizedText) => {
      setCurrentRecognizedText(recognizedText);
      void handleVoiceQuery(recognizedText);
    },
    onSpeechEmpty: () => {
      setCurrentRecognizedText("");
      setVoiceState("completed");
      setMessages((prev) => [...prev, {
        id: String(Date.now()),
        sender: "ai",
        text: "这一轮没有听清楚。请靠近麦克风再说一次，或直接使用文字输入。",
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    },
  });

  // --- 麦克风按钮处理（含全双工打断） ---
  const handleMicPress = useCallback(() => {
    if (voiceState === "speaking") {
      stopTTS();
      setVoiceState("listening");
      toggleRecording();
      return;
    }
    if (isRecording) {
      setVoiceState("recognizing");
      stopRecording();
    } else {
      stopTTS();
      setCurrentRecognizedText("");
      setLastAIReplyText("");
      setVoiceState("listening");
      toggleRecording();
    }
  }, [voiceState, isRecording, stopTTS, toggleRecording, stopRecording]);

  // 🛒 智能采购清单 Modal State
  const [shoppingListModalVisible, setShoppingListModalVisible] = useState(false);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);

  const loadShoppingList = async () => {
    if (!shoppingListStorageKey) {
      setShoppingItems([]);
      return;
    }
    try {
      const authoritative = normalizeShoppingItems(await shoppingListApi.list<unknown[]>(authFetch));
      setShoppingItems(authoritative);
      await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(authoritative));
    } catch {
      const saved = await AsyncStorage.getItem(shoppingListStorageKey);
      setShoppingItems(saved ? normalizeShoppingItems(JSON.parse(saved)) : []);
    }
  };

  const handleOpenShoppingList = () => {
    loadShoppingList();
    setShoppingListModalVisible(true);
  };

  const handleRemoveShoppingItem = async (id: string) => {
    try {
      await shoppingListApi.remove(authFetch, id);
      const updated = shoppingItems.filter((i) => i.id !== id);
      setShoppingItems(updated);
      if (shoppingListStorageKey) await AsyncStorage.setItem(shoppingListStorageKey, JSON.stringify(updated));
    } catch (error) {
      Alert.alert("删除失败", error instanceof Error ? error.message : "请稍后重试");
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

  useEffect(() => {
    if (openShoppingList === "true" || (Array.isArray(openShoppingList) && openShoppingList[0] === "true")) {
      handleOpenShoppingList();
    }
  }, [openShoppingList]);

  // 新建新对话
  const handleStartNewChat = () => {
    historyLimitNoticeShown.current = false;
    const newId = String(Date.now());
    setCurrentSessionId(newId);
    setMessages([]);
    setSelectedPendingInputMessageId(null);
    setComposerError("");
    setHistoryDrawerVisible(false);
  };

  // 切换已有历史会话
  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages || []);
    setSelectedPendingInputMessageId(null);
    setComposerError("");
    setHistoryDrawerVisible(false);
  };

  // 删除单条会话
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await aiApi.deleteConversation(authFetch, sessionId);
    } catch (error) {
      Alert.alert("删除失败", error instanceof Error ? error.message : "无法同步删除服务端会话，请稍后重试。");
      return;
    }
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
    if (!aiConsentStorageKey || await AsyncStorage.getItem(aiConsentStorageKey) !== "accepted") {
      pendingConsentSend.current = { textToSend };
      setAIConsentError("");
      setAIConsentVisible(true);
      return;
    }

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
        const resData = await aiApi.visionFood<{ data?: Record<string, unknown>; run: AgentRunSummary }>(
          authFetch,
          base64Image,
          userPromptText,
        );
        const visionRun = await waitForAgentRun(authFetch, resData.run);
        const food = resData.data || visionRun.artifacts.find((artifact) => artifact.type === "vision")?.data as Record<string, unknown> || {};
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
      // 服务端最多接收 50 条消息；预留本次提问，并忽略旧缓存中的无效消息。
      const latestMessages = messagesRef.current;
      const validHistory = latestMessages.filter((m) => typeof m.text === "string" && m.text.trim().length > 0);
      if (validHistory.length > 49 && !historyLimitNoticeShown.current) {
        Alert.alert("对话提示", "为保证回复速度，本次 AI 将参考最近 50 条对话。更早内容仍保留在本机历史中。");
        historyLimitNoticeShown.current = true;
      }
      const historyPayload = buildChatHistory(latestMessages, text);
      // AsyncStorage 中的会话来自旧版本或异常缓存时，不能让它破坏本次请求。
      const sessionId = typeof currentSessionId === "string" && currentSessionId.trim().length <= 120
        ? currentSessionId.trim()
        : undefined;

      let data: Record<string, any>;
      try {
        data = await aiApi.chat<Record<string, any>>(authFetch, {
          messages: historyPayload,
          source: "assistant",
          ...(sessionId ? { sessionId } : {}),
        });
      } catch (error) {
        // 历史消息只用于补充上下文；缓存损坏或旧版本格式不兼容时，
        // 退化为当前问题继续完成对话，而不是把校验错误展示给用户。
        // Expo Web 在热更新后可能存在重复模块实例，不能只依赖 instanceof。
        // 只丢弃损坏的历史消息；稳定会话 ID 必须保留，避免管理端被拆成新会话。
        const isValidationError = error instanceof ApiError
          ? error.code === "VALIDATION_ERROR"
          : typeof error === "object"
            && error !== null
            && (error as { code?: unknown }).code === "VALIDATION_ERROR";
        if (!isValidationError) throw error;
        data = await aiApi.chat<Record<string, any>>(authFetch, {
          prompt: text.trim(),
          source: "assistant",
          ...(sessionId ? { sessionId } : {}),
        });
      }
      const agentResponse = data as AgentResponse & Record<string, any>;
      const responseText = agentResponse.run ? agentMessageText(agentResponse.run, data.reply) : (data.reply || "智能大厨正在整理您的食谱建议...");

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: responseText,
        actionCard: data.actionCard,
        writeConfirmation: data.writeConfirmation,
        missingCard: data.missingCard,
        optionsCard: data.optionsCard,
        solutionCards: data.solutionCards,
        agentCardsHydrated: data.solutionCards !== undefined,
        agentRun: agentResponse.run ? { run: agentResponse.run, events: [] } : undefined,
        responseTimeMs: data.responseTimeMs,
        time: "刚刚",
      };

      setMessages((prev) => [...prev, aiMsg]);
      setLastAIReplyText(responseText);
    } catch (err: any) {
      console.error("[AIAssistant Error]", err);
      const fallbackMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: err instanceof Error ? err.message : "AI 对话请求失败，请稍后重试",
        status: "failed",
        time: "刚刚",
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  }, [aiConsentStorageKey, authFetch, inputText, selectedImage, loading, messages, currentSessionId, router]);

  const closeAIConsent = useCallback(() => {
    if (aiConsentSaving) return;
    pendingConsentSend.current = null;
    setAIConsentError("");
    setAIConsentVisible(false);
  }, [aiConsentSaving]);

  const openAIPrivacyNotice = useCallback(() => {
    if (aiConsentSaving) return;
    pendingConsentSend.current = null;
    setAIConsentError("");
    setAIConsentVisible(false);
    router.push("/legal");
  }, [aiConsentSaving, router]);

  const acceptAIConsentAndSend = useCallback(async () => {
    const pending = pendingConsentSend.current;
    if (!pending || aiConsentSaving) return;
    if (!aiConsentStorageKey) {
      setAIConsentError("账号信息仍在同步，请稍后重试。");
      return;
    }

    setAIConsentSaving(true);
    setAIConsentError("");
    try {
      await AsyncStorage.setItem(aiConsentStorageKey, "accepted");
      pendingConsentSend.current = null;
      setAIConsentVisible(false);
      setAIConsentSaving(false);
      void handleSendMessage(pending.textToSend);
    } catch {
      setAIConsentError("授权状态保存失败，请检查浏览器存储权限后重试。");
      setAIConsentSaving(false);
    }
  }, [aiConsentSaving, aiConsentStorageKey, handleSendMessage]);

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
                    inventoryScanCard: { jobId, status: "review", items, lowConfidence: Boolean(data.lowConfidence), confidence: typeof data.confidence === "number" ? data.confidence : null },
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
      await Promise.all(missingCard.missingIngredients.map((item, index) => shoppingListApi.create<unknown>(authFetch, {
        clientId: `assistant:${msgId}:${index}`,
        name: item.name,
        amount: item.amount,
        category: "其他",
        checked: false,
      })));
      const updatedList = normalizeShoppingItems(await shoppingListApi.list<unknown[]>(authFetch));
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
        const resData = await aiApi.visionFood<{ data?: Record<string, unknown>; run: AgentRunSummary }>(authFetch, base64Image);
        const visionRun = await waitForAgentRun(authFetch, resData.run);
        const food = resData.data || visionRun.artifacts.find((artifact) => artifact.type === "vision")?.data as Record<string, unknown> || {};
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
    isTomorrow = false,
    confirmation?: AIWriteConfirmation,
  ) => {
    try {
      if (confirmation) {
        if (isTomorrow) {
          Alert.alert("请修改后保存", "明日计划请使用“弹出修改”确认日期后保存。");
          return;
        }
        await handleCommitWriteConfirmation(msgId, confirmation);
        return;
      }
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
        recorded_time: isTomorrow ? null : toLocalTimeKey(),
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

  const handleCommitWriteConfirmation = async (msgId: string, confirmation: AIWriteConfirmation) => {
    try {
      await aiApi.commitWriteConfirmation(authFetch, confirmation.confirmationId, `ai-confirm-${confirmation.confirmationId}`);
      setMessages((prev) => prev.map((message) => message.id === msgId && message.writeConfirmation
        ? { ...message, writeConfirmation: { ...message.writeConfirmation, committed: true }, actionCard: message.actionCard ? { ...message.actionCard, saved: true } : undefined }
        : message));
      Alert.alert("保存成功", "已确认并保存本次操作。");
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
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
        recorded_time: toLocalTimeKey(),
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
        const resData = await aiApi.scanReceipt<{ items?: any[]; run: AgentRunSummary }>(authFetch, base64Image);
        const visionRun = await waitForAgentRun(authFetch, resData.run);
        const visionData = visionRun.artifacts.find((artifact) => artifact.type === "vision")?.data as { items?: any[] } | undefined;
        const items: any[] = resData.items?.length ? resData.items : visionData?.items || [];
        const itemsText = items.length > 0
          ? items.map((it: any) => `• ${it.foodName || "食材"} (${it.quantity || "1份"}, 建议存放${it.suggestedStorageLocation || "保鲜库"}, 保质${it.estimatedExpireDays || 7}天)`).join("\n")
          : "没有识别出可信的食品条目，请换一张更清晰、只包含小票或商品的照片。";

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
    Alert.alert("从可信菜谱开始", "做饭模式会读取菜谱库中的最新步骤，请先选择一道已通过质量检查的菜谱。", [
      { text: "去选菜谱", onPress: () => router.push("/inventory") },
      { text: "取消", style: "cancel" },
    ]);
  };

  const handleStartCookingSolution = (card: SolutionCard) => {
    if (!Number.isInteger(Number(card.recipeId)) || Number(card.recipeId) <= 0) {
      Alert.alert("请先保存并审核", "AI 临时方案不能直接进入做饭模式。请先保存到我的菜谱，待内容审核通过后再开始烹饪。");
      return;
    }
    router.push("/cooking-mode", { recipeId: Number(card.recipeId) });
  };

  const handleSaveSolutionRecipe = async (messageId: string, card: SolutionCard) => {
    const steps = card.steps?.map((step) => step.trim()).filter(Boolean) || [];
    const ingredients = card.ingredientItems || [];
    if (!steps.length || !ingredients.length) {
      Alert.alert("方案信息不完整", "请先重新生成含完整食材和步骤的方案卡，再保存到我的菜谱。");
      return;
    }
    const { calories, protein, carbs, fat } = parseSolutionMacros(card.macros);

    try {
      const result = await recipesApi.submit(authFetch, {
        title: card.title,
        description: `${card.schemeTag} · ${card.cookingTip}`,
        cook_time: 20,
        difficulty: "简单",
        calories: calories ?? 0,
        protein: protein ?? 0,
        carbs: carbs ?? 0,
        fat: fat ?? 0,
        nutrition: [],
        category: "快手菜",
        tags: ["AI 方案", card.schemeTag],
        ingredients: ingredients.map((item) => ({ ...item, group: "主料" })),
        steps,
      });
      setMessages((current) => current.map((message) => message.id === messageId && message.solutionCards
        ? { ...message, solutionCards: message.solutionCards.map((solution) => solution.id === card.id ? { ...solution, savedToRecipes: true } : solution) }
        : message));
      Alert.alert("已保存", result.message || "方案已保存到我的菜谱，等待审核后公开。");
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  const updateAgentMessage = useCallback((messageId: string, run: AgentRunSummary, solutionCards?: SolutionCard[]) => {
    setMessages((current) => current.map((message) => message.id === messageId ? {
      ...message,
      text: agentMessageText(run),
      status: run.status === "failed" ? "failed" : run.status === "completed" ? "completed" : message.status,
      responseTimeMs: run.durationMs ?? message.responseTimeMs,
      solutionCards: solutionCards ?? message.solutionCards,
      agentCardsHydrated: solutionCards !== undefined ? true : message.agentCardsHydrated,
      agentRun: message.agentRun ? { ...message.agentRun, run } : { run, events: [] },
    } : message));
    if (run.reply) setLastAIReplyText(run.reply);
  }, []);

  const handleAgentResume = useCallback(async (
    messageId: string,
    runId: string,
    decision: "approve" | "reject" | "edit",
    actions?: AgentActionProposal[],
  ) => {
    try {
      const response = await aiApi.resumeAgentRun<AgentResponse>(authFetch, runId, { decision, ...(actions ? { actions } : {}) });
      updateAgentMessage(messageId, response.run, response.solutionCards);
    } catch (error) {
      Alert.alert("操作未提交", error instanceof Error ? error.message : "请刷新后重试");
      throw error;
    }
  }, [authFetch, updateAgentMessage]);

  const handleAgentCancel = useCallback(async (messageId: string, runId: string) => {
    try {
      await aiApi.cancelAgentRun(authFetch, runId);
      setMessages((current) => current.map((message) => message.id === messageId && message.agentRun ? {
        ...message,
        text: "任务已取消，没有执行后续操作。",
        agentRun: { ...message.agentRun, run: { ...message.agentRun.run, status: "cancelled" } },
      } : message));
    } catch (error) {
      Alert.alert("取消失败", error instanceof Error ? error.message : "请稍后重试");
      throw error;
    }
  }, [authFetch]);

  const handleAgentRetry = useCallback(async (messageId: string, runId: string) => {
    try {
      const response = await aiApi.retryAgentRun<AgentResponse>(authFetch, runId);
      updateAgentMessage(messageId, response.run, response.solutionCards);
    } catch (error) {
      Alert.alert("重试失败", error instanceof Error ? error.message : "请稍后重试");
      throw error;
    }
  }, [authFetch, updateAgentMessage]);

  const handleAgentUndo = useCallback(async (messageId: string, runId: string) => {
    try {
      await aiApi.undoAgentRun(authFetch, runId);
      setMessages((current) => current.map((message) => message.id === messageId && message.agentRun
        ? { ...message, agentRun: { ...message.agentRun, undoState: "completed" } }
        : message));
      Alert.alert("已撤销", "本次自动写入已恢复到执行前状态。");
    } catch (error) {
      Alert.alert("无法撤销", error instanceof Error ? error.message : "撤销入口可能已过期");
      throw error;
    }
  }, [authFetch]);

  const handleAgentInput = useCallback(async (messageId: string, runId: string, input: string) => {
    const response = await aiApi.resumeAgentRun<AgentResponse>(authFetch, runId, { input });
    updateAgentMessage(messageId, response.run, response.solutionCards);
  }, [authFetch, updateAgentMessage]);

  const handleComposerSend = useCallback(async () => {
    if (!pendingInputTarget) {
      await handleSendMessage();
      return;
    }

    const input = inputText.trim();
    if (!input || selectedImage || composerBusy) return;
    setComposerBusy(true);
    setComposerError("");
    try {
      await handleAgentInput(pendingInputTarget.id, pendingInputTarget.agentRun!.run.id, input);
      setInputText("");
      setSelectedPendingInputMessageId(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "无法继续任务，请稍后重试");
    } finally {
      setComposerBusy(false);
    }
  }, [composerBusy, handleAgentInput, handleSendMessage, inputText, pendingInputTarget, selectedImage]);

  const selectNextPendingInput = useCallback(() => {
    if (pendingInputMessages.length < 2) return;
    const currentIndex = pendingInputMessages.findIndex((message) => message.id === pendingInputTarget?.id);
    const next = pendingInputMessages[(currentIndex + 1) % pendingInputMessages.length];
    setSelectedPendingInputMessageId(next.id);
    setComposerError("");
  }, [pendingInputMessages, pendingInputTarget?.id]);

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
      handleCommitWriteConfirmation={handleCommitWriteConfirmation}
      handleOpenEditModal={handleOpenEditModal}
      toggleInventoryScanItem={toggleInventoryScanItem}
      openInventoryScanEditor={openInventoryScanEditor}
      confirmInventoryScanCard={confirmInventoryScanCard}
      handleSaveToShoppingList={handleSaveToShoppingList}
      handleSendMessage={handleSendMessage}
      onStartCooking={handleStartCookingSolution}
      onSaveRecipe={handleSaveSolutionRecipe}
      onOpenInventory={() => router.push("/inventory")}
      onOpenInventoryAdd={() => router.push("/inventory", { action: "add" })}
      onAgentResume={handleAgentResume}
      onAgentCancel={handleAgentCancel}
      onAgentRetry={handleAgentRetry}
      onAgentUndo={handleAgentUndo}
    />
  );

  return (
    <Screen backgroundColor="#F6F4F0" safeAreaEdges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 flex-col justify-between"
      >
        {/* Full Screen Header */}
        <View className="px-5 py-3.5 flex-row items-center justify-between border-b border-line bg-white/70 shadow-xs">
          <TouchableOpacity onPress={handleSafeGoBack} className="p-2 -ml-2 active:opacity-70">
            <FontAwesome6 name="chevron-left" size={18} color="#3D3229" />
          </TouchableOpacity>

          <View className="flex-row items-center gap-2 bg-brand/10 px-3.5 py-1.5 rounded-full">
            <Text className="text-base font-black text-ink">食光</Text>
            <View className="bg-brand px-2 py-0.5 rounded-md">
              <Text className="text-[10px] font-black text-white">AI 食语</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-1.5">
            <TouchableOpacity
              onPress={() => setHeaderMoreVisible(true)}
              className="relative w-9 h-9 rounded-full bg-white items-center justify-center border border-line"
            >
              <FontAwesome6 name="ellipsis" size={14} color="#3D3229" />
              {shoppingItems.length > 0 ? (
                <View className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-critical items-center justify-center px-1">
                  <Text className="text-[8px] font-black text-white">{shoppingItems.length > 9 ? "9+" : shoppingItems.length}</Text>
                </View>
              ) : null}
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
                <View className="w-28 h-28 rounded-full bg-gradient-to-tr from-brand/20 to-highlight/30 items-center justify-center shadow-xl border-4 border-white overflow-hidden">
                  <Image
                    source={require("@/assets/shiyu-avatar.jpg")}
                    className="w-28 h-28 rounded-full"
                    resizeMode="cover"
                  />
                </View>
                <View className="absolute -bottom-1 bg-highlight px-3 py-1 rounded-full border border-white shadow-xs">
                  <Text className="text-[10px] font-black text-ink">食光 AI 大厨 · 食语</Text>
                </View>
              </View>

              {/* Hero Slogan */}
              <Text className="text-xl font-black text-ink tracking-wide mb-1 text-center">
                每一顿膳食与卡路里，食语都能帮你理清楚
              </Text>
              <Text className="text-xs text-copy-muted mb-6 text-center">
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
                    className="w-52 bg-white p-5 rounded-3xl border border-line shadow-xs justify-between mr-4 active:scale-95 transition-transform"
                  >
                    <View className="w-10.5 h-10.5 rounded-2xl bg-background-secondary items-center justify-center mb-5">
                      <FontAwesome6 name={card.icon} size={18} color={card.color} />
                    </View>
                    <View>
                      <Text className="text-xs font-black text-ink leading-5 mb-1.5">
                        {card.title}
                      </Text>
                      <Text className="text-[11px] text-copy-muted leading-4">
                        {card.subtitle}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              </View>
            </View>
          }
          ListFooterComponent={
            <>
              {currentRecognizedText ? (
                <View className="bg-emerald-50 border border-emerald-200/80 p-3 rounded-2xl self-end max-w-[82%] mb-2 mr-2">
                  <Text className="text-xs font-bold text-emerald-900">
                    正在听：{currentRecognizedText}
                  </Text>
                </View>
              ) : null}
              {loading ? (
                <View className="flex-row items-center gap-2 bg-white p-3.5 rounded-2xl border border-line self-start ml-2 mb-4 shadow-xs">
                  <ActivityIndicator size="small" color="#2D6A4F" />
                  <Text className="text-xs text-copy-muted font-bold">AI 正在为您检索食材库与营养数据库...</Text>
                </View>
              ) : null}
            </>
          }
        />



        {/* Fixed Full Screen Bottom Bar Section (Warm Theme Matched, No Harsh White Box) */}
        <View className="bg-canvas px-5 pt-3.5 pb-6 border-t border-line shadow-2xl">
          {hasSafetyProfile(healthProfile) ? (
            <TouchableOpacity
              onPress={() => router.push("/health-profile")}
              accessibilityLabel="查看当前安全与饮食限制"
              className="mb-2.5 flex-row items-start rounded-2xl border border-[#E7A594] bg-[#FFF0EC] px-3 py-2.5"
            >
              <View className="mt-0.5 h-7 w-7 items-center justify-center rounded-xl bg-[#F8D4CB]">
                <FontAwesome6 name="shield-halved" size={12} color="#A63D2B" />
              </View>
              <View className="ml-2.5 flex-1">
                <Text className="text-xs font-black text-[#8E2F20]">安全档案已启用 · 推荐与食材替换将优先核对</Text>
                <Text className="mt-0.5 text-[10px] leading-4 text-[#985242]" numberOfLines={2}>{safetySummary(healthProfile).slice(0, 2).join("；")}</Text>
              </View>
              <FontAwesome6 name="chevron-right" size={10} color="#A63D2B" style={{ marginTop: 8 }} />
            </TouchableOpacity>
          ) : null}
          <View className="mb-2">
            <MedicalDisclaimer compact />
          </View>
          {/* Selected Image Attachment Badge */}
          {selectedImage && (
            <View className="mb-2.5 flex-row items-center self-start bg-white p-1.5 pr-3 rounded-2xl border border-line relative shadow-xs">
              <Image source={{ uri: selectedImage.uri }} className="w-14 h-14 rounded-xl mr-2.5" resizeMode="cover" />
              <View>
                <Text className="text-xs font-bold text-ink">已添加待识别照片</Text>
                <Text className="text-[10px] text-copy-muted">可在下方输入提问，一并发送</Text>
              </View>
              <TouchableOpacity
                onPress={() => setSelectedImage(null)}
                className="absolute -top-1.5 -right-1.5 bg-critical w-5.5 h-5.5 rounded-full items-center justify-center border border-white shadow-xs"
              >
                <FontAwesome6 name="xmark" size={10} color="#FFF" />
              </TouchableOpacity>
            </View>
          )}

          {/* 语音交互状态栏 */}
          {voiceState !== "idle" && voiceState !== "completed" ? (
            <View className="mb-2 px-3.5 py-2 rounded-xl bg-brand/10 border border-brand/20 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2 flex-1">
                {voiceState === "listening" && <View className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                {(voiceState === "thinking" || voiceState === "recognizing") && <ActivityIndicator size="small" color="#2D6A4F" />}
                {voiceState === "speaking" && <View className="w-2.5 h-2.5 rounded-full bg-sky-500" />}
                <Text className="text-xs font-bold text-brand" numberOfLines={1}>
                  {voiceState === "listening" ? "正在倾听…说完停顿会自动提交" :
                   voiceState === "recognizing" ? "正在识别语音…" :
                   voiceState === "thinking" ? "食语正在思考…" :
                   voiceState === "speaking" ? "食语正在回答…" : ""}
                </Text>
              </View>
              {voiceState === "speaking" && (
                <TouchableOpacity
                  onPress={() => { stopTTS(); setVoiceState("idle"); }}
                  className="bg-red-50 px-2.5 py-1 rounded-full border border-red-200 flex-row items-center gap-1"
                >
                  <FontAwesome6 name="circle-stop" size={10} color="#EF4444" />
                  <Text className="text-[10px] font-bold text-red-600">打断</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {voiceState === "completed" && lastAIReplyText ? (
            <View className="mb-2 flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => speak(lastAIReplyText)}
                className="flex-row items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 active:bg-sky-100"
              >
                <FontAwesome6 name="volume-high" size={10} color="#0284C7" />
                <Text className="text-[10px] font-bold text-sky-700">重播回答</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setVoiceState("idle"); setLastAIReplyText(""); }}
                className="rounded-full bg-white border border-line px-2 py-1"
              >
                <FontAwesome6 name="xmark" size={10} color="#8B7D6B" />
              </TouchableOpacity>
            </View>
          ) : null}

          {ttsError ? <Text className="mb-2 px-4 text-center text-[10px] text-red-600">{ttsError}</Text> : null}

          {pendingInputTarget?.agentRun?.run.pendingInput ? (
            <View className="mb-2.5 rounded-2xl border border-brand/25 bg-[#F2F8F4] px-3.5 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <View className="min-w-0 flex-1 flex-row items-center gap-2">
                  <View className="h-7 w-7 items-center justify-center rounded-xl bg-brand">
                    <FontAwesome6 name="reply" size={10} color="#FFFFFF" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[10px] font-black text-brand">正在补充 Supervisor 任务</Text>
                    <Text className="mt-0.5 text-[10px] leading-4 text-copy-muted" numberOfLines={2}>
                      {pendingInputTarget.agentRun.run.pendingInput.question}
                    </Text>
                  </View>
                </View>
                {pendingInputMessages.length > 1 ? (
                  <TouchableOpacity
                    onPress={selectNextPendingInput}
                    disabled={composerBusy}
                    className="rounded-full border border-brand/20 bg-white px-2.5 py-1.5 disabled:opacity-50"
                  >
                    <Text className="text-[9px] font-bold text-brand">切换任务</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {selectedImage ? (
                <Text className="mt-2 text-[10px] font-bold text-red-600">补充信息暂不支持图片，请先移除下方附件。</Text>
              ) : (
                <Text className="mt-2 text-[9px] text-brand/80">底部发送将继续这个任务，不会新建一轮对话。</Text>
              )}
            </View>
          ) : null}

          {composerError ? <Text className="mb-2 px-3 text-center text-[10px] font-bold text-red-600">{composerError}</Text> : null}

          {/* Integrated Card Container */}
          <View className={`bg-white p-3 rounded-[24px] border transition-all shadow-xs ${isRecording ? 'border-red-500 bg-red-50/50' : pendingInputTarget ? 'border-brand/40' : 'border-line'}`}>
            {/* Input Area */}
            <TextInput
              value={inputText}
              onChangeText={(value) => {
                setInputText(value);
                if (composerError) setComposerError("");
              }}
              placeholder={isRecording
                ? "正在倾听..."
                : pendingInputTarget?.agentRun?.run.pendingInput
                  ? "在这里补充信息，发送后继续当前任务..."
                  : selectedImage
                    ? "针对照片提问..."
                    : "发消息或点击麦克风语音提问..."}
              placeholderTextColor="#A3A398"
              multiline
              editable={!composerBusy}
              className="text-xs text-ink min-h-[36px] max-h-[90px] px-1 py-1 align-top"
              onSubmitEditing={() => void handleComposerSend()}
            />

            {/* Bottom Control Bar */}
            <View className="flex-row items-center justify-between pt-2 border-t border-line/40 mt-1">
              {/* Left Side: Practical Food AI Chips (Hide when + tools grid expanded for perfect adaptation) */}
              {pendingInputTarget ? (
                <View className="flex-row items-center gap-1.5">
                  <FontAwesome6 name="circle-nodes" size={10} color="#2D6A4F" />
                  <Text className="text-[10px] font-bold text-brand">回复后继续原任务</Text>
                </View>
              ) : !showToolsGrid ? (
                <View className="flex-row items-center gap-1.5 flex-wrap">
                  <TouchableOpacity
                    onPress={() => setInputText("根据现有冰箱食材推荐一份健康减脂晚餐")}
                    className="px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200/80 flex-row items-center gap-1 active:bg-emerald-100"
                  >
                    <FontAwesome6 name="utensils" size={11} color="#059669" />
                    <Text className="text-[11px] font-bold text-emerald-800">推荐晚餐</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setInputText("帮我计算今日膳食需要的蛋白质与营养配比")}
                    className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200/80 flex-row items-center gap-1 active:bg-amber-100"
                  >
                    <FontAwesome6 name="chart-pie" size={11} color="#D97706" />
                    <Text className="text-[11px] font-bold text-amber-800">营养分析</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text className="text-[11px] font-bold text-copy-muted">食光工具箱</Text>
              )}

              {/* Right Side: Action Buttons */}
              <View className="flex-row items-center gap-1.5 ml-2">
                {!pendingInputTarget ? (
                  <>
                    <TouchableOpacity
                      onPress={() => setShowToolsGrid((prev) => !prev)}
                      className={`w-7.5 h-7.5 rounded-full border items-center justify-center transition-all ${
                        showToolsGrid ? 'bg-brand border-brand' : 'bg-canvas border-line active:bg-line/50'
                      }`}
                    >
                      <FontAwesome6 name={showToolsGrid ? "xmark" : "plus"} size={13} color={showToolsGrid ? "#FFFFFF" : "#3D3229"} />
                    </TouchableOpacity>

                    <VoiceWaveform
                      voiceState={voiceState}
                      onPress={handleMicPress}
                      size="sm"
                    />
                  </>
                ) : null}

                {inputText.trim() || selectedImage ? (
                  <TouchableOpacity
                    onPress={() => void handleComposerSend()}
                    disabled={loading || composerBusy || Boolean(pendingInputTarget && selectedImage)}
                    accessibilityRole="button"
                    accessibilityLabel={pendingInputTarget ? "补充信息并继续任务" : "发送消息"}
                    className="w-7.5 h-7.5 rounded-full bg-brand items-center justify-center shadow-xs active:scale-95 disabled:opacity-50"
                  >
                    {composerBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <FontAwesome6 name="arrow-up" size={13} color="#FFFFFF" />}
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>

          {/* Bottom 5 Core AI Action Grid (按 + 号展开多彩轻奢图标面板) */}
          {showToolsGrid && !pendingInputTarget && (
            <View className="bg-white rounded-2xl p-3.5 border border-line mt-2.5 flex-row items-center justify-between shadow-sm">
              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handlePickImageAttachment();
                }}
                className="items-center gap-1.5 active:opacity-80 flex-1"
              >
                <View className="w-11 h-11 rounded-2xl bg-emerald-50 items-center justify-center border border-emerald-200/80 shadow-xs">
                  <FontAwesome6 name="image" size={18} color="#059669" />
                </View>
                <Text className="text-[11px] font-bold text-ink">添加图片</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionScanReceipt();
                }}
                className="items-center gap-1.5 active:opacity-80 flex-1"
              >
                <View className="w-11 h-11 rounded-2xl bg-amber-50 items-center justify-center border border-amber-200/80 shadow-xs">
                  <FontAwesome6 name="receipt" size={18} color="#D97706" />
                </View>
                <Text className="text-[11px] font-bold text-ink">扫码入库</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionFridgeClean();
                }}
                className="items-center gap-1.5 active:opacity-80 flex-1"
              >
                <View className="w-11 h-11 rounded-2xl bg-sky-50 items-center justify-center border border-sky-200/80 shadow-xs">
                  <FontAwesome6 name="snowflake" size={18} color="#0284C7" />
                </View>
                <Text className="text-[11px] font-bold text-ink">冰箱清库</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleOpenShoppingList();
                }}
                className="items-center gap-1.5 active:opacity-80 flex-1"
              >
                <View className="w-11 h-11 rounded-2xl bg-purple-50 items-center justify-center border border-purple-200/80 shadow-xs">
                  <FontAwesome6 name="cart-shopping" size={18} color="#9333EA" />
                </View>
                <Text className="text-[11px] font-bold text-ink">采购清单</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowToolsGrid(false);
                  handleActionCookingVoice();
                }}
                className="items-center gap-1.5 active:opacity-80 flex-1"
              >
                <View className="w-11 h-11 rounded-2xl bg-orange-50 items-center justify-center border border-orange-200/80 shadow-xs">
                  <FontAwesome6 name="fire-burner" size={18} color="#EA580C" />
                </View>
                <Text className="text-[11px] font-bold text-ink">做饭语音包</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={aiConsentVisible}
        transparent
        animationType="fade"
        onRequestClose={closeAIConsent}
      >
        <View className="flex-1 items-center justify-center bg-black/45 px-6">
          <View className="w-full max-w-md rounded-[28px] border border-line bg-white p-6 shadow-2xl">
            <View className="mb-4 flex-row items-start gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-2xl bg-brand/10">
                <FontAwesome6 name="shield-halved" size={16} color="#2D6A4F" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-black text-ink">发送给 AI 前请确认</Text>
                <Text className="mt-1 text-[11px] leading-5 text-copy-muted">
                  当前问题、最近对话及你填写的健康档案可能发送给部署环境配置的 AI 服务商。
                </Text>
              </View>
            </View>

            <View className="rounded-2xl bg-canvas px-4 py-3">
              <Text className="text-[11px] leading-5 text-copy-muted">
                服务端会保存完整对话，直到账户删除或运营方按请求删除；授权管理员可为排障查看。请勿发送无关敏感信息。
              </Text>
            </View>

            {aiConsentError ? (
              <Text className="mt-3 text-center text-[11px] font-bold text-red-600">{aiConsentError}</Text>
            ) : null}

            <TouchableOpacity
              onPress={acceptAIConsentAndSend}
              disabled={aiConsentSaving}
              accessibilityRole="button"
              accessibilityLabel="同意隐私说明并发送"
              className="mt-5 items-center rounded-2xl bg-brand py-3.5 disabled:opacity-50"
            >
              {aiConsentSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text className="text-sm font-black text-white">同意并发送</Text>
              )}
            </TouchableOpacity>

            <View className="mt-2 flex-row gap-2">
              <TouchableOpacity
                onPress={openAIPrivacyNotice}
                disabled={aiConsentSaving}
                accessibilityRole="button"
                className="flex-1 items-center rounded-2xl border border-line bg-white py-3 disabled:opacity-50"
              >
                <Text className="text-xs font-bold text-brand">查看隐私说明</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={closeAIConsent}
                disabled={aiConsentSaving}
                accessibilityRole="button"
                className="flex-1 items-center rounded-2xl border border-line bg-white py-3 disabled:opacity-50"
              >
                <Text className="text-xs font-bold text-copy-muted">取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(inventoryEditTarget)}
        animationType="slide"
        transparent
        onRequestClose={() => setInventoryEditTarget(null)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <View className="rounded-t-[32px] bg-white p-6">
            <View className="mb-5 flex-row items-center justify-between border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-full bg-brand">
                  <FontAwesome6 name="pen" size={12} color="#FFF" />
                </View>
                <View>
                  <Text className="text-base font-black text-ink">修改识别结果</Text>
                  <Text className="mt-0.5 text-[10px] text-copy-muted">确认后只更新当前卡片，不会立即入库</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setInventoryEditTarget(null)} className="p-2">
                <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            <Text className="mb-1.5 text-xs font-bold text-copy-muted">食材名称</Text>
            <TextInput
              value={inventoryEditTarget?.foodName || ""}
              onChangeText={(foodName) => setInventoryEditTarget((current) => current ? { ...current, foodName } : current)}
              className="rounded-2xl border border-line bg-canvas px-4 py-3.5 text-sm font-bold text-ink"
            />

            <View className="mt-4 flex-row gap-3">
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-copy-muted">数量</Text>
                <TextInput
                  value={inventoryEditTarget?.quantity || ""}
                  onChangeText={(quantity) => setInventoryEditTarget((current) => current ? { ...current, quantity } : current)}
                  placeholder="如：500g、2盒"
                  className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-bold text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="mb-1.5 text-xs font-bold text-copy-muted">建议保质期（天）</Text>
                <TextInput
                  value={inventoryEditTarget?.expireDays || ""}
                  onChangeText={(expireDays) => setInventoryEditTarget((current) => current ? { ...current, expireDays } : current)}
                  keyboardType="numeric"
                  className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm font-bold text-ink"
                />
              </View>
            </View>

            <Text className="mb-2 mt-4 text-xs font-bold text-copy-muted">存放位置</Text>
            <View className="flex-row gap-2">
              {(["冷藏", "冷冻", "常温"] as const).map((location) => (
                <TouchableOpacity
                  key={location}
                  onPress={() => setInventoryEditTarget((current) => current ? { ...current, storageLocation: location } : current)}
                  className={`flex-1 items-center rounded-xl border py-2.5 ${inventoryEditTarget?.storageLocation === location ? "border-brand bg-brand" : "border-line bg-white"}`}
                >
                  <Text className={`text-xs font-bold ${inventoryEditTarget?.storageLocation === location ? "text-white" : "text-copy-muted"}`}>{location}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={saveInventoryScanEdit}
              className="mt-5 items-center rounded-2xl bg-brand py-4"
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
            <View className="flex-row items-center justify-between mb-4 border-b border-background-secondary pb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-brand items-center justify-center">
                  <FontAwesome6 name="utensils" size={13} color="#FFF" />
                </View>
                <Text className="text-base font-black text-ink">
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
                <Text className="text-xs font-bold text-copy-muted mb-2">餐别选择</Text>
                <View className="flex-row gap-2">
                  {["早餐", "午餐", "晚餐", "加餐"].map((type) => (
                    <TouchableOpacity
                      key={type}
                      onPress={() => setFormMealType(type)}
                      className={`flex-1 py-2.5 rounded-xl items-center border ${
                        formMealType === type
                          ? "bg-brand border-brand"
                          : "bg-white border-line"
                      }`}
                    >
                      <Text className={`text-xs font-bold ${formMealType === type ? "text-white" : "text-ink"}`}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* 食物名称 */}
              <View>
                <Text className="text-xs font-bold text-copy-muted mb-1">食物名称</Text>
                <TextInput
                  value={formFoodName}
                  onChangeText={setFormFoodName}
                  placeholder="如：香煎鸡胸肉、水饺"
                  className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                />
              </View>

              {/* 分量与卡路里 */}
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Text className="text-xs font-bold text-copy-muted mb-1">预估分量</Text>
                  <TextInput
                    value={formAmount}
                    onChangeText={setFormAmount}
                    placeholder="如：1碗、200g"
                    className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-xs font-bold text-copy-muted mb-1">卡路里 (kcal)</Text>
                  <TextInput
                    value={formCalories}
                    onChangeText={setFormCalories}
                    keyboardType="numeric"
                    placeholder="350"
                    className="bg-background-secondary/60 p-3 rounded-xl border border-line text-xs font-bold text-ink"
                  />
                </View>
              </View>

              {/* 三大营养素 */}
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">蛋白质 (g)</Text>
                  <TextInput
                    value={formProtein}
                    onChangeText={setFormProtein}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">碳水 (g)</Text>
                  <TextInput
                    value={formCarbs}
                    onChangeText={setFormCarbs}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-[11px] font-bold text-copy-muted mb-1">脂肪 (g)</Text>
                  <TextInput
                    value={formFat}
                    onChangeText={setFormFat}
                    keyboardType="numeric"
                    className="bg-background-secondary/60 p-2.5 rounded-xl border border-line text-xs text-center font-bold text-ink"
                  />
                </View>
              </View>

              {/* 保存按钮 */}
              <TouchableOpacity
                onPress={handleSaveEditModal}
                disabled={savingRecord}
                className="bg-brand py-3.5 rounded-2xl items-center shadow-sm active:opacity-90 mt-2"
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

      {/* 顶栏次要操作：避免在窄屏、刘海和 Android 状态栏下挤压标题。 */}
      <Modal
        visible={headerMoreVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHeaderMoreVisible(false)}
      >
        <View className="flex-1">
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setHeaderMoreVisible(false)}
            className="absolute inset-0 bg-black/10"
          />
            <View
            style={{ position: "absolute", top: insets.top + 58, right: 16 }}
              className="w-44 rounded-2xl border border-line bg-white p-1.5 shadow-xl"
            >
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                handleStartNewChat();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="plus" size={14} color="#2D6A4F" />
              <Text className="text-sm font-bold text-ink">新建对话</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                handleOpenShoppingList();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="cart-shopping" size={14} color="#D4A276" />
              <Text className="text-sm font-bold text-ink">采购清单</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                setHistoryDrawerVisible(true);
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="clock-rotate-left" size={14} color="#2D6A4F" />
              <Text className="text-sm font-bold text-ink">历史对话</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                setIsMuted((value) => !value);
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name={isMuted ? "volume-xmark" : "volume-high"} size={14} color="#3D3229" />
              <Text className="text-sm font-bold text-ink">{isMuted ? "开启语音" : "关闭语音"}</Text>
            </TouchableOpacity>
            <View className="mx-2 border-t border-line" />
            <TouchableOpacity
              onPress={() => {
                setHeaderMoreVisible(false);
                handleSafeGoBack();
              }}
              className="flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-background-secondary"
            >
              <FontAwesome6 name="xmark" size={14} color="#8B7D6B" />
              <Text className="text-sm font-bold text-copy-muted">关闭食语</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <HistoryDrawer
        visible={historyDrawerVisible}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onClose={() => setHistoryDrawerVisible(false)}
        onNewChat={handleStartNewChat}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
      />

      <ShoppingListDrawer
        visible={shoppingListModalVisible}
        items={shoppingItems}
        onClose={() => setShoppingListModalVisible(false)}
        onRemove={handleRemoveShoppingItem}
      />

    </Screen>
  );
}
