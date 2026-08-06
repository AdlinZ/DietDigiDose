import { requestJson, type ApiFetch } from "./client";
import type { DietRecord } from "./types";

export type DietRecordInput = Omit<DietRecord, "id">;

export const dietApi = {
  list: (apiFetch: ApiFetch, date?: string) => requestJson<DietRecord[]>(apiFetch, `/api/v1/diet-records${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  create: (apiFetch: ApiFetch, input: DietRecordInput) => requestJson<DietRecord>(apiFetch, "/api/v1/diet-records", {
    method: "POST", body: JSON.stringify(input),
  }),
  completeCooking: (apiFetch: ApiFetch, input: {
    idempotency_key: string;
    recipe_id?: number | null;
    inventory_item_ids: number[];
    diet_record: DietRecordInput;
  }) => requestJson<{ diet_record: DietRecord; consumed_inventory_item_ids: number[]; repeated: boolean }>(
    apiFetch,
    "/api/v1/diet-records/cooking-completions",
    { method: "POST", body: JSON.stringify(input) },
  ),
  remove: (apiFetch: ApiFetch, id: number) => requestJson<{ message: string }>(apiFetch, `/api/v1/diet-records/${id}`, { method: "DELETE" }),
};
