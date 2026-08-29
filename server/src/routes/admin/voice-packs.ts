import { Router } from "express";

import type { AuthRequest } from "../../middleware/auth.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import {
  parseVoicePackRow,
  validateVoicePackManifest,
  voicePackResourceFingerprint,
  type VoicePackRow,
} from "../../services/voicePacks.js";
import { db } from "../../storage/db.js";
import { sendError } from "../../utils/http.js";
import { auditAdminAction } from "./shared.js";

const statuses = ["draft", "published", "disabled", "revoked"] as const;

function publicAdminRow(row: VoicePackRow) {
  return {
    id: row.id,
    voiceId: row.voice_id,
    name: row.name,
    version: row.version,
    language: row.language,
    styleTags: JSON.parse(row.style_tags_json || "[]"),
    manifest: parseVoicePackRow(row),
    providerVoice: row.provider_voice,
    status: row.status,
    revision: row.revision,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    publishedAt: row.published_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowById(id: number) {
  return db.prepare("SELECT * FROM voice_pack_versions WHERE id = ?").get(id) as VoicePackRow | undefined;
}

function parseDraft(body: Record<string, unknown>) {
  const manifest = validateVoicePackManifest(body.manifest);
  if (!manifest) return null;
  const styleTags = Array.isArray(body.styleTags)
    ? [...new Set(body.styleTags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
    : [];
  const providerVoice = body.providerVoice == null ? null : String(body.providerVoice).trim();
  if (providerVoice && !/^[a-z0-9._-]{1,80}$/i.test(providerVoice)) return null;
  return { manifest, styleTags, providerVoice, fingerprint: voicePackResourceFingerprint(manifest) };
}

function transition(req: AuthRequest, res: any, id: number, target: "published" | "disabled" | "revoked") {
  const row = rowById(id);
  if (!row) return sendError(res, 404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND");
  const expectedRevision = Number(req.body?.revision);
  const reason = String(req.body?.reason || "").trim();
  if (expectedRevision !== row.revision) return sendError(res, 409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
  if (target !== "published" && reason.length < 4) return sendError(res, 400, "请填写状态变更原因", "VOICE_PACK_REASON_REQUIRED");
  if (target === "published" && !["draft", "disabled"].includes(row.status)) return sendError(res, 409, "当前状态不能发布", "VOICE_PACK_INVALID_TRANSITION");
  if (target === "disabled" && row.status !== "published") return sendError(res, 409, "仅已发布音色可以下架", "VOICE_PACK_INVALID_TRANSITION");
  if (target === "revoked" && row.status === "revoked") return sendError(res, 409, "音色已经撤销", "VOICE_PACK_INVALID_TRANSITION");
  if (!validateVoicePackManifest(parseVoicePackRow(row))) return sendError(res, 400, "音色包未通过发布校验", "VOICE_PACK_VALIDATION_FAILED");

  const nextRevision = row.revision + 1;
  const changes = db.transaction(() => {
    const result = db.prepare(`UPDATE voice_pack_versions SET status = ?, revision = ?, reviewed_by = ?,
      published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE published_at END,
      revoked_at = CASE WHEN ? = 'revoked' THEN CURRENT_TIMESTAMP ELSE NULL END,
      revoke_reason = CASE WHEN ? = 'revoked' THEN ? ELSE NULL END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?`)
      .run(target, nextRevision, req.userId!, target, target, target, reason || null, id, row.revision);
    if (!result.changes) return 0;
    db.prepare(`INSERT INTO voice_pack_status_history
      (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, req.userId!, row.status, target, reason || (target === "published" ? "发布审核通过" : null), nextRevision);
    if (target === "revoked") {
      db.prepare(`UPDATE user_voice_preferences SET selected_voice_id = NULL, selected_version = NULL,
        version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE selected_voice_id = ? AND selected_version = ?`)
        .run(row.voice_id, row.version);
    }
    return result.changes;
  })();
  if (!changes) return sendError(res, 409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
  auditAdminAction(req, {
    action: `voice_pack.${target}`,
    resourceType: "voice_pack_version",
    resourceId: id,
    summary: `音色包 ${row.voice_id}@${row.version} 状态变更为 ${target}`,
    details: { before: row.status, after: target, reason: reason || null, revision: nextRevision },
  });
  return res.json({ item: publicAdminRow(rowById(id)!) });
}

export function createAdminVoicePackRouter() {
  const router = Router();
  router.param("id", positiveIntegerParam);

  router.get("/voice-packs", (req, res) => {
    const status = typeof req.query.status === "string" && statuses.includes(req.query.status as typeof statuses[number]) ? req.query.status : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const conditions: string[] = [];
    const params: string[] = [];
    if (status) { conditions.push("status = ?"); params.push(status); }
    if (search) { conditions.push("(voice_id LIKE ? OR name LIKE ? OR version LIKE ?)"); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = db.prepare(`SELECT * FROM voice_pack_versions ${where} ORDER BY updated_at DESC, id DESC LIMIT 200`).all(...params) as VoicePackRow[];
    return res.json({ items: rows.map(publicAdminRow), authority: "database" });
  });

  router.get("/voice-packs/:id/history", (req, res) => {
    if (!rowById(Number(req.params.id))) return sendError(res, 404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND");
    const items = db.prepare(`SELECT id, actor_user_id AS actorUserId, from_status AS fromStatus,
      to_status AS toStatus, reason, revision, created_at AS createdAt
      FROM voice_pack_status_history WHERE voice_pack_version_id = ? ORDER BY id DESC`).all(req.params.id);
    return res.json({ items });
  });

  router.post("/voice-packs", (req: AuthRequest, res) => {
    const draft = parseDraft(req.body || {});
    if (!draft) return sendError(res, 400, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED");
    try {
      const result = db.prepare(`INSERT INTO voice_pack_versions
        (voice_id, name, version, language, style_tags_json, manifest_json, resource_fingerprint, provider_voice, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(draft.manifest.voiceId, draft.manifest.name, draft.manifest.version, draft.manifest.language,
          JSON.stringify(draft.styleTags), JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, req.userId!);
      const id = Number(result.lastInsertRowid);
      db.prepare(`INSERT INTO voice_pack_status_history
        (voice_pack_version_id, actor_user_id, from_status, to_status, reason, revision)
        VALUES (?, ?, NULL, 'draft', '创建草稿', 1)`).run(id, req.userId!);
      auditAdminAction(req, { action: "voice_pack.create", resourceType: "voice_pack_version", resourceId: id, summary: `创建音色包草稿 ${draft.manifest.voiceId}@${draft.manifest.version}` });
      return res.status(201).json({ item: publicAdminRow(rowById(id)!) });
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) return sendError(res, 409, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE");
      throw error;
    }
  });

  router.put("/voice-packs/:id", (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const row = rowById(id);
    if (!row) return sendError(res, 404, "音色包版本不存在", "VOICE_PACK_VERSION_NOT_FOUND");
    if (row.status !== "draft") return sendError(res, 409, "已进入发布流程的资源不可原地覆盖，请创建新版本", "VOICE_PACK_IMMUTABLE");
    if (Number(req.body?.revision) !== row.revision) return sendError(res, 409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
    const draft = parseDraft(req.body || {});
    if (!draft) return sendError(res, 400, "音色包清单、HTTPS 资源、摘要或授权字段无效", "VOICE_PACK_VALIDATION_FAILED");
    try {
      const nextRevision = row.revision + 1;
      const result = db.prepare(`UPDATE voice_pack_versions SET voice_id = ?, name = ?, version = ?, language = ?,
        style_tags_json = ?, manifest_json = ?, resource_fingerprint = ?, provider_voice = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND revision = ? AND status = 'draft'`)
        .run(draft.manifest.voiceId, draft.manifest.name, draft.manifest.version, draft.manifest.language,
          JSON.stringify(draft.styleTags), JSON.stringify(draft.manifest), draft.fingerprint, draft.providerVoice, nextRevision, id, row.revision);
      if (!result.changes) return sendError(res, 409, "音色包已被其他管理员更新", "VOICE_PACK_REVISION_CONFLICT");
      auditAdminAction(req, { action: "voice_pack.update", resourceType: "voice_pack_version", resourceId: id, summary: `更新音色包草稿 ${draft.manifest.voiceId}@${draft.manifest.version}`, details: { revision: nextRevision } });
      return res.json({ item: publicAdminRow(rowById(id)!) });
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) return sendError(res, 409, "音色版本或资源已经存在", "VOICE_PACK_DUPLICATE");
      throw error;
    }
  });

  router.post("/voice-packs/:id/publish", (req: AuthRequest, res) => transition(req, res, Number(req.params.id), "published"));
  router.post("/voice-packs/:id/disable", (req: AuthRequest, res) => transition(req, res, Number(req.params.id), "disabled"));
  router.post("/voice-packs/:id/revoke", (req: AuthRequest, res) => transition(req, res, Number(req.params.id), "revoked"));

  return router;
}
