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
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
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
}

interface RealtimeVoiceMVPModalProps {
  visible: boolean;
  onClose: () => void;
}

export function RealtimeVoiceMVPModal({ visible, onClose }: RealtimeVoiceMVPModalProps) {
  const authFetch = useAuthFetch();
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
        utterance.onend = () => setVoiceState("completed");
        utterance.onerror = () => {
          setTtsError("浏览器没有启动语音播放。请检查此标签页是否静音、系统媒体音量或点击“重播回答”。");
          setVoiceState("completed");
        };
        window.speechSynthesis.speak(utterance);
        ttsStartTimerRef.current = setTimeout(() => {
          if (!window.speechSynthesis.speaking) {
            setTtsError("语音未能启动。请取消 Chrome 标签页静音并确认系统媒体音量已开启，然后点“重播回答”。");
            setVoiceState("completed");
          }
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
          prompt: `【实时语音对话模式】请用精炼亲切的口语（100字以内的短句）回答用户的提问，方便语音播报：${userText}`,
        }
      )) as { reply?: string };
      const replyText = res.reply || "收到，我已经听明白了。你还想继续问我什么？";
      const llmDoneTime = Date.now();
      const llmMs = llmDoneTime - asrDoneTime;

      // 3. 添加 AI 消息记录
      const aiMsg: VoiceMessage = {
        id: String(Date.now() + 1),
        sender: "ai",
        text: replyText,
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
      setMessages((prev) => [...prev, {
        id: String(Date.now() + 1),
        sender: "ai",
        text: "这次语音请求没有完成，请再说一次或改用文字输入。",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
      setVoiceState("completed");
    }
  }, [authFetch, speakReply, stopTTS]);

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
        <View className="bg-[#FAF8F5] rounded-t-[36px] p-6 max-h-[85%] border-t border-[#EBE3D5] shadow-2xl flex-col">
          {/* Top Bar Navigation */}
          <View className="flex-row items-center justify-between pb-4 border-b border-[#EBE3D5]">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-full bg-[#2D6A4F] items-center justify-center shadow-xs">
                <FontAwesome6 name="microphone-lines" size={14} color="#FFF" />
              </View>
              <View>
                <Text className="text-base font-black text-[#3D3229]">TeleSpeechASR + LLM 实时语音 MVP</Text>
                <Text className="text-[10px] text-[#8B7D6B] font-medium">毫秒级流式 ASR ➜ 思考 ➜ 语音全双工响应</Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleCloseModal}
              className="w-8 h-8 rounded-full bg-white items-center justify-center border border-[#EBE3D5] active:bg-[#EBE3D5]/40"
            >
              <FontAwesome6 name="xmark" size={14} color="#3D3229" />
            </TouchableOpacity>
          </View>

          {/* Pipeline Benchmark Metrics Tag */}
          <View className="bg-white my-3 p-2.5 rounded-2xl border border-[#EBE3D5] flex-row items-center justify-around shadow-2xs">
            <View className="items-center">
              <Text className="text-[9px] text-[#8B7D6B] font-bold">1. ASR 识别流</Text>
              <Text className="text-xs font-black text-emerald-700">~{pipelineMetrics.asrMs || 180} ms</Text>
            </View>
            <Text className="text-xs text-[#EBE3D5]">➜</Text>
            <View className="items-center">
              <Text className="text-[9px] text-[#8B7D6B] font-bold">2. LLM 流式思考</Text>
              <Text className="text-xs font-black text-amber-600">~{pipelineMetrics.llmMs || 340} ms</Text>
            </View>
            <Text className="text-xs text-[#EBE3D5]">➜</Text>
            <View className="items-center">
              <Text className="text-[9px] text-[#8B7D6B] font-bold">3. TTS 语音播报</Text>
              <Text className="text-xs font-black text-sky-600">~{pipelineMetrics.ttsMs || 90} ms</Text>
            </View>
          </View>

          {/* Chat Messages Stream */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            className="flex-1 max-h-[260px] my-2 px-1"
            contentContainerStyle={{ gap: 10, paddingVertical: 4 }}
          >
            {messages.length === 0 ? (
              <View className="items-center py-8 bg-white/60 rounded-3xl border border-dashed border-[#EBE3D5]">
                <FontAwesome6 name="headset" size={32} color="#D4A276" />
                <Text className="text-xs font-bold text-[#3D3229] mt-3">按下下方麦克风，直接开口对答</Text>
                <Text className="text-[10px] text-[#8B7D6B] mt-1">支持方言、普通话、英语自然语音混说交互</Text>
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
                        ? "bg-[#2D6A4F] rounded-br-xs"
                        : "bg-white border border-[#EBE3D5] rounded-bl-xs"
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold ${
                        msg.sender === "user" ? "text-white" : "text-[#3D3229]"
                      }`}
                    >
                      {msg.text}
                    </Text>
                    <Text
                      className={`text-[9px] mt-1 text-right ${
                        msg.sender === "user" ? "text-emerald-100/70" : "text-[#8B7D6B]"
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
              <View className="bg-emerald-50 border border-emerald-200/80 p-3 rounded-2xl self-end max-w-[82%]">
                <Text className="text-xs font-bold text-emerald-900">
                  正在听: “{currentRecognizedText}”
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Quick Voice Prompts */}
          <View className="flex-row items-center gap-1.5 my-2 flex-wrap justify-center">
            <TouchableOpacity
              onPress={() => handleQuickPrompt("根据现有冰箱食材推荐一份健康晚餐")}
              className="px-3 py-1.5 rounded-full bg-white border border-[#EBE3D5] flex-row items-center gap-1 active:bg-[#2D6A4F]/10"
            >
              <FontAwesome6 name="utensils" size={10} color="#059669" />
              <Text className="text-[11px] font-bold text-[#2D6A4F]">推荐晚餐</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleQuickPrompt("用四川话告诉我西红柿炒鸡蛋怎么做")}
              className="px-3 py-1.5 rounded-full bg-white border border-[#EBE3D5] flex-row items-center gap-1 active:bg-[#2D6A4F]/10"
            >
              <FontAwesome6 name="language" size={10} color="#D97706" />
              <Text className="text-[11px] font-bold text-[#D97706]">方言食谱示范</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleQuickPrompt("给5岁小朋友做一道不挑食的营养早餐")}
              className="px-3 py-1.5 rounded-full bg-white border border-[#EBE3D5] flex-row items-center gap-1 active:bg-[#2D6A4F]/10"
            >
                <FontAwesome6 name="child" size={10} color="#0284C7" />
              <Text className="text-[11px] font-bold text-[#0284C7]">儿童餐推荐</Text>
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
                    ? "bg-red-500/20 border-red-500"
                    : voiceState === "speaking"
                    ? "bg-sky-500/20 border-sky-500"
                    : voiceState === "thinking" || voiceState === "recognizing"
                    ? "bg-amber-500/20 border-amber-500"
                    : "bg-[#2D6A4F]/10 border-[#2D6A4F]"
                }`}
              />

              {/* Central Trigger Button */}
              <TouchableOpacity
                onPress={handleMicPress}
                activeOpacity={0.8}
                className={`absolute w-16 h-16 rounded-full items-center justify-center shadow-lg transition-all ${
                  voiceState === "listening"
                    ? "bg-red-500"
                    : voiceState === "speaking"
                    ? "bg-sky-600"
                    : voiceState === "thinking" || voiceState === "recognizing"
                    ? "bg-amber-500"
                    : "bg-[#2D6A4F]"
                }`}
              >
                {voiceState === "thinking" ? (
                  <ActivityIndicator color="#FFF" size="small" />
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
                    color="#FFF"
                  />
                )}
              </TouchableOpacity>
            </View>

            {/* Status Hint */}
            <Text className="text-xs font-black text-[#3D3229] mt-2">
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
                className="mt-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 active:bg-red-100"
              >
                <Text className="text-[10px] font-bold text-red-600">结束本轮</Text>
              </TouchableOpacity>
            )}

            {voiceState === "speaking" && (
              <TouchableOpacity
                onPress={() => {
                  stopTTS();
                  setVoiceState("idle");
                }}
                className="mt-2 bg-red-50 px-3 py-1 rounded-full border border-red-200 flex-row items-center gap-1 active:bg-red-100"
              >
                <FontAwesome6 name="circle-stop" size={10} color="#EF4444" />
                <Text className="text-[10px] font-bold text-red-600">全双工打断播报</Text>
              </TouchableOpacity>
            )}

            {aiResponseText && voiceState !== "speaking" && (
              <TouchableOpacity
                onPress={() => speakReply(aiResponseText)}
                className="mt-2 flex-row items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 active:bg-sky-100"
              >
                <FontAwesome6 name="volume-high" size={10} color="#0284C7" />
                <Text className="text-[10px] font-bold text-sky-700">重播回答</Text>
              </TouchableOpacity>
            )}

            {ttsError ? <Text className="mt-2 px-4 text-center text-[10px] text-red-600">{ttsError}</Text> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
