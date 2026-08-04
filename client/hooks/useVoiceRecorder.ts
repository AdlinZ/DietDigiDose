import { useState, useCallback, useRef } from "react";
import { Platform } from "react-native";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi } from "@/services/api";

interface VoiceRecorderOptions {
  /** 识别中的临时文本，用于更新 UI。 */
  onSpeechResult?: (text: string) => void;
  /** 一轮录音完成后的最终文本。无论自动停顿或手动结束，都只触发一次。 */
  onSpeechFinal?: (text: string) => void;
  /** 本轮结束但未能识别出有效语音。 */
  onSpeechEmpty?: () => void;
}

export function useVoiceRecorder({ onSpeechResult, onSpeechFinal, onSpeechEmpty }: VoiceRecorderOptions = {}) {
  const authFetch = useAuthFetch();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const mediaRecorderRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const webRecognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const submittedRef = useRef(false);
  const emptyNotifiedRef = useRef(false);
  const cleanupAudioRef = useRef<(() => void) | null>(null);

  const emitFinalTranscript = useCallback((text?: string) => {
    const transcript = (text ?? transcriptRef.current).trim();
    if (!transcript || submittedRef.current) return false;
    submittedRef.current = true;
    onSpeechFinal?.(transcript);
    return true;
  }, [onSpeechFinal]);

  const emitEmptySpeech = useCallback(() => {
    if (submittedRef.current || emptyNotifiedRef.current) return;
    emptyNotifiedRef.current = true;
    onSpeechEmpty?.();
  }, [onSpeechEmpty]);

  const stopRecording = useCallback(() => {
    if (webRecognitionRef.current) {
      try {
        webRecognitionRef.current.stop();
      } catch {}
      webRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
      mediaRecorderRef.current = null;
    }
    cleanupAudioRef.current?.();
    cleanupAudioRef.current = null;
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setStatusText("正在倾听，请说话...");
    setIsRecording(true);
    transcriptRef.current = "";
    submittedRef.current = false;
    emptyNotifiedRef.current = false;

    // 1. 优先尝试 Web Speech Recognition API (原生的流式实时文字识别)
    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    ) {
      try {
        const SpeechRecognition =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = "zh-CN";

        recognition.onresult = (event: any) => {
          let finalTranscript = "";
          let interimTranscript = "";

          for (let i = 0; i < event.results.length; ++i) {
            const res = event.results[i];
            const transcriptText = res[0]?.transcript || "";
            if (res.isFinal) {
              finalTranscript += transcriptText;
            } else {
              interimTranscript += transcriptText;
            }
          }

          const currentText = (finalTranscript + interimTranscript).trim();
          if (currentText) {
            transcriptRef.current = currentText;
            onSpeechResult?.(currentText);
          }
        };

        recognition.onerror = (err: any) => {
          if (err.error !== "no-speech") {
            console.warn("[WebSpeech Error]", err);
          }
          setIsRecording(false);
          setStatusText("");
        };

        recognition.onend = () => {
          setIsRecording(false);
          setStatusText("");
          // Web Speech 在用户停顿后会触发 onend；这就是本 MVP 的自动结束回合。
          if (!emitFinalTranscript()) emitEmptySpeech();
        };

        recognition.start();
        webRecognitionRef.current = recognition;
        return;
      } catch (e) {
        console.warn("[WebSpeech Start Error]", e);
      }
    }

    // 2. 次选：使用 MediaRecorder 录音并通过后端 /api/v1/ai/transcribe (SenseVoice / Whisper) 转译
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.mediaDevices?.getUserMedia
    ) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        mediaRecorder.onstop = async () => {
          cleanupAudioRef.current?.();
          cleanupAudioRef.current = null;
          const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          setIsTranscribing(true);
          setStatusText("正在调用 ASR 大模型识别语音...");

          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64data = (reader.result as string) || "";
            try {
              const res = await aiApi.transcribe<{ text?: string }>(authFetch, base64data, "audio/webm");
              if (res.text && onSpeechResult) {
                transcriptRef.current = res.text;
                onSpeechResult(res.text);
              }
              if (!emitFinalTranscript(res.text)) emitEmptySpeech();
            } catch (err) {
              console.error("[Transcribe Error]", err);
              emitEmptySpeech();
            } finally {
              setIsTranscribing(false);
              setIsRecording(false);
              setStatusText("");
            }
          };
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;

        // 没有 Web Speech API 时，用输入音量检测停顿：检测到说话后静默 1.2 秒自动提交。
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let animationFrame = 0;
        let heardVoice = false;
        let lastVoiceAt = Date.now();
        const watchSilence = () => {
          analyser.getByteTimeDomainData(samples);
          const amplitude = samples.reduce((total, value) => total + Math.abs(value - 128), 0) / samples.length;
          if (amplitude > 3) {
            heardVoice = true;
            lastVoiceAt = Date.now();
          }
          if (heardVoice && Date.now() - lastVoiceAt >= 1200 && mediaRecorder.state !== "inactive") {
            setStatusText("检测到停顿，正在结束本轮...");
            mediaRecorder.stop();
            return;
          }
          animationFrame = requestAnimationFrame(watchSilence);
        };
        animationFrame = requestAnimationFrame(watchSilence);
        cleanupAudioRef.current = () => {
          cancelAnimationFrame(animationFrame);
          stream.getTracks().forEach((track) => track.stop());
          void audioContext.close();
        };
      } catch (err) {
        console.error("[getUserMedia Error]", err);
        alert("无法获取麦克风权限，请在浏览器地址栏允许麦克风权限");
        setIsRecording(false);
        setStatusText("");
      }
    } else {
      alert("当前运行环境暂不支持麦克风录音");
      setIsRecording(false);
      setStatusText("");
    }
  }, [authFetch, emitEmptySpeech, emitFinalTranscript, onSpeechResult]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isTranscribing,
    statusText,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
