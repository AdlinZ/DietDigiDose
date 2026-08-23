import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeSearchParams, useSafeRouter } from "@/hooks/useSafeRouter";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import * as Speech from "expo-speech";
import * as Haptics from "expo-haptics";
import { useAuthFetch } from "@/contexts/AuthContext";
import { toLocalDateKey, toLocalTimeKey } from "@/utils/date";
import { aiApi, dietApi, inventoryApi, recipesApi, waitForAgentRun, type Recipe } from "@/services/api";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface CookingStep {
  text: string;
  duration?: number; // in seconds
  completed: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  responseTimeMs?: number;
}

interface VoiceConversationTurn {
  question: string;
  answer: string;
}

type CookingAgentRun = {
  id: string;
  status: string;
  reply?: string;
  error?: { message?: string };
  durationMs?: number;
};

export default function CookingModeScreen() {
  const insets = useSafeAreaInsets();
  const { recipeId } = useSafeSearchParams<{ recipeId: number }>();

  const router = useSafeRouter();
  const authFetch = useAuthFetch();
  const [cookingChatSessionId] = useState(() => `cooking-${Date.now()}`);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(true);
  const [recipeError, setRecipeError] = useState("");
  const title = recipe?.title;
  const calories = recipe?.calories;
  const protein = recipe?.protein;
  const carbs = recipe?.carbs;
  const fat = recipe?.fat;

  // Primary State
  const [currentStep, setCurrentStep] = useState(0);
  const [cookingSteps, setCookingSteps] = useState<CookingStep[]>([]);
  const [ingredients, setIngredients] = useState<
    { name: string; amount: string; checked: boolean }[]
  >([]);

  // Timer State
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerMode, setTimerMode] = useState<"countdown" | "stopwatch">("countdown");
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showTimerModal, setShowTimerModal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // View Controls
  const [viewMode, setViewMode] = useState<"hero" | "timeline">("hero");
  const [showIngredientsDrawer, setShowIngredientsDrawer] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);

  // AI & Voice State
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);

  const [autoSpeechEnabled, setAutoSpeechEnabled] = useState(true);
  const [isCompleting, setIsCompleting] = useState(false);

  // 🎙️ Live Direct Voice HUD Toast State (底栏上方半透明 HUD 悬浮卡片状态)
  const [voiceHudState, setVoiceHudState] = useState<{
    visible: boolean;
    type: "listening" | "processing" | "result";
    userText?: string;
    aiText?: string;
    actionDoneText?: string;
  }>({ visible: false, type: "listening" });
  const [voiceConversation, setVoiceConversation] = useState<VoiceConversationTurn[]>([]);

  const voiceHudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionKeyRef = useRef(`cook-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Step duration estimation
  const estimateStepDuration = (step: string): number => {
    const lower = step.toLowerCase();
    if (lower.includes("腌")) return 900;
    if (lower.includes("炖") || lower.includes("煲") || lower.includes("慢火") || lower.includes("收汁")) return 600;
    if (lower.includes("蒸")) return 480;
    if (lower.includes("炒") || lower.includes("煎") || lower.includes("爆") || lower.includes("焯")) return 300;
    if (lower.includes("煮")) return 360;
    if (lower.includes("切") || lower.includes("洗") || lower.includes("备") || lower.includes("主料") || lower.includes("辅料")) return 120;
    return 180;
  };

  // Step Action Tag Classifier
  const getStepActionTag = (stepText: string) => {
    if (!stepText)
      return { label: "烹饪步骤", icon: "utensils", bg: "bg-[#E8F2EA]", text: "text-[#2D6A4F]" };
    const lower = stepText.toLowerCase();
    if (
      lower.includes("切") ||
      lower.includes("洗") ||
      lower.includes("备") ||
      lower.includes("主料") ||
      lower.includes("辅料") ||
      lower.includes("刨") ||
      lower.includes("撕")
    ) {
      return { label: "切配准备", icon: "kitchen-set", bg: "bg-[#FFF4E5]", text: "text-[#D97706]" };
    }
    if (
      lower.includes("炒") ||
      lower.includes("爆") ||
      lower.includes("煎") ||
      lower.includes("炸") ||
      lower.includes("煸")
    ) {
      return { label: "火候烹炒", icon: "fire", bg: "bg-[#FEE2E2]", text: "text-[#DC2626]" };
    }
    if (
      lower.includes("炖") ||
      lower.includes("煮") ||
      lower.includes("煲") ||
      lower.includes("焖") ||
      lower.includes("收汁")
    ) {
      return { label: "慢炖文火", icon: "whiskey-glass", bg: "bg-[#E8F2EA]", text: "text-[#1B4332]" };
    }
    if (lower.includes("蒸") || lower.includes("焯")) {
      return { label: "水蒸焯水", icon: "cloud", bg: "bg-[#E0F2FE]", text: "text-[#0284C7]" };
    }
    if (
      lower.includes("调") ||
      lower.includes("拌") ||
      lower.includes("腌") ||
      lower.includes("淋") ||
      lower.includes("勾芡")
    ) {
      return { label: "调味腌制", icon: "bowl-rice", bg: "bg-[#F3E8FF]", text: "text-[#7E22CE]" };
    }
    return { label: "精细烹饪", icon: "utensils", bg: "bg-[#E8F2EA]", text: "text-[#2D6A4F]" };
  };

  // Step Context AI Tip
  const getStepContextTip = (stepText: string) => {
    if (!stepText) return null;
    const lower = stepText.toLowerCase();
    if (lower.includes("炒") || lower.includes("爆") || lower.includes("煸")) {
      return "热锅冷油下料，翻炒动作要迅速，大火能锁住食材汁水与香气。";
    }
    if (lower.includes("切") || lower.includes("主料")) {
      return "顺纹切猪肉、逆纹切牛肉，这样烹饪出来的肉质更加嫩滑易嚼。";
    }
    if (lower.includes("炖") || lower.includes("焖") || lower.includes("收汁")) {
      return "炖煮时汤水建议一次性加足，中途加水会降低汤汁鲜美度。";
    }
    if (lower.includes("腌")) {
      return "加入少许淀粉或蛋清抓匀，腌制 10 分钟口感更细腻饱满。";
    }
    if (lower.includes("蒸") || lower.includes("焯")) {
      return "待水沸腾上汽后再下入食材，能更快锁存食物原本的营养。";
    }
    return "注意厨房油温与用火安全，保持食材切配卫生。";
  };

  const speakStep = useCallback((stepText: string, stepIndex: number) => {
    try {
      Speech.stop();
      const contentToSpeak = `第 ${stepIndex + 1} 步：${stepText}`;
      Speech.speak(contentToSpeak, { language: "zh-CN", rate: 0.95 });
    } catch (e) {
      console.error("Speech error", e);
    }
  }, []);

  useEffect(() => {
    const id = Number(recipeId);
    if (!Number.isInteger(id) || id <= 0) {
      setRecipeError("菜谱编号无效，请从菜谱详情重新开始烹饪。");
      setRecipeLoading(false);
      return;
    }
    let active = true;
    setRecipeLoading(true);
    setRecipeError("");
    void recipesApi.detail(id).then((latestRecipe) => {
      if (!active) return;
      const parsedSteps: CookingStep[] = (latestRecipe.steps || []).map((s: string) => ({
        text: s,
        duration: estimateStepDuration(s),
        completed: false,
      }));
      if (!parsedSteps.length || !latestRecipe.ingredients?.length) throw new Error("菜谱步骤或食材不完整");
      setRecipe(latestRecipe);
      setCookingSteps(parsedSteps);
      setIngredients(
        latestRecipe.ingredients.map((i) => ({
          ...i,
          checked: false,
        }))
      );
      setTimerSeconds(parsedSteps[0].duration || 180);
    }).catch((error) => {
      if (!active) return;
      setRecipe(null);
      setCookingSteps([]);
      setIngredients([]);
      setRecipeError(error instanceof Error ? error.message : "菜谱读取失败");
    }).finally(() => { if (active) setRecipeLoading(false); });
    return () => { active = false; };
  }, [recipeId]);

  // Step change reaction: TTS + reset timer
  useEffect(() => {
    if (cookingSteps.length > 0 && cookingSteps[currentStep]) {
      if (autoSpeechEnabled) {
        speakStep(cookingSteps[currentStep].text, currentStep);
      }

      // Reset timer based on current mode
      const stepDuration = cookingSteps[currentStep].duration || 180;
      setIsTimerRunning(false);
      if (timerMode === "countdown") {
        setTimerSeconds(stepDuration);
      } else {
        setTimerSeconds(0);
      }
    }
  }, [currentStep, autoSpeechEnabled, cookingSteps, speakStep, timerMode]);

  // Timer interval engine
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => {
          if (timerMode === "countdown") {
            if (prev <= 1) {
              // Countdown finished!
              setIsTimerRunning(false);
              try {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                Speech.speak("当前步骤倒计时结束！", { language: "zh-CN" });
              } catch {}
              return 0;
            }
            return prev - 1;
          } else {
            return prev + 1;
          }
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, timerMode]);

  // 🎙️ Execute Direct Voice Command from HUD
  const executeDirectVoiceCommand = async (commandText: string) => {
    const text = commandText.trim();
    if (!text) return;

    if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
    setVoiceHudState({
      visible: true,
      type: "processing",
      userText: text,
    });

    try {
      const data = await aiApi.voiceCommand<{ type: string; action?: string; answerText?: string; run?: CookingAgentRun }>(
        authFetch,
        {
          speechText: text,
          sessionId: cookingChatSessionId,
          currentStep,
          recipeTitle: title || "当前菜品",
          recipeSteps: cookingSteps.map((s) => s.text),
          recipeIngredients: ingredients.map((i) => `${i.name} ${i.amount}`),
          voiceHistory: voiceConversation,
        }
      );

      if (data.type === "CONTROL") {
        let actionDoneText = "已完成语音控制";
        if (data.action === "NEXT_STEP") {
          if (currentStep < cookingSteps.length - 1) {
            handleNextStep();
            actionDoneText = "已为您切换至下一步";
          } else {
            actionDoneText = "已是最后一步步骤";
          }
        } else if (data.action === "PREV_STEP") {
          if (currentStep > 0) {
            handlePrevStep();
            actionDoneText = "已为您返回上一步";
          }
        } else if (data.action === "TOGGLE_TIMER") {
          setIsTimerRunning((prev) => !prev);
          actionDoneText = isTimerRunning ? "已为您暂停倒计时" : "已为您开启倒计时";
        }

        setVoiceHudState({
          visible: true,
          type: "result",
          userText: text,
          actionDoneText,
        });

        Speech.speak(actionDoneText, { language: "zh-CN", rate: 1.0 });
      } else {
        const completedRun = data.run ? await waitForAgentRun(authFetch, data.run) : undefined;
        const reply = completedRun?.reply || data.answerText || completedRun?.error?.message || "已为您提供下厨解答";
        setVoiceConversation((previous) => [
          ...previous,
          { question: text, answer: reply },
        ].slice(-3));
        setVoiceHudState({
          visible: true,
          type: "result",
          userText: text,
          aiText: reply,
        });

        Speech.speak(reply, { language: "zh-CN", rate: 1.0 });
      }

      // Keep the floating answer available while the user is cooking, then dismiss it.
      voiceHudTimerRef.current = setTimeout(() => {
        setVoiceHudState((prev) => ({ ...prev, visible: false }));
      }, data.type === "CONTROL" ? 4000 : 30000);
    } catch (error) {
      setVoiceHudState({
        visible: true,
        type: "result",
        userText: text,
        aiText: error instanceof Error ? error.message : "处理语音指令失败，请稍后重试",
      });
    }
  };

  // 🎙️ Voice Recorder Integration
  const {
    isRecording: isVoiceRecording,
    isTranscribing: isVoiceTranscribing,
    toggleRecording: toggleVoiceRecording,
    stopRecording: stopVoiceRecording,
  } = useVoiceRecorder({
    onSpeechResult: (recognizedText) => {
      if (recognizedText) {
        setVoiceHudState({
          visible: true,
          type: "listening",
          userText: recognizedText,
        });
      }
    },
    onSpeechFinal: (finalText) => {
      if (finalText) {
        void executeDirectVoiceCommand(finalText);
      }
    },
    onSpeechEmpty: () => {
      setVoiceHudState({
        visible: true,
        type: "result",
        aiText: "未能清晰识别到您的语音，请再试一次。",
      });
    },
  });

  // 🎙️ Direct Voice Mic Handler (点击底栏麦克风直接唤起/停止半透明 HUD 卡片与麦克风)
  const handleToggleDirectMic = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    if (isVoiceRecording) {
      stopVoiceRecording();
      return;
    }

    if (voiceHudTimerRef.current) clearTimeout(voiceHudTimerRef.current);
    setVoiceHudState({
      visible: true,
      type: "listening",
    });
    toggleVoiceRecording();
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDurationText = (seconds: number): string => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60);
      const remainingSecs = seconds % 60;
      return remainingSecs > 0 ? `${mins}分${remainingSecs}秒` : `${mins}分钟`;
    }
    return `${seconds}秒`;
  };

  const handleStartPauseTimer = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIsTimerRunning((prev) => !prev);
  };

  const handleResetTimer = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}
    setIsTimerRunning(false);
    const targetDur = cookingSteps[currentStep]?.duration || 180;
    setTimerSeconds(timerMode === "countdown" ? targetDur : 0);
  };

  const handleAddMinutes = (mins: number) => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setTimerSeconds((prev) => prev + mins * 60);
  };

  const toggleTimerMode = () => {
    const nextMode = timerMode === "countdown" ? "stopwatch" : "countdown";
    setTimerMode(nextMode);
    setIsTimerRunning(false);
    const targetDur = cookingSteps[currentStep]?.duration || 180;
    setTimerSeconds(nextMode === "countdown" ? targetDur : 0);
  };

  const handlePrevStep = () => {
    if (currentStep > 0) {
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleNextStep = () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    const newSteps = [...cookingSteps];
    if (newSteps[currentStep]) {
      newSteps[currentStep].completed = true;
      setCookingSteps(newSteps);
    }

    if (currentStep < cookingSteps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Last step completed! Open Finish Modal
      try {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      setShowFinishModal(true);
    }
  };

  const handleCheckIngredient = (index: number) => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
    setIngredients((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], checked: !updated[index].checked };
      return updated;
    });
  };

  const handleToggleSelectAllIngredients = () => {
    const allChecked = ingredients.every((i) => i.checked);
    setIngredients((prev) =>
      prev.map((i) => ({ ...i, checked: !allChecked }))
    );
  };

  const getMealType = () => {
    const hour = new Date().getHours();
    return hour < 10 ? "早餐" : hour < 15 ? "午餐" : hour < 21 ? "晚餐" : "加餐";
  };

  const findMatchedInventoryIds = async () => {
    const inventory = await inventoryApi.list(authFetch);
    if (!Array.isArray(inventory)) return [];
    const normalize = (value: string) =>
      value.toLocaleLowerCase().replace(/[\s·、，,。()（）/\\_-]/g, "");
    const ingredientNames = ingredients
      .filter((item) => item.checked)
      .map((item) => normalize(item.name));
    const matches = inventory.filter(
      (item: { food_name?: string; is_available?: boolean }) => {
        const foodName = normalize(String(item.food_name || ""));
        return (
          item.is_available &&
          ingredientNames.some(
            (name) => name && (foodName.includes(name) || name.includes(foodName))
          )
        );
      }
    );
    return matches.map((item: { id: number }) => item.id);
  };

  const finishCooking = async (consumeInventory: boolean) => {
    if (isCompleting) return;
    try {
      setIsCompleting(true);
      let inventoryItemIds: number[] = [];
      if (consumeInventory) {
        inventoryItemIds = await findMatchedInventoryIds();
        if (inventoryItemIds.length === 0) {
          Alert.alert(
            "未匹配到库存",
            "没有找到已勾选且名称匹配的库存食材，仍可继续记录这餐。",
            [{ text: "继续记录", onPress: () => void finishCooking(false) }]
          );
          return;
        }
      }
      const nutritionNumber = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      };

      const result = await dietApi.completeCooking(authFetch, {
        idempotency_key: completionKeyRef.current,
        recipe_id:
          Number.isInteger(Number(recipeId)) && Number(recipeId) > 0
            ? Number(recipeId)
            : null,
        inventory_item_ids: inventoryItemIds,
        diet_record: {
          meal_type: getMealType(),
          food_name: title || "自制餐食",
          amount: "1份",
          calories: nutritionNumber(calories),
          protein: nutritionNumber(protein),
          carbs: nutritionNumber(carbs),
          fat: nutritionNumber(fat),
          recorded_at: toLocalDateKey(),
          recorded_time: toLocalTimeKey(),
          image_url: null,
        },
      });

      setShowFinishModal(false);
      Alert.alert(
        result.repeated ? "已完成" : "烹饪完成！",
        `饮食记录已保存${
          result.consumed_inventory_item_ids.length
            ? `，并自动扣减了 ${result.consumed_inventory_item_ids.length} 项库存食材`
            : ""
        }。`,
        [{ text: "查看饮食记录", onPress: () => router.replace("/diet-record") }]
      );
    } catch (error) {
      Alert.alert("完成失败", error instanceof Error ? error.message : "请稍后重试");
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: chatInput,
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setIsAILoading(true);

    try {
      const currentDish = title || "这道菜";
      const currentStepText = cookingSteps[currentStep]?.text || "准备中";

      const data = await aiApi.chat<{ reply?: string; responseTimeMs?: number; run: CookingAgentRun }>(authFetch, {
        source: "cooking",
        sessionId: cookingChatSessionId,
        messages: [
          {
            role: "user",
            content: `【当前烹饪状态】菜品：${currentDish}；步骤 ${currentStep + 1}：${currentStepText}`,
          },
          ...chatMessages.slice(-46).map((message) => ({ role: message.role, content: message.content })),
          { role: "user", content: chatInput.trim() },
        ],
      });
      const completedRun = await waitForAgentRun(authFetch, data.run);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: completedRun.reply || data.reply || completedRun.error?.message || "抱歉，我暂时无法回答这个问题。",
        timestamp: new Date(),
        responseTimeMs: completedRun.durationMs ?? data.responseTimeMs,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: error instanceof Error ? error.message : "AI 对话请求失败，请稍后重试",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAILoading(false);
    }
  };

  const completedCount = cookingSteps.filter((s) => s.completed).length;
  const progressPercent =
    cookingSteps.length > 0 ? (completedCount / cookingSteps.length) * 100 : 0;
  const checkedIngredientsCount = ingredients.filter((i) => i.checked).length;
  const actionTag = getStepActionTag(cookingSteps[currentStep]?.text || "");
  const contextTip = getStepContextTip(cookingSteps[currentStep]?.text || "");
  const targetStepDuration = cookingSteps[currentStep]?.duration || 180;

  if (recipeLoading) {
    return <Screen><View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="#2D6A4F" /><Text className="mt-3 text-sm text-copy-muted">正在读取最新菜谱…</Text></View></Screen>;
  }
  if (!recipe || recipeError) {
    return <Screen><View className="flex-1 items-center justify-center px-8"><FontAwesome6 name="triangle-exclamation" size={28} color="#A63D2B" /><Text className="mt-4 text-center text-base font-black text-ink">无法开始烹饪</Text><Text className="mt-2 text-center text-sm leading-6 text-copy-muted">{recipeError || "菜谱暂不可用"}</Text><TouchableOpacity onPress={() => router.back()} className="mt-5 rounded-2xl bg-brand px-6 py-3"><Text className="font-bold text-white">返回菜谱</Text></TouchableOpacity></View></Screen>;
  }

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} className="flex-1 bg-[#F7F5F0] relative">
      {/* 🌿 Minimalist Ultra-Clean Top Header (极致清爽顶栏) */}
      <View
        style={{ paddingTop: Math.max(insets.top, 12) + 4 }}
        className="bg-white pb-3 px-5 border-b border-[#EBE3D5] shadow-xs relative flex-row items-center justify-between"
      >
        {/* Back Button */}
        <TouchableOpacity
          onPress={() => {
            const doExit = () => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)");
              }
            };

            if (Platform.OS === "web") {
              if (typeof window !== "undefined" && window.confirm("确定要退出当前的烹饪流程吗？")) {
                doExit();
              }
            } else {
              Alert.alert("退出做饭模式", "确定要退出当前的烹饪流程吗？", [
                { text: "取消", style: "cancel" },
                { text: "退出", style: "destructive", onPress: doExit },
              ]);
            }
          }}
          className="w-9 h-9 rounded-full bg-[#F8F5F0] border border-[#EBE3D5] items-center justify-center active:bg-[#EBE3D5]"
        >
          <FontAwesome6 name="chevron-left" size={14} color="#3D3229" />
        </TouchableOpacity>

        {/* Center: Title + Step Badge */}
        <View className="flex-1 items-center mx-3">
          <Text className="text-[#1B4332] text-base font-black tracking-wide" numberOfLines={1}>
            {title || "做饭模式"}
          </Text>
          <Text className="text-[#2D6A4F] text-[11px] font-bold mt-0.5">
            第 {currentStep + 1}/{cookingSteps.length || 1} 步 ({Math.round(progressPercent)}%)
          </Text>
        </View>

        {/* Right Clean Action Controls (2 icons only) */}
        <View className="flex-row items-center gap-2">
          {/* TTS Speech Mute/Unmute */}
          <TouchableOpacity
            onPress={() => {
              const nextState = !autoSpeechEnabled;
              setAutoSpeechEnabled(nextState);
              if (nextState && cookingSteps[currentStep]) {
                speakStep(cookingSteps[currentStep].text, currentStep);
              }
            }}
            className={`w-9 h-9 rounded-full items-center justify-center border ${
              autoSpeechEnabled
                ? "bg-[#E8F2EA] border-[#2D6A4F]/20"
                : "bg-[#F8F5F0] border-[#EBE3D5]"
            }`}
          >
            <FontAwesome6
              name={autoSpeechEnabled ? "volume-high" : "volume-xmark"}
              size={13}
              color={autoSpeechEnabled ? "#2D6A4F" : "#8B7D6B"}
            />
          </TouchableOpacity>

          {/* Timeline Switcher */}
          <TouchableOpacity
            onPress={() => setViewMode((prev) => (prev === "hero" ? "timeline" : "hero"))}
            className={`w-9 h-9 rounded-full items-center justify-center border ${
              viewMode === "timeline"
                ? "bg-[#2D6A4F] border-[#2D6A4F]"
                : "bg-[#F8F5F0] border-[#EBE3D5]"
            }`}
          >
            <FontAwesome6
              name={viewMode === "hero" ? "list-ul" : "layer-group"}
              size={13}
              color={viewMode === "timeline" ? "white" : "#3D3229"}
            />
          </TouchableOpacity>
        </View>

        {/* Flush 3px Progress Line attached to header bottom */}
        <View className="absolute bottom-0 left-0 right-0 h-[3px] bg-[#EBE3D5]">
          <View
            className="h-full bg-[#2D6A4F]"
            style={{ width: `${progressPercent}%` }}
          />
        </View>
      </View>

      {/* 🥗 Floating Ingredient Drawer Launcher Pill */}
      {ingredients.length > 0 && (
        <View className="px-5 pt-3 pb-1">
          <TouchableOpacity
            onPress={() => setShowIngredientsDrawer(true)}
            className="bg-white border border-[#EBE3D5] rounded-2xl px-4 py-2.5 flex-row items-center justify-between shadow-sm active:bg-[#F8F5F0]"
          >
            <View className="flex-row items-center gap-2.5">
              <View className="w-6 h-6 rounded-full bg-[#E8F2EA] items-center justify-center">
                <FontAwesome6 name="basket-shopping" size={12} color="#2D6A4F" />
              </View>
              <Text className="text-xs font-bold text-[#3D3229]">
                食材准备清单 ({checkedIngredientsCount}/{ingredients.length})
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-xs font-bold text-[#2D6A4F]">
                {checkedIngredientsCount === ingredients.length ? "已全部备齐" : "查看/勾选 ▸"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Mode Content */}
      <ScrollView className="flex-1 px-5 pt-2" showsVerticalScrollIndicator={false}>
        {viewMode === "hero" ? (
          /* 📱 HERO BIG STEP CARD DECK (食光大卡片沉浸视图) */
          <View className="pb-44">
            {cookingSteps.length > 0 && (
              <View className="gap-3">
                <View className="bg-white rounded-[24px] p-6 border border-[#EBE3D5] shadow-sm">
                {/* Step Action Tag & Header */}
                <View className="flex-row items-center justify-between mb-4">
                  <View className="flex-row items-center gap-2.5">
                    <View className="w-11 h-11 rounded-2xl bg-[#1B4332] items-center justify-center shadow-md">
                      <Text className="text-white text-lg font-black">
                        {currentStep + 1}
                      </Text>
                    </View>
                    <View className={`px-3 py-1.5 rounded-full flex-row items-center gap-1.5 ${actionTag.bg}`}>
                      <FontAwesome6 name={actionTag.icon} size={12} className={actionTag.text} color="currentColor" />
                      <Text className={`text-xs font-bold ${actionTag.text}`}>{actionTag.label}</Text>
                    </View>
                  </View>

                  {/* ⏱️ Compact Timer Trigger Button */}
                  <TouchableOpacity
                    onPress={() => setShowTimerModal(true)}
                    className={`px-3.5 py-2 rounded-full flex-row items-center gap-1.5 border ${
                      isTimerRunning
                        ? "bg-[#E76F51] border-[#E76F51] shadow-sm"
                        : "bg-[#F8F5F0] border-[#EBE3D5]"
                    }`}
                  >
                    <FontAwesome6
                      name={isTimerRunning ? "clock" : "stopwatch"}
                      size={12}
                      color={isTimerRunning ? "white" : "#2D6A4F"}
                    />
                    <Text
                      className={`text-xs font-bold ${
                        isTimerRunning ? "text-white" : "text-[#2D6A4F]"
                      }`}
                    >
                      {isTimerRunning
                        ? `${formatTime(timerSeconds)} (${timerMode === "countdown" ? "倒计时" : "正计时"})`
                        : `建议: ${formatDurationText(targetStepDuration)}`}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Main High-Readability Step Text */}
                <Text className="text-2xl font-black text-[#1B4332] leading-9 tracking-wide mb-6">
                  {cookingSteps[currentStep]?.text}
                </Text>

                {/* AI Context Tip Pill */}
                {contextTip && (
                  <View className="bg-[#E8F2EA] border border-[#2D6A4F]/20 rounded-2xl p-4 mb-4">
                    <Text className="text-xs font-bold text-[#1B4332] leading-5">
                      {contextTip}
                    </Text>
                  </View>
                )}

                {/* ⏱️ Inline Compact Quick Timer Bar */}
                <View className="bg-[#F8F5F0] rounded-2xl p-3.5 border border-[#EBE3D5] flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2.5">
                    <View
                      className={`w-9 h-9 rounded-xl items-center justify-center ${
                        isTimerRunning ? "bg-[#E76F51]" : "bg-[#2D6A4F]"
                      }`}
                    >
                      <FontAwesome6 name="clock" size={15} color="white" />
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-[#8B7D6B]">
                        {timerMode === "countdown" ? "倒计时" : "正计时"} ({formatDurationText(targetStepDuration)})
                      </Text>
                      <Text className="text-xl font-black text-[#1B4332] tracking-wider">
                        {formatTime(timerSeconds)}
                      </Text>
                    </View>
                  </View>

                  <View className="flex-row items-center gap-2">
                    {/* Start/Pause */}
                    <TouchableOpacity
                      onPress={handleStartPauseTimer}
                      className={`px-4 py-2.5 rounded-xl flex-row items-center gap-1.5 shadow-sm ${
                        isTimerRunning ? "bg-[#E76F51]" : "bg-[#2D6A4F]"
                      }`}
                    >
                      <FontAwesome6
                        name={isTimerRunning ? "pause" : "play"}
                        size={12}
                        color="white"
                      />
                      <Text className="text-white text-xs font-bold">
                        {isTimerRunning ? "暂停" : "开始"}
                      </Text>
                    </TouchableOpacity>

                    {/* Open Full Timer Controls Modal */}
                    <TouchableOpacity
                      onPress={() => setShowTimerModal(true)}
                      className="bg-white p-2.5 rounded-xl border border-[#EBE3D5] active:bg-[#EBE3D5]"
                    >
                      <FontAwesome6 name="ellipsis" size={14} color="#3D3229" />
                    </TouchableOpacity>
                  </View>
                </View>
                </View>

              </View>
            )}
          </View>
        ) : (
          /* 📋 FULL TIMELINE OVERVIEW (全部步骤总览视图) */
          <View className="pb-44 pt-2">
            <View className="bg-white rounded-[24px] p-5 border border-[#EBE3D5] shadow-sm">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-base font-bold text-[#1B4332]">全部烹饪步骤</Text>
                <Text className="text-xs text-[#8B7D6B]">点击可直接跳转对应步骤</Text>
              </View>

              <View className="gap-3">
                {cookingSteps.map((step, idx) => {
                  const isCurrent = idx === currentStep;
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => {
                        setCurrentStep(idx);
                        setViewMode("hero");
                      }}
                      className={`flex-row items-start p-4 rounded-2xl border ${
                        isCurrent
                          ? "bg-[#E8F2EA] border-[#2D6A4F]"
                          : step.completed
                          ? "bg-[#F8F5F0] border-transparent opacity-60"
                          : "bg-white border-[#EBE3D5]"
                      }`}
                    >
                      <View
                        className={`w-7 h-7 rounded-full items-center justify-center mr-3 mt-0.5 ${
                          step.completed
                            ? "bg-[#2D6A4F]"
                            : isCurrent
                            ? "bg-[#E9C46A]"
                            : "bg-[#EBE3D5]"
                        }`}
                      >
                        {step.completed ? (
                          <FontAwesome6 name="check" size={12} color="white" />
                        ) : (
                          <Text
                            className={`text-xs font-bold ${
                              isCurrent ? "text-[#3D3229]" : "text-[#8B7D6B]"
                            }`}
                          >
                            {idx + 1}
                          </Text>
                        )}
                      </View>
                      <View className="flex-1">
                        <Text
                          className={`text-sm leading-6 font-bold ${
                            step.completed
                              ? "text-[#8B7D6B] line-through"
                              : isCurrent
                              ? "text-[#1B4332]"
                              : "text-[#3D3229]"
                          }`}
                        >
                          {step.text}
                        </Text>
                        {step.duration ? (
                          <Text className="text-[11px] text-[#8B7D6B] mt-1">
                            建议耗时: {formatDurationText(step.duration)}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* LIVE SEMI-TRANSPARENT FROSTED GLASS VOICE HUD TOAST */}
      {voiceHudState.visible && (
        <View className="absolute bottom-24 left-4 right-4 z-50 bg-white/95 backdrop-blur-md rounded-2xl p-4 border border-[#EBE3D5] shadow-2xl">
          <View className="flex-row items-center justify-between mb-2 pb-1.5 border-b border-[#EBE3D5]">
            <View className="flex-row items-center gap-2">
              <View
                className={`w-2.5 h-2.5 rounded-full ${
                  isVoiceRecording ? "bg-[#E76F51]" : "bg-[#2D6A4F]"
                }`}
              />
              <Text className="text-xs font-black text-[#1B4332] tracking-wide">
                {isVoiceRecording
                  ? "正在实时倾听中，请说话..."
                  : isVoiceTranscribing || voiceHudState.type === "processing"
                  ? "正在调用 AI 大模型解答中..."
                  : "AI 厨艺实时解答"}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (isVoiceRecording) stopVoiceRecording();
                setVoiceHudState((prev) => ({ ...prev, visible: false }));
              }}
              className="w-6 h-6 rounded-full bg-[#F8F5F0] border border-[#EBE3D5] items-center justify-center active:bg-[#EBE3D5]"
            >
              <FontAwesome6 name="xmark" size={11} color="#3D3229" />
            </TouchableOpacity>
          </View>

          {/* Listening State Mode */}
          {voiceHudState.type === "listening" ? (
            <View className="gap-2">
              {voiceHudState.userText ? (
                <View className="flex-row items-start gap-1.5 bg-[#E8F2EA] p-2.5 rounded-xl border border-[#2D6A4F]/20">
                  <Text className="text-xs font-bold text-[#2D6A4F]">识别中:</Text>
                  <Text className="text-xs font-bold text-[#1B4332] flex-1">{voiceHudState.userText}</Text>
                </View>
              ) : (
                <Text className="text-xs font-bold text-[#8B7D6B]">
                  请直接说出问题，或点击下方常用指令：
                </Text>
              )}

              <View className="flex-row flex-wrap gap-1.5 pt-0.5">
                {["怎么切方块", "老抽放多少", "下一步", "上一步", "火候怎么掌握"].map((cmd, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => {
                      if (isVoiceRecording) stopVoiceRecording();
                      void executeDirectVoiceCommand(cmd);
                    }}
                    className="bg-[#F8F5F0] px-3 py-1.5 rounded-full border border-[#EBE3D5] active:bg-[#E8F2EA]"
                  >
                    <Text className="text-xs font-bold text-[#2D6A4F]">“{cmd}”</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : voiceHudState.type === "processing" || isVoiceTranscribing ? (
            <View className="flex-row items-center gap-2.5 py-1.5">
              <ActivityIndicator size="small" color="#2D6A4F" />
              <Text className="text-xs text-[#1B4332] font-bold">正在为您识别语音并检索烹饪数据库...</Text>
            </View>
          ) : (
            /* Result Toast Mode */
            <View className="gap-2">
              {voiceHudState.userText ? (
                <View className="flex-row items-start gap-1.5">
                  <Text className="text-xs font-bold text-[#D97706]">你问:</Text>
                  <Text className="text-xs font-bold text-[#1B4332] flex-1">{voiceHudState.userText}</Text>
                </View>
              ) : null}

              {voiceHudState.actionDoneText ? (
                <View className="bg-[#E8F2EA] p-2.5 rounded-xl border border-[#2D6A4F]/20 flex-row items-center gap-2">
                  <FontAwesome6 name="circle-check" size={13} color="#2D6A4F" />
                  <Text className="text-xs font-bold text-[#1B4332]">{voiceHudState.actionDoneText}</Text>
                </View>
              ) : null}

              {voiceHudState.aiText ? (
                <View className="bg-[#E8F2EA]/90 p-3 rounded-xl border border-[#2D6A4F]/20 gap-1 mt-1">
                  <View className="flex-row items-center gap-1.5">
                    <FontAwesome6 name="robot" size={12} color="#2D6A4F" />
                    <Text className="text-xs font-black text-[#2D6A4F]">AI 大厨解答</Text>
                  </View>
                  <Text className="text-xs leading-5 font-bold text-[#1B4332] mt-0.5" numberOfLines={4}>
                    {voiceHudState.aiText}
                  </Text>
                </View>
              ) : null}

            </View>
          )}
        </View>
      )}

      {/* 🛠️ UNIFIED BOTTOM CONTROL CAPSULE DOCK (全合一底栏控制胶囊) */}
      <View className="absolute bottom-6 left-4 right-4 bg-white/95 backdrop-blur-md rounded-full p-2 flex-row items-center gap-2 shadow-2xl border border-[#EBE3D5]">
        {/* Prev Step Button */}
        <TouchableOpacity
          onPress={handlePrevStep}
          disabled={currentStep === 0}
          className={`w-10 h-10 rounded-full items-center justify-center border ${
            currentStep === 0
              ? "bg-[#F8F5F0] border-[#EBE3D5] opacity-30"
              : "bg-[#F8F5F0] border-[#EBE3D5] active:bg-[#EBE3D5]"
          }`}
        >
          <FontAwesome6 name="chevron-left" size={14} color="#3D3229" />
        </TouchableOpacity>

        {/* Direct Voice Mic Button (Tap to trigger direct recording HUD) */}
        <TouchableOpacity
          onPress={handleToggleDirectMic}
          className={`w-10 h-10 rounded-full items-center justify-center shadow-xs active:scale-95 ${
            isVoiceRecording
              ? "bg-[#E76F51]"
              : "bg-[#E9C46A]"
          }`}
        >
          <FontAwesome6
            name={isVoiceRecording ? "square" : "microphone"}
            size={isVoiceRecording ? 12 : 14}
            color={isVoiceRecording ? "white" : "#3D3229"}
          />
        </TouchableOpacity>

        {/* AI Kitchen Mentor Q&A Button (Soft Mint Green) */}
        <TouchableOpacity
          onPress={() => setShowAIChat(true)}
          className="w-10 h-10 rounded-full bg-[#E8F2EA] border border-[#2D6A4F]/20 items-center justify-center active:bg-[#D8E8DC] shadow-xs"
        >
          <FontAwesome6 name="robot" size={14} color="#2D6A4F" />
        </TouchableOpacity>

        {/* Primary Step Action Button */}
        <TouchableOpacity
          onPress={handleNextStep}
          className="flex-1 h-10 rounded-full bg-[#2D6A4F] items-center justify-center flex-row gap-2 shadow-md active:bg-[#1B4332]"
        >
          <Text className="text-white font-black text-sm tracking-wide" numberOfLines={1}>
            {currentStep < cookingSteps.length - 1 ? "完成此步，下一步" : "完成烹饪!"}
          </Text>
          <FontAwesome6
            name={currentStep < cookingSteps.length - 1 ? "arrow-right" : "check"}
            size={12}
            color="white"
          />
        </TouchableOpacity>
      </View>

      {/* ⏱️ TIMER QUICK CONTROLS MODAL */}
      <Modal
        visible={showTimerModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowTimerModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-center px-6">
          <View className="bg-white rounded-[32px] p-6 items-center shadow-2xl border border-[#EBE3D5]">
            <View className="flex-row items-center justify-between w-full mb-4">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-[#E8F2EA] items-center justify-center">
                  <FontAwesome6 name="clock" size={14} color="#2D6A4F" />
                </View>
                <Text className="text-base font-bold text-[#1B4332]">厨房智能计时器</Text>
              </View>
              <TouchableOpacity onPress={() => setShowTimerModal(false)} className="p-1">
                <FontAwesome6 name="xmark" size={18} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            {/* Huge Time Display */}
            <Text className="text-6xl font-black text-[#1B4332] tracking-wider my-3">
              {formatTime(timerSeconds)}
            </Text>

            {/* Mode Switcher */}
            <TouchableOpacity
              onPress={toggleTimerMode}
              className="bg-[#F8F5F0] px-4 py-2 rounded-full border border-[#EBE3D5] mb-5"
            >
              <Text className="text-xs font-bold text-[#2D6A4F]">
                当前为{timerMode === "countdown" ? "【倒计时模式】点击切为正计时" : "【正计时模式】点击切为倒计时"}
              </Text>
            </TouchableOpacity>

            {/* Quick Modifiers */}
            <View className="flex-row gap-3 mb-6">
              <TouchableOpacity
                onPress={() => handleAddMinutes(1)}
                className="bg-[#F8F5F0] px-5 py-2.5 rounded-full border border-[#EBE3D5] active:bg-[#E9C46A]"
              >
                <Text className="text-xs font-bold text-[#3D3229]">+1 分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddMinutes(5)}
                className="bg-[#F8F5F0] px-5 py-2.5 rounded-full border border-[#EBE3D5] active:bg-[#E9C46A]"
              >
                <Text className="text-xs font-bold text-[#3D3229]">+5 分钟</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleResetTimer}
                className="bg-[#F8F5F0] px-5 py-2.5 rounded-full border border-[#EBE3D5] active:bg-[#EBE3D5]"
              >
                <Text className="text-xs font-bold text-[#8B7D6B]">重置</Text>
              </TouchableOpacity>
            </View>

            {/* Primary Action Button */}
            <TouchableOpacity
              onPress={() => {
                handleStartPauseTimer();
                setShowTimerModal(false);
              }}
              className={`w-full py-4 rounded-2xl flex-row items-center justify-center gap-2 shadow-md active:opacity-90 ${
                isTimerRunning ? "bg-[#E76F51]" : "bg-[#2D6A4F]"
              }`}
            >
              <FontAwesome6
                name={isTimerRunning ? "pause" : "play"}
                size={16}
                color="white"
              />
              <Text className="text-white font-black text-sm">
                {isTimerRunning ? "暂停计时" : "开始计时"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🥗 INGREDIENTS SHEET MODAL */}
      <Modal
        visible={showIngredientsDrawer}
        animationType="slide"
        transparent
        onRequestClose={() => setShowIngredientsDrawer(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] p-6 max-h-[75%]">
            <View className="flex-row items-center justify-between mb-4 border-b border-[#EBE3D5] pb-3">
              <View className="flex-row items-center gap-2">
                <View className="w-8 h-8 rounded-full bg-[#E8F2EA] items-center justify-center">
                  <FontAwesome6 name="basket-shopping" size={14} color="#2D6A4F" />
                </View>
                <Text className="text-lg font-bold text-[#1B4332]">食材备料打勾清单</Text>
                <Text className="text-xs text-[#8B7D6B]">
                  ({checkedIngredientsCount}/{ingredients.length})
                </Text>
              </View>

              <View className="flex-row items-center gap-3">
                <TouchableOpacity onPress={handleToggleSelectAllIngredients}>
                  <Text className="text-xs font-bold text-[#2D6A4F]">
                    {checkedIngredientsCount === ingredients.length ? "取消全选" : "全选"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowIngredientsDrawer(false)} className="p-1">
                  <FontAwesome6 name="xmark" size={20} color="#8B7D6B" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              <View className="flex-row flex-wrap gap-2.5 pb-4">
                {ingredients.map((ing, idx) => (
                  <TouchableOpacity
                    key={idx}
                    onPress={() => handleCheckIngredient(idx)}
                    className={`px-4 py-3 rounded-2xl border flex-row items-center gap-2.5 ${
                      ing.checked
                        ? "bg-[#E8F2EA] border-[#2D6A4F]"
                        : "bg-[#F8F5F0] border-[#EBE3D5]"
                    }`}
                  >
                    <View
                      className={`w-5 h-5 rounded-md items-center justify-center border ${
                        ing.checked
                          ? "bg-[#2D6A4F] border-[#2D6A4F]"
                          : "border-[#8B7D6B]"
                      }`}
                    >
                      {ing.checked && <FontAwesome6 name="check" size={10} color="white" />}
                    </View>
                    <Text
                      className={`text-xs font-bold ${
                        ing.checked ? "text-[#2D6A4F] line-through" : "text-[#3D3229]"
                      }`}
                    >
                      {ing.name} {ing.amount}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              onPress={() => setShowIngredientsDrawer(false)}
              className="bg-[#2D6A4F] py-4 rounded-2xl items-center justify-center mt-2 shadow-md active:bg-[#1B4332]"
            >
              <Text className="text-white font-bold text-sm">完成备料确认</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🎉 COOKING FINISH CELEBRATION MODAL */}
      <Modal
        visible={showFinishModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowFinishModal(false)}
      >
        <View className="flex-1 bg-black/70 justify-center px-6">
          <View className="bg-white rounded-[32px] p-6 items-center shadow-2xl">
            <View className="w-20 h-20 rounded-full bg-[#E9C46A] items-center justify-center mb-4 shadow-amber-glow">
              <FontAwesome6 name="trophy" size={36} color="#3D3229" />
            </View>

            <Text className="text-2xl font-black text-[#1B4332] text-center">烹饪圆满完成！</Text>
            <Text className="text-xs text-[#8B7D6B] mt-1 mb-5 text-center leading-5">
              您已成功完成了【{title || "自制菜品"}】的全部 {cookingSteps.length} 个步骤！
            </Text>

            {/* Nutrition Cards Preview */}
            {(calories || protein || carbs || fat) ? (
              <View className="w-full bg-[#F8F5F0] rounded-2xl p-4 border border-[#EBE3D5] mb-5">
                <Text className="text-xs font-bold text-[#1B4332] mb-3 text-center">
                  预计摄入营养成分总览
                </Text>
                <View className="flex-row justify-around">
                  {calories ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-[#2D6A4F]">{calories}</Text>
                      <Text className="text-[10px] font-bold text-[#8B7D6B]">热量 kcal</Text>
                    </View>
                  ) : null}
                  {protein ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-[#2D6A4F]">{protein}g</Text>
                      <Text className="text-[10px] font-bold text-[#8B7D6B]">蛋白质</Text>
                    </View>
                  ) : null}
                  {carbs ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-[#2D6A4F]">{carbs}g</Text>
                      <Text className="text-[10px] font-bold text-[#8B7D6B]">碳水</Text>
                    </View>
                  ) : null}
                  {fat ? (
                    <View className="items-center">
                      <Text className="text-base font-black text-[#2D6A4F]">{fat}g</Text>
                      <Text className="text-[10px] font-bold text-[#8B7D6B]">脂肪</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Actions */}
            <View className="w-full gap-3">
              <TouchableOpacity
                onPress={() => finishCooking(true)}
                disabled={isCompleting}
                className="bg-[#E9C46A] py-4 rounded-2xl items-center justify-center flex-row gap-2 shadow-md active:opacity-90"
              >
                {isCompleting ? (
                  <ActivityIndicator size="small" color="#3D3229" />
                ) : (
                  <>
                    <FontAwesome6 name="boxes-packing" size={15} color="#3D3229" />
                    <Text className="text-[#3D3229] font-black text-sm">
                      扣减已勾选食材并记录本餐
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => finishCooking(false)}
                disabled={isCompleting}
                className="bg-[#2D6A4F] py-3.5 rounded-2xl items-center justify-center flex-row gap-2 shadow-md active:opacity-90"
              >
                <FontAwesome6 name="utensils" size={14} color="white" />
                <Text className="text-white font-bold text-sm">仅记录本餐饮食</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  setShowFinishModal(false);
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(tabs)");
                  }
                }}
                disabled={isCompleting}
                className="py-2.5 items-center justify-center active:opacity-70"
              >
                <Text className="text-[#8B7D6B] text-xs font-semibold">不记录，直接退出</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 🤖 AI CHAT MODAL */}
      <Modal
        visible={showAIChat}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAIChat(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] max-h-[80%]">
            {/* Header */}
            <View className="flex-row items-center justify-between p-4 border-b border-[#EBE3D5]">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-[#2D6A4F] items-center justify-center">
                  <FontAwesome6 name="robot" size={18} color="white" />
                </View>
                <View className="ml-3">
                  <Text className="text-base font-bold text-[#1B4332]">AI 烹饪导师</Text>
                  <Text className="text-xs text-[#8B7D6B]">有任何烹饪疑问随问随答</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowAIChat(false)} className="p-2">
                <FontAwesome6 name="xmark" size={20} color="#8B7D6B" />
              </TouchableOpacity>
            </View>

            {/* Chat Messages */}
            <ScrollView
              className="flex-1 p-4"
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}
            >
              {chatMessages.length === 0 && (
                <View className="items-center py-6">
                  <FontAwesome6 name="utensils" size={36} color="#2D6A4F" />
                  <Text className="text-[#8B7D6B] text-xs mt-3 text-center leading-5">
                    正在烹饪【{title || "菜品"}】第 {currentStep + 1} 步{"\n"}
                    遇到调料放多少、火候问题？随时向我提问！
                  </Text>
                  <View className="mt-4 gap-2">
                    {[
                      "这一步火候怎么掌握？",
                      "没有老抽可以用什么代替？",
                      "怎样判断食材是否已经熟透？",
                    ].map((q, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => setChatInput(q)}
                        className="bg-[#F8F5F0] px-4 py-2.5 rounded-full border border-[#EBE3D5] active:bg-[#E8F2EA]"
                      >
                        <Text className="text-xs font-semibold text-[#2D6A4F]">{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
              {chatMessages.map((msg) => (
                <View
                  key={msg.id}
                  className={`mb-3 ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <View
                    className={`max-w-[80%] px-4 py-3 rounded-2xl ${
                      msg.role === "user"
                        ? "bg-[#2D6A4F]"
                        : "bg-[#F8F5F0] border border-[#EBE3D5]"
                    }`}
                  >
                    <Text
                      className={`text-sm leading-6 ${
                        msg.role === "user" ? "text-white" : "text-[#3D3229]"
                      }`}
                    >
                      {msg.content}
                    </Text>
                    {msg.role === "assistant" && typeof msg.responseTimeMs === "number" ? (
                      <Text className="mt-1 text-[10px] text-[#8B7D6B]">
                        回复耗时 {msg.responseTimeMs < 1000 ? `${Math.round(msg.responseTimeMs)} ms` : `${(msg.responseTimeMs / 1000).toFixed(2)} 秒`}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {isAILoading && (
                <View className="items-start mb-3">
                  <View className="bg-[#F8F5F0] px-4 py-3 rounded-2xl border border-[#EBE3D5]">
                    <Text className="text-xs text-[#8B7D6B]">思考中...</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Input */}
            <View className="p-4 border-t border-[#EBE3D5]">
              <View className="flex-row items-center bg-[#F8F5F0] rounded-full px-4 py-2 border border-[#EBE3D5]">
                <TextInput
                  className="flex-1 text-sm text-[#3D3229] px-2"
                  placeholder="问点什么..."
                  placeholderTextColor="#8B7D6B"
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={handleSendChat}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  onPress={handleSendChat}
                  disabled={!chatInput.trim() || isAILoading}
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    chatInput.trim() && !isAILoading ? "bg-[#2D6A4F]" : "bg-[#EBE3D5]"
                  }`}
                >
                  <FontAwesome6
                    name="paper-plane"
                    size={12}
                    color={chatInput.trim() && !isAILoading ? "white" : "#8B7D6B"}
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
