import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Text, TouchableOpacity } from "react-native";
import type { PreparedMeal } from "@dietdigidose/contracts";

const mockList = jest.fn();
const mockEvent = jest.fn();
const mockAuthFetch = jest.fn();
const mockStore = new Map<string, string>();
const mockUser = { id: 501 };
jest.mock("@/services/api", () => ({ dietApi: { preparedMeals: (...args: unknown[]) => mockList(...args), mealEvent: (...args: unknown[]) => mockEvent(...args) }, ApiError: class extends Error {} }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser, isAuthenticated: true }), useAuthFetch: () => mockAuthFetch }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock("expo-router", () => ({ useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]) }));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("expo-file-system", () => ({ Paths: { cache: { size: 0 } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: {
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
} }));
import PreparedMealsScreen from "./index";
const meal = (version: number, remaining: number) => ({ id: "meal", food_name: "饭", version, remaining_servings: remaining, produced_servings: 3, nutrition_per_serving: {} }) as PreparedMeal;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function press(tree: renderer.ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  if (!button) throw new Error(`Missing ${label}`);
  button.props.onPress();
}
function output(tree: renderer.ReactTestRenderer) { return JSON.stringify(tree.toJSON()); }
beforeEach(() => { jest.clearAllMocks(); mockStore.clear(); jest.spyOn(Alert, "alert").mockImplementation(() => undefined); });

test("a historical replay and delayed GET cannot revive a completed meal", async () => {
  const oldGet = deferred<PreparedMeal[]>();
  const event = deferred<unknown>();
  mockStore.set("prepared-meal-pending:user:501", JSON.stringify({ mealId: "meal", input: { idempotency_key: "retry-202-original", version: 1, type: "eat", servings: 1 } }));
  mockList.mockResolvedValueOnce([meal(3, 1)]).mockReturnValueOnce(oldGet.promise).mockResolvedValueOnce([meal(4, 0)]);
  mockEvent.mockReturnValueOnce(event.promise);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreparedMealsScreen />); });
  await act(async () => { press(tree, "刷新"); });
  await act(async () => { press(tree, "重试原提交"); });
  await act(async () => { event.resolve({ prepared_meal: meal(2, 2), repeated: true }); });
  expect(output(tree)).not.toContain('剩余 ');
  await act(async () => { oldGet.resolve([meal(1, 3)]); });
  expect(output(tree)).not.toContain('剩余 ');
  expect(mockEvent).toHaveBeenCalledTimes(1);
  expect(mockStore.has("prepared-meal-pending:user:501")).toBe(false);
  act(() => tree.unmount());
});

test("newest refresh wins even when earlier requests finish later", async () => {
  const oldGet = deferred<PreparedMeal[]>();
  mockList.mockReturnValueOnce(oldGet.promise).mockResolvedValueOnce([meal(3, 1)]);
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreparedMealsScreen />); });
  await act(async () => { press(tree, "刷新"); });
  const freshOutput = output(tree);
  await act(async () => { oldGet.resolve([meal(1, 3)]); });
  expect(output(tree)).toBe(freshOutput);
  act(() => tree.unmount());
});
