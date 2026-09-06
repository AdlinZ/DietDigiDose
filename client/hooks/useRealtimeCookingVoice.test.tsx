import React from "react";
import { Platform } from "react-native";
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
  onTranscript: jest.fn(), onBargeIn: jest.fn(), onControl: jest.fn(),
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
});
