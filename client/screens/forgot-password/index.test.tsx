import React from "react";
import renderer, { act } from "react-test-renderer";
import { Text, TextInput, TouchableOpacity } from "react-native";
const mockSend = jest.fn();
const mockVerify = jest.fn();
const mockReset = jest.fn();
const mockReplace = jest.fn();
jest.mock("@/components/Screen", () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useSafeRouter", () => ({ useSafeRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => false }) }));
jest.mock("@/services/api", () => ({ authApi: { sendPasswordRecovery: (...args: unknown[]) => mockSend(...args), verifyPasswordRecovery: (...args: unknown[]) => mockVerify(...args), resetPassword: (...args: unknown[]) => mockReset(...args) } }));
import ForgotPasswordScreen from "./index";
beforeEach(() => { jest.clearAllMocks(); });
function press(tree: renderer.ReactTestRenderer, title: string) {
  tree.root.findAllByType(TouchableOpacity).find(button => button.findAllByType(Text).some(text => text.props.children === title))!.props.onPress();
}
function input(tree: renderer.ReactTestRenderer, label: string, value: string) {
  tree.root.findAllByType(TextInput).find(field => field.props.accessibilityLabel === label)!.props.onChangeText(value);
}
test("recovery verifies the phone, validates confirmation and clears secrets after success", async () => {
  mockSend.mockResolvedValue({ challengeId: "challenge", resendAfter: 60 });
  mockVerify.mockResolvedValue({ recoveryToken: "proof", expiresIn: 300 });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ForgotPasswordScreen />); });
  act(() => input(tree, "绑定手机号", "+86 13800138000"));
  await act(async () => { press(tree, "获取恢复验证码"); });
  expect(mockSend).toHaveBeenCalledWith("13800138000");
  expect(JSON.stringify(tree.toJSON())).toContain("请求已被服务商接收");
  act(() => input(tree, "恢复验证码", "123456"));
  await act(async () => { press(tree, "验证身份"); });
  expect(mockVerify).toHaveBeenCalledWith("challenge", "123456");
  act(() => { input(tree, "新密码", "NewPass123"); input(tree, "确认新密码", "WrongPass1"); });
  await act(async () => { press(tree, "重设密码"); });
  expect(mockReset).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain("两次输入的新密码不一致");
  act(() => input(tree, "确认新密码", "NewPass123"));
  mockReset.mockResolvedValue({ success: true });
  await act(async () => { press(tree, "重设密码"); press(tree, "重设密码"); });
  expect(mockReset).toHaveBeenCalledTimes(1);
  expect(mockReset).toHaveBeenCalledWith("proof", "NewPass123");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain("所有旧登录会话已失效");
  act(() => press(tree, "返回登录"));
  expect(mockReplace).toHaveBeenCalledWith("/login");
  act(() => tree.unmount());
});

test("supplier failure stays retryable and unsupported email has a concrete manual path", async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<ForgotPasswordScreen />); });
  expect(JSON.stringify(tree.toJSON())).toContain("联系向你提供安装包或邀请的管理员");
  act(() => input(tree, "绑定手机号", "email@example.com"));
  await act(async () => { press(tree, "获取恢复验证码"); });
  expect(mockSend).not.toHaveBeenCalled();
  act(() => input(tree, "绑定手机号", "13800138000"));
  mockSend.mockRejectedValueOnce(new Error("短信发送失败，请稍后重试"));
  await act(async () => { press(tree, "获取恢复验证码"); });
  expect(JSON.stringify(tree.toJSON())).toContain("短信发送失败");
  expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  mockSend.mockResolvedValueOnce({ challengeId: "retry", resendAfter: 60 });
  await act(async () => { press(tree, "获取恢复验证码"); });
  expect(tree.root.findAllByType(TextInput)).toHaveLength(2);
  act(() => press(tree, "更换手机号"));
  expect(tree.root.findAllByType(TextInput)).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).toContain("60 秒后获取");
  act(() => tree.unmount());
});
