import { requestJson, type ApiFetch } from "./client";

export type RecommendationSurface = "home" | "inventory" | "ai" | "meal_plan";

export interface RecipeRecommendationItem<TRecipe> {
  recipeId: number;
  recipe: TRecipe;
  score: number;
  scoringVersion: string;
  candidateVersion: string;
  hardConstraints: { satisfied: string[]; unmet: string[] };
  features: {
    inventoryCoverage: number;
    matchedIngredients: Array<{ name: string; amount?: string }>;
    expiringIngredients: Array<{ name: string; daysLeft: number }>;
    missingIngredients: Array<{ name: string; amount?: string }>;
    timeBudgetMinutes: number | null;
    estimatedTimeMinutes: number;
    nutritionFit: number;
    favorite: boolean;
    recentRepeat: boolean;
    skippedRecently: boolean;
  };
  reasons: string[];
  dataUpdatedAt: string | null;
  degraded: string[];
}

export interface RecipeRecommendationPage<TRecipe> {
  requestId: string;
  scoringVersion: string;
  candidateVersion: string;
  dataUpdatedAt: string | null;
  items: Array<RecipeRecommendationItem<TRecipe>>;
  total: number;
  nextCursor: string | null;
}

export const recommendationsApi = {
  recipes: <TRecipe>(apiFetch: ApiFetch, input: {
    surface: RecommendationSurface;
    category?: string;
    search?: string;
    maxCookTime?: number;
    matchStatus?: "all" | "full" | "missing_few" | "expiring";
    mealType?: "breakfast" | "lunch" | "dinner" | "snack";
    pageSize?: number;
    cursor?: string;
  }) => requestJson<RecipeRecommendationPage<TRecipe>>(apiFetch, "/api/v1/recommendations/recipes", {
    method: "POST",
    body: JSON.stringify(input),
  }),
  event: (apiFetch: ApiFetch, input: {
    requestId?: string;
    recipeId: number;
    eventType: "exposure" | "view" | "favorite" | "skip" | "shopping" | "queue" | "start" | "complete" | "constraint_change";
    scoringVersion: string;
    surface: RecommendationSurface;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }) => requestJson<{ eventId: string; repeated: boolean }>(apiFetch, "/api/v1/recommendations/events", {
    method: "POST",
    body: JSON.stringify(input),
  }),
};
