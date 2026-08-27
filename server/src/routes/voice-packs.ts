import { Router } from "express";

import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { sharedRateLimit } from "../middleware/sharedRateLimit.js";
import { getChatConfig } from "../services/aiService.js";
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js";
import { sendError } from "../utils/http.js";

type VoicePackResource = { path: string; url: string; sha256: string; bytes: number };
type VoicePackManifest = {
  voiceId: string;
  name: string;
  version: string;
  language: string;
  sampleRate: number;
  outputFormat: "pcm-f32";
  minimumAppVersion: string;
  minimumMemoryMb: number;
  license: { name: string; url: string; speakerAuthorization: string; modelNotice: string };
  resources: VoicePackResource[];
  model: { path: string; vocabularyPath: string; inputNames: { tokens: string; lengths: string; scales?: string; speakerId?: string }; outputName?: string; speakerId?: number };
  previewUrl?: string;
  revoked?: boolean;
};

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

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export function parseVoicePackCatalog(raw = process.env.VOICE_PACK_CATALOG_JSON || "[]") {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((candidate): VoicePackManifest[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as VoicePackManifest;
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(String(item.voiceId || ""))) return [];
    if (!/^\d+\.\d+\.\d+$/.test(String(item.version || ""))) return [];
    if (!item.name || item.language !== "zh-CN" || item.outputFormat !== "pcm-f32") return [];
    if (!Number.isInteger(item.sampleRate) || item.sampleRate < 8_000 || item.sampleRate > 48_000) return [];
    if (!item.license?.name || !safeHttpsUrl(item.license.url) || !item.license.speakerAuthorization || !item.license.modelNotice) return [];
    if (!Array.isArray(item.resources) || !item.resources.length || item.resources.some((resource) =>
      !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(resource.path)
      || resource.path.includes("..") || !safeHttpsUrl(resource.url) || !isHexSha256(resource.sha256)
      || !Number.isInteger(resource.bytes) || resource.bytes <= 0)) return [];
    if (!item.model?.path || !item.model.vocabularyPath || !item.model.inputNames?.tokens || !item.model.inputNames.lengths) return [];
    const resourcePaths = new Set(item.resources.map((resource) => resource.path));
    if (resourcePaths.size !== item.resources.length || !resourcePaths.has(item.model.path) || !resourcePaths.has(item.model.vocabularyPath)) return [];
    if (!item.minimumAppVersion || !Number.isInteger(item.minimumMemoryMb) || item.minimumMemoryMb < 128) return [];
    if (item.previewUrl && !safeHttpsUrl(item.previewUrl)) return [];
    return [{ ...item, revoked: Boolean(item.revoked) }];
  });
}

router.get("/", (_req, res) => {
  const catalog = parseVoicePackCatalog();
  return res.json({
    items: catalog.filter((item) => !item.revoked),
    revoked: catalog.filter((item) => item.revoked).map((item) => ({ voiceId: item.voiceId, version: item.version })),
    syntheticVoiceDisclosure: "音色包生成的内容属于合成语音；模型文件安装到设备后可能被提取。",
  });
});

router.post("/synthesize", ttsRateLimit, async (req: AuthRequest, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text || text.length > 600) return sendError(res, 400, "朗读文本需为 1-600 个字符", "INVALID_TTS_TEXT");
  const configuredBase = String(process.env.TTS_BASE_URL || "").trim().replace(/\/$/, "");
  const configuredKey = String(process.env.TTS_API_KEY || "").trim();
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
        voice: process.env.TTS_VOICE || "alloy",
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
