import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi, waitForAgentRun } from "@/services/api";

interface UseVoiceWakeWordOptions {
  onWakeWordDetected?: (transcript: string) => void;
  onSpeechRecognized?: (text: string) => void;
  wakeWords?: string[];
}

export function useVoiceWakeWord({
  onWakeWordDetected,
}: UseVoiceWakeWordOptions = {}) {
  const authFetch = useAuthFetch();
  const [isWakeEnabled, setIsWakeEnabledState] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isWoken, setIsWoken] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [statusText, setStatusText] = useState("做饭免手扶唤醒模式未开启");

  const recognitionRef = useRef<any>(null);
  const wokenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeEnabledRef = useRef(false);

  // 连续浏览器 ASR 会绕开 VoiceAgent。全量 Agent 模式下保留点击录音，
  // 音频统一交给服务端转录；待支持流式 Agent ASR 后再恢复免手扶唤醒。
  const isWebSpeechSupported = false;

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
      setIsListening(false);
      setTranscript("");
      setStatusText("全量 Agent 模式：请点击语音按钮，录音将由 VoiceAgent 识别");
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

  useEffect(() => () => {
    wakeEnabledRef.current = false;
    if (wokenTimerRef.current) clearTimeout(wokenTimerRef.current);
  }, []);

  // 手动模拟录音/语音提交（发送给后端 API /transcribe）
  const transcribeAudioFile = useCallback(async (audioBase64: string, mimeType = "audio/m4a") => {
    try {
      const data = await aiApi.transcribe<{ text?: string; run: { id: string; status: string; transcript?: string; error?: { message?: string } } }>(authFetch, audioBase64, mimeType);
      const run = await waitForAgentRun(authFetch, data.run);
      return data.text || run.transcript || "";
    } catch (e) {
      console.error("[transcribeAudioFile Error]", e);
    }
    return "";
  }, [authFetch]);

  return {
    isWakeEnabled,
    setIsWakeEnabled,
    isListening,
    isWoken,
    transcript,
    statusText,
    transcribeAudioFile,
    playWakeSound,
    triggerWakeUp,
  };
}
