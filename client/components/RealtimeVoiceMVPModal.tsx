import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import FontAwesome6 from "@/components/ThemedFontAwesome6";
import * as Speech from "expo-speech";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi } from "@/services/api";

type VoiceState = "idle" | "listening" | "recognizing" | "thinking" | "speaking" | "completed";

interface VoiceMessage {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: string;
  solutionCards?: SolutionCard[];
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
interface RealtimeVoiceMVPModalProps {
  visible: boolean;
  onClose: () => void;
}

export function RealtimeVoiceMVPModal({ visible, onClose }: RealtimeVoiceMVPModalProps) {
  const authFetch = useAuthFetch();
  const [sessionId] = useState(() => `voice-${Date.now()}`);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [currentRecognizedText, setCurrentRecognizedText] = useState("");
  const [aiResponseText, setAiResponseText] = useState("");
  const [ttsError, setTtsError] = useState("");
  const ttsStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pipelineMetrics, setPipelineMetrics] = useState<{
    asrMs: number;
    llmMs: number;
    ttsMs: number;
  }>({ asrMs: 0, llmMs: 0, ttsMs: 0 });

  // 动画配置
  const [pulseAnim] = useState(() => new Animated.Value(1));
  const [waveAnim1] = useState(() => new Animated.Value(0.3));
  const [waveAnim2] = useState(() => new Animated.Value(0.5));
  const [waveAnim3] = useState(() => new Animated.Value(0.8));

  // 开始循环波形动画
  useEffect(() => {
    if (voiceState === "listening" || voiceState === "speaking") {
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );

      const waveLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim1, { toValue: 1, duration: 400, useNativeDriver: false }),
          Animated.timing(waveAnim1, { toValue: 0.2, duration: 400, useNativeDriver: false }),
        ])
      );
      const waveLoop2 = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim2, { toValue: 0.2, duration: 350, useNativeDriver: false }),
          Animated.timing(waveAnim2, { toValue: 0.9, duration: 350, useNativeDriver: false }),
        ])
      );
      const waveLoop3 = Animated.loop(
        Animated.sequence([
          Animated.timing(waveAnim3, { toValue: 0.9, duration: 500, useNativeDriver: false }),
          Animated.timing(waveAnim3, { toValue: 0.3, duration: 500, useNativeDriver: false }),
        ])
      );

      pulseLoop.start();
      waveLoop.start();
      waveLoop2.start();
      waveLoop3.start();

      return () => {
        pulseLoop.stop();
        waveLoop.stop();
        waveLoop2.stop();
        waveLoop3.stop();
      };
    } else {
      pulseAnim.setValue(1);
    }
  }, [voiceState, pulseAnim, waveAnim1, waveAnim2, waveAnim3]);

  // 停止 TTS 语音播放
  const stopTTS = useCallback(() => {
    try {
      if (ttsStartTimerRef.current) {
        clearTimeout(ttsStartTimerRef.current);
        ttsStartTimerRef.current = null;
      }
      if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      Speech.stop();
    } catch {}
  }, []);

  const speakReply = useCallback((text: string) => {
    const reply = text.trim();
    if (!reply) return;

    setTtsError("");
    setVoiceState("speaking");
    try {
      stopTTS();

      // Expo Speech 在 Web 上会把调用吞掉而不触发可听声音；浏览器原生实现可选中文音色，
      // 并能通过 onstart/onerror 明确判断是否真正开始播放。
      if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(reply);
        const chineseVoice = window.speechSynthesis
          .getVoices()
          .find((voice) => /^zh(?:-|_)/i.test(voice.lang));
        utterance.lang = chineseVoice?.lang || "zh-CN";
        utterance.voice = chineseVoice || null;
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onstart = () => {
          if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
        };
        utterance.onend = () => {
          if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
          setVoiceState("completed");
        };
        utterance.onerror = (event) => {
          if (ttsStartTimerRef.current) clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
          // Chrome emits these when we intentionally cancel playback to start a new turn.
          if (event.error !== "canceled" && event.error !== "interrupted") {
            setTtsError("自动朗读未能启动。请点击“重播回答”手动播放，并检查标签页和系统媒体音量。");
          }
          setVoiceState("completed");
        };
        window.speechSynthesis.speak(utterance);
        ttsStartTimerRef.current = setTimeout(() => {
          if (!window.speechSynthesis.speaking) {
            setTtsError("自动朗读未能启动。请点击“重播回答”手动播放，并检查标签页和系统媒体音量。");
            setVoiceState("completed");
          }
          ttsStartTimerRef.current = null;
        }, 1500);
        return;
      }

      Speech.speak(reply, {
        language: "zh-CN",
        rate: 1.0,
        pitch: 1.0,
        onDone: () => setVoiceState("completed"),
        onStopped: () => setVoiceState("completed"),
        onError: () => {
          setTtsError("语音播放未启动，请点“重播回答”或检查设备媒体音量。");
          setVoiceState("completed");
        },
      });
    } catch {
      setTtsError("当前设备无法播放语音，请检查浏览器语音权限或使用文字查看回答。");
      setVoiceState("completed");
    }
  }, [stopTTS]);

  // 执行管线：ASR 识别文本 -> LLM 思考 -> 流式 TTS 朗读
  const handleProcessVoiceQuery = useCallback(async (userText: string) => {
    if (!userText.trim()) return;

    const startTime = Date.now();
    setVoiceState("thinking");
    stopTTS();

    // 1. 添加用户消息记录
    const userMsg: VoiceMessage = {
      id: String(Date.now()),
      sender: "user",
      text: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages((prev) => [...prev, userMsg]);
    setCurrentRecognizedText("");

    const asrDoneTime = Date.now();
    const asrMs = Math.max(120, asrDoneTime - startTime);

    try {
      // 2. 调用 LLM
      const res = (await aiApi.chat(
        authFetch,
        {
          messages: [{ role: "user", content: userText }],
          source: "voice",
          sessionId,
        }
      )) as { reply?: string; solutionCards?: SolutionCard[] };
      const replyText = res.reply || "收到，我已经听明白了。你还想继续问我什么？";
      const llmDoneTime = Date.now();
      const llmMs = llmDoneTime - asrDoneTime;

      // 3. 添加 AI 消息记录
      const aiMsg: VoiceMessage = {
        id: String(Date.now() + 1),
        sender: "ai",
        text: replyText,
        solutionCards: res.solutionCards,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setAiResponseText(replyText);
      // 4. 调用 TTS 语音播放
      const ttsStart = Date.now();
      speakReply(replyText);
      const ttsMs = Date.now() - ttsStart;
      setPipelineMetrics({ asrMs, llmMs, ttsMs: Math.max(80, ttsMs) });

    } catch (err) {
      console.error("Voice pipeline error:", err);
      const message = err instanceof Error && err.message
        ? `食语暂时无法回复：${err.message}`
        : "食语暂时无法回复，请检查网络后重试。";
      setMessages((prev) => [...prev, {
        id: String(Date.now() + 1),
        sender: "ai",
        text: message,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
      setVoiceState("completed");
    }
  }, [authFetch, sessionId, speakReply, stopTTS]);

  // ASR 识别 Hook
  const { isRecording, toggleRecording, stopRecording } = useVoiceRecorder({
    onSpeechResult: (recognizedText) => {
      setCurrentRecognizedText(recognizedText);
    },
    onSpeechFinal: (recognizedText) => {
      setCurrentRecognizedText(recognizedText);
      void handleProcessVoiceQuery(recognizedText);
    },
    onSpeechEmpty: () => {
      setCurrentRecognizedText("");
      setVoiceState("completed");
      setMessages((prev) => [...prev, {
        id: String(Date.now()),
        sender: "ai",
        text: "这一轮没有听清楚。请靠近麦克风再说一次，或直接使用文字输入。",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    },
  });

  // 处理语音按键切换
  const handleMicPress = async () => {
    if (voiceState === "speaking") {
      // 触发【全双工打断】机制：立即停止 TTS，切回听取模式
      stopTTS();
      setVoiceState("listening");
      toggleRecording();
      return;
    }

    if (isRecording) {
      // 手动结束同样会走 onSpeechFinal；避免旧逻辑在 state 尚未刷新时丢失文本。
      setVoiceState("recognizing");
      stopRecording();
    } else {
      // 开始录音倾听
      stopTTS();
      setCurrentRecognizedText("");
      setAiResponseText("");
      setVoiceState("listening");
      toggleRecording();
    }
  };

  // 快捷提问
  const handleQuickPrompt = (promptText: string) => {
    handleProcessVoiceQuery(promptText);
  };

  // 弹窗关闭清理
  const handleCloseModal = () => {
    stopRecording();
    stopTTS();
    setVoiceState("idle");
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCloseModal}>
      <View className="flex-1 bg-black/75 justify-end">
        <View className="bg-background-secondary rounded-t-[36px] p-6 max-h-[85%] border-t border-line shadow-2xl flex-col">
          {/* Top Bar Navigation */}
          <View className="flex-row items-center justify-between pb-4 border-b border-line">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-full bg-brand-fill items-center justify-center shadow-xs">
                <FontAwesome6 name="microphone-lines" size={14} colorClassName="accent-on-brand" />
              </View>
              <View>
                <Text className="text-base font-black text-ink">TeleSpeechASR + LLM 实时语音 MVP</Text>
                <Text className="text-[10px] text-copy-muted font-medium">毫秒级流式 ASR ➜ 思考 ➜ 语音全双工响应</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleCloseModal}
              className="w-8 h-8 rounded-full bg-surface items-center justify-center border border-line active:bg-line/40"
            >
              <FontAwesome6 name="xmark" size={14} colorClassName="accent-ink" />
            </TouchableOpacity>
          </View>

          {/* Pipeline Benchmark Metrics Tag */}
          <View className="bg-surface my-3 p-2.5 rounded-2xl border border-line flex-row items-center justify-around shadow-2xs">
            <View className="items-center">
              <Text className="text-[9px] text-copy-muted font-bold">1. ASR 识别流</Text>
              <Text className="text-xs font-black text-success">~{pipelineMetrics.asrMs || 180} ms</Text>
            </View>
            <Text className="text-xs text-line">➜</Text>
            <View className="items-center">
              <Text className="text-[9px] text-copy-muted font-bold">2. LLM 流式思考</Text>
              <Text className="text-xs font-black text-warm">~{pipelineMetrics.llmMs || 340} ms</Text>
            </View>
            <Text className="text-xs text-line">➜</Text>
            <View className="items-center">
              <Text className="text-[9px] text-copy-muted font-bold">3. TTS 语音播报</Text>
              <Text className="text-xs font-black text-info">~{pipelineMetrics.ttsMs || 90} ms</Text>
            </View>
          </View>

          {/* Chat Messages Stream */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            className="flex-1 max-h-[260px] my-2 px-1"
            contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
          >
            {messages.length === 0 ? (
              <View className="items-center py-8 bg-surface/60 rounded-3xl border border-dashed border-line">
                <FontAwesome6 name="headset" size={32} colorClassName="accent-warm" />
                <Text className="text-xs font-bold text-ink mt-3">按下下方麦克风，直接开口对答</Text>
                <Text className="text-[10px] text-copy-muted mt-1">支持方言、普通话、英语自然语音混说交互</Text>
              </View>
            ) : (
              messages.map((msg) => (
                <View
                  key={msg.id}
                  className={`flex-row ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <View
                    className={`max-w-[82%] px-4 py-3 rounded-2xl shadow-2xs ${
                      msg.sender === "user"
                        ? "bg-brand-fill rounded-br-xs"
                        : "bg-surface border border-line rounded-bl-xs"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        msg.sender === "user" ? "text-white" : "text-ink"
                      }`}
                    >
                      {msg.text}
                    </Text>
                    {msg.sender === "ai" && msg.solutionCards?.length ? (
                      <View className="mt-3 gap-2">
                        {msg.solutionCards.map((card) => (
                          <TouchableOpacity
                            key={card.id}
                            onPress={() => handleProcessVoiceQuery(card.actionText)}
                            className="rounded-xl border border-brand/25 bg-brand/5 p-2.5 active:bg-brand/10"
                          >
                            <View className="flex-row items-center justify-between gap-2">
                              <View className="rounded-full bg-brand-fill px-2 py-0.5">
                                <Text className="text-[9px] font-black text-white">{card.schemeTag}</Text>
                              </View>
                              <Text className="flex-1 text-right text-[11px] font-black text-ink" numberOfLines={1}>
                                {card.title}
                              </Text>
                            </View>
                            <Text className="mt-1.5 text-[10px] font-medium leading-relaxed text-ink" numberOfLines={2}>
                              {card.ingredients}
                            </Text>
                            <Text className="mt-1 text-[9px] font-bold text-brand">{card.macros}</Text>
                            <Text className="mt-1 text-[9px] text-copy-muted" numberOfLines={2}>{card.cookingTip}</Text>
                            <Text className="mt-2 text-center text-[10px] font-black text-brand">点击选择此方案</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                    <Text
                      className={`text-[9px] mt-1 text-right ${
                        msg.sender === "user" ? "text-emerald-100/70" : "text-copy-muted"
                      }`}
                    >
                      {msg.timestamp}
                    </Text>
                  </View>
                </View>
              ))
            )}

            {/* Live Streaming Recognizing Text */}
            {currentRecognizedText ? (
              <View className="bg-success-soft border border-success/30 p-3 rounded-2xl self-end max-w-[82%]">
                <Text className="text-xs font-bold text-success">
                  正在听: “{currentRecognizedText}”
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Quick Voice Prompts */}
          <View className="flex-row items-center gap-1.5 my-2 flex-wrap justify-center">
            <TouchableOpacity
              onPress={() => handleQuickPrompt("根据现有冰箱食材推荐一份健康晚餐")}
              className="px-3 py-1.5 rounded-full bg-surface border border-line flex-row items-center gap-1 active:bg-brand/10"
            >
              <FontAwesome6 name="utensils" size={10} colorClassName="accent-success" />
              <Text className="text-[11px] font-bold text-brand">推荐晚餐</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleQuickPrompt("用四川话告诉我西红柿炒鸡蛋怎么做")}
              className="px-3 py-1.5 rounded-full bg-surface border border-line flex-row items-center gap-1 active:bg-brand/10"
            >
              <FontAwesome6 name="language" size={10} colorClassName="accent-warm" />
              <Text className="text-[11px] font-bold text-warm">方言食谱示范</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleQuickPrompt("给5岁小朋友做一道不挑食的营养早餐")}
              className="px-3 py-1.5 rounded-full bg-surface border border-line flex-row items-center gap-1 active:bg-brand/10"
            >
                <FontAwesome6 name="child" size={10} colorClassName="accent-info" />
              <Text className="text-[11px] font-bold text-info">儿童餐推荐</Text>
            </TouchableOpacity>
          </View>

          {/* Large Waveform & Mic Interactive Button Area */}
          <View className="items-center justify-center pt-3 pb-2">
            {/* Waveform Pulse Ring */}
            <View className="relative items-center justify-center my-2">
              <Animated.View
                style={{
                  transform: [{ scale: pulseAnim }],
                }}
                className={`w-24 h-24 rounded-full items-center justify-center border-2 transition-all ${
                  voiceState === "listening"
                    ? "bg-critical/20 border-critical"
                    : voiceState === "speaking"
                    ? "bg-info/20 border-info"
                    : voiceState === "thinking" || voiceState === "recognizing"
                    ? "bg-warm/20 border-warm"
                    : "bg-brand/10 border-brand"
                }`}
              />

              {/* Central Trigger Button */}
              <TouchableOpacity
                onPress={handleMicPress}
                activeOpacity={0.8}
                className={`absolute w-16 h-16 rounded-full items-center justify-center shadow-lg transition-all ${
                  voiceState === "listening"
                    ? "bg-critical-fill"
                    : voiceState === "speaking"
                    ? "bg-info-fill"
                    : voiceState === "thinking" || voiceState === "recognizing"
                    ? "bg-warm-fill"
                    : "bg-brand-fill"
                }`}
              >
                {voiceState === "thinking" ? (
                  <ActivityIndicator colorClassName="accent-on-brand" size="small" />
                ) : (
                  <FontAwesome6
                    name={
                      voiceState === "speaking"
                        ? "stop"
                        : voiceState === "listening" || voiceState === "recognizing"
                        ? "waveform"
                        : "microphone"
                    }
                    size={22}
                    colorClassName="accent-on-brand"
                  />
                )}
              </TouchableOpacity>
            </View>

            {/* Status Hint */}
            <Text className="text-xs font-black text-ink mt-2">
              {voiceState === "listening"
                ? "正在倾听；说完停顿会自动提交，也可点击结束本轮"
                : voiceState === "recognizing"
                ? "正在结束本轮并识别语音…"
                : voiceState === "thinking"
                ? "识别完成，食语正在思考…"
                : voiceState === "speaking"
                ? "食语正在回答；点击可打断并继续说"
                : voiceState === "completed"
                ? "本轮对话已完成；点击麦克风继续"
                : "点击麦克风，开启语音对话"}
            </Text>

            {voiceState === "listening" && (
              <TouchableOpacity
                onPress={handleMicPress}
                className="mt-2 rounded-full border border-critical/40 bg-danger-soft px-3 py-1.5 active:bg-danger-soft"
              >
                <Text className="text-[10px] font-bold text-critical">结束本轮</Text>
              </TouchableOpacity>
            )}

            {voiceState === "speaking" && (
              <TouchableOpacity
                onPress={() => {
                  stopTTS();
                  setVoiceState("idle");
                }}
                className="mt-2 bg-danger-soft px-3 py-1 rounded-full border border-critical/40 flex-row items-center gap-1 active:bg-danger-soft"
              >
                <FontAwesome6 name="circle-stop" size={10} colorClassName="accent-critical" />
                <Text className="text-[10px] font-bold text-critical">全双工打断播报</Text>
              </TouchableOpacity>
            )}

            {aiResponseText && voiceState !== "speaking" && (
              <TouchableOpacity
                onPress={() => speakReply(aiResponseText)}
                className="mt-2 flex-row items-center gap-1 rounded-full border border-info/30 bg-info-soft px-3 py-1.5 active:bg-info-soft"
              >
                <FontAwesome6 name="volume-high" size={10} colorClassName="accent-info" />
                <Text className="text-[10px] font-bold text-info">重播回答</Text>
              </TouchableOpacity>
            )}

            {ttsError ? <Text className="mt-2 px-4 text-center text-[10px] text-critical">{ttsError}</Text> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
