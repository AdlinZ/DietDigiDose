import { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeRouter } from "@/hooks/useSafeRouter";
import { useAuth, useAuthFetch } from "@/contexts/AuthContext";
import { aiApi, ApiError } from "@/services/api";
import { AIMarkdown } from "@/components/AIMarkdown";
import {
  CHAT_SESSIONS_STORAGE_KEY,
  getUserStorageKey,
  storageBelongsToCurrentUser,
} from "@/utils/userStorage";


import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { RealtimeVoiceMVPModal } from "@/components/RealtimeVoiceMVPModal";

interface DietActionCard {
  mealType: string;
  foodName: string;
  amount: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  saved?: boolean;
}

interface MissingIngredientsCard {
  dishName: string;
  missingIngredients: Array<{ name: string; amount: string }>;
  savedToList?: boolean;
}

interface DietRecordOptionsCard {
  title: string;
  options: Array<{ label: string; actionText: string }>;
}

interface SolutionCard {
  id: string;
  schemeTag: string;
  title: string;
  ingredients: string;
  cookingTip: string;
  macros: string;
  actionText: string;
}

interface WriteConfirmationCard {
  confirmationId: string;
  action: "record_diet_meal" | "add_inventory_item" | "add_kitchenware_item" | "record_health_log";
  payload: Record<string, unknown>;
  expiresAt: string;
  committed?: boolean;
}

interface Message {
  id: string;
  sender: "ai" | "user";
  text: string;
  imageUri?: string;
  actionCard?: DietActionCard;
  writeConfirmation?: WriteConfirmationCard;
  missingCard?: MissingIngredientsCard;
  optionsCard?: DietRecordOptionsCard;
  solutionCards?: SolutionCard[];
  time: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}

interface AIChefModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AIChefModal({ visible, onClose }: AIChefModalProps) {
  const router = useSafeRouter();
  const { user } = useAuth();
  const authFetch = useAuthFetch();
  const chatStorageKey = getUserStorageKey(CHAT_SESSIONS_STORAGE_KEY, user?.id);
  const [loadedChatStorageKey, setLoadedChatStorageKey] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [showToolsGrid, setShowToolsGrid] = useState(false);
  const [isDeepThink, setIsDeepThink] = useState(false);
  const [isWebSearch, setIsWebSearch] = useState(false);
  const baseInputTextRef = useRef("");

  const { isRecording, isTranscribing, statusText: voiceStatusText, toggleRecording } = useVoiceRecorder({
    onSpeechResult: (recognizedText) => {
      const base = baseInputTextRef.current.trim();
      setInputText(base ? `${base} ${recognizedText}` : recognizedText);
    },
  });

  const handleToggleVoiceRecording = () => {
    if (!isRecording) {
      baseInputTextRef.current = inputText;
    }
    toggleRecording();
  };
  const [isMuted, setIsMuted] = useState(false);
  const [showRealtimeVoiceMVP, setShowRealtimeVoiceMVP] = useState(false);
  const [storedMessages, setMessages] = useState<Message[]>([]);
  const [storedSessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(() => String(Date.now()));
  const [historyDrawerVisible, setHistoryDrawerVisible] = useState(false);
  const historyLimitNoticeShown = useRef(false);
  const historyBelongsToCurrentUser = storageBelongsToCurrentUser(
    chatStorageKey,
    loadedChatStorageKey,
  );
  const messages = historyBelongsToCurrentUser ? storedMessages : [];
  const sessions = historyBelongsToCurrentUser ? storedSessions : [];

  // 初始化加载历史会话记录
  useEffect(() => {
    setLoadedChatStorageKey(null);
    setSessions([]);
    setMessages([]);
    setCurrentSessionId(String(Date.now()));
    if (!visible || !chatStorageKey) return;

    let active = true;
    AsyncStorage.getItem(chatStorageKey)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setSessions(parsed);
              setCurrentSessionId(parsed[0].id);
              setMessages(parsed[0].messages || []);
            }
          } catch {
            // ignore
          }
        }
      })
      .finally(() => {
        if (active) setLoadedChatStorageKey(chatStorageKey);
      });
    return () => {
      active = false;
    };
  }, [visible, chatStorageKey]);

  // 消息同步持久化至 AsyncStorage
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

  const handleStartNewChat = () => {
    historyLimitNoticeShown.current = false;
    const newId = String(Date.now());
    setCurrentSessionId(newId);
    setMessages([]);
    setHistoryDrawerVisible(false);
  };

  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages || []);
    setHistoryDrawerVisible(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    const filtered = sessions.filter((s) => s.id !== sessionId);
    setSessions(filtered);
    if (chatStorageKey) {
      void AsyncStorage.setItem(chatStorageKey, JSON.stringify(filtered));
    }
    if (currentSessionId === sessionId) {
      if (filtered.length > 0) {
        setCurrentSessionId(filtered[0].id);
        setMessages(filtered[0].messages || []);
      } else {
        handleStartNewChat();
      }
    }
  };

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

  const handleSendMessage = useCallback(async (textToSend?: string) => {
    const text = textToSend || inputText;
    if (!text.trim() || loading) return;

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
      if (!user) {
        onClose();
        router.push("/login");
        return;
      }

      // 服务端最多接收 50 条消息；预留本次提问，并忽略旧缓存中的无效消息。
      const validHistory = messages.filter((m) => typeof m.text === "string" && m.text.trim().length > 0);
      if (validHistory.length > 49 && !historyLimitNoticeShown.current) {
        Alert.alert("对话提示", "为保证回复速度，本次 AI 将参考最近 50 条对话。更早内容仍保留在本机历史中。");
        historyLimitNoticeShown.current = true;
      }
      const historyPayload = validHistory
        .slice(-49)
        .map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text.trim().slice(0, 12_000),
        }));
      historyPayload.push({ role: "user", content: text.trim() });

      let data: Record<string, any>;
      try {
        data = await aiApi.chat<Record<string, any>>(authFetch, { messages: historyPayload });
      } catch (error) {
        // 旧版本地缓存可能含有不再符合接口约束的历史消息。
        // 历史仅作上下文，不能阻塞用户当前这一次提问。
        // Expo Web 热更新可能产生多个 ApiError 模块实例，按错误码判断更可靠。
        const isValidationError = error instanceof ApiError
          ? error.code === "VALIDATION_ERROR"
          : typeof error === "object"
            && error !== null
            && (error as { code?: unknown }).code === "VALIDATION_ERROR";
        if (!isValidationError) throw error;
        data = await aiApi.chat<Record<string, any>>(authFetch, { prompt: text.trim() });
      }
      const responseText = data.reply || "智能大厨正在整理您的食谱建议...";

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: responseText,
        actionCard: data.actionCard,
        writeConfirmation: data.writeConfirmation,
        missingCard: data.missingCard,
        optionsCard: data.optionsCard,
        solutionCards: data.solutionCards,
        time: "刚刚",
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      console.error("[AIChefModal Error]", err);
      const fallbackMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: `食语暂时无法回复：${err instanceof Error ? err.message : "请检查网络或重新登录后重试"}。你的消息仍保留在本次对话中，可以稍后再次发送。`,
        time: "刚刚",
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setLoading(false);
    }
  }, [authFetch, inputText, loading, messages, onClose, router, user]);

  const handleCommitWriteConfirmation = async (messageId: string, confirmation: WriteConfirmationCard) => {
    try {
      await aiApi.commitWriteConfirmation(authFetch, confirmation.confirmationId, `ai-confirm-${confirmation.confirmationId}`);
      setMessages((previous) => previous.map((message) => message.id === messageId && message.writeConfirmation
        ? { ...message, writeConfirmation: { ...message.writeConfirmation, committed: true }, actionCard: message.actionCard ? { ...message.actionCard, saved: true } : undefined }
        : message));
      Alert.alert("保存成功", "已确认并保存本次操作。");
    } catch (error) {
      Alert.alert("保存失败", error instanceof Error ? error.message : "请稍后重试");
    }
  };

  // 底部 4 大快捷动作处理器
  const handleActionVisionFood = async () => {
    try {
      onClose();
      router.push("/diet-record");
    } catch (e: any) {
      Alert.alert("提示", "调起识图失败");
    }
  };

  const handleActionScanReceipt = async () => {
    try {
      onClose();
      router.push("/inventory");
    } catch (e: any) {
      Alert.alert("提示", "调起扫描失败");
    }
  };

  const handleActionFridgeClean = () => {
    onClose();
    router.push("/inventory");
  };

  const handleActionCookingVoice = () => {
    onClose();
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

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-[#F6F4F0]">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1 bg-[#F6F4F0] overflow-hidden flex-col justify-between"
        >
          {/* Header */}
          <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-[#EBE3D5]/60 bg-white/60">
            <TouchableOpacity onPress={() => setHistoryDrawerVisible(true)} className="p-1.5 flex-row items-center gap-1 active:opacity-70">
              <FontAwesome6 name="bars" size={16} color="#3D3229" />
            </TouchableOpacity>

            <View className="flex-row items-center gap-1.5 bg-[#2D6A4F]/10 px-3 py-1 rounded-full">
              <Text className="text-sm font-black text-[#3D3229]">食光</Text>
              <View className="bg-[#2D6A4F] px-1.5 py-0.5 rounded-md">
                <Text className="text-[9px] font-black text-white">AI 食语</Text>
              </View>
            </View>

            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => setHistoryDrawerVisible(true)}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5] active:opacity-80"
              >
                <FontAwesome6 name="clock-rotate-left" size={13} color="#2D6A4F" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setShowRealtimeVoiceMVP(true)}
                className="h-8 px-2.5 rounded-full bg-emerald-600 items-center justify-center shadow-xs active:opacity-80 flex-row gap-1"
              >
                <FontAwesome6 name="microphone-lines" size={11} color="#FFF" />
                <Text className="text-[11px] font-bold text-white">实时语音 MVP</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleStartNewChat}
                className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs active:opacity-80"
              >
                <FontAwesome6 name="plus" size={12} color="#FFF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  onClose();
                  router.push("/ai-assistant");
                }}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5] active:opacity-80"
              >
                <FontAwesome6 name="up-right-from-square" size={12} color="#3D3229" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setIsMuted(!isMuted)}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
              >
                <FontAwesome6
                  name={isMuted ? "volume-xmark" : "volume-high"}
                  size={13}
                  color="#3D3229"
                />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onClose}
                className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5]"
              >
                <FontAwesome6 name="xmark" size={14} color="#3D3229" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Center Scroll Content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            className="flex-1 px-4"
          >
            {messages.length === 0 ? (
              <View className="items-center pt-6 pb-4">
                {/* 3D Cute AI Avatar */}
                <View className="relative mb-3 items-center justify-center">
                  <View className="w-24 h-24 rounded-full bg-[#2D6A4F]/15 items-center justify-center shadow-lg border-2 border-white">
                    <Image
                      source={require("@/assets/shiyu-avatar.jpg")}
                      className="w-20 h-20 rounded-full"
                    />
                  </View>
                  <View className="absolute -bottom-1 -right-1 bg-[#E9C46A] px-2 py-0.5 rounded-full border border-white shadow-xs">
                    <Text className="text-[9px] font-black text-[#3D3229]">大厨智能体</Text>
                  </View>
                </View>

                {/* Slogan */}
                <Text className="text-base font-black text-[#3D3229] tracking-wide mb-1 text-center">
                  每一顿膳食与卡路里，我都能帮你理清楚
                </Text>
                <Text className="text-xs text-[#8B7D6B] mb-5">
                  智能库存配餐 · 拍照识菜算营养 · 双手解放做饭语音
                </Text>

                {/* Horizontal Sliding Cards */}
                <View className="w-full">
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }} className="flex-row gap-3">
                  {cardPrompts.map((card, i) => (
                    <TouchableOpacity
                      key={i}
                      onPress={() => handleSendMessage(card.title)}
                      className="w-44 bg-white p-4 rounded-3xl border border-[#EBE3D5] shadow-xs justify-between active:scale-95 transition-transform"
                    >
                      <View className="w-9 h-9 rounded-2xl bg-[#F5EFE6] items-center justify-center mb-3">
                        <FontAwesome6 name={card.icon} size={16} color={card.color} />
                      </View>
                      <View>
                        <Text className="text-xs font-black text-[#3D3229] leading-4 mb-1">
                          {card.title}
                        </Text>
                        <Text className="text-[10px] text-[#8B7D6B] leading-3">
                          {card.subtitle}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                </View>
              </View>
            ) : (
              <View className="pt-4">
                {messages.map((msg) => (
                  <View
                    key={msg.id}
                    className={`mb-4 flex-row ${
                      msg.sender === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {msg.sender === "ai" && (
                      <View className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center mr-2 mt-0.5 shadow-xs">
                        <FontAwesome6 name="robot" size={13} color="#FFF" />
                      </View>
                    )}

                    <View
                      className={`max-w-[86%] p-3.5 rounded-2xl shadow-xs ${
                        msg.sender === "user"
                          ? "bg-[#2D6A4F] rounded-tr-none"
                          : "bg-white border border-[#EBE3D5] rounded-tl-none"
                      }`}
                    >
                      {msg.sender === "ai" ? (
                        <AIMarkdown content={msg.text} />
                      ) : (
                        <Text className="text-xs leading-5 font-bold text-white">
                          {msg.text}
                        </Text>
                      )}

                      {/* Action Card */}
                      {msg.actionCard && (
                        <View className="mt-3 bg-[#FDF8F0] p-3 rounded-2xl border border-[#E9C46A]/60 shadow-xs">
                          <View className="flex-row items-center justify-between mb-1.5 pb-1 border-b border-[#EBE3D5]">
                            <View className="flex-row items-center gap-1">
                              <FontAwesome6 name="wand-magic-sparkles" size={11} color="#2D6A4F" />
                              <Text className="text-[11px] font-black text-[#3D3229]">打卡预填确认卡片</Text>
                            </View>
                            <View className="bg-[#2D6A4F] px-2 py-0.5 rounded-full">
                              <Text className="text-[9px] font-bold text-white">{msg.actionCard.mealType}</Text>
                            </View>
                          </View>
                          <Text className="text-xs font-black text-[#3D3229] mb-1">
                            {msg.actionCard.foodName} ({msg.actionCard.amount})
                          </Text>
                          <Text className="text-[10px] text-[#8B7D6B] mb-2">
                            预估: {msg.actionCard.calories} kcal | 蛋白: {msg.actionCard.protein}g
                          </Text>
                        </View>
                      )}

                      {msg.writeConfirmation && (
                        <View className="mt-3 rounded-2xl border border-[#2D6A4F]/25 bg-[#F7FAF8] p-3">
                          <Text className="text-[11px] font-black text-[#3D3229]">
                            {msg.writeConfirmation.committed ? "已确认保存" : "请确认本次操作"}
                          </Text>
                          {!msg.writeConfirmation.committed && (
                            <TouchableOpacity onPress={() => handleCommitWriteConfirmation(msg.id, msg.writeConfirmation!)} className="mt-2 rounded-xl bg-[#2D6A4F] py-2 items-center">
                              <Text className="text-xs font-bold text-white">确认保存</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {/* Missing Ingredients Card */}
                      {msg.missingCard && (
                        <View className="mt-3 bg-amber-500/10 p-3 rounded-2xl border border-amber-500/30 shadow-xs">
                          <View className="flex-row items-center justify-between mb-1.5 pb-1 border-b border-amber-500/20">
                            <View className="flex-row items-center gap-1">
                              <FontAwesome6 name="basket-shopping" size={11} color="#D4A276" />
                              <Text className="text-[11px] font-black text-[#3D3229]">缺料采购预警卡片</Text>
                            </View>
                          </View>
                          <Text className="text-xs font-black text-[#3D3229] mb-1.5">
                            想吃菜品: 【{msg.missingCard.dishName}】
                          </Text>
                          <View className="flex-row flex-wrap gap-1 mb-2">
                            {msg.missingCard.missingIngredients.map((item, idx) => (
                              <View key={idx} className="bg-white px-2 py-0.5 rounded-lg border border-amber-500/30 flex-row items-center gap-1">
                                <FontAwesome6 name="circle-exclamation" size={8} color="#E76F51" />
                                <Text className="text-[10px] font-bold text-[#3D3229]">{item.name}</Text>
                                <Text className="text-[9px] text-[#8B7D6B]">({item.amount})</Text>
                              </View>
                            ))}
                          </View>
                          <TouchableOpacity
                            onPress={() => handleSendMessage(`我冰箱里只有现有食材，请为我用冰箱里的食材替代推荐适合的料理！`)}
                            className="bg-[#2D6A4F] py-2 rounded-xl items-center flex-row justify-center gap-1 active:opacity-90"
                          >
                            <FontAwesome6 name="wand-magic-sparkles" size={10} color="#FFF" />
                            <Text className="text-[11px] font-bold text-white">用现有食材替代</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Solution Bento Cards List */}
                      {msg.solutionCards && msg.solutionCards.length > 0 && (
                        <View className="mt-3 gap-2.5">
                          <Text className="text-xs font-black text-[#2D6A4F] px-1">
                            推荐的平替解决方案卡片（含完整食材与亮点）：
                          </Text>
                          {msg.solutionCards.map((card) => (
                            <View
                              key={card.id}
                              className="bg-white rounded-2xl p-3 border border-[#2D6A4F]/25 shadow-xs"
                            >
                              <View className="flex-row items-center justify-between mb-1.5 gap-2">
                                <View className="bg-[#2D6A4F] px-2 py-0.5 rounded-full shrink-0">
                                  <Text className="text-[9px] font-black text-white">{card.schemeTag}</Text>
                                </View>
                                <Text className="text-xs font-black text-[#3D3229] flex-1 text-right" numberOfLines={1}>
                                  {card.title}
                                </Text>
                              </View>

                              <View className="bg-[#2D6A4F]/10 px-2 py-0.5 rounded-lg border border-[#2D6A4F]/20 mb-2 flex-row items-center gap-1 self-start">
                                <FontAwesome6 name="fire" size={9} color="#2D6A4F" />
                                <Text className="text-[9px] font-bold text-[#2D6A4F]">{card.macros}</Text>
                              </View>

                              <View className="bg-[#F6F4F0] p-2 rounded-xl mb-2.5 border border-[#EBE3D5] gap-1">
                                <View className="flex-row items-start gap-1">
                                  <FontAwesome6 name="carrot" size={9} color="#2D6A4F" className="mt-0.5" />
                                  <Text className="text-[10px] font-medium text-[#3D3229] flex-1 leading-relaxed">
                                    {card.ingredients}
                                  </Text>
                                </View>
                                {card.cookingTip ? (
                                  <View className="flex-row items-start gap-1 pt-1 border-t border-[#EBE3D5]/60">
                                    <FontAwesome6 name="fire-burner" size={9} color="#D4A276" className="mt-0.5" />
                                    <Text className="text-[9px] text-[#8B7D6B] flex-1 leading-relaxed">
                                      {card.cookingTip}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>

                              <TouchableOpacity
                                onPress={() => handleSendMessage(card.actionText)}
                                className="bg-[#2D6A4F] py-2 rounded-xl items-center flex-row justify-center gap-1 shadow-2xs active:opacity-90"
                              >
                                <FontAwesome6 name="utensils" size={10} color="#FFF" />
                                <Text className="text-xs font-bold text-white">选择【{card.schemeTag}】制作</Text>
                                <FontAwesome6 name="chevron-right" size={8} color="#FFF" />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}

            {loading && (
              <View className="flex-row items-center gap-2 bg-white p-3 rounded-2xl border border-[#EBE3D5] self-start ml-2 mb-4 shadow-xs">
                <ActivityIndicator size="small" color="#2D6A4F" />
                <Text className="text-xs text-[#8B7D6B] font-bold">AI 正在为您检索食材库与营养数据库...</Text>
              </View>
            )}
          </ScrollView>

          {/* Bottom Bar Section (Warm Theme Matched, No Harsh White Box) */}
          <View className="bg-[#F6F4F0] px-4 pt-3 pb-6 border-t border-[#EBE3D5] shadow-lg">
            {voiceStatusText ? (
              <View className="mb-2 px-3 py-1.5 rounded-xl bg-[#2D6A4F]/10 border border-[#2D6A4F]/20 flex-row items-center justify-between">
                <Text className="text-xs font-medium text-[#2D6A4F]">{voiceStatusText}</Text>
                {isRecording && <View className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                {isTranscribing && <ActivityIndicator size="small" color="#2D6A4F" />}
              </View>
            ) : null}

            {/* Integrated Card Container */}
            <View className={`bg-white p-3 rounded-[24px] border transition-all shadow-xs ${isRecording ? 'border-red-500 bg-red-50/50' : 'border-[#EBE3D5]'}`}>
              {/* Input Area */}
              <TextInput
                value={inputText}
                onChangeText={setInputText}
                placeholder={isRecording ? "正在录音识别中..." : "发消息或按住说话..."}
                placeholderTextColor="#A3A398"
                multiline
                className="text-xs text-[#3D3229] min-h-[36px] max-h-[90px] px-1 py-1 align-top"
                onSubmitEditing={() => handleSendMessage()}
              />

              {/* Bottom Control Bar */}
              <View className="flex-row items-center justify-between pt-2 border-t border-[#EBE3D5]/40 mt-1">
                {/* Left Side: Practical Food AI Chips (Hide when + tools grid expanded for perfect adaptation) */}
                {!showToolsGrid ? (
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
                  <Text className="text-[11px] font-bold text-[#8B7D6B]">食光工具箱</Text>
                )}

                {/* Right Side: Action Buttons */}
                <View className="flex-row items-center gap-1.5 ml-2">
                  <TouchableOpacity
                    onPress={() => setShowToolsGrid((prev) => !prev)}
                    className={`w-7.5 h-7.5 rounded-full border items-center justify-center transition-all ${
                      showToolsGrid ? 'bg-[#2D6A4F] border-[#2D6A4F]' : 'bg-[#F6F4F0] border-[#EBE3D5] active:bg-[#EBE3D5]/50'
                    }`}
                  >
                    <FontAwesome6 name={showToolsGrid ? "xmark" : "plus"} size={13} color={showToolsGrid ? "#FFFFFF" : "#3D3229"} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleToggleVoiceRecording}
                    disabled={loading || isTranscribing}
                    className={`w-7.5 h-7.5 rounded-full items-center justify-center transition-all ${
                      isRecording ? 'bg-red-500' : 'bg-[#F6F4F0] border border-[#EBE3D5]'
                    }`}
                  >
                    <FontAwesome6
                      name="microphone"
                      size={13}
                      color={isRecording ? "#FFFFFF" : "#3D3229"}
                    />
                  </TouchableOpacity>

                  {inputText.trim() ? (
                    <TouchableOpacity
                      onPress={() => handleSendMessage()}
                      disabled={loading}
                      className="w-7.5 h-7.5 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs active:scale-95"
                    >
                      <FontAwesome6 name="arrow-up" size={13} color="#FFFFFF" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Bottom 5 Core AI Quick Action Grid (按 + 号展开多彩轻奢图标面板) */}
            {showToolsGrid && (
              <View className="bg-white rounded-2xl p-3.5 border border-[#EBE3D5] mt-2.5 flex-row items-center justify-around shadow-sm">
                <TouchableOpacity
                  onPress={() => {
                    setShowToolsGrid(false);
                    handleActionVisionFood();
                  }}
                  className="items-center gap-1.5 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-2xl bg-emerald-50 items-center justify-center border border-emerald-200/80 shadow-xs">
                    <FontAwesome6 name="camera" size={18} color="#059669" />
                  </View>
                  <Text className="text-[11px] font-bold text-[#3D3229]">识菜热量</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowToolsGrid(false);
                    handleActionScanReceipt();
                  }}
                  className="items-center gap-1.5 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-2xl bg-amber-50 items-center justify-center border border-amber-200/80 shadow-xs">
                    <FontAwesome6 name="receipt" size={18} color="#D97706" />
                  </View>
                  <Text className="text-[11px] font-bold text-[#3D3229]">扫码入库</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowToolsGrid(false);
                    handleActionFridgeClean();
                  }}
                  className="items-center gap-1.5 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-2xl bg-sky-50 items-center justify-center border border-sky-200/80 shadow-xs">
                    <FontAwesome6 name="snowflake" size={18} color="#0284C7" />
                  </View>
                  <Text className="text-[11px] font-bold text-[#3D3229]">冰箱清库</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowToolsGrid(false);
                    onClose();
                    router.push("/ai-assistant", { open_shopping_list: "true" });
                  }}
                  className="items-center gap-1.5 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-2xl bg-purple-50 items-center justify-center border border-purple-200/80 shadow-xs">
                    <FontAwesome6 name="cart-shopping" size={18} color="#9333EA" />
                  </View>
                  <Text className="text-[11px] font-bold text-[#3D3229]">采购清单</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowToolsGrid(false);
                    handleActionCookingVoice();
                  }}
                  className="items-center gap-1.5 active:opacity-80"
                >
                  <View className="w-11 h-11 rounded-2xl bg-orange-50 items-center justify-center border border-orange-200/80 shadow-xs">
                    <FontAwesome6 name="fire-burner" size={18} color="#EA580C" />
                  </View>
                  <Text className="text-[11px] font-bold text-[#3D3229]">做饭语音包</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* 📜 历史对话记录 Drawer Modal */}
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

            <TouchableOpacity
              onPress={handleStartNewChat}
              className="my-3 bg-[#2D6A4F] py-3 rounded-2xl flex-row items-center justify-center gap-2 shadow-xs active:opacity-90"
            >
              <FontAwesome6 name="plus" size={14} color="#FFF" />
              <Text className="text-xs font-bold text-white">开启新的对话</Text>
            </TouchableOpacity>

            <ScrollView className="space-y-2.5 max-h-[400px]">
              {sessions.length === 0 ? (
                <View className="items-center py-8">
                  <Text className="text-xs text-[#8B7D6B]">暂无历史对话记录</Text>
                </View>
              ) : (
                sessions.map((s) => (
                  <View
                    key={s.id}
                    className={`p-3.5 my-1 rounded-2xl border flex-row items-center justify-between ${
                      s.id === currentSessionId
                        ? "bg-[#2D6A4F]/10 border-[#2D6A4F]"
                        : "bg-white border-[#EBE3D5]"
                    }`}
                  >
                    <TouchableOpacity
                      onPress={() => handleSelectSession(s)}
                      className="flex-1 mr-3"
                    >
                      <Text className="text-xs font-black text-[#3D3229] mb-1" numberOfLines={1}>
                        {s.title}
                      </Text>
                      <Text className="text-[11px] text-[#8B7D6B]">
                        {s.updatedAt} · {s.messages?.length || 0} 条对话
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => handleDeleteSession(s.id)}
                      className="w-8 h-8 rounded-full bg-[#F5EFE6] items-center justify-center active:opacity-70"
                    >
                      <FontAwesome6 name="trash-can" size={12} color="#8B7D6B" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 🎙️ 实时语音对话 (TeleSpeechASR + LLM MVP Modal) */}
      <RealtimeVoiceMVPModal
        visible={showRealtimeVoiceMVP}
        onClose={() => setShowRealtimeVoiceMVP(false)}
      />
    </Modal>
  );
}
