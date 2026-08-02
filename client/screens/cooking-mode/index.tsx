import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Alert,
  Animated,
  ActivityIndicator,
} from "react-native";
import { Screen } from "@/components/Screen";
import { useSafeSearchParams, useSafeRouter } from "@/hooks/useSafeRouter";
import { FontAwesome6 } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

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
}

export default function CookingModeScreen() {
  const { recipeId, title, steps: stepsParam, ingredients: ingredientsParam } =
    useSafeSearchParams<{
      recipeId: number;
      title: string;
      steps: string;
      ingredients: string;
    }>();

  const router = useSafeRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [cookingSteps, setCookingSteps] = useState<CookingStep[]>([]);
  const [ingredients, setIngredients] = useState<
    { name: string; amount: string; checked: boolean }[]
  >([]);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isAILoading, setIsAILoading] = useState(false);
  const [autoSpeechEnabled, setAutoSpeechEnabled] = useState(true);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const [voiceInputText, setVoiceInputText] = useState("");
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const speakStep = useCallback((stepText: string, stepIndex: number) => {
    try {
      Speech.stop();
      const contentToSpeak = `第 ${stepIndex + 1} 步：${stepText}`;
      Speech.speak(contentToSpeak, { language: "zh-CN", rate: 0.95 });
    } catch (e) {
      console.error("Speech error", e);
    }
  }, []);

  // 步骤变化时自动播报
  useEffect(() => {
    if (autoSpeechEnabled && cookingSteps.length > 0 && cookingSteps[currentStep]) {
      speakStep(cookingSteps[currentStep].text, currentStep);
    }
  }, [currentStep, autoSpeechEnabled, cookingSteps, speakStep]);

  const handleSendVoiceCommand = async (textToProcess?: string) => {
    const text = (textToProcess || voiceInputText).trim();
    if (!text) return;

    setVoiceProcessing(true);
    try {
      const savedToken = await AsyncStorage.getItem("@auth_token");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (savedToken) headers["Authorization"] = `Bearer ${savedToken}`;

      const res = await fetch(`${BACKEND_URL}/api/v1/ai/voice-command`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          speechText: text,
          currentStep,
          recipeTitle: title || "当前菜品",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.type === "CONTROL") {
          if (data.action === "NEXT_STEP") {
            if (currentStep < cookingSteps.length - 1) {
              setCurrentStep((prev) => prev + 1);
              Alert.alert("语音导航", "已为您切换至下一步");
            } else {
              Alert.alert("提示", "已经是最后一步了");
            }
          } else if (data.action === "PREV_STEP") {
            if (currentStep > 0) {
              setCurrentStep((prev) => prev - 1);
              Alert.alert("语音导航", "已为您返回上一步");
            }
          } else if (data.action === "TOGGLE_TIMER") {
            setIsTimerRunning((prev) => !prev);
          }
        } else if (data.type === "QUESTION") {
          const reply = data.answerText || "做饭建议已收到";
          const assistantMessage: ChatMessage = {
            id: Date.now().toString(),
            role: "assistant",
            content: reply,
            timestamp: new Date(),
          };
          setChatMessages((prev) => [...prev, assistantMessage]);
          setShowAIChat(true);
          Speech.speak(reply, { language: "zh-CN", rate: 1.0 });
        }
      }
    } catch (e: any) {
      Alert.alert("提示", "处理语音指令失败");
    } finally {
      setVoiceProcessing(false);
      setShowVoiceModal(false);
      setVoiceInputText("");
    }
  };

  // Parse steps and ingredients from params
  useFocusEffect(() => {
    try {
      const stepsArr = stepsParam ? JSON.parse(stepsParam as string) : [];
      const ingredientsArr = ingredientsParam
        ? JSON.parse(ingredientsParam as string)
        : [];

      setCookingSteps(
        stepsArr.map((s: string) => ({
          text: s,
          duration: estimateStepDuration(s),
          completed: false,
        }))
      );

      setIngredients(
        ingredientsArr.map((i: { name: string; amount: string }) => ({
          ...i,
          checked: false,
        }))
      );
    } catch {
      setCookingSteps([]);
      setIngredients([]);
    }
  });

  // Timer logic
  useEffect(() => {
    if (isTimerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning]);

  // Pulse animation for active step
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const estimateStepDuration = (step: string): number => {
    const lower = step.toLowerCase();
    if (lower.includes("煮") || lower.includes("炖")) return 600;
    if (lower.includes("蒸")) return 480;
    if (lower.includes("炒") || lower.includes("煎")) return 300;
    if (lower.includes("切") || lower.includes("洗")) return 120;
    if (lower.includes("腌")) return 900;
    return 180;
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60);
      return `${mins}分钟`;
    }
    return `${seconds}秒`;
  };

  const handleStartTimer = () => {
    setIsTimerRunning(true);
  };

  const handlePauseTimer = () => {
    setIsTimerRunning(false);
  };

  const handleResetTimer = () => {
    setIsTimerRunning(false);
    setTimerSeconds(0);
  };

  const handleCompleteStep = () => {
    const newSteps = [...cookingSteps];
    newSteps[currentStep].completed = true;
    setCookingSteps(newSteps);
    setTimerSeconds(0);
    setIsTimerRunning(false);

    if (currentStep < cookingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      Alert.alert("完成!", "恭喜你完成了这道菜!", [
        { text: "太棒了!", onPress: () => router.back() },
      ]);
    }
  };

  const handleCheckIngredient = (index: number) => {
    const newIngredients = [...ingredients];
    newIngredients[index].checked = !newIngredients[index].checked;
    setIngredients(newIngredients);
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
      const currentStepText =
        cookingSteps[currentStep]?.text || "准备中";

      const prompt = `当前正在做菜【${currentDish}】，正在进行第 ${currentStep + 1} 步：${currentStepText}。
用户提问：“${chatInput.trim()}”。请给出实用简短的烹饪建议。`;

      const response = await fetch(`${BACKEND_URL}/api/v1/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await response.json();

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply || "抱歉，我暂时无法回答这个问题。",
        timestamp: new Date(),
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "网络异常，请稍后再试。",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsAILoading(false);
    }
  };

  const progress =
    cookingSteps.length > 0
      ? (cookingSteps.filter((s) => s.completed).length / cookingSteps.length) *
        100
      : 0;

  return (
    <Screen className="flex-1 bg-[#FDF8F0]">
      {/* Header */}
      <View className="bg-[#2D6A4F] pt-12 pb-4 px-5">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={() => router.back()} className="p-2">
            <FontAwesome6 name="arrow-left" size={20} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-lg font-bold" numberOfLines={1}>
            做饭模式
          </Text>
          <View className="flex-row items-center gap-1">
            <TouchableOpacity
              onPress={() => setAutoSpeechEnabled((prev) => !prev)}
              className={`p-2 rounded-full ${autoSpeechEnabled ? "bg-[#E9C46A]/30" : ""}`}
            >
              <FontAwesome6
                name={autoSpeechEnabled ? "volume-high" : "volume-xmark"}
                size={16}
                color={autoSpeechEnabled ? "#E9C46A" : "white"}
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowVoiceModal(true)}
              className="p-2 bg-[#E9C46A] rounded-full active:opacity-80"
            >
              <FontAwesome6 name="microphone" size={15} color="#3D3229" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowAIChat(true)}
              className="p-2"
            >
              <FontAwesome6 name="robot" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>
        <Text className="text-white/80 text-sm mt-1" numberOfLines={1}>
          {title || "烹饪中..."}
        </Text>
        {/* Progress bar */}
        <View className="mt-3 h-2 bg-white/20 rounded-full overflow-hidden">
          <View
            className="h-full bg-[#E9C46A] rounded-full"
            style={{ width: `${progress}%` }}
          />
        </View>
        <Text className="text-white/70 text-xs mt-1">
          步骤 {currentStep + 1}/{cookingSteps.length} | 已完成{" "}
          {Math.round(progress)}%
        </Text>
      </View>

      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Ingredients Checklist */}
        <View className="mx-5 mt-4 bg-white rounded-2xl p-4 shadow-sm">
          <View className="flex-row items-center mb-3">
            <View className="w-8 h-8 rounded-full bg-[#E9C46A]/20 items-center justify-center mr-2">
              <FontAwesome6 name="list-check" size={14} color="#E9C46A" />
            </View>
            <Text className="text-base font-bold text-[#1B4332]">
              食材准备
            </Text>
            <Text className="text-xs text-[#A3A398] ml-2">
              {ingredients.filter((i) => i.checked).length}/{ingredients.length}
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {ingredients.map((ing, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => handleCheckIngredient(idx)}
                className={`px-3 py-2 rounded-full border ${
                  ing.checked
                    ? "bg-[#2D6A4F]/10 border-[#2D6A4F]"
                    : "bg-white border-[#E0E0D8]"
                }`}
              >
                <Text
                  className={`text-xs ${
                    ing.checked
                      ? "text-[#2D6A4F] line-through"
                      : "text-[#6B705C]"
                  }`}
                >
                  {ing.name} {ing.amount}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Current Step */}
        {cookingSteps.length > 0 && (
          <Animated.View
            style={{ transform: [{ scale: pulseAnim }] }}
            className="mx-5 mt-4"
          >
            <View className="bg-white rounded-2xl p-5 shadow-sm border-2 border-[#2D6A4F]/20">
              <View className="flex-row items-center mb-3">
                <View className="w-10 h-10 rounded-full bg-[#2D6A4F] items-center justify-center mr-3">
                  <Text className="text-white text-lg font-bold">
                    {currentStep + 1}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-[#A3A398]">当前步骤</Text>
                  <Text className="text-sm font-semibold text-[#2D6A4F]">
                    {cookingSteps[currentStep]?.duration
                      ? `建议时长: ${formatDuration(cookingSteps[currentStep].duration || 0)}`
                      : ""}
                  </Text>
                </View>
              </View>
              <Text className="text-base text-[#1B4332] leading-6 mb-4">
                {cookingSteps[currentStep]?.text}
              </Text>

              {/* Timer */}
              <View className="bg-[#F8F5F0] rounded-xl p-4 items-center">
                <Text className="text-4xl font-bold text-[#2D6A4F] mb-3">
                  {formatTime(timerSeconds)}
                </Text>
                <View className="flex-row gap-3">
                  {!isTimerRunning ? (
                    <TouchableOpacity
                      onPress={handleStartTimer}
                      className="bg-[#2D6A4F] px-5 py-2 rounded-full flex-row items-center"
                    >
                      <FontAwesome6 name="play" size={12} color="white" />
                      <Text className="text-white text-sm ml-2">开始计时</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      onPress={handlePauseTimer}
                      className="bg-[#E07A5F] px-5 py-2 rounded-full flex-row items-center"
                    >
                      <FontAwesome6 name="pause" size={12} color="white" />
                      <Text className="text-white text-sm ml-2">暂停</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={handleResetTimer}
                    className="bg-[#F0EBE3] px-4 py-2 rounded-full flex-row items-center"
                  >
                    <FontAwesome6 name="rotate-right" size={12} color="#6B705C" />
                    <Text className="text-[#6B705C] text-sm ml-2">重置</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Complete Step Button */}
              <TouchableOpacity
                onPress={handleCompleteStep}
                className="bg-[#2D6A4F] py-3 rounded-xl mt-4 flex-row items-center justify-center"
              >
                <FontAwesome6 name="check" size={16} color="white" />
                <Text className="text-white font-bold ml-2">
                  {currentStep < cookingSteps.length - 1
                    ? "完成此步，进入下一步"
                    : "完成烹饪!"}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* All Steps Overview */}
        <View className="mx-5 mt-4 mb-8 bg-white rounded-2xl p-4 shadow-sm">
          <Text className="text-base font-bold text-[#1B4332] mb-3">
            全部步骤
          </Text>
          <View className="gap-3">
            {cookingSteps.map((step, idx) => (
              <TouchableOpacity
                key={idx}
                onPress={() => setCurrentStep(idx)}
                className={`flex-row items-start p-3 rounded-xl ${
                  idx === currentStep
                    ? "bg-[#2D6A4F]/10 border border-[#2D6A4F]/30"
                    : step.completed
                      ? "bg-[#F0EBE3]/50"
                      : "bg-[#F8F5F0]"
                }`}
              >
                <View
                  className={`w-6 h-6 rounded-full items-center justify-center mr-3 mt-0.5 ${
                    step.completed
                      ? "bg-[#2D6A4F]"
                      : idx === currentStep
                        ? "bg-[#E9C46A]"
                        : "bg-[#E0E0D8]"
                  }`}
                >
                  {step.completed ? (
                    <FontAwesome6 name="check" size={10} color="white" />
                  ) : (
                    <Text
                      className={`text-xs font-bold ${idx === currentStep ? "text-white" : "text-[#6B705C]"}`}
                    >
                      {idx + 1}
                    </Text>
                  )}
                </View>
                <Text
                  className={`flex-1 text-sm ${
                    step.completed
                      ? "text-[#A3A398] line-through"
                      : "text-[#1B4332]"
                  }`}
                >
                  {step.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* AI Chat Modal */}
      <Modal
        visible={showAIChat}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAIChat(false)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-[#FDF8F0] rounded-t-3xl max-h-[80%]">
            {/* Chat Header */}
            <View className="flex-row items-center justify-between p-4 border-b border-[#E0E0D8]">
              <View className="flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-[#2D6A4F] items-center justify-center">
                  <FontAwesome6 name="robot" size={18} color="white" />
                </View>
                <View className="ml-3">
                  <Text className="text-base font-bold text-[#1B4332]">
                    AI 烹饪助手
                  </Text>
                  <Text className="text-xs text-[#A3A398]">
                    有任何烹饪问题都可以问我
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setShowAIChat(false)}
                className="p-2"
              >
                <FontAwesome6 name="xmark" size={20} color="#6B705C" />
              </TouchableOpacity>
            </View>

            {/* Chat Messages */}
            <ScrollView
              className="flex-1 p-4"
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={false}
            >
              {chatMessages.length === 0 && (
                <View className="items-center py-8">
                  <FontAwesome6 name="utensils" size={40} color="#E0E0D8" />
                  <Text className="text-[#A3A398] text-sm mt-3 text-center">
                    烹饪过程中遇到问题？{"\n"}随时向我提问！
                  </Text>
                  <View className="mt-4 gap-2">
                    {[
                      "这道菜有什么小技巧？",
                      "如何判断食物是否熟了？",
                      "可以替换什么食材？",
                    ].map((q, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => setChatInput(q)}
                        className="bg-white px-4 py-2 rounded-full border border-[#E0E0D8]"
                      >
                        <Text className="text-xs text-[#6B705C]">{q}</Text>
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
                        ? "bg-[#2D6A4F] rounded-br-sm"
                        : "bg-white rounded-bl-sm shadow-sm"
                    }`}
                  >
                    <Text
                      className={`text-sm ${msg.role === "user" ? "text-white" : "text-[#1B4332]"}`}
                    >
                      {msg.content}
                    </Text>
                  </View>
                </View>
              ))}
              {isAILoading && (
                <View className="items-start mb-3">
                  <View className="bg-white px-4 py-3 rounded-2xl rounded-bl-sm shadow-sm">
                    <Text className="text-sm text-[#A3A398]">
                      思考中...
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Chat Input */}
            <View className="p-4 border-t border-[#E0E0D8]">
              <View className="flex-row items-center bg-white rounded-full px-4 py-2 border border-[#E0E0D8]">
                <TextInput
                  className="flex-1 text-sm text-[#1B4332]"
                  placeholder="问点什么..."
                  placeholderTextColor="#A3A398"
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={handleSendChat}
                  returnKeyType="send"
                />
                <TouchableOpacity
                  onPress={handleSendChat}
                  disabled={!chatInput.trim() || isAILoading}
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    chatInput.trim() && !isAILoading
                      ? "bg-[#2D6A4F]"
                      : "bg-[#E0E0D8]"
                  }`}
                >
                  <FontAwesome6
                    name="paper-plane"
                    size={12}
                    color={
                      chatInput.trim() && !isAILoading ? "white" : "#A3A398"
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Voice Assistant Modal */}
      <Modal
        visible={showVoiceModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowVoiceModal(false)}
      >
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-[#2D6A4F] rounded-t-[32px] p-6 items-center border-t border-[#E9C46A]">
            <View className="w-16 h-16 rounded-full bg-[#E9C46A] items-center justify-center mb-3 shadow-lg">
              <FontAwesome6 name="microphone" size={26} color="#3D3229" />
            </View>
            <Text className="text-lg font-black text-white">AI 语音下厨助手</Text>
            <Text className="text-xs text-emerald-100 mt-1 mb-4 text-center">
              双手解放模式：可随时说出控制指令或烹饪疑问
            </Text>

            {/* Quick Voice Chips */}
            <View className="w-full flex-row flex-wrap justify-center gap-2 mb-4">
              {["下一步", "上一步", "重置计时器", "老抽放多少合适？", "用什么替代生抽？"].map(
                (cmd, i) => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => handleSendVoiceCommand(cmd)}
                    disabled={voiceProcessing}
                    className="bg-white/15 px-3.5 py-2 rounded-full border border-white/20 active:bg-white/30"
                  >
                    <Text className="text-xs font-bold text-white">“{cmd}”</Text>
                  </TouchableOpacity>
                )
              )}
            </View>

            {/* Voice Input Field */}
            <View className="w-full bg-white/10 rounded-2xl p-2.5 flex-row items-center gap-2 border border-white/20">
              <TextInput
                value={voiceInputText}
                onChangeText={setVoiceInputText}
                placeholder="说出指令或向 AI 提问..."
                placeholderTextColor="#A3A398"
                className="flex-1 text-sm text-white px-2"
                onSubmitEditing={() => handleSendVoiceCommand()}
              />
              <TouchableOpacity
                onPress={() => handleSendVoiceCommand()}
                disabled={!voiceInputText.trim() || voiceProcessing}
                className="bg-[#E9C46A] px-4 py-2 rounded-xl flex-row items-center gap-1.5"
              >
                {voiceProcessing ? (
                  <ActivityIndicator size="small" color="#3D3229" />
                ) : (
                  <>
                    <FontAwesome6 name="paper-plane" size={12} color="#3D3229" />
                    <Text className="text-xs font-black text-[#3D3229]">发送</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => setShowVoiceModal(false)}
              className="mt-4 p-2"
            >
              <Text className="text-xs text-emerald-200">关闭语音助手</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
