import type Database from "better-sqlite3";
import type { FeedbackRepository } from "./repository.js";
import type { FeedbackCreateData } from "./types.js";

export class SqliteFeedbackRepository implements FeedbackRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async create(userId: number, input: FeedbackCreateData) {
    const result = this.database.prepare(`
      INSERT INTO user_feedback (user_id, category, content, context_json)
      VALUES (?, ?, ?, ?)
    `).run(
      userId,
      input.category,
      input.content,
      input.context ? JSON.stringify(input.context) : null,
    );
    return Number(result.lastInsertRowid);
  }
}
