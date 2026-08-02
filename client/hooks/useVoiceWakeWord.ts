import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || "http://localhost:9091";

interface UseVoiceWakeWordOptions {
  onWakeWordDetected?: (transcript: string) => void;
  onSpeechRecognized?: (text: string) => void;
  wakeWords?: string[];
}

export function useVoiceWakeWord({
  onWakeWordDetected,
  onSpeechRecognized,
  wakeWords = ["食语食语", "小食小食", "食语", "hey shiyu"],
}: UseVoiceWakeWordOptions = {}) {
  const [isWakeEnabled, setIsWakeEnabledState] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isWoken, setIsWoken] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [statusText, setStatusText] = useState("做饭免手扶唤醒模式未开启");

  const recognitionRef = useRef<any>(null);
  const wokenTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wakeEnabledRef = useRef(false);

  // 初始化检查语音识别兼容性 (Web)
  const isWebSpeechSupported =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  const setIsWakeEnabled = useCallback((enabled: boolean) => {
    wakeEnabledRef.current = enabled;
    setIsWakeEnabledState(enabled);

    if (!enabled) {
      setIsListening(false);
      setIsWoken(false);
      setStatusText("做饭免手扶唤醒模式未开启");
      stopRecognition();
    } else if (!isWebSpeechSupported) {
      setStatusText("当前环境支持点击语音输入按钮呼叫食语");
    }
  }, [isWebSpeechSupported, stopRecognition]);

  // 播放内置唤醒音效 (Web / App)
  const playWakeSound = useCallback(() => {
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
          osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.2);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const triggerWakeUp = useCallback((capturedText: string) => {
    playWakeSound();
    setIsWoken(true);
    setStatusText("【食语食语】唤醒成功！正在听您指示...");

    if (wokenTimerRef.current) clearTimeout(wokenTimerRef.current);
    wokenTimerRef.current = setTimeout(() => {
      setIsWoken(false);
      setStatusText("正在持续监听唤醒词【食语食语】中...");
    }, 6000);

    if (onWakeWordDetected) {
      onWakeWordDetected(capturedText);
    }
  }, [playWakeSound, onWakeWordDetected]);

  // 开启 / 关闭 实时 Web Speech 唤醒引擎
  useEffect(() => {
    if (!isWakeEnabled) {
      return;
    }

    if (!isWebSpeechSupported) {
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let cancelled = false;

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "zh-CN";

      recognition.onstart = () => {
        setIsListening(true);
        setStatusText("正在持续监听【食语食语】做饭唤醒词...");
      };

      recognition.onresult = (event: any) => {
        let currentText = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          currentText += event.results[i][0].transcript;
        }

        const lower = currentText.toLowerCase().trim();
        setTranscript(lower);

        if (onSpeechRecognized) {
          onSpeechRecognized(lower);
        }

        const matchedWord = wakeWords.find((w) => lower.includes(w.toLowerCase()));
        if (matchedWord) {
          const commandText = lower.slice(lower.indexOf(matchedWord) + matchedWord.length).trim();
          triggerWakeUp(commandText || "在");
        }
      };

      recognition.onerror = (err: any) => {
        if (err.error !== "no-speech") {
          console.warn("[SpeechRecognition Error]", err);
        }
      };

      recognition.onend = () => {
        if (wakeEnabledRef.current) {
          try { recognition.start(); } catch {}
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (e) {
      console.warn("[VoiceWakeWord Setup Error]", e);
      queueMicrotask(() => {
        if (!cancelled) setStatusText("支持点击语音图标随时呼叫食语");
      });
    }

    return () => {
      cancelled = true;
      stopRecognition();
    };
  }, [isWakeEnabled, isWebSpeechSupported, wakeWords, triggerWakeUp, onSpeechRecognized, stopRecognition]);

  useEffect(() => () => {
    wakeEnabledRef.current = false;
    if (wokenTimerRef.current) clearTimeout(wokenTimerRef.current);
  }, []);

  // 手动模拟录音/语音提交（发送给后端 API /transcribe）
  const transcribeAudioFile = useCallback(async (audioBase64: string, mimeType = "audio/m4a") => {
    try {
      const token = await AsyncStorage.getItem("@auth_token");
      const res = await fetch(`${BACKEND_URL}/api/v1/ai/transcribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ audioBase64, mimeType }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.text || "";
      }
    } catch (e) {
      console.error("[transcribeAudioFile Error]", e);
    }
    return "";
  }, []);

  return {
    isWakeEnabled,
    setIsWakeEnabled,
    isListening,
    isWoken,
    transcript,
    statusText,
    transcribeAudioFile,
    playWakeSound,
  };
}
