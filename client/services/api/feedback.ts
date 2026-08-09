import { requestJson, type ApiFetch } from "./client";

export type FeedbackCategory = "issue" | "suggestion" | "support";

export type FeedbackContext = {
  page?: string;
  recipeId?: number;
  recipeTitle?: string;
};

export const feedbackApi = {
  create: (apiFetch: ApiFetch, payload: { category: FeedbackCategory; content: string; context?: FeedbackContext }) =>
    requestJson<{ id: number; status: "received" }>(apiFetch, "/api/v1/feedback", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
