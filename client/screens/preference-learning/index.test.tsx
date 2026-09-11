import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TouchableOpacity } from "react-native";
const mockRequest = jest.fn(); const mockFetch = jest.fn(); let mockUser = { id: 1 };
jest.mock("@/contexts/AuthContext",() => ({ useAuth: () => ({ user: mockUser }),useAuthFetch: () => mockFetch }));
jest.mock("@/components/Screen",() => ({ Screen: "View" }));
jest.mock("@/hooks/useSafeRouter",() => ({ useSafeRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/services/api/client",() => ({ requestJson: (...args: unknown[]) => mockRequest(...args) }));
import PreferenceLearningScreen from "./index";
const initial = { version: 3,enabled: true,items: [{ recipeId: 1,title: "蛋羹",origin: "inferred",explanation: "多次明确不喜欢",evidence: [{ id: "source",at: "2026-09-12",reason: "明确长期不喜欢" }] }] };
beforeEach(() => { jest.clearAllMocks(); mockUser = { id: 1 }; });
test("deleting a conclusion sends the displayed version and removes it only after success",async () => {
  mockRequest.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial,version: 4,items: [] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreferenceLearningScreen />); });
  await act(async () => { tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === "纠正或删除：不再据此降低排序"))!.props.onPress(); });
  expect(JSON.parse(mockRequest.mock.calls[1][2].body)).toEqual({ kind: "recipe",version: 3,recipeId: 1,value: "neutral" });
  expect(JSON.stringify(tree.toJSON())).not.toContain("蛋羹");
  act(() => tree.unmount());
});
test("an old account response cannot reveal its preferences after switching",async () => {
  let resolve!: (value: unknown) => void;
  mockRequest.mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ version: 1,enabled: true,items: [] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreferenceLearningScreen />); });
  mockUser = { id: 2 };
  await act(async () => { tree.update(<PreferenceLearningScreen />); });
  await act(async () => { resolve(initial); });
  expect(JSON.stringify(tree.toJSON())).not.toContain("蛋羹");
  act(() => tree.unmount());
});

test("shows zero remaining portions as an observation without calling it a taste preference",async () => {
  mockRequest.mockResolvedValueOnce({ ...initial,items: [],observations: [{ id: "production:batch",kind: "production",title: "蛋羹",at: "2026-09-12T10:00:00Z",servings: 3,remainingServings: 0,observedAt: "2026-09-13T10:00:00Z",valid: true,explanation: "已制作，不等于已食用" }] });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PreferenceLearningScreen />); });
  const remaining = tree.root.findAllByType(Text).find(node => Array.isArray(node.props.children) && node.props.children[0] === "当前待吃余量 ");
  expect(remaining?.props.children).toContain(0);
  expect(remaining?.props.children).toContain("2026-09-13");
  expect(JSON.stringify(tree.toJSON())).toContain("余量本身不说明是否喜欢或份量过大");
  act(() => tree.unmount());
});
