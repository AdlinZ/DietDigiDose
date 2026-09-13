import React from "react";
import { AppState, Platform } from "react-native";
import renderer, { act } from "react-test-renderer";
import { Audio } from "expo-av";

import { realtimeVoiceApi, type RealtimeVoiceSession } from "@/services/api";
import { useRealtimeCookingVoice } from "./useRealtimeCookingVoice";

const mockStartNativeRecording = jest.fn();
const mockStopNativeRecording = jest.fn();
const mockPauseNativeRecording = jest.fn();
const mockResumeNativeRecording = jest.fn();
const mockAuthFetch = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({ useAuthFetch: () => mockAuthFetch }));
jest.mock("@siteed/audio-studio", () => ({
  useAudioRecorder: () => ({
    startRecording: mockStartNativeRecording,
    stopRecording: mockStopNativeRecording,
    pauseRecording: mockPauseNativeRecording,
    resumeRecording: mockResumeNativeRecording,
  }),
}));
jest.mock("expo-av", () => ({ Audio: { requestPermissionsAsync: jest.fn() } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
jest.mock("@/services/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, body?: { code?: string }) {
      super(message); this.status = status; this.code = body?.code;
    }
  }
  return {
    ApiError,
    aiApi: { transcribe: jest.fn() },
    waitForAgentRun: jest.fn(),
    realtimeVoiceApi: {
      create: jest.fn(), heartbeat: jest.fn(), events: jest.fn(), close: jest.fn(),
      audioChunk: jest.fn(), turn: jest.fn(),
    },
  };
});

const createdSession: RealtimeVoiceSession = {
  id: "00000000-0000-4000-8000-000000000002",
  recipeId: 42,
  status: "active",
  platform: "android",
  version: 1,
  connectedAt: "2026-09-06T00:00:00.000Z",
  expiresAt: "2026-09-06T02:00:00.000Z",
  metrics: { firstTranscriptMs: null, firstResponseMs: null, interruptions: 0, reconnects: 0, fallbacks: 0 },
};

const options = {
  recipeId: 42,
  currentStep: 0,
  timerSeconds: 0,
  timerRunning: false,
  recipeSteps: ["准备", "完成"],
  recipeIngredients: ["番茄 2个"],
  onTranscript: jest.fn(), onBargeIn: jest.fn(), onStopOutput: jest.fn(), onControl: jest.fn(),
  onAnswerDelta: jest.fn(), onAnswer: jest.fn(), onConfirmationRequired: jest.fn(), onError: jest.fn(),
};

describe("useRealtimeCookingVoice startup cleanup", () => {
  let voice!: ReturnType<typeof useRealtimeCookingVoice>;
  let tree!: renderer.ReactTestRenderer;

  function Harness({ onUpdate }: { onUpdate: (value: ReturnType<typeof useRealtimeCookingVoice>) => void }) {
    const value = useRealtimeCookingVoice(options);
    React.useEffect(() => onUpdate(value), [onUpdate, value]);
    return null;
  }

  beforeEach(async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    jest.clearAllMocks();
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    mockPauseNativeRecording.mockResolvedValue(undefined);
    mockResumeNativeRecording.mockResolvedValue(undefined);
    mockStartNativeRecording.mockResolvedValue(undefined);
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    jest.mocked(realtimeVoiceApi.heartbeat).mockImplementation(async (_fetch, _id, input) => ({ session: { ...createdSession, version: input.version + 1, status: input.muted ? "muted" : "active" } }));
    mockStopNativeRecording.mockResolvedValue(undefined);
    jest.mocked(realtimeVoiceApi.create).mockResolvedValue({ session: createdSession, repeated: false });
    jest.mocked(realtimeVoiceApi.close).mockResolvedValue({ session: { ...createdSession, status: "closed" } });
    await act(async () => {
      tree = renderer.create(<Harness onUpdate={(value) => { voice = value; }} />);
    });
  });

  afterEach(async () => {
    await act(async () => { tree.unmount(); });
  });

  it("closes the remote session and resets local state when microphone permission is denied", async () => {
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: false } as never);
    let started = true;

    await act(async () => { started = await voice.start(); });

    expect(started).toBe(false);
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(expect.any(Function), createdSession.id);
    expect(mockStopNativeRecording).toHaveBeenCalled();
    expect(voice.session).toBeNull();
    expect(voice.active).toBe(false);
    expect(voice.state).toBe("fallback");
  });

  it("closes a late created session without starting recording after stop", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.create>>) => void;
    jest.mocked(realtimeVoiceApi.create).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { expect(await voice.start()).toBe(false); await voice.stop(); });
    await act(async () => { resolve({ session: createdSession, repeated: false }); expect(await pending).toBe(false); });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(mockAuthFetch, createdSession.id);
    expect(voice.state).toBe("off");
  });

  it("does not start the microphone after delayed permission resolves on an exited page", async () => {
    let resolve!: (value: never) => void;
    jest.mocked(Audio.requestPermissionsAsync).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { await voice.stop(); });
    await act(async () => { resolve({ granted: true } as never); await pending; });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(voice.state).toBe("off");
  });

  it("stops a native recorder that finishes starting after the page exits", async () => {
    let recording = false;
    let release!: () => void;
    mockStartNativeRecording.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      recording = true;
    });
    mockStopNativeRecording.mockImplementation(async () => { recording = false; });
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); });
    await act(async () => { await voice.stop(); });
    await act(async () => { release(); expect(await pending).toBe(false); });
    expect(recording).toBe(false);
    expect(voice.state).toBe("off");
  });

  it("invalidates pending startup when the app backgrounds", async () => {
    let onChange!: (state: "background") => void;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
      onChange = listener;
      return { remove: jest.fn() };
    });
    await act(async () => { tree.unmount(); tree = renderer.create(<Harness onUpdate={value => { voice = value; }} />); });
    let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.create>>) => void;
    jest.mocked(realtimeVoiceApi.create).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.start(); onChange("background"); });
    await act(async () => { resolve({ session: createdSession, repeated: false }); await pending; });
    expect(mockStartNativeRecording).not.toHaveBeenCalled();
    expect(voice.state).toBe("off");
    spy.mockReturnValue({ remove: jest.fn() });
  });

  it("ignores recorder interruption callbacks from a closed session", async () => {
    await act(async () => { await voice.start(); });
    const oldRecorder = mockStartNativeRecording.mock.calls[0][0];
    await act(async () => { await voice.stop(); await voice.start(); });
    const stops = mockStopNativeRecording.mock.calls.length;
    await act(async () => { oldRecorder.onRecordingInterrupted(); });
    expect(mockStopNativeRecording).toHaveBeenCalledTimes(stops);
    expect(voice.state).toBe("listening");
  });

  it("stops capture when Web microphone permission is revoked", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    const recognizers: Array<{ onerror?: (event: { error: string }) => void }> = [];
    let recording = false;
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      constructor() { recognizers.push(this); }
      onerror?: (event: { error: string }) => void;
      start() { recording = true; }
      abort() { recording = false; }
    } });
    try {
      await act(async () => { await voice.start(); });
      await act(async () => { recognizers[0].onerror!({ error: "not-allowed" }); });
      expect(recording).toBe(false);
      expect(voice.state).toBe("off");
      expect(options.onStopOutput).toHaveBeenCalled();
    } finally { Reflect.deleteProperty(window, "SpeechRecognition"); }
  });

  it("closes the remote session and releases partial recording state when native startup fails", async () => {
    jest.mocked(Audio.requestPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mockStartNativeRecording.mockRejectedValue(new Error("native recorder failed"));
    let started = true;

    await act(async () => { started = await voice.start(); });

    expect(started).toBe(false);
    expect(realtimeVoiceApi.close).toHaveBeenCalledWith(expect.any(Function), createdSession.id);
    expect(mockStopNativeRecording).toHaveBeenCalled();
    expect(voice.session).toBeNull();
    expect(voice.state).toBe("fallback");
    expect(options.onError).toHaveBeenCalledWith("native recorder failed");
  });
  it("pauses the native microphone immediately even while the heartbeat hangs or fails", async () => {
    let recording = false;
    mockStartNativeRecording.mockImplementation(async () => { recording = true; });
    mockPauseNativeRecording.mockImplementation(async () => { recording = false; });
    await act(async () => { await voice.start(); });
    expect(recording).toBe(true);
    let reject!: (error: Error) => void;
    jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = voice.toggleMute(); });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
    expect(options.onStopOutput).toHaveBeenCalled();
    await act(async () => { reject(new Error("offline")); await pending; });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
  });

  it("coalesces rapid Web resume taps and never restarts after stop", async () => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
    let recording = false;
    const start = jest.fn(() => { if (recording) throw new Error("already started"); recording = true; });
    const abort = jest.fn(() => { recording = false; });
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: class {
      start = start;
      abort = abort;
    } });
    try {
      await act(async () => { await voice.start(); await voice.toggleMute(); });
      expect(recording).toBe(false);
      let resolve!: (value: Awaited<ReturnType<typeof realtimeVoiceApi.heartbeat>>) => void;
      jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      let first!: Promise<boolean>;
      await act(async () => { first = voice.toggleMute(); await voice.toggleMute(); });
      await act(async () => { resolve({ session: { ...createdSession, version: 3 } }); await first; });
      expect(recording).toBe(true);
      expect(voice.muted).toBe(false);
      expect(start).toHaveBeenCalledTimes(2);
      await act(async () => { await voice.toggleMute(); });
      jest.mocked(realtimeVoiceApi.heartbeat).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
      await act(async () => { first = voice.toggleMute(); });
      await act(async () => { await voice.stop(); });
      await act(async () => { resolve({ session: { ...createdSession, version: 5 } }); await first; });
      expect(recording).toBe(false);
      expect(voice.state).toBe("off");
      expect(start).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(window, "SpeechRecognition");
    }
  });

  it("stops a partially resumed native recorder if resume throws", async () => {
    let recording = false;
    mockStartNativeRecording.mockImplementation(async () => { recording = true; });
    mockPauseNativeRecording.mockImplementation(async () => { recording = false; });
    mockResumeNativeRecording.mockImplementation(async () => { recording = true; throw new Error("resume failed"); });
    await act(async () => { await voice.start(); await voice.toggleMute(); });
    await act(async () => { await voice.toggleMute(); });
    expect(recording).toBe(false);
    expect(voice.muted).toBe(true);
  });

});
