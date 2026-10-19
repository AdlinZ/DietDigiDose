import React from "react";
import renderer, { act } from "react-test-renderer";
import { Modal, Text, TouchableOpacity } from "react-native";
import type { Recipe } from "@/services/api";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let mockParams: { recipeId?: string; queueItemId?: string } = { recipeId: "10" };
let mockUser: { id: number; username: string } | null = { id: 1, username: "测试大厨" };

const mockRecipeDetail = jest.fn();
const mockQueueList = jest.fn();
const mockVoiceCommand = jest.fn();

jest.mock("@/services/api", () => ({
  recipesApi: { detail: (id: number) => mockRecipeDetail(id) },
  cookingQueueApi: { list: () => mockQueueList() },
  aiApi: { voiceCommand: (...args: unknown[]) => mockVoiceCommand(...args) },
  inventoryApi: { list: async () => [] },
  waitForAgentRun: jest.fn(),
  ApiError: class extends Error {},
}));

jest.mock("@/services/api/client", () => ({
  requestJson: async () => ({ requirements: [] }),
}));

const mockAuthFetch = jest.fn();

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: Boolean(mockUser) }),
  useAuthFetch: () => mockAuthFetch,
}));

jest.mock("@/hooks/useSafeRouter", () => ({
  useSafeRouter: () => mockRouter,
  useSafeSearchParams: () => mockParams,
}));

jest.mock("@/components/Screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ThemedFontAwesome6", () => "FontAwesome6");

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 20, left: 0, right: 0 }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "uuid-1234",
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("@/hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({ isRecording: false, startRecording: jest.fn(), stopRecording: jest.fn() }),
}));

jest.mock("@/hooks/useRealtimeCookingVoice", () => ({
  useRealtimeCookingVoice: () => ({ isConnected: false, isSpeaking: false, error: null }),
}));

const mockSetTimerSeconds = jest.fn();
const mockSetTimerMode = jest.fn();
const mockSetIsTimerRunning = jest.fn();
const mockFinishTimer = jest.fn();

jest.mock("@/hooks/useCookingTimer", () => ({
  useCookingTimer: () => ({
    ready: true,
    notice: "切换步骤保留当前计时",
    timerSeconds: 180,
    timerMode: "countdown",
    isTimerRunning: false,
    setTimerSeconds: mockSetTimerSeconds,
    setTimerMode: mockSetTimerMode,
    setIsTimerRunning: mockSetIsTimerRunning,
    finish: mockFinishTimer,
  }),
}));

jest.mock("@/services/voicePackManager", () => ({
  prewarmVoicePack: jest.fn().mockResolvedValue(undefined),
  prefetchVoiceText: jest.fn().mockResolvedValue(undefined),
  speakWithVoiceFallback: jest.fn().mockResolvedValue("system"),
  stopVoiceOutput: jest.fn().mockResolvedValue(undefined),
  enqueueVoiceOutput: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted" }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("notif-1"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

import CookingModeScreen from "./index";

const sampleRecipe: Recipe = {
  id: 10,
  title: "经典番茄炒蛋",
  description: "快手家常菜",
  category: "家常菜",
  cooking_time: 15,
  servings: 2,
  ingredients: [
    { name: "鸡蛋", amount: "2个" },
    { name: "番茄", amount: "1个" },
  ],
  steps: [
    "鸡蛋打散备用，番茄切小块。",
    "热锅倒油，先将鸡蛋炒至凝固盛出。",
    "下入番茄翻炒出沙，再倒回鸡蛋翻炒均匀，出锅前加少许盐调味。",
  ],
};

describe("CookingModeScreen", () => {
  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { recipeId: "10" };
    mockUser = { id: 1, username: "测试大厨" };
    mockRecipeDetail.mockResolvedValue(sampleRecipe);
    mockQueueList.mockResolvedValue([]);
  });

  afterEach(() => {
    if (tree) {
      act(() => {
        tree!.unmount();
      });
      tree = null;
    }
  });

  const extractText = (node: renderer.ReactTestInstance) =>
    node.findAllByType(Text).map((t) => React.Children.toArray(t.props.children).join("")).join(" ");

  test("renders recipe steps and allows opening the kitchen timer modal", async () => {
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    // Verify recipe title rendered
    const allText = extractText(tree!.root);
    expect(allText).toContain("经典番茄炒蛋");
    expect(allText).toContain("1/3 步");

    // Find the timer button and click it to open timer modal
    const buttons = tree!.root.findAllByType(TouchableOpacity);
    const timerButton = buttons.find((btn) => {
      const text = extractText(btn);
      return text.includes("建议") || text.includes("倒计时") || text.includes("正计时");
    });
    expect(timerButton).toBeDefined();

    await act(async () => {
      timerButton!.props.onPress();
    });

    // Check modal visibility
    const modals = tree!.root.findAllByType(Modal);
    expect(modals.length).toBeGreaterThan(0);
    const timerModal = modals.find((m) => m.props.visible === true);
    expect(timerModal).toBeDefined();

    // Verify modal contents
    const modalText = extractText(timerModal!);
    expect(modalText).toContain("厨房智能计时器");
    expect(modalText).toContain("+1 分钟");
    expect(modalText).toContain("+5 分钟");
    expect(modalText).toContain("重置");
    expect(modalText).toContain("切换步骤保留当前计时");
  });

  test("handles timer toggle mode, modifiers and start/pause", async () => {
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    // Open timer modal
    const buttons = tree!.root.findAllByType(TouchableOpacity);
    const timerButton = buttons.find((btn) => {
      const text = extractText(btn);
      return text.includes("建议") || text.includes("倒计时") || text.includes("正计时");
    });
    expect(timerButton).toBeDefined();
    await act(async () => {
      timerButton!.props.onPress();
    });

    const timerModal = tree!.root.findAllByType(Modal).find((m) => m.props.visible === true)!;

    // Toggle timer mode
    const modeToggle = timerModal.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("模式")
    );
    expect(modeToggle).toBeDefined();
    await act(async () => {
      modeToggle!.props.onPress();
    });
    expect(mockSetTimerMode).toHaveBeenCalledWith("stopwatch");

    // Add 1 minute
    const addOneBtn = timerModal.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("+1 分钟")
    );
    expect(addOneBtn).toBeDefined();
    await act(async () => {
      addOneBtn!.props.onPress();
    });
    expect(mockSetTimerSeconds).toHaveBeenCalled();

    // Click start/pause
    const actionBtn = timerModal.findAllByType(TouchableOpacity).find((btn) => {
      const text = extractText(btn);
      return text.includes("开始") || text.includes("暂停");
    });
    expect(actionBtn).toBeDefined();
    await act(async () => {
      actionBtn!.props.onPress();
    });
    expect(mockSetIsTimerRunning).toHaveBeenCalled();
  });

  test("displays error when recipeId is invalid", async () => {
    mockParams = { recipeId: "invalid" };
    await act(async () => {
      tree = renderer.create(<CookingModeScreen />);
    });

    const texts = tree!.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts.some((c) => typeof c === "string" && c.includes("菜谱编号无效"))).toBe(true);
  });
});
