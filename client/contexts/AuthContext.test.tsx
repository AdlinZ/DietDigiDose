import React from "react";
import renderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi } from "@/services/api";
import { AUTH_USER_KEY, getStoredToken } from "@/utils/authStorage";
import { AuthProvider, useAuth } from "./AuthContext";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("@/services/api", () => ({
  ApiError: class extends Error {},
  authApi: { login: jest.fn(), me: jest.fn(), updateProfile: jest.fn() },
}));
jest.mock("@/services/api/cache", () => ({
  clearApiCacheScope: jest.fn().mockResolvedValue(undefined), registerApiFetchScope: jest.fn(),
}));
jest.mock("@/utils/authStorage", () => ({
  AUTH_USER_KEY: "@auth_user", getStoredToken: jest.fn(),
  setStoredToken: jest.fn().mockResolvedValue(undefined), removeStoredToken: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/userStorage", () => ({
  activatePrivateStorage: jest.fn(), invalidatePrivateStorage: jest.fn(),
  purgeLegacyUnscopedPrivateStorage: jest.fn().mockResolvedValue(undefined),
  purgeUserPrivateStorage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/utils/notifications", () => ({
  cancelAllLocalNotificationsForUser: jest.fn().mockResolvedValue(undefined),
  cancelLegacyUnscopedLocalNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/voicePackManager", () => ({
  purgeVoiceAudioCacheForUser: jest.fn().mockResolvedValue(undefined),
  stopVoiceOutput: jest.fn().mockResolvedValue(undefined),
}));

const userA = { id: 1, username: "A", avatar_url: null, bio: null };
const userB = { id: 2, username: "B", avatar_url: null, bio: null };
let auth: ReturnType<typeof useAuth>;
let tree: renderer.ReactTestRenderer;
function Probe() {
  const value = useAuth();
  React.useEffect(() => { auth = value; }, [value]);
  return null;
}
async function mount() {
  await act(async () => { tree = renderer.create(<AuthProvider><Probe /></AuthProvider>); });
}
async function loginAsB() {
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-B", user: userB });
  await act(async () => { await auth.login("B", "password"); });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(getStoredToken).mockResolvedValue(null);
});
afterEach(() => { act(() => tree?.unmount()); });

it.each(["profile", "refresh"])("ignores a delayed %s response from the previous account", async kind => {
  await mount();
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  let resolveResponse!: (value: typeof userA) => void;
  const response = new Promise<typeof userA>(resolve => { resolveResponse = resolve; });
  jest.mocked(authApi.updateProfile).mockReturnValue(response);
  jest.mocked(authApi.me).mockReturnValue(response);
  let pending!: Promise<unknown>;
  act(() => { pending = kind === "profile" ? auth.updateProfile({ bio: "updated" }) : auth.refreshUser(); });
  await act(async () => { await auth.logout(); });
  await loginAsB();
  await act(async () => { resolveResponse({ ...userA, username: "A updated" }); await pending; });
  expect(auth.token).toBe("token-B");
  expect(auth.user).toEqual(userB);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual(userB);
});

it("ignores delayed startup verification after the session changes", async () => {
  await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(userA));
  jest.mocked(getStoredToken).mockResolvedValue("token-A");
  let resolveResponse!: (value: typeof userA) => void;
  jest.mocked(authApi.me).mockReturnValue(new Promise(resolve => { resolveResponse = resolve; }));
  await mount();
  expect(auth.user).toEqual(userA);
  await act(async () => { await auth.logout(); });
  await loginAsB();
  await act(async () => { resolveResponse({ ...userA, username: "A refreshed" }); });
  expect(auth.token).toBe("token-B");
  expect(auth.user).toEqual(userB);
  expect(JSON.parse((await AsyncStorage.getItem(AUTH_USER_KEY))!)).toEqual(userB);
});

it("checks the live login generation after screen teardown, account changes and provider teardown", async () => {
  await mount();
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  const check = auth.isSessionCurrent;
  const firstGeneration = auth.sessionGeneration;
  expect(check(userA.id, firstGeneration)).toBe(true);
  jest.mocked(authApi.login).mockResolvedValue({ token: "token-A-replaced", user: userA });
  await act(async () => { await auth.login("A", "password"); });
  expect(check(userA.id, firstGeneration)).toBe(false);
  expect(check(userA.id, auth.sessionGeneration)).toBe(true);
  await loginAsB();
  const secondGeneration = auth.sessionGeneration;
  expect(check(userA.id, secondGeneration)).toBe(false);
  expect(check(userB.id, secondGeneration)).toBe(true);
  act(() => tree.unmount());
  expect(check(userB.id, secondGeneration)).toBe(false);
});
