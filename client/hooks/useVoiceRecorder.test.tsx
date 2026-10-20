import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Linking, Platform } from "react-native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { aiApi, waitForAgentRun } from "@/services/api";
import { useVoiceRecorder } from "./useVoiceRecorder";

const mockAuthFetch = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuthFetch: () => mockAuthFetch,
}));

jest.mock("expo-av", () => ({
  Audio: {
    requestPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn(),
    Recording: {
      createAsync: jest.fn(),
    },
    RecordingOptionsPresets: {
      HIGH_QUALITY: "high_quality",
    },
  },
}));

jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(),
}));

jest.mock("@/services/api", () => ({
  aiApi: {
    transcribe: jest.fn(),
  },
  waitForAgentRun: jest.fn(),
}));

describe("useVoiceRecorder", () => {
  let recorderHook!: ReturnType<typeof useVoiceRecorder>;
  const onSpeechResult = jest.fn();
  const onSpeechFinal = jest.fn();
  const onSpeechEmpty = jest.fn();

  function TestComponent({ scopeKey }: { scopeKey?: string } = {}) {
    const value = useVoiceRecorder({ scopeKey, onSpeechResult, onSpeechFinal, onSpeechEmpty });
    React.useLayoutEffect(() => {
      recorderHook = value;
    });
    return null;
  }

  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = "ios";
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined as never);
    jest.spyOn(console, "error").mockImplementation(jest.fn());
  });

  afterEach(() => {
    if (tree) {
      act(() => {
        tree!.unmount();
      });
      tree = null;
    }
  });

  test("handles permission rejection and prompts user appropriately", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: true,
    });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "需要麦克风权限",
      "请允许食光烙记使用麦克风后再试。",
      expect.any(Array),
    );
    expect(recorderHook.isRecording).toBe(false);

    // Test permanent rejection (canAskAgain = false)
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
      canAskAgain: false,
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      "需要麦克风权限",
      "麦克风权限已被关闭，请前往系统设置为食光烙记开启权限。",
      expect.any(Array),
    );

    // Trigger settings button
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const settingsButton = alertCalls[alertCalls.length - 1][2][1];
    expect(settingsButton.text).toBe("打开设置");
    settingsButton.onPress();
    expect(Linking.openSettings).toHaveBeenCalled();
  });

  test("records native audio and transcribes result successfully", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (Audio.Recording.createAsync as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce("mock-base64-audio");
    (aiApi.transcribe as jest.Mock).mockResolvedValueOnce({
      text: "买两斤西兰花",
      run: { id: "run-1", status: "completed" },
    });
    (waitForAgentRun as jest.Mock).mockResolvedValueOnce({
      id: "run-1",
      status: "completed",
      transcript: "买两斤西兰花",
    });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });

    expect(recorderHook.isRecording).toBe(true);
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecordingIOS: true }),
    );

    await act(async () => {
      recorderHook.stopRecording();
    });

    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(aiApi.transcribe).toHaveBeenCalledWith(mockAuthFetch, "mock-base64-audio", "audio/m4a");
    expect(onSpeechResult).toHaveBeenCalledWith("买两斤西兰花");
    expect(onSpeechFinal).toHaveBeenCalledWith("买两斤西兰花");
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.isTranscribing).toBe(false);
    // Verified audio mode reset
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  });

  test("network disconnect or transcribe failure resets recording state and avoids hung recorder (#183)", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (Audio.Recording.createAsync as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValueOnce("mock-base64-audio");
    // Simulate network error / connection drop during transcribe
    (aiApi.transcribe as jest.Mock).mockRejectedValueOnce(new Error("Network request failed"));

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });
    expect(recorderHook.isRecording).toBe(true);

    await act(async () => {
      recorderHook.stopRecording();
    });

    // Verify recording was properly unloaded and state reset
    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(onSpeechEmpty).toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(recorderHook.isRecording).toBe(false);
    expect(recorderHook.isTranscribing).toBe(false);
    expect(recorderHook.statusText).toBe("");
    expect(Audio.setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
  });

  test("component unmount stops active native recording and prevents late callbacks (#183)", async () => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);

    const mockRecording = {
      stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
      getURI: jest.fn().mockReturnValue("file:///test-audio.m4a"),
    };
    (Audio.Recording.createAsync as jest.Mock).mockResolvedValueOnce({ recording: mockRecording });

    await act(async () => {
      tree = renderer.create(<TestComponent />);
    });

    await act(async () => {
      await recorderHook.startRecording();
    });
    expect(recorderHook.isRecording).toBe(true);

    // Unmount while recording is running
    await act(async () => {
      tree!.unmount();
      tree = null;
    });

    expect(mockRecording.stopAndUnloadAsync).toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
  });
  test.each(["conversation-B", "account-B", "logged-out"])("discards pending native ASR after scope becomes %s", async nextScope => {
    (Audio.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Audio.setAudioModeAsync as jest.Mock).mockResolvedValue(undefined);
    const recording = { stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined), getURI: () => "file:///old.m4a" };
    (Audio.Recording.createAsync as jest.Mock).mockResolvedValue({ recording });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue("audio");
    let resolve!: (value: unknown) => void;
    (aiApi.transcribe as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
    await act(async () => { tree = renderer.create(<TestComponent scopeKey="account-A:conversation-A" />); });
    await act(async () => { await recorderHook.startRecording(); recorderHook.stopRecording(); });
    expect(aiApi.transcribe).toHaveBeenCalledTimes(1);
    await act(async () => { tree!.update(<TestComponent scopeKey={nextScope} />); });
    await act(async () => { resolve({ text: "旧账号秘密", run: { id: "old", status: "completed" } }); });
    expect(waitForAgentRun).not.toHaveBeenCalled();
    expect(onSpeechResult).not.toHaveBeenCalled();
    expect(onSpeechFinal).not.toHaveBeenCalled();
    expect(onSpeechEmpty).not.toHaveBeenCalled();
    expect(recorderHook.isTranscribing).toBe(false);
  });

});
