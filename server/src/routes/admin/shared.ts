import type { AuthRequest } from "../../middleware/auth.js";
import { logAdminAction } from "../../storage/db.js";

export type AdminAuditEvent = {
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  summary: string;
  details?: Record<string, unknown>;
};

export function auditAdminAction(req: AuthRequest, event: AdminAuditEvent) {
  if (!req.userId) return;
  logAdminAction({
    adminUserId: req.userId,
    ...event,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
}

export function deletedFilter(status: unknown, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  if (status === "deleted") return `${prefix}deleted_at IS NOT NULL`;
  if (status === "all") return "1=1";
  return `${prefix}deleted_at IS NULL`;
}
