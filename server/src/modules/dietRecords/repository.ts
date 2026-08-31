import type { CookingCompletionResult, PreparedCookingCompletion, PreparedDietRecord } from "./types.js";

/** Driver-neutral persistence port for diet records and atomic cooking completion. */
export interface DietRecordsRepository {
  list(userId: number, date?: string): Promise<Array<Record<string, unknown>>>;
  create(userId: number, record: PreparedDietRecord): Promise<Record<string, unknown>>;
  remove(userId: number, id: number): Promise<boolean>;
  completeCooking(userId: number, input: PreparedCookingCompletion): Promise<CookingCompletionResult>;
}
