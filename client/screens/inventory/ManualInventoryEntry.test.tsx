import React from "react";
import renderer, { act } from "react-test-renderer";

const mockGet = jest.fn(); const mockWrite = jest.fn(); const mockRemove = jest.fn(); const mockSave = jest.fn(); const mockDone = jest.fn();
let mockUser: { id: number } | null = { id: 1 };
let mockGeneration = 0;
let mockForm: Record<string, any>;
const mockStorage = new Map<string, string>();
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: (...args: unknown[]) => mockGet(...args) }));
jest.mock("@/utils/userStorage", () => ({
  getPrivateStorageGeneration: () => mockGeneration,
  getUserStorageKey: (key: string, id: number) => `${key}:user:${id}`,
  writeUserPrivateStorage: (...args: unknown[]) => mockWrite(...args), removeUserPrivateStorage: (...args: unknown[]) => mockRemove(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000001" }));
jest.mock("./InventoryEntryForm", () => ({ InventoryEntryForm: (props: Record<string, any>) => { mockForm = props; return null; } }));

import { ManualInventoryEntry } from "./ManualInventoryEntry";
const props = { saveIntake: (input: unknown) => mockSave(input), onSaved: () => mockDone(), onPhoto: jest.fn(), photoUrl: "", bottomInset: 0 };
async function render() { let tree!: renderer.ReactTestRenderer; await act(async () => { tree = renderer.create(<ManualInventoryEntry {...props} />); }); return tree; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }

beforeEach(() => {
  jest.clearAllMocks(); mockUser = { id: 1 }; mockGeneration = 0; mockStorage.clear();
  mockGet.mockReset().mockImplementation((key: string) => Promise.resolve(mockStorage.get(key) ?? null));
  mockWrite.mockReset().mockImplementation((key: string, id: number, _generation: number, value: string) => { mockStorage.set(`${key}:user:${id}`, value); return Promise.resolve(true); });
  mockRemove.mockReset().mockImplementation((key: string, id: number) => { mockStorage.delete(`${key}:user:${id}`); return Promise.resolve(true); });
  mockSave.mockReset().mockResolvedValue({});
});

test("manual creation preserves unknown quantities and stores the retry request before sending", async () => {
  const tree = await render(); expect(mockForm.quantity).toBe(""); expect(mockForm.expirationDate).toBe("");
  await act(async () => { mockForm.onFoodNameChange("番茄"); });
  mockSave.mockImplementation(async input => { expect(JSON.parse(mockStorage.get("@inventory_manual_draft_v1:user:1")!).pending).toEqual(input); return {}; });
  await act(async () => { mockForm.onSave(); });
  expect(mockSave.mock.calls[0][0].items[0]).toMatchObject({ food_name: "番茄", quantity: "数量未知", quantity_value: null, quantity_unit: null });
  expect(mockRemove).toHaveBeenCalledWith("@inventory_manual_draft_v1", 1, 0); expect(mockDone).toHaveBeenCalledTimes(1); act(() => tree.unmount());
});

test("ambiguous saves survive restart and retry the same immutable batch", async () => {
  mockSave.mockRejectedValueOnce(new Error("响应丢失"));
  const first = await render(); await act(async () => { mockForm.onFoodNameChange("鸡蛋"); }); await act(async () => { mockForm.onSave(); });
  const original = mockSave.mock.calls[0][0]; expect(mockForm.locked).toBe(true); act(() => first.unmount());
  const restored = await render(); expect(mockForm.foodName).toBe("鸡蛋"); expect(mockForm.locked).toBe(true);
  await act(async () => { mockForm.onFoodNameChange("牛奶"); mockForm.onSave(); });
  expect(mockSave.mock.calls[1][0]).toEqual(original); expect(mockDone).toHaveBeenCalledTimes(1); act(() => restored.unmount());
});

test("switching accounts discards late responses without touching the next account's draft", async () => {
  const pending = deferred<unknown>(); mockSave.mockReturnValue(pending.promise);
  const tree = await render(); await act(async () => { mockForm.onFoodNameChange("鸡蛋"); }); await act(async () => { mockForm.onSave(); });
  mockUser = { id: 2 }; mockGeneration = 1;
  await act(async () => { tree.update(<ManualInventoryEntry {...props} />); });
  expect(mockForm.foodName).toBe(""); await act(async () => { pending.resolve({}); });
  expect(mockDone).not.toHaveBeenCalled(); expect(mockRemove).not.toHaveBeenCalled(); act(() => tree.unmount());
});

test("failed durable storage prevents a mutation", async () => {
  const tree = await render(); await act(async () => { mockForm.onFoodNameChange("鸡蛋"); });
  mockWrite.mockRejectedValue(new Error("磁盘写入失败")); await act(async () => { mockForm.onSave(); });
  expect(mockSave).not.toHaveBeenCalled(); expect(JSON.stringify(tree.toJSON())).toContain("磁盘写入失败"); act(() => tree.unmount());
});

test("a failed local clear after confirmed saving retains the same retry identity", async () => {
  mockRemove.mockRejectedValueOnce(new Error("本机清理失败"));
  const tree = await render(); await act(async () => { mockForm.onFoodNameChange("鸡蛋"); });
  await act(async () => { mockForm.onSave(); });
  expect(mockDone).not.toHaveBeenCalled(); expect(mockForm.locked).toBe(true);
  const saved = mockSave.mock.calls[0][0];
  await act(async () => { mockForm.onSave(); });
  expect(mockSave.mock.calls[1][0]).toEqual(saved); expect(mockDone).toHaveBeenCalledTimes(1); act(() => tree.unmount());
});
