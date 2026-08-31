import type { RecommendationEventInput, Row } from "./types.js";

export type RecipeQuery = { category?: string; search?: string; timeBudget: number | null };
export type RecommendationRequestWrite = {
  id: string;
  userId: number;
  surface: string;
  scoringVersion: string;
  candidateVersion: string;
  inputHash: string;
  inputSnapshot: Row;
  results: Row[];
  dataUpdatedAt: string | null;
};

export interface RecommendationsRepository {
  profile(userId: number): Promise<Row | null>;
  inventory(userId: number): Promise<Row[]>;
  kitchenware(userId: number): Promise<Row[]>;
  recipes(query: RecipeQuery): Promise<Row[]>;
  favoriteRecipeIds(userId: number): Promise<number[]>;
  recentRecipeIds(userId: number): Promise<number[]>;
  skippedRecipeIds(userId: number): Promise<number[]>;
  dietTotals(userId: number, date: string): Promise<{ calories: number; protein: number }>;
  dailyCaloriesTarget(userId: number): Promise<number>;
  findRequest(userId: number, requestId: string): Promise<Row | null>;
  createRequest(input: RecommendationRequestWrite): Promise<void>;
  findEvent(userId: number, idempotencyKey: string): Promise<Row | null>;
  recipeAvailable(recipeId: number): Promise<boolean>;
  requestScoringVersion(userId: number, requestId: string): Promise<string | null>;
  createEvent(id: string, userId: number, input: RecommendationEventInput): Promise<{ id: string; repeated: boolean }>;
}
