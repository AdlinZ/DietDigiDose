import { requestJson, type ApiFetch } from "./client";

export type MealPlanItemStatus = "planned" | "queued" | "cooking" | "completed" | "skipped";

export interface MealPlanItem {
  id: string;
  planId: string;
  plannedDate: string;
  mealType: string;
  title: string;
  recipeId: number | null;
  recipeAvailable: boolean;
  recipeImageUrl: string | null;
  cookTime: number;
  difficulty: string | null;
  ingredients: Array<{ name: string; amount: string }>;
  steps: unknown[];
  nutrition: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
  status: MealPlanItemStatus;
  version: number;
  dietRecordId: number | null;
  queueItemId: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface MealPlan {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: "draft" | "active" | "completed" | "cancelled";
  source: "agent" | "manual" | string;
  createdByRunId: string | null;
  constraints: Record<string, unknown>;
  version: number;
  undoState: "active" | "undone";
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  items: MealPlanItem[];
}

const itemPath = (planId: string, itemId: string) =>
  `/api/v1/meal-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`;

export const mealPlansApi = {
  list: (apiFetch: ApiFetch, includeArchived = true) =>
    requestJson<MealPlan[]>(apiFetch, `/api/v1/meal-plans?includeArchived=${includeArchived}`),
  get: (apiFetch: ApiFetch, id: string) =>
    requestJson<MealPlan>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`),
  update: (apiFetch: ApiFetch, id: string, input: unknown) =>
    requestJson<MealPlan>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (apiFetch: ApiFetch, id: string, version: number) =>
    requestJson<{ deleted: true }>(apiFetch, `/api/v1/meal-plans/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ version }) }),
  updateItem: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<MealPlanItem>(apiFetch, itemPath(planId, itemId), { method: "PATCH", body: JSON.stringify(input) }),
  addShopping: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ added: number; itemIds: string[]; repeated: boolean }>(apiFetch, `${itemPath(planId, itemId)}/shopping`, { method: "POST", body: JSON.stringify(input) }),
  addQueue: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ queueItemId: string; added: boolean; repeated: boolean }>(apiFetch, `${itemPath(planId, itemId)}/queue`, { method: "POST", body: JSON.stringify(input) }),
  complete: (apiFetch: ApiFetch, planId: string, itemId: string, input: unknown) =>
    requestJson<{ dietRecordId: number; repeated: boolean }>(apiFetch, `${itemPath(planId, itemId)}/complete`, { method: "POST", body: JSON.stringify(input) }),
};
