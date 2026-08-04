import { publicFetch, requestJson } from "./client";

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

export const authApi = {
  login: <T>(identifier: string, password: string) => requestJson<T>(publicFetch, "/api/v1/auth/login", {
    method: "POST", body: JSON.stringify({ identifier, password }),
  }),
  register: <T>(identifier: string, password: string) => requestJson<T>(publicFetch, "/api/v1/auth/register", {
    method: "POST", body: JSON.stringify({ identifier, password }),
  }),
  me: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/auth/me", { headers: authHeaders(token) }),
  updateProfile: <T>(token: string, input: unknown) => requestJson<T>(publicFetch, "/api/v1/auth/profile", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  notificationPreferences: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/notifications/preferences", { headers: authHeaders(token) }),
  notificationHistory: <T>(token: string) => requestJson<T>(publicFetch, "/api/v1/notifications/history", { headers: authHeaders(token) }),
  updateNotificationPreferences: <T>(token: string, input: unknown) => requestJson<T>(publicFetch, "/api/v1/notifications/preferences", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  registerPushDevice: (token: string, input: { expo_push_token: string; platform: "ios" | "android" }) => requestJson<void>(publicFetch, "/api/v1/notifications/device", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify(input),
  }),
  deleteAccount: (token: string, password: string) => requestJson<{ success: boolean; message: string }>(publicFetch, "/api/v1/auth/account", {
    method: "DELETE", headers: authHeaders(token), body: JSON.stringify({ password, confirmation: "DELETE" }),
  }),
};
