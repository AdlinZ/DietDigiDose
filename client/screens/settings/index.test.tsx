import React from "react";
import renderer, { act } from "react-test-renderer";
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity } from "react-native";
import { restoredAuthIdentity } from "@/utils/authIdentity";

let mockFocused = true;
const mockReadNotifications = jest.fn();
const mockSaveNotifications = jest.fn();
const mockPreferences = { breakfast_time: "08:00", lunch_time: "12:00", dinner_time: "18:00", water_start_time: "08:00", water_end_time: "22:00", quiet_start_time: "22:00", quiet_end_time: "07:00", water_interval_minutes: 120, weekdays_enabled: true, weekends_enabled: true, meal_reminder: false, water_reminder: false, expiring_alert: false };
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
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => mockFocused }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) }));
jest.mock("@react-native-community/datetimepicker", () => () => null);
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/ThemedFontAwesome6", () => "Icon");
jest.mock("@/components/PhoneBindingSettings", () => ({ PhoneBindingSettings: () => null }));
jest.mock("@/components/AccountSmsVerification", () => ({ AccountSmsVerification: () => null }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/contexts/ThemeContext", () => ({ useThemePreference: () => ({ preference: "system", setPreference: jest.fn() }) }));
jest.mock("@/hooks/useAppThemeColors", () => ({ useAppThemeColors: () => ({}) }));
jest.mock("@/utils/appVersion", () => ({ APP_RELEASE_LABEL: "test" }));
jest.mock("@/utils/notifications", () => ({ DEFAULT_NOTIFICATION_PREFERENCES: {}, getExpoPushToken: async () => null, syncLocalNotificationSchedules: async () => undefined }));
jest.mock("@/utils/userStorage", () => ({ getTotalClearableCacheSize: async () => 0, formatStorageBytes: () => "0 B" }));
jest.mock("@/services/offlineInventory", () => ({}));
jest.mock("@/services/api/cache", () => ({ getApiCacheDiagnostics: () => ({ hitRate: 0, entries: 0, staleFallbacks: 0 }) }));
jest.mock("@/services/voicePackManager", () => ({ getVoicePackState: async () => null }));
jest.mock("@/services/api", () => ({
  authApi: { me: (...args: unknown[]) => mockMe(...args), notificationPreferences: (...args: unknown[]) => mockReadNotifications(...args), updateNotificationPreferences: (...args: unknown[]) => mockSaveNotifications(...args) },
  voicePackApi: { catalog: async () => { throw new Error("offline"); }, preference: async () => ({}) },
}));
import SettingsScreen from "./index";
import { SmartDateInput } from "@/components/SmartDateInput";
let tree: renderer.ReactTestRenderer;
const clickText = async (label: string) => {
  const button = tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label));
  await act(async () => { await button!.props.onPress(); });
};
beforeEach(async () => {
  jest.clearAllMocks(); mockCurrent.mockReturnValue(true); mockFocused = true;
  mockReadNotifications.mockResolvedValue({ ...mockPreferences });
  jest.spyOn(Keyboard, "dismiss").mockImplementation(() => undefined);
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

const openCalorie = async () => {
  mockMe.mockResolvedValue({ daily_calories_target: 1700 });
  await act(async () => { await tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
};
const visibleModal = () => tree.root.findAllByType(Modal).find(modal => modal.props.visible)!;
const buttonAction = (label: string) => tree.root.findAllByType(TouchableOpacity).find(node => node.findAllByType(Text).some(text => text.props.children === label))!.props.onPress;
it("returns/cancels without saving and reopens from the latest calorie value", async () => {
  await openCalorie();
  act(() => tree.root.findByProps({ placeholder: "2100" }).props.onChangeText("2000"));
  act(() => visibleModal().props.onRequestClose());
  expect(mockUpdate).not.toHaveBeenCalled(); expect(visibleModal()).toBeUndefined();
  await openCalorie(); expect(tree.root.findByProps({ placeholder: "2100" }).props.value).toBe("1700");
  act(() => tree.root.findByProps({ accessibilityLabel: "取消热量设置" }).props.onPress());
  expect(visibleModal()).toBeUndefined(); expect(Keyboard.dismiss).toHaveBeenCalled();
});
it("validates the entire calorie value, recovers from errors and prevents same-tick duplicate writes", async () => {
  await openCalorie();
  act(() => tree.root.findByProps({ placeholder: "2100" }).props.onChangeText("1700junk"));
  await clickText("保存目标设置"); expect(mockUpdate).not.toHaveBeenCalled();
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toContain("1000");
  act(() => tree.root.findByProps({ placeholder: "2100" }).props.onChangeText("1800"));
  let finish!: (value: { success: boolean; error?: string }) => void;
  mockUpdate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const save = buttonAction("保存目标设置"); let pending!: Promise<void>;
  act(() => { pending = save(); void save(); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  act(() => visibleModal().props.onRequestClose()); expect(visibleModal()).toBeDefined();
  await act(async () => { finish({ success: false, error: "网络失败" }); await pending; });
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe("网络失败");
  mockUpdate.mockResolvedValueOnce({ success: true }); await clickText("保存目标设置");
  expect(visibleModal()).toBeUndefined();
});
it("ignores late reads and saves after leaving settings, then allows re-entry", async () => {
  let finishRead!: (value: object) => void;
  mockMe.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
  await act(async () => { mockFocused = false; tree.update(<SettingsScreen />); });
  await act(async () => { finishRead({ daily_calories_target: 2000 }); await pending; });
  expect(visibleModal()).toBeUndefined();
  await act(async () => { mockFocused = true; tree.update(<SettingsScreen />); });
  await openCalorie();
  let finishSave!: (value: object) => void;
  mockUpdate.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  act(() => { pending = buttonAction("保存目标设置")(); });
  await act(async () => { mockFocused = false; tree.update(<SettingsScreen />); });
  await act(async () => { finishSave({ success: true }); await pending; });
  expect(Alert.alert).not.toHaveBeenCalledWith("成功", expect.anything());
});
it("edits HH:mm drafts, rejects empty time and recovers from failed saves without duplicate writes", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  const breakfast = () => tree.root.findAllByType(SmartDateInput).find(field => field.props.label === "早餐")!;
  act(() => breakfast().props.onChange("")); await clickText("保存并重排提醒");
  expect(mockSaveNotifications).not.toHaveBeenCalled();
  act(() => breakfast().props.onChange("09:30")); expect(mockSaveNotifications).not.toHaveBeenCalled();
  mockSaveNotifications.mockRejectedValueOnce(new Error("offline")); await clickText("保存并重排提醒");
  expect(breakfast().props.value).toBe("09:30");
  expect(tree.root.findByProps({ accessibilityRole: "alert" }).props.children).toBe("offline");
  let finish!: () => void;
  mockSaveNotifications.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const save = buttonAction("保存并重排提醒");
  // The UI intentionally fire-and-forgets; flush the async continuation after resolution.
  await act(async () => { save(); save(); });
  expect(mockSaveNotifications).toHaveBeenCalledTimes(2); expect(breakfast().props.disabled).toBe(true);
  await act(async () => { finish(); });
  expect(mockSaveNotifications).toHaveBeenLastCalledWith("token-A", { ...mockPreferences, breakfast_time: "09:30" });
  expect(breakfast().props.disabled).toBe(false);
});
it("clears deletion verification on Android back and gives modals keyboard-aware scrolling", async () => {
  jest.replaceProperty(Platform, "OS", "android");
  await clickText("永久删除账号与所有数据");
  act(() => tree.root.findByProps({ purpose: "account_delete" }).props.onVerified("old-proof"));
  const modal = visibleModal();
  expect(modal.findByType(KeyboardAvoidingView).props.behavior).toBe("height");
  expect(modal.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe("handled");
  act(() => modal.props.onRequestClose());
  await clickText("永久删除账号与所有数据"); await clickText("永久删除");
  expect(mockDelete).not.toHaveBeenCalled(); expect(Alert.alert).toHaveBeenCalledWith("请验证身份", expect.any(String));
});
it("keeps an in-flight calorie write locked across blur/re-entry until it settles", async () => {
  await openCalorie(); let finish!: (value: object) => void;
  mockUpdate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = buttonAction("保存目标设置")(); });
  await act(async () => { mockFocused = false; tree.update(<SettingsScreen />); });
  await act(async () => { mockFocused = true; tree.update(<SettingsScreen />); });
  mockMe.mockClear();
  await act(async () => { await tree.root.findByProps({ accessibilityLabel: "编辑每日热量目标" }).props.onPress(); });
  expect(mockMe).not.toHaveBeenCalled();
  await act(async () => { finish({ success: true }); await pending; });
  await openCalorie(); expect(visibleModal()).toBeDefined();
  expect(mockUpdate).toHaveBeenCalledTimes(1);
});
it("keeps a pending reminder write locked across re-entry and reloads after completion", async () => {
  jest.replaceProperty(Platform, "OS", "web");
  let finish!: () => void;
  mockSaveNotifications.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await clickText("保存并重排提醒");
  await act(async () => { mockFocused = false; tree.update(<SettingsScreen />); });
  await act(async () => { mockFocused = true; tree.update(<SettingsScreen />); });
  await clickText("保存并重排提醒"); expect(mockSaveNotifications).toHaveBeenCalledTimes(1);
  const reads = mockReadNotifications.mock.calls.length;
  await act(async () => { finish(); });
  expect(mockReadNotifications.mock.calls.length).toBe(reads + 1);
});
