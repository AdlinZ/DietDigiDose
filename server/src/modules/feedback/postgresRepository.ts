import type { Pool } from "pg";
import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData } from "./types.js";

export class PostgresFeedbackRepository implements FeedbackRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async create(userId: number, input: FeedbackCreateData) {
    const result = await this.pool.query<{ id: number }>(`
      INSERT INTO user_feedback (user_id, category, content, context_json)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id
    `, [
      userId,
      input.category,
      input.content,
      input.context ? JSON.stringify(input.context) : null,
    ]);
    return Number(result.rows[0]!.id);
  }
}
