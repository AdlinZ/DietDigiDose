import type Database from "better-sqlite3";
import type { AdminConsoleRepository } from "./repository.js";
import type { AdminAudit, AuditQuery, Row, ScanQuery, TrashResource, UsageQuery } from "./types.js";

const TABLES: Record<TrashResource, string> = {
  community: "community_posts", recipes: "recipes", ingredients: "ingredients_library", kitchenware: "kitchenware_items",
};

export class SqliteAdminConsoleRepository implements AdminConsoleRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async stats() { const count = (sql: string) => Number((this.database.prepare(sql).get() as Row).count); return {
    users: count("SELECT COUNT(*) AS count FROM users"), posts: count("SELECT COUNT(*) AS count FROM community_posts WHERE deleted_at IS NULL"),
    recipes: count("SELECT COUNT(*) AS count FROM recipes WHERE deleted_at IS NULL"), inventory: count("SELECT COUNT(*) AS count FROM inventory_items"),
    ingredients: count("SELECT COUNT(*) AS count FROM ingredients_library"), kitchenware: count("SELECT COUNT(*) AS count FROM kitchenware_items WHERE deleted_at IS NULL"),
    kitchenwareCatalog: count("SELECT COUNT(*) AS count FROM kitchenware_catalog"),
  }; }

  async funnel(days: number) { return this.database.prepare(`SELECT event_name AS eventName, COUNT(*) AS events,
    COUNT(DISTINCT actor_hash) AS users FROM funnel_events WHERE created_at >= datetime('now', ?)
    GROUP BY event_name ORDER BY event_name`).all(`-${days} days`) as Row[]; }

  async auditLogs(input: AuditQuery) {
    const filters: string[] = []; const values: string[] = [];
    if (input.action) { filters.push("l.action=?"); values.push(input.action); }
    if (input.resourceType) { filters.push("l.resource_type=?"); values.push(input.resourceType); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const total = Number((this.database.prepare(`SELECT COUNT(*) AS count FROM admin_audit_logs l ${where}`).get(...values) as Row).count);
    const items = this.database.prepare(`SELECT l.id, l.admin_user_id AS adminUserId, COALESCE(u.username,'已删除管理员') AS adminName,
      l.action, l.resource_type AS resourceType, l.resource_id AS resourceId, l.summary, l.details_json AS detailsJson,
      l.ip_address AS ipAddress, l.user_agent AS userAgent, l.created_at AS createdAt FROM admin_audit_logs l
      LEFT JOIN users u ON u.id=l.admin_user_id ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`)
      .all(...values, input.pageSize, (input.page - 1) * input.pageSize) as Row[];
    return { items, total };
  }

  async scanJobs(input: ScanQuery) { const conditions: string[] = []; const values: string[] = [];
    if (input.status) { conditions.push("j.status=?"); values.push(input.status); }
    if (input.user) { conditions.push("(u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?)"); const term = `%${input.user}%`; values.push(term, term); }
    return this.database.prepare(`SELECT j.id,j.status,j.result_json AS resultJson,j.error_message AS errorMessage,
      j.created_at AS createdAt,j.updated_at AS updatedAt,u.id AS userId,u.username FROM inventory_scan_jobs j
      JOIN users u ON u.id=j.user_id ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY j.created_at DESC LIMIT 100`).all(...values) as Row[]; }

  async scanJob(id: string) { return (this.database.prepare(`SELECT j.id,j.status,j.result_json AS resultJson,j.error_message AS errorMessage,
    j.created_at AS createdAt,j.updated_at AS updatedAt,u.id AS userId,u.username FROM inventory_scan_jobs j
    JOIN users u ON u.id=j.user_id WHERE j.id=?`).get(id) as Row | undefined) || null; }

  async conversations(query?: string) { const values = query ? [`%${query}%`, `%${query}%`] : []; return this.database.prepare(`
    SELECT m.user_id AS userId,m.session_id AS sessionId,u.username,
      SUM(CASE WHEN m.role='user' THEN 1 ELSE 0 END) AS turnCount,
      SUM(CASE WHEN m.role IN ('user','assistant') THEN 1 ELSE 0 END) AS messageCount,
      ROUND(AVG(CASE WHEN m.role='assistant' AND m.status='completed' THEN m.response_time_ms END)) AS avgResponseTimeMs,
      SUM(CASE WHEN m.role='assistant' AND m.status='failed' THEN 1 ELSE 0 END) AS failedCount,
      GROUP_CONCAT(DISTINCT m.source) AS sources,MAX(m.created_at) AS updatedAt,
      (SELECT content FROM ai_chat_messages x WHERE x.user_id=m.user_id AND x.session_id=m.session_id AND x.role='user'
       ORDER BY x.id DESC LIMIT 1) AS lastUserMessage
    FROM ai_chat_messages m JOIN users u ON u.id=m.user_id ${query ? "WHERE u.username LIKE ? OR CAST(u.id AS TEXT) LIKE ?" : ""}
    GROUP BY m.user_id,m.session_id ORDER BY MAX(m.id) DESC LIMIT 100`).all(...values) as Row[]; }

  async conversation(userId: number, sessionId: string) {
    const user = (this.database.prepare("SELECT id,username FROM users WHERE id=?").get(userId) as Row | undefined) || null;
    const messages = this.database.prepare(`SELECT m.id,m.role,m.content,m.response_time_ms AS responseTimeMs,m.source,m.status,
      m.payload_json AS payloadJson,m.created_at AS createdAt,c.status AS confirmationStatus FROM ai_chat_messages m
      LEFT JOIN ai_write_confirmations c ON c.id=m.confirmation_id WHERE m.user_id=? AND m.session_id=? ORDER BY m.id`)
      .all(userId, sessionId) as Row[]; return { user, messages };
  }

  async runDiagnostic(userId: number, runId: string) {
    const failure = this.database.prepare("SELECT error_code AS errorCode,error_message AS errorMessage FROM agent_runs WHERE id=? AND user_id=?")
      .get(runId, userId) as Row | undefined;
    const usage = this.database.prepare("SELECT model FROM ai_usage_logs WHERE run_id=? ORDER BY id DESC LIMIT 1").get(runId) as Row | undefined;
    return failure || usage ? { errorCode: failure?.errorCode ? String(failure.errorCode) : null,
      errorMessage: failure?.errorMessage ? String(failure.errorMessage) : null, model: usage?.model ? String(usage.model) : null } : null;
  }

  async trash() { const list = (table: string, title: string) => this.database.prepare(`SELECT id,${title} AS title,deleted_at AS deletedAt
    FROM ${table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all() as Row[]; return {
    community: list("community_posts", "content"), recipes: list("recipes", "title"),
    ingredients: list("ingredients_library", "name"), kitchenware: list("kitchenware_items", "name"),
  }; }

  async restore(resource: TrashResource, id: number, audit: AdminAudit) { return this.database.transaction(() => {
    const result = this.database.prepare(`UPDATE ${TABLES[resource]} SET deleted_at=NULL,deleted_by=NULL WHERE id=? AND deleted_at IS NOT NULL`).run(id);
    if (!result.changes) return false; this.insertAudit(audit); return true;
  })(); }

  async userExists(userId: number) { return Boolean(this.database.prepare("SELECT 1 FROM users WHERE id=?").get(userId)); }

  async usage(input: UsageQuery) {
    const filters: string[] = []; const values: Array<string | number> = [];
    if (input.rangeDays !== null) { filters.push("created_at >= datetime('now', ?)"); values.push(`-${input.rangeDays} days`); }
    if (input.userId !== null) { filters.push("user_id=?"); values.push(input.userId); }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const summary = this.database.prepare(`SELECT COUNT(*) AS requests,COALESCE(SUM(prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(completion_tokens),0) AS completionTokens,COALESCE(SUM(total_tokens),0) AS totalTokens,
      COALESCE(ROUND(SUM(estimated_cost_usd),6),0) AS estimatedCostUsd,COALESCE(ROUND(AVG(latency_ms)),0) AS avgLatencyMs,
      COALESCE(ROUND(100.0*SUM(CASE WHEN success=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(*),0),1),0) AS successRate,
      COUNT(DISTINCT user_id) AS activeUsers FROM ai_usage_logs ${where}`).get(...values) as Row;
    const trend = this.database.prepare(`SELECT date(created_at) AS date,COUNT(*) AS requests,COALESCE(SUM(prompt_tokens),0) AS promptTokens,
      COALESCE(SUM(completion_tokens),0) AS completionTokens,COALESCE(SUM(total_tokens),0) AS totalTokens FROM ai_usage_logs ${where}
      GROUP BY date(created_at) ORDER BY date(created_at)`).all(...values) as Row[];
    const failures = this.database.prepare(`SELECT endpoint,model,failure_reason AS failureReason,latency_ms AS latencyMs,created_at AS createdAt
      FROM ai_usage_logs ${where ? `${where} AND success=0` : "WHERE success=0"} ORDER BY created_at DESC LIMIT 20`).all(...values) as Row[];
    const models = this.database.prepare(`SELECT model,COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS totalTokens
      FROM ai_usage_logs ${where} GROUP BY model ORDER BY totalTokens DESC,requests DESC`).all(...values) as Row[];
    const endpoints = this.database.prepare(`SELECT endpoint,COUNT(*) AS requests,COALESCE(SUM(total_tokens),0) AS totalTokens
      FROM ai_usage_logs ${where} GROUP BY endpoint ORDER BY totalTokens DESC,requests DESC`).all(...values) as Row[];
    const join = input.rangeDays === null ? "" : "AND l.created_at >= datetime('now', ?)";
    const users = this.database.prepare(`SELECT u.id,u.username,u.avatar_url AS avatarUrl,COUNT(l.id) AS requests,
      COALESCE(SUM(l.prompt_tokens),0) AS promptTokens,COALESCE(SUM(l.completion_tokens),0) AS completionTokens,
      COALESCE(SUM(l.total_tokens),0) AS totalTokens,COALESCE(ROUND(AVG(l.latency_ms)),0) AS avgLatencyMs,
      COALESCE(ROUND(100.0*SUM(CASE WHEN l.success=1 THEN 1 ELSE 0 END)/NULLIF(COUNT(l.id),0),1),0) AS successRate,
      MAX(l.created_at) AS lastUsedAt FROM users u LEFT JOIN ai_usage_logs l ON l.user_id=u.id ${join}
      GROUP BY u.id ORDER BY totalTokens DESC,requests DESC,u.id`).all(...(input.rangeDays === null ? [] : [`-${input.rangeDays} days`])) as Row[];
    return { summary, trend, failures, models, endpoints, users };
  }

  async trends(days: number) { const rows: Row[] = []; for (let offset = days - 1; offset >= 0; offset -= 1) {
    const modifier = `-${offset} days`; const date = String((this.database.prepare("SELECT date('now', ?) AS date").get(modifier) as Row).date);
    const count = (table: string, extra = "") => Number((this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}
      WHERE date(created_at)=date('now', ?) ${extra}`).get(modifier) as Row).count);
    rows.push({ date, users: count("users"), records: count("diet_records"), posts: count("community_posts", "AND deleted_at IS NULL") });
  } return rows; }

  async recent() { return {
    recentUsers: this.database.prepare("SELECT id,username,avatar_url,created_at FROM users ORDER BY created_at DESC LIMIT 5").all() as Row[],
    recentPosts: this.database.prepare(`SELECT id,username,content,image_url,category,created_at FROM community_posts
      WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 5`).all() as Row[],
    pendingFoods: this.database.prepare(`SELECT f.id,f.name,f.calories_100g,f.created_at,u.username AS author_name FROM user_custom_foods f
      LEFT JOIN users u ON u.id=f.user_id WHERE f.status='pending' ORDER BY f.created_at DESC LIMIT 5`).all() as Row[],
  }; }

  private insertAudit(audit: AdminAudit) { this.database.prepare(`INSERT INTO admin_audit_logs
    (admin_user_id,action,resource_type,resource_id,summary,ip_address,user_agent) VALUES (?,?,?,?,?,?,?)`)
    .run(audit.adminUserId,audit.action,audit.resourceType,String(audit.resourceId),audit.summary,audit.ipAddress || null,audit.userAgent || null); }
}
