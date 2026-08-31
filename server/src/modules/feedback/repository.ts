import type { FeedbackCreateData } from "./types.js";

/** Driver-neutral persistence port for authenticated user feedback. */
export interface FeedbackRepository {
  create(userId: number, input: FeedbackCreateData): Promise<number>;
}
