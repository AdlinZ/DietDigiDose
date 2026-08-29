import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { sharedRateLimit } from "../middleware/sharedRateLimit.js";
import { getChatConfig } from "../services/aiService.js";
import { db } from "../storage/db.js";
import {
  findPublishedVoicePack,
  parseVoicePackCatalog,
  publicVoicePackCatalog,
  safeHttpsUrl,
} from "../services/voicePacks.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { sendError } from "../utils/http.js";

const router = Router();
router.use(authMiddleware);
const ttsRateLimit = sharedRateLimit({
  namespace: "tts-user",
  limit: Math.max(10, Number(process.env.TTS_RATE_LIMIT) || 120),
  windowMs: 15 * 60 * 1000,
  key: (req) => String((req as AuthRequest).userId || "unknown"),
  message: "语音合成请求过于频繁，请稍后重试",
  code: "TTS_RATE_LIMITED",
});

export { parseVoicePackCatalog };

router.get("/", (req, res) => {
  const catalog = publicVoicePackCatalog(String(req.get("x-client-version") || "0.0.0"));
  res.set("ETag", `W/\"voice-catalog-${catalog.catalogVersion}\"`);
  return res.json({
    ...catalog,
    syntheticVoiceDisclosure: "音色包生成的内容属于合成语音；模型文件安装到设备后可能被提取。",
  });
});

router.get("/preference", (req: AuthRequest, res) => {
  const row = db.prepare("SELECT selected_voice_id, selected_version, preference, version, updated_at FROM user_voice_preferences WHERE user_id = ?")
    .get(req.userId!) as Record<string, unknown> | undefined;
  return res.json(row ? {
    selectedVoiceId: row.selected_voice_id,
    selectedVersion: row.selected_version,
    preference: row.preference,
    version: Number(row.version),
    updatedAt: row.updated_at,
  } : { selectedVoiceId: null, selectedVersion: null, preference: "automatic", version: 0, updatedAt: null });
});

router.put("/preference", (req: AuthRequest, res) => {
  const preference = req.body?.preference;
  const selectedVoiceId = req.body?.selectedVoiceId == null ? null : String(req.body.selectedVoiceId);
  const selectedVersion = req.body?.selectedVersion == null ? null : String(req.body.selectedVersion);
  const expectedVersion = Number(req.body?.version ?? 0);
  if (!["automatic", "system-only"].includes(preference)) return sendError(res, 400, "语音偏好无效", "INVALID_VOICE_PREFERENCE");
  if ((selectedVoiceId || selectedVersion) && (!selectedVoiceId || !selectedVersion || !findPublishedVoicePack(selectedVoiceId, selectedVersion))) {
    return sendError(res, 400, "所选音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE");
  }
  const existing = db.prepare("SELECT version FROM user_voice_preferences WHERE user_id = ?").get(req.userId!) as { version: number } | undefined;
  if (existing && expectedVersion !== existing.version) return sendError(res, 409, "语音偏好已在其他设备更新", "VOICE_PREFERENCE_VERSION_CONFLICT");
  if (!existing && expectedVersion !== 0) return sendError(res, 409, "语音偏好版本无效", "VOICE_PREFERENCE_VERSION_CONFLICT");
  db.prepare(`INSERT INTO user_voice_preferences (user_id, selected_voice_id, selected_version, preference)
    VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
      selected_voice_id = excluded.selected_voice_id, selected_version = excluded.selected_version,
      preference = excluded.preference, version = user_voice_preferences.version + 1, updated_at = CURRENT_TIMESTAMP`)
    .run(req.userId!, selectedVoiceId, selectedVersion, preference);
  const row = db.prepare("SELECT selected_voice_id, selected_version, preference, version, updated_at FROM user_voice_preferences WHERE user_id = ?").get(req.userId!) as Record<string, unknown>;
  return res.json({ selectedVoiceId: row.selected_voice_id, selectedVersion: row.selected_version, preference: row.preference, version: Number(row.version), updatedAt: row.updated_at });
});

router.post("/synthesize", ttsRateLimit, async (req: AuthRequest, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 600) return sendError(res, 400, "朗读文本需为 1-600 个字符", "INVALID_TTS_TEXT");
  const configuredBase = String(process.env.TTS_BASE_URL || "").trim().replace(/\/$/, "");
  const configuredKey = String(process.env.TTS_API_KEY || "").trim();
  const requestedVoiceId = req.body?.voiceId == null ? null : String(req.body.voiceId);
  const requestedVersion = req.body?.version == null ? null : String(req.body.version);
  const selectedPack = requestedVoiceId ? findPublishedVoicePack(requestedVoiceId, requestedVersion) : null;
  if (requestedVoiceId && !selectedPack) return sendError(res, 400, "音色未发布或已撤销", "VOICE_PACK_NOT_AVAILABLE");
  const chat = getChatConfig();
  const baseUrl = configuredBase || chat.baseUrl;
  const apiKey = configuredKey || chat.apiKey;
  if (!apiKey || !safeHttpsUrl(baseUrl)) return sendError(res, 503, "云端语音暂不可用", "TTS_NOT_CONFIGURED");
  try {
    const response = await fetchWithTimeout(`${baseUrl}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
        voice: selectedPack?.provider_voice || process.env.TTS_VOICE || "alloy",
        input: text,
        response_format: "mp3",
      }),
    }, 30_000);
    if (!response.ok) return sendError(res, 502, "云端语音生成失败", "TTS_UPSTREAM_FAILED");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) return sendError(res, 502, "云端语音响应无效", "TTS_INVALID_RESPONSE");
    return res.json({ audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg", source: "server", userId: req.userId });
  } catch {
    return sendError(res, 504, "云端语音请求超时", "TTS_TIMEOUT");
  }
});

export default router;
