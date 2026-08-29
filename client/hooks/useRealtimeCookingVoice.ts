import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Crypto from "expo-crypto";
import { Audio } from "expo-av";
import { useAudioRecorder, type AudioDataEvent, type AudioAnalysis } from "@siteed/audio-studio";
import { Base64 } from "js-base64";

import { useAuthFetch } from "@/contexts/AuthContext";
import { aiApi, realtimeVoiceApi, waitForAgentRun, type RealtimeVoiceSession } from "@/services/api";

type Options = {
  recipeId: number;
  currentStep: number;
  timerSeconds: number;
  timerRunning: boolean;
  recipeSteps: string[];
  recipeIngredients: string[];
  onTranscript: (text: string, final: boolean) => void;
  onBargeIn: () => void;
  onControl: (action: string, seconds: number) => void;
  onAnswerDelta: (text: string) => void;
  onAnswer: (text: string) => void;
  onConfirmationRequired: (message: string) => void;
  onError: (message: string) => void;
};

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onspeechstart: (() => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionConstructor() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

function pcm16WavBase64(chunks: string[], sampleRate = 16_000) {
  const parts = chunks.map((chunk) => Base64.toUint8Array(chunk));
  const pcmLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(44 + pcmLength);
  const view = new DataView(output.buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + pcmLength, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, pcmLength, true);
  let offset = 44;
  for (const part of parts) { output.set(part, offset); offset += part.byteLength; }
  return Base64.fromUint8Array(output);
}

export function useRealtimeCookingVoice(options: Options) {
  const authFetch = useAuthFetch();
  const {
    startRecording: startNativeRecording,
    stopRecording: stopNativeRecording,
    pauseRecording: pauseNativeRecording,
    resumeRecording: resumeNativeRecording,
  } = useAudioRecorder();
  const optionsRef = useRef(options);
  const recognitionRef = useRef<Recognition | null>(null);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const activeRef = useRef(false);
  const responseGeneration = useRef(0);
  const interruptedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nativeChunksRef = useRef<string[]>([]);
  const nativePreRollRef = useRef<string[]>([]);
  const nativeSpeakingRef = useRef(false);
  const nativeSpeechStartedAtRef = useRef(0);
  const nativeSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeTranscribingRef = useRef(false);
  const nativeTurnIdRef = useRef("");
  const nativeSequenceRef = useRef(0);
  const nativePartialSentLengthRef = useRef(0);
  const nativePartialInFlightRef = useRef(false);
  const mutedRef = useRef(false);
  const [session, setSession] = useState<RealtimeVoiceSession | null>(null);
  const [state, setState] = useState<"off" | "connecting" | "listening" | "processing" | "reconnecting" | "muted" | "fallback">("off");
  const stateRef = useRef(state);
  const supported = Boolean(recognitionConstructor()) || Platform.OS === "android" || Platform.OS === "ios";

  useEffect(() => { optionsRef.current = options; }, [options]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const pollAnswer = useCallback(async (sessionId: string, turnId: string, generation: number) => {
    let after = 0;
    let combined = "";
    const deadline = Date.now() + 120_000;
    while (activeRef.current && responseGeneration.current === generation && Date.now() < deadline) {
      const page = await realtimeVoiceApi.events(authFetch, sessionId, after);
      for (const event of page.events) {
        after = Math.max(after, event.sequence);
        if (event.payload.turnId !== turnId) continue;
        if (event.type === "response.text.delta") {
          combined += String(event.payload.delta || "");
          optionsRef.current.onAnswerDelta(combined);
        }
        if (event.type === "response.completed") {
          const answer = String(event.payload.text || combined);
          optionsRef.current.onAnswer(answer);
          setState("listening");
          return;
        }
        if (event.type === "response.failed") throw new Error("实时回答失败");
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }, [authFetch]);

  const submitTurn = useCallback(async (transcript: string) => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;
    setState("processing");
    const generation = responseGeneration.current + 1;
    responseGeneration.current = generation;
    try {
      const result = await realtimeVoiceApi.turn(authFetch, currentSession.id, {
        turnId: Crypto.randomUUID(), transcript,
        currentStep: optionsRef.current.currentStep,
        timerSeconds: optionsRef.current.timerSeconds,
        timerRunning: optionsRef.current.timerRunning,
        interruptedResponse: interruptedRef.current,
      });
      interruptedRef.current = false;
      if (result.intent === "control") {
        optionsRef.current.onControl(String(result.action?.action || ""), Number(result.action?.seconds || 0));
        setState("listening");
      } else if (result.intent === "confirmation_required") {
        optionsRef.current.onConfirmationRequired(String(result.action?.message || "该操作需要在屏幕上确认"));
        setState("listening");
      } else {
        await pollAnswer(currentSession.id, result.turnId, generation);
      }
    } catch (error) {
      optionsRef.current.onError(error instanceof Error ? error.message : "实时语音处理失败");
      setState(activeRef.current ? "listening" : "fallback");
    }
  }, [authFetch, pollAnswer]);

  const flushNativeUtterance = useCallback(async () => {
    if (nativeTranscribingRef.current || !nativeChunksRef.current.length) return;
    const chunks = nativeChunksRef.current.splice(0);
    const turnId = nativeTurnIdRef.current || Crypto.randomUUID();
    const sequence = nativeSequenceRef.current + 1;
    const currentSession = sessionRef.current;
    nativeTurnIdRef.current = "";
    nativeSequenceRef.current = sequence;
    nativeSpeakingRef.current = false;
    if (!currentSession || !activeRef.current || Date.now() - nativeSpeechStartedAtRef.current < 250 || chunks.length < 2) return;
    nativeTranscribingRef.current = true;
    setState("processing");
    try {
      let transcript = "";
      try {
        const partial = await realtimeVoiceApi.audioChunk(authFetch, currentSession.id, {
          turnId, sequence, audioBase64: pcm16WavBase64(chunks), mimeType: "audio/wav", final: true,
        });
        transcript = partial.transcript.trim();
      } catch {
        const result = await aiApi.transcribe<{
          transcript?: string;
          text?: string;
          run: { id: string; status: string; transcript?: string; error?: { message?: string } };
        }>(authFetch, pcm16WavBase64(chunks), "audio/wav");
        const completed = await waitForAgentRun(authFetch, result.run);
        transcript = String(result.transcript || result.text || completed.transcript || "").trim();
      }
      if (!transcript) throw new Error("没有识别到清晰语音");
      if (!activeRef.current) return;
      optionsRef.current.onTranscript(transcript, true);
      await submitTurn(transcript);
    } catch (error) {
      optionsRef.current.onError(error instanceof Error ? error.message : "连续语音转写失败");
      if (activeRef.current) setState("listening");
    } finally {
      nativeTranscribingRef.current = false;
    }
  }, [authFetch, submitTurn]);

  const handleNativeAudio = useCallback(async (event: AudioDataEvent) => {
    if (!activeRef.current || typeof event.data !== "string") return;
    nativePreRollRef.current.push(event.data);
    nativePreRollRef.current = nativePreRollRef.current.slice(-3);
    if (nativeSpeakingRef.current) {
      nativeChunksRef.current.push(event.data);
      const shouldSendPartial = nativeChunksRef.current.length - nativePartialSentLengthRef.current >= 10;
      const currentSession = sessionRef.current;
      if (shouldSendPartial && currentSession && !nativePartialInFlightRef.current && nativeTurnIdRef.current) {
        const chunks = [...nativeChunksRef.current];
        const turnId = nativeTurnIdRef.current;
        const sequence = nativeSequenceRef.current + 1;
        nativeSequenceRef.current = sequence;
        nativePartialSentLengthRef.current = chunks.length;
        nativePartialInFlightRef.current = true;
        void realtimeVoiceApi.audioChunk(authFetch, currentSession.id, {
          turnId, sequence, audioBase64: pcm16WavBase64(chunks), mimeType: "audio/wav", final: false,
        }).then((result) => {
          if (turnId === nativeTurnIdRef.current && result.transcript.trim()) {
            optionsRef.current.onTranscript(result.transcript.trim(), false);
          }
        }).catch(() => undefined).finally(() => { nativePartialInFlightRef.current = false; });
      }
    }
    if (nativeChunksRef.current.length > 160) void flushNativeUtterance();
  }, [authFetch, flushNativeUtterance]);

  const handleNativeAnalysis = useCallback(async (event: AudioAnalysis) => {
    if (!activeRef.current) return;
    const speaking = event.dataPoints.some((point) => !point.silent && point.rms >= 0.018);
    if (speaking) {
      if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
      nativeSilenceTimerRef.current = null;
      if (!nativeSpeakingRef.current) {
        nativeSpeakingRef.current = true;
        nativeSpeechStartedAtRef.current = Date.now();
        nativeChunksRef.current = [...nativePreRollRef.current];
        nativeTurnIdRef.current = Crypto.randomUUID();
        nativeSequenceRef.current = 0;
        nativePartialSentLengthRef.current = 0;
        if (stateRef.current === "processing") {
          interruptedRef.current = true;
          responseGeneration.current += 1;
          optionsRef.current.onBargeIn();
        }
      }
      setState("listening");
      return;
    }
    if (nativeSpeakingRef.current && !nativeSilenceTimerRef.current) {
      nativeSilenceTimerRef.current = setTimeout(() => {
        nativeSilenceTimerRef.current = null;
        void flushNativeUtterance();
      }, 650);
    }
  }, [flushNativeUtterance]);

  const stop = useCallback(async () => {
    activeRef.current = false;
    mutedRef.current = false;
    responseGeneration.current += 1;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
    if (nativeSilenceTimerRef.current) clearTimeout(nativeSilenceTimerRef.current);
    nativeSilenceTimerRef.current = null;
    nativeSpeakingRef.current = false;
    nativeChunksRef.current = [];
    nativePreRollRef.current = [];
    nativeTurnIdRef.current = "";
    nativeSequenceRef.current = 0;
    nativePartialSentLengthRef.current = 0;
    nativePartialInFlightRef.current = false;
    if (Platform.OS !== "web") await stopNativeRecording().catch(() => undefined);
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setState("off");
    if (current) await realtimeVoiceApi.close(authFetch, current.id).catch(() => undefined);
  }, [authFetch, stopNativeRecording]);

  const toggleMute = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !activeRef.current) return false;
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    if (Platform.OS === "web") {
      if (nextMuted) {
        try { recognitionRef.current?.abort(); } catch {}
      } else {
        try { recognitionRef.current?.start(); } catch { setState("reconnecting"); }
      }
    } else if (nextMuted) await pauseNativeRecording();
    else await resumeNativeRecording();
    const result = await realtimeVoiceApi.heartbeat(authFetch, current.id, { version: current.version, muted: nextMuted, reconnect: false });
    sessionRef.current = result.session;
    setSession(result.session);
    setState(nextMuted ? "muted" : "listening");
    return nextMuted;
  }, [authFetch, pauseNativeRecording, resumeNativeRecording]);

  const start = useCallback(async () => {
    const RecognitionConstructor = recognitionConstructor();
    const native = Platform.OS === "android" || Platform.OS === "ios";
    if ((!RecognitionConstructor && !native) || !Number.isInteger(optionsRef.current.recipeId) || optionsRef.current.recipeId <= 0) {
      setState("fallback");
      return false;
    }
    setState("connecting");
    try {
      const created = await realtimeVoiceApi.create(authFetch, {
        recipeId: optionsRef.current.recipeId,
        platform: Platform.OS,
        idempotencyKey: `realtime-cooking-${optionsRef.current.recipeId}-${Date.now()}`,
        currentStep: optionsRef.current.currentStep,
        recipeSteps: optionsRef.current.recipeSteps,
        recipeIngredients: optionsRef.current.recipeIngredients,
      });
      sessionRef.current = created.session;
      setSession(created.session);
      activeRef.current = true;
      if (RecognitionConstructor) {
        const recognition = new RecognitionConstructor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "zh-CN";
        recognition.onstart = () => setState("listening");
        recognition.onspeechstart = () => {
          if (stateRef.current === "processing") {
            interruptedRef.current = true;
            responseGeneration.current += 1;
            optionsRef.current.onBargeIn();
          }
        };
        recognition.onresult = (event: any) => {
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = String(result[0]?.transcript || "").trim();
            if (!text) continue;
            optionsRef.current.onTranscript(text, Boolean(result.isFinal));
            if (result.isFinal) void submitTurn(text);
            else interim += text;
          }
          if (interim) optionsRef.current.onTranscript(interim, false);
        };
        recognition.onerror = () => setState("reconnecting");
        recognition.onend = () => {
          if (!activeRef.current || mutedRef.current) return;
          setState("reconnecting");
          setTimeout(() => {
            if (!activeRef.current) return;
            try { recognition.start(); } catch { setState("fallback"); }
          }, 300);
        };
        recognitionRef.current = recognition;
        recognition.start();
      } else {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) throw new Error("未获得麦克风权限，已保留文字和按轮录音");
        await startNativeRecording({
          sampleRate: 16_000, channels: 1, encoding: "pcm_16bit", interval: 100,
          enableProcessing: true, keepFullAnalysis: false, intervalAnalysis: 100,
          segmentDurationMs: 100, features: { rms: true }, output: { primary: { enabled: false } },
          android: { audioFocusStrategy: "communication" }, autoResumeAfterInterruption: false,
          onAudioStream: handleNativeAudio, onAudioAnalysis: handleNativeAnalysis,
          onRecordingInterrupted: () => {
            if (activeRef.current) {
              setState("fallback");
              optionsRef.current.onError("录音被系统中断，已停止持续监听");
            }
          },
        });
        setState("listening");
      }
      heartbeatRef.current = setInterval(() => {
        const activeSession = sessionRef.current;
        if (!activeSession) return;
        void realtimeVoiceApi.heartbeat(authFetch, activeSession.id, { version: activeSession.version, reconnect: false })
          .then(({ session: latest }) => { sessionRef.current = latest; setSession(latest); })
          .catch(() => setState("reconnecting"));
      }, 20_000);
      return true;
    } catch (error) {
      setState("fallback");
      optionsRef.current.onError(error instanceof Error ? error.message : "实时通道不可用，已切换按轮录音");
      return false;
    }
  }, [authFetch, handleNativeAnalysis, handleNativeAudio, startNativeRecording, submitTurn]);

  useEffect(() => () => { void stop(); }, [stop]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active" && activeRef.current) void stop();
    });
    return () => subscription.remove();
  }, [stop]);

  return { supported, session, state, active: !["off", "fallback"].includes(state), muted: state === "muted", start, stop, toggleMute };
}
