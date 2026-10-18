import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Modal, Text, TextInput, TouchableOpacity } from "react-native";
import { restoredAuthIdentity } from "@/utils/authIdentity";

const mockMe = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockFetch = jest.fn();
const mockCurrent = jest.fn(() => true);
const mockUser = restoredAuthIdentity({ id: 1, username: "A", hasPassword: false, phone_verified_at: "2026-09-20", phone: "+861234", daily_calories_target: 1700 });
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, token: "token-A", isAuthenticated: true, sessionGeneration: 4, isSessionCurrent: mockCurrent, updateProfile: mockUpdate, deleteAccount: mockDelete }),
  useAuthFetch: () => mockFetch,
}));
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/AccountSmsVerification", () => ({ AccountSmsVerification: () => null }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/contexts/ThemeContext", () => ({ useThemePreference: () => ({ preference: "system", setPreference: jest.fn() }) }));
jest.mock("@/hooks/useAppThemeColors", () => ({ useAppThemeColors: () => ({}) }));
jest.mock("@/utils/appVersion", () => ({ APP_RELEASE_LABEL: "test" }));
jest.mock("@/utils/notifications", () => ({ DEFAULT_NOTIFICATION_PREFERENCES: {} }));
jest.mock("@/utils/userStorage", () => ({ getTotalClearableCacheSize: async () => 0, formatStorageBytes: () => "0 B" }));
jest.mock("@/services/offlineInventory", () => ({}));
jest.mock("@/services/api/cache", () => ({ getApiCacheDiagnostics: () => ({ hitRate: 0, entries: 0, staleFallbacks: 0 }) }));
jest.mock("@/services/voicePackManager", () => ({ getVoicePackState: async () => null }));
jest.mock("@/services/api", () => ({
  authApi: { me: (...args: unknown[]) => mockMe(...args), notificationPreferences: async () => ({}) },
  voicePackApi: { catalog: async () => { throw new Error("offline"); }, preference: async () => ({}) },
}));
import SettingsScreen from "./index";
let tree: renderer.ReactTestRenderer;
const clickText = async (label: string) => {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  await act(async () => { await button!.props.onPress(); });
};
beforeEach(async () => {
  jest.clearAllMocks(); mockCurrent.mockReturnValue(true);
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await act(async () => { tree = renderer.create(<SettingsScreen />); });
});
afterEach(() => { act(() => tree.unmount()); jest.restoreAllMocks(); });

it("does not present or save a fabricated calorie goal after offline identity restore", async () => {
  expect(tree.root.findAllByType(Text).some(text => text.props.children === "联网后查看")).toBe(true);
  mockMe.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
  expect(tree.root.findAllByType(Modal).every(modal => !modal.props.visible)).toBe(true);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledWith("暂时无法读取热量目标", expect.any(String));
  mockMe.mockResolvedValueOnce({ daily_calories_target: 1700 });
  await act(async () => { tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
  expect(tree.root.findByProps({ placeholder: "2100" }).props.value).toBe("1700");
  mockUpdate.mockResolvedValueOnce({ success: true });
  await clickText("保存目标设置");
  expect(mockUpdate).toHaveBeenCalledWith({ daily_calories_target: 1700 });
});

it("ignores a calorie read completed after the account changes", async () => {
  mockMe.mockResolvedValue({ daily_calories_target: 1700 });
  mockCurrent.mockReturnValue(false);
  await act(async () => { tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
  expect(tree.root.findAllByType(Modal).every(modal => !modal.props.visible)).toBe(true);
});

it("keeps the SMS account-deletion path for a restored passwordless account", async () => {
  await clickText("永久删除账号与所有数据");
  const sms = tree.root.findByProps({ purpose: "account_delete" });
  expect(tree.root.findAllByType(TextInput).some(input => input.props.placeholder === "请输入当前登录密码")).toBe(false);
  act(() => sms.props.onVerified("verified-token"));
  mockDelete.mockResolvedValueOnce({ success: true });
  await clickText("永久删除");
  expect(mockDelete).toHaveBeenCalledWith({ reauthToken: "verified-token" });
});
