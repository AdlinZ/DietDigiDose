import { useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import * as Speech from "expo-speech";

/**
 * TTS（文字转语音）hook。
 * Web 端使用 window.speechSynthesis，原生端使用 expo-speech。
 * 支持全双工打断（调用 stop 后立即调用 speak）。
 */
export function useTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const ttsStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 停止所有正在进行的 TTS 播放
  const stop = useCallback(() => {
    try {
      if (ttsStartTimerRef.current) {
        clearTimeout(ttsStartTimerRef.current);
        ttsStartTimerRef.current = null;
      }
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }
      Speech.stop();
    } catch {
      // 忽略停止时的异常
    }
    setIsSpeaking(false);
  }, []);

  // 朗读一段文字
  const speak = useCallback(
    (text: string) => {
      const reply = text.trim();
      if (!reply) return;

      setError("");
      setIsSpeaking(true);

      // 先停止之前的播放
      try {
        if (ttsStartTimerRef.current) {
          clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
        }
        if (
          Platform.OS === "web" &&
          typeof window !== "undefined" &&
          "speechSynthesis" in window
        ) {
          window.speechSynthesis.cancel();
        }
        Speech.stop();
      } catch {
        // 忽略
      }

      // Web 端：使用浏览器原生 SpeechSynthesis（可选中文音色，回调可靠）
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
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
          if (ttsStartTimerRef.current)
            clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
        };

        utterance.onend = () => {
          if (ttsStartTimerRef.current)
            clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
          setIsSpeaking(false);
        };

        utterance.onerror = (event) => {
          if (ttsStartTimerRef.current)
            clearTimeout(ttsStartTimerRef.current);
          ttsStartTimerRef.current = null;
          // canceled / interrupted 是我们主动打断的，不算错误
          if (event.error !== "canceled" && event.error !== "interrupted") {
            setError(
              "自动朗读未能启动。请点击「重播回答」手动播放，并检查标签页和系统媒体音量。"
            );
          }
          setIsSpeaking(false);
        };

        window.speechSynthesis.speak(utterance);

        // 安全超时：如果 1.5s 后 speechSynthesis 仍未开始，提示用户
        ttsStartTimerRef.current = setTimeout(() => {
          if (!window.speechSynthesis.speaking) {
            setError(
              "自动朗读未能启动。请点击「重播回答」手动播放，并检查标签页和系统媒体音量。"
            );
            setIsSpeaking(false);
          }
          ttsStartTimerRef.current = null;
        }, 1500);
        return;
      }

      // 原生端：使用 expo-speech
      Speech.speak(reply, {
        language: "zh-CN",
        rate: 1.0,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => {
          setError(
            "语音播放未启动，请点「重播回答」或检查设备媒体音量。"
          );
          setIsSpeaking(false);
        },
      });
    },
    []
  );

  return {
    speak,
    stop,
    isSpeaking,
    error,
  } as const;
}
