import { requestJson, type ApiFetch } from "./client";
import type { HealthLog } from "./types";

export const healthApi = {
  list: (apiFetch: ApiFetch) => requestJson<HealthLog[]>(apiFetch, "/api/v1/health-data"),
  latest: (apiFetch: ApiFetch) => requestJson<HealthLog | null>(apiFetch, "/api/v1/health-data/latest"),
  saveLog: (apiFetch: ApiFetch, input: unknown) => requestJson<HealthLog>(apiFetch, "/api/v1/health-data/log", { method: "POST", body: JSON.stringify(input) }),
  deleteLog: (apiFetch: ApiFetch, id: number) => requestJson<void>(apiFetch, `/api/v1/health-data/log/${id}`, { method: "DELETE" }),
  profile: <T>(apiFetch: ApiFetch) => requestJson<T | null>(apiFetch, "/api/v1/health-data/profile"),
  saveProfile: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/health-data/profile", { method: "PUT", body: JSON.stringify(input) }),
};
