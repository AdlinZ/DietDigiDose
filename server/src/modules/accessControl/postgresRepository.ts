import type { Pool } from "pg";
import type { AccessControlRepository } from "./repository.js";
import type { StoredAccessUser } from "./types.js";

export class PostgresAccessControlRepository implements AccessControlRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) { this.pool = pool; }

  async user(userId: number) {
    return ((await this.pool.query(`SELECT session_version AS "sessionVersion",is_disabled AS "isDisabled",role,
      must_change_password AS "mustChangePassword" FROM users WHERE id=$1`, [userId])).rows[0] as StoredAccessUser | undefined) || null;
  }
}
