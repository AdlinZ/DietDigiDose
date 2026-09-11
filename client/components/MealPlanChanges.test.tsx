import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Text, TouchableOpacity } from "react-native";
const mockChanges = jest.fn();
const mockReview = jest.fn();
const mockFetch = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({ useAuthFetch: () => mockFetch }));
jest.mock("@/services/api", () => ({ mealPlansApi: { changes: (...args: unknown[]) => mockChanges(...args), reviewChange: (...args: unknown[]) => mockReview(...args) } }));
import { MealPlanChanges } from "./MealPlanChanges";
const suggestion = { id: "change", itemId: "item", reason: "用餐条件变化", source: "worker", status: "pending", before: { title: "旧菜", input: { plannedDate: "2026-09-12", mealType: "午餐", recipeId: 1 } }, after: { plannedDate: "2026-09-13", recipeId: 2, title: "新菜" } };
function press(tree: renderer.ReactTestRenderer, label: string) { tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress(); }
beforeEach(() => jest.clearAllMocks());
test("shows concrete before/after and applies only when the user accepts", async () => {
  mockChanges.mockResolvedValueOnce([suggestion]).mockResolvedValueOnce([{ ...suggestion,status: "applied" }]);
  mockReview.mockResolvedValue({ id: "item",version: 2 });
  const onChanged = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  expect(JSON.stringify(tree.toJSON())).toContain("旧菜 → 新菜");
  expect(mockReview).not.toHaveBeenCalled();
  await act(async () => { press(tree,"接受变更"); });
  expect(mockReview).toHaveBeenCalledWith(mockFetch,"plan","change","accept");
  expect(onChanged).toHaveBeenCalledWith({ id: "item",version: 2 });
  expect(JSON.stringify(tree.toJSON())).toContain("恢复变更前安排");
  act(() => tree.unmount());
});
test("conflict keeps the current plan and reports the server's reason", async () => {
  mockChanges.mockResolvedValue([suggestion]);
  mockReview.mockRejectedValue(new Error("制作状态已变化"));
  const alert = jest.spyOn(Alert,"alert").mockImplementation(() => undefined);
  const onChanged = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<MealPlanChanges planId="plan" revision={0} items={[]} onChanged={onChanged} />); });
  await act(async () => { press(tree,"接受变更"); });
  expect(onChanged).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith("原安排已保留","制作状态已变化");
  act(() => tree.unmount());
});
