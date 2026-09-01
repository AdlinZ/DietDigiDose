import type { CookingCompletionResult, PreparedCookingCompletion, PreparedDietRecord } from "./types.js";
import type { FunnelEventName } from "../../services/funnelEvents.js";

/** Driver-neutral persistence port for diet records and atomic cooking completion. */
export interface DietRecordsRepository {
  recordFunnelEvent(eventName: FunnelEventName, actorHash: string): Promise<void>;
  list(userId: number, date?: string): Promise<Array<Record<string, unknown>>>;
  create(userId: number, record: PreparedDietRecord): Promise<Record<string, unknown>>;
  remove(userId: number, id: number): Promise<boolean>;
  completeCooking(userId: number, input: PreparedCookingCompletion): Promise<CookingCompletionResult>;
}
