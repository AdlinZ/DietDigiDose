import { requestJson, type ApiFetch } from "./client";
import type { InventoryItem } from "./types";

export type InventoryInput = Omit<InventoryItem, "id" | "is_available"> & { is_available?: boolean };

export const inventoryApi = {
  list: (apiFetch: ApiFetch) => requestJson<InventoryItem[]>(apiFetch, "/api/v1/inventory"),
  create: (apiFetch: ApiFetch, input: InventoryInput) => requestJson<InventoryItem>(apiFetch, "/api/v1/inventory", {
    method: "POST", body: JSON.stringify(input),
  }),
  update: (apiFetch: ApiFetch, id: number, input: Partial<InventoryInput>) => requestJson<InventoryItem>(apiFetch, `/api/v1/inventory/${id}`, {
    method: "PUT", body: JSON.stringify(input),
  }),
  remove: (apiFetch: ApiFetch, id: number) => requestJson<{ message: string }>(apiFetch, `/api/v1/inventory/${id}`, { method: "DELETE" }),
};

export const kitchenwareApi = {
  list: <T>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/kitchenware"),
  catalog: <T>(apiFetch: ApiFetch) => requestJson<T[]>(apiFetch, "/api/v1/kitchenware/catalog"),
  create: <T>(apiFetch: ApiFetch, input: unknown) => requestJson<T>(apiFetch, "/api/v1/kitchenware", { method: "POST", body: JSON.stringify(input) }),
  update: <T>(apiFetch: ApiFetch, id: number, input: unknown) => requestJson<T>(apiFetch, `/api/v1/kitchenware/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  maintain: <T>(apiFetch: ApiFetch, id: number) => requestJson<T>(apiFetch, `/api/v1/kitchenware/${id}/maintain`, { method: "POST" }),
  remove: (apiFetch: ApiFetch, id: number) => requestJson<{ success: boolean }>(apiFetch, `/api/v1/kitchenware/${id}`, { method: "DELETE" }),
};
