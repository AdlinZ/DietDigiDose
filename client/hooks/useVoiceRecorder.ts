import { useState, useCallback, useRef } from "react";
import { Alert, Linking, Platform } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi, waitForAgentRun } from "@/services/api";

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
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);

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

  const transcribeNativeRecording = useCallback(async (recording: Audio.Recording) => {
    setIsTranscribing(true);
    setStatusText("正在识别语音...");
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error("录音文件不可用");
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
      const response = await aiApi.transcribe<{
        text?: string;
        run: { id: string; status: string; transcript?: string; error?: { message?: string } };
      }>(authFetch, base64, "audio/m4a");
      const run = await waitForAgentRun(authFetch, response.run);
      const transcript = (response.text || run.transcript || "").trim();
      if (transcript) {
        transcriptRef.current = transcript;
        onSpeechResult?.(transcript);
      }
      if (!emitFinalTranscript(transcript)) emitEmptySpeech();
    } catch (error) {
      console.error("[Native Transcribe Error]", error);
      emitEmptySpeech();
    } finally {
      nativeRecordingRef.current = null;
      setIsTranscribing(false);
      setIsRecording(false);
      setStatusText("");
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
    }
  }, [authFetch, emitEmptySpeech, emitFinalTranscript, onSpeechResult]);

  const stopRecording = useCallback(() => {
    if (nativeRecordingRef.current) {
      const recording = nativeRecordingRef.current;
      nativeRecordingRef.current = null;
      void transcribeNativeRecording(recording);
      return;
    }
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
  }, [transcribeNativeRecording]);

  const startRecording = useCallback(async () => {
    setStatusText("正在倾听，请说话...");
    setIsRecording(true);
    transcriptRef.current = "";
    submittedRef.current = false;
    emptyNotifiedRef.current = false;

    if (Platform.OS !== "web") {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          setIsRecording(false);
          setStatusText("");
          Alert.alert(
            "需要麦克风权限",
            permission.canAskAgain
              ? "请允许食光烙记使用麦克风后再试。"
              : "麦克风权限已被关闭，请前往系统设置为食光烙记开启权限。",
            permission.canAskAgain
              ? [{ text: "知道了" }]
              : [{ text: "取消", style: "cancel" }, { text: "打开设置", onPress: () => void Linking.openSettings() }],
          );
          return;
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });
        const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        nativeRecordingRef.current = recording;
        return;
      } catch (error) {
        console.error("[Native Recording Start Error]", error);
        setIsRecording(false);
        setStatusText("");
        Alert.alert("无法开始录音", "请检查麦克风权限后重试。");
        return;
      }
    }

    // 所有转录统一通过后端 VoiceAgent，避免浏览器 ASR 绕开 Agent Run 与审计。
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
              const res = await aiApi.transcribe<{ text?: string; run: { id: string; status: string; transcript?: string; error?: { message?: string } } }>(authFetch, base64data, "audio/webm");
              const run = await waitForAgentRun(authFetch, res.run);
              const transcript = res.text || run.transcript || "";
              if (transcript && onSpeechResult) {
                transcriptRef.current = transcript;
                onSpeechResult(transcript);
              }
              if (!emitFinalTranscript(transcript)) emitEmptySpeech();
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
      Alert.alert("暂不支持录音", "当前浏览器不支持麦克风录音，请改用文字输入。");
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
