import { aiErrorTypeForCode, sanitizeAIErrorMessage } from "../../services/aiErrors.js";
import { AdminConsoleError } from "./errors.js";
import type { AdminConsoleRepository } from "./repository.js";
import type { AuditContext, Row, TrashResource } from "./types.js";

const RANGES: Record<string, number | null> = { "7d": 7, "30d": 30, "90d": 90, all: null };
const RESOURCES: Record<TrashResource, string> = { community: "社区帖子", recipes: "食谱", ingredients: "食材", kitchenware: "厨具" };
function parseJson(value: unknown, fallback: unknown) {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function numeric(row: Row, keys: string[]) { const copy = { ...row }; for (const key of keys) copy[key] = Number(copy[key] || 0); return copy; }

export class AdminConsoleService {
  private readonly repository: AdminConsoleRepository;
  constructor(repository: AdminConsoleRepository) { this.repository = repository; }

  stats() { return this.repository.stats(); }
  async funnel(query: Row) { const days = Math.max(1, Math.min(90, Number(query.days) || 30));
    return { days, items: (await this.repository.funnel(days)).map((row) => numeric(row, ["events", "users"])) }; }

  async auditLogs(query: Row) {
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(10, Number(query.pageSize) || 20));
    const result = await this.repository.auditLogs({ page, pageSize,
      action: typeof query.action === "string" && query.action.trim() ? query.action.trim() : undefined,
      resourceType: typeof query.resourceType === "string" && query.resourceType.trim() ? query.resourceType.trim() : undefined });
    return { ...result, items: result.items.map((item) => ({ ...item,
      detailsJson: typeof item.detailsJson === "string" || item.detailsJson == null ? item.detailsJson : JSON.stringify(item.detailsJson) }) as Row), page, pageSize };
  }

  async scanJobs(query: Row) {
    const status = ["queued", "processing", "completed", "failed"].includes(String(query.status)) ? String(query.status) : undefined;
    const user = typeof query.user === "string" && query.user.trim() ? query.user.trim() : undefined;
    const rows = await this.repository.scanJobs({ status, user });
    return { items: rows.map(({ resultJson, ...job }) => ({ ...job,
      itemCount: Array.isArray(parseJson(resultJson, [])) ? (parseJson(resultJson, []) as unknown[]).length : 0 }) as Row) };
  }

  async scanJob(id: string) {
    const job = await this.repository.scanJob(id); if (!job) throw new AdminConsoleError(404, "识别任务不存在");
    const { resultJson, ...detail } = job; const items = parseJson(resultJson, []);
    return { ...detail, items: Array.isArray(items) ? items : [] };
  }

  async conversations(query: Row) {
    const search = typeof query.query === "string" && query.query.trim() ? query.query.trim() : undefined;
    const items = (await this.repository.conversations(search)).map((row) => numeric(row,
      ["userId", "turnCount", "messageCount", "avgResponseTimeMs", "failedCount"]));
    return { items };
  }

  async conversation(userId: number, sessionId: string) {
    if (!Number.isInteger(userId) || userId <= 0 || !sessionId) throw new AdminConsoleError(400, "会话参数无效");
    const data = await this.repository.conversation(userId, sessionId);
    if (!data.user) throw new AdminConsoleError(404, "用户不存在");
    const messages = await Promise.all(data.messages.map(async ({ payloadJson, ...message }) => {
      let payload = parseJson(payloadJson, payloadJson ? { legacyCardSummaries: [String(payloadJson)] } : null);
      if (message.status === "failed" && payload && typeof payload === "object") {
        const details = payload as Row; const runId = typeof details.agentRunId === "string" ? details.agentRunId : "";
        if (runId) { const diagnostic = await this.repository.runDiagnostic(userId, runId);
          const errorCode = diagnostic?.errorCode || (typeof details.errorCode === "string" ? details.errorCode : "AI_AGENT_FAILED");
          payload = { ...details, errorCode,
            errorType: typeof details.errorType === "string" ? details.errorType : aiErrorTypeForCode(errorCode),
            errorMessage: sanitizeAIErrorMessage(diagnostic?.errorMessage || details.errorMessage),
            failureStage: typeof details.failureStage === "string" ? details.failureStage : "agent_execution",
            modelIdentifier: diagnostic?.model || details.modelIdentifier || null };
        }
      }
      return { ...message, payload };
    }));
    if (!messages.length) throw new AdminConsoleError(404, "对话不存在");
    return { user: data.user, sessionId, messages };
  }

  trash() { return this.repository.trash(); }
  async restore(resource: string, id: number, context: AuditContext) {
    if (!(resource in RESOURCES) || !Number.isInteger(id) || id <= 0) throw new AdminConsoleError(400, "无效的回收站资源");
    const key = resource as TrashResource; const label = RESOURCES[key];
    if (!await this.repository.restore(key, id, { ...context, action: `${key}.restore`, resourceType: key,
      resourceId: id, summary: `恢复${label}` })) throw new AdminConsoleError(404, "回收站中未找到该记录");
    return { success: true, message: `${label}已恢复` };
  }

  async usage(query: Row) {
    const range = typeof query.range === "string" && query.range in RANGES ? query.range : "30d";
    const userId = query.userId === undefined ? null : Number(query.userId);
    if (userId !== null && (!Number.isInteger(userId) || userId <= 0)) throw new AdminConsoleError(400, "无效的用户 ID");
    if (userId !== null && !await this.repository.userExists(userId)) throw new AdminConsoleError(404, "用户不存在");
    const data = await this.repository.usage({ rangeDays: RANGES[range]!, userId });
    const usageKeys = ["requests", "promptTokens", "completionTokens", "totalTokens", "estimatedCostUsd", "avgLatencyMs", "successRate", "activeUsers"];
    return { range, selectedUserId: userId, summary: numeric(data.summary, usageKeys),
      trend: data.trend.map((row) => numeric(row, usageKeys)), models: data.models.map((row) => numeric(row, usageKeys)),
      endpoints: data.endpoints.map((row) => numeric(row, usageKeys)), failures: data.failures.map((row) => numeric(row, ["latencyMs"])),
      users: data.users.map((row) => numeric(row, usageKeys)) };
  }

  trends() { return this.repository.trends(7); }
  recent() { return this.repository.recent(); }
}
