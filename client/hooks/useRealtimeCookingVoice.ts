import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";

import { useAuthFetch } from "@/contexts/AuthContext";
import { realtimeVoiceApi, type RealtimeVoiceSession } from "@/services/api";

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

export function useRealtimeCookingVoice(options: Options) {
  const authFetch = useAuthFetch();
  const optionsRef = useRef(options);
  const recognitionRef = useRef<Recognition | null>(null);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const activeRef = useRef(false);
  const responseGeneration = useRef(0);
  const interruptedRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [session, setSession] = useState<RealtimeVoiceSession | null>(null);
  const [state, setState] = useState<"off" | "connecting" | "listening" | "processing" | "reconnecting" | "fallback">("off");
  const stateRef = useRef(state);
  const supported = Boolean(recognitionConstructor());

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

  const stop = useCallback(async () => {
    activeRef.current = false;
    responseGeneration.current += 1;
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = null;
    try { recognitionRef.current?.abort(); } catch {}
    recognitionRef.current = null;
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    setState("off");
    if (current) await realtimeVoiceApi.close(authFetch, current.id).catch(() => undefined);
  }, [authFetch]);

  const start = useCallback(async () => {
    const RecognitionConstructor = recognitionConstructor();
    if (!RecognitionConstructor || !Number.isInteger(optionsRef.current.recipeId) || optionsRef.current.recipeId <= 0) {
      setState("fallback");
      return false;
    }
    setState("connecting");
    try {
      const created = await realtimeVoiceApi.create(authFetch, {
        recipeId: optionsRef.current.recipeId,
        platform: "web",
        idempotencyKey: `realtime-cooking-${optionsRef.current.recipeId}-${Date.now()}`,
        currentStep: optionsRef.current.currentStep,
        recipeSteps: optionsRef.current.recipeSteps,
        recipeIngredients: optionsRef.current.recipeIngredients,
      });
      sessionRef.current = created.session;
      setSession(created.session);
      activeRef.current = true;
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
        if (!activeRef.current) return;
        setState("reconnecting");
        setTimeout(() => {
          if (!activeRef.current) return;
          try { recognition.start(); } catch { setState("fallback"); }
        }, 300);
      };
      recognitionRef.current = recognition;
      recognition.start();
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
  }, [authFetch, submitTurn]);

  useEffect(() => () => { void stop(); }, [stop]);

  return { supported, session, state, active: !["off", "fallback"].includes(state), start, stop };
}
