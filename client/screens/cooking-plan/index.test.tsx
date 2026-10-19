import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
import type { CookingPlanDraft } from "@dietdigidose/contracts";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
let mockParams: Record<string, unknown> = {};
let mockUser: { id: number; username: string } | null = { id: 1, username: "测试用户" };
const mockAuthFetch = jest.fn();

const mockCookingPlan = jest.fn();
const mockReplaceCookingItem = jest.fn();
const mockSaveDraft = jest.fn();
const mockUpdateDraft = jest.fn();
const mockActivateDraft = jest.fn();
const mockGetMealPlan = jest.fn();
const mockPatchProfile = jest.fn();

jest.mock("@/services/api/recommendations", () => ({
  recommendationsApi: {
    cookingPlan: (...args: unknown[]) => mockCookingPlan(...args),
    replaceCookingItem: (...args: unknown[]) => mockReplaceCookingItem(...args),
  },
}));

jest.mock("@/services/api/mealPlans", () => ({
  mealPlansApi: {
    get: (...args: unknown[]) => mockGetMealPlan(...args),
    saveDraft: (...args: unknown[]) => mockSaveDraft(...args),
    updateDraft: (...args: unknown[]) => mockUpdateDraft(...args),
    activateDraft: (...args: unknown[]) => mockActivateDraft(...args),
  },
}));

jest.mock("@/services/api/health", () => ({
  healthApi: {
    patchProfile: (...args: unknown[]) => mockPatchProfile(...args),
  },
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: Boolean(mockUser) }),
  useAuthFetch: () => mockAuthFetch,
}));

jest.mock("@/hooks/useSafeRouter", () => ({
  useSafeRouter: () => mockRouter,
  useSafeSearchParams: () => mockParams,
}));

jest.mock("@/hooks/useHealthSummary", () => ({
  useHealthSummary: () => ({
    profile: { version: 1, safety_status: "none" },
    targetCalories: 2000,
    targetLabel: "系统标准",
    error: "",
  }),
}));

jest.mock("@/components/Screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/ReheatingDevicePicker", () => ({
  ReheatingDevicePicker: () => null,
}));

jest.mock("@/components/CookingSchedulePanel", () => ({
  CookingSchedulePanel: () => null,
}));

jest.mock("@/components/OnboardingProgressCard", () => ({
  OnboardingProgressCard: () => null,
}));

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: () => void) => {
    require("react").useEffect(callback, [callback]);
  },
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "uuid-plan-1",
}));

import CookingPlanScreen from "./index";

const sampleDraft: CookingPlanDraft = {
  status: "requires_validation",
  productionDate: "2026-10-20",
  meals: [
    {
      id: "dinner",
      date: "2026-10-20",
      mealType: "dinner",
      servings: 1,
      preparedServings: 0,
      cookServings: 1,
      allocations: [],
    },
  ],
  totalCookServings: 1,
  cooking: [
    {
      targetMealId: "dinner",
      recipeId: 10,
      title: "经典番茄炒蛋",
      servings: 1,
      recipeYield: 1,
      demands: [{ food_name: "鸡蛋", amount_value: 2, unit: "piece" }],
    },
  ],
  unresolved: [],
  ingredientBudget: [
    {
      food_name: "鸡蛋",
      quantity_status: "sufficient",
      covered_value: 2,
      missing_value: 0,
      unit: "piece",
      fully_covered: true,
    },
  ],
  time: {
    budgetMinutes: 30,
    knownSequentialMinutes: 20,
    exceedsBudget: false,
    isEstimate: false,
    incomplete: false,
    missing: [],
  },
  checksPending: [],
  excludedPreparedMealIds: [],
  effectivePreferences: {},
};

describe("CookingPlanScreen", () => {
  let tree: renderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockUser = { id: 1, username: "测试用户" };
    mockCookingPlan.mockResolvedValue(sampleDraft);
    mockSaveDraft.mockResolvedValue({
      plan: {
        id: "plan-1",
        version: 1,
        status: "draft",
        constraints: {
          currentCookingDraft: sampleDraft,
        },
      },
    });
    mockActivateDraft.mockResolvedValue({
      plan: {
        id: "plan-1",
        version: 2,
        status: "active",
      },
    });
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

  test("renders initial cooking plan form controls", async () => {
    await act(async () => {
      tree = renderer.create(<CookingPlanScreen />);
    });

    const allText = extractText(tree!.root);
    expect(allText).toContain("这次怎么备餐");
    expect(allText).toContain("晚餐日期");
    expect(allText).toContain("每餐需要几份");
    expect(allText).toContain("本次时间上限");
    expect(allText).toContain("按当前库存重新计算");

    // Check inputs exist
    const inputs = tree!.root.findAllByType(TextInput);
    expect(inputs.some((input) => input.props.accessibilityLabel === "晚餐日期")).toBe(true);
    expect(inputs.some((input) => input.props.accessibilityLabel === "每餐份量")).toBe(true);
  });

  test("calculates draft, renders results, saves draft and activates plan", async () => {
    await act(async () => {
      tree = renderer.create(<CookingPlanScreen />);
    });

    // Find and click calculate button
    const buttons = tree!.root.findAllByType(TouchableOpacity);
    const calcButton = buttons.find((btn) => extractText(btn).includes("按当前库存重新计算"));
    expect(calcButton).toBeDefined();

    await act(async () => {
      calcButton!.props.onPress();
    });

    expect(mockCookingPlan).toHaveBeenCalledTimes(1);

    // Verify draft result rendered
    const textAfterCalc = extractText(tree!.root);
    expect(textAfterCalc).toContain("方案草案 · 还需核对");
    expect(textAfterCalc).toContain("经典番茄炒蛋");
    expect(textAfterCalc).toContain("需要 1 份 · 待吃餐 0 份 · 补做 1 份");
    expect(textAfterCalc).toContain("整套原料预算");
    expect(textAfterCalc).toContain("鸡蛋：已知库存足量");

    // Find and click save button
    const saveButton = tree!.root.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("保存此方案草案")
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton!.props.onPress();
    });

    expect(mockSaveDraft).toHaveBeenCalledTimes(1);

    // Verify saved state
    const textAfterSave = extractText(tree!.root);
    expect(textAfterSave).toContain("已保存 · 可从餐单恢复");
    expect(textAfterSave).toContain("转为餐单，选择要制作的菜");

    // Click activate button
    const activateButton = tree!.root.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("转为餐单")
    );
    expect(activateButton).toBeDefined();

    await act(async () => {
      activateButton!.props.onPress();
    });

    expect(mockActivateDraft).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith("/meal-plans");
  });

  test("handles calculation error gracefully", async () => {
    mockCookingPlan.mockRejectedValueOnce(new Error("当前无可用食材"));

    await act(async () => {
      tree = renderer.create(<CookingPlanScreen />);
    });

    const calcButton = tree!.root.findAllByType(TouchableOpacity).find((btn) =>
      extractText(btn).includes("按当前库存重新计算")
    );

    await act(async () => {
      calcButton!.props.onPress();
    });

    const allText = extractText(tree!.root);
    expect(allText).toContain("当前无可用食材");
  });
});
