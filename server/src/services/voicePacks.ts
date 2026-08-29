import { createHash } from "node:crypto";

import { db } from "../storage/db.js";

export type VoicePackResource = { path: string; url: string; sha256: string; bytes: number };
export type VoicePackManifest = {
  voiceId: string;
  name: string;
  version: string;
  language: string;
  gender?: "male" | "female" | "neutral" | "unspecified";
  deviceRequirements?: string[];
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

export type VoicePackRow = {
  id: number;
  voice_id: string;
  name: string;
  version: string;
  language: string;
  style_tags_json: string;
  manifest_json: string;
  resource_fingerprint: string;
  provider_voice: string | null;
  status: "draft" | "published" | "disabled" | "revoked";
  revision: number;
  created_by: number | null;
  reviewed_by: number | null;
  published_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

function isHexSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

export function safeHttpsUrl(value: unknown) {
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
    if (item.gender && !["male", "female", "neutral", "unspecified"].includes(item.gender)) return [];
    if (item.deviceRequirements && (!Array.isArray(item.deviceRequirements)
      || item.deviceRequirements.length > 12
      || item.deviceRequirements.some((requirement) => typeof requirement !== "string" || !requirement.trim() || requirement.length > 120))) return [];
    if (!Number.isInteger(item.sampleRate) || item.sampleRate < 8_000 || item.sampleRate > 48_000) return [];
    if (!item.license?.name || !safeHttpsUrl(item.license.url) || !item.license.speakerAuthorization || !item.license.modelNotice) return [];
    if (!Array.isArray(item.resources) || !item.resources.length || item.resources.some((resource) =>
      !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(resource.path)
      || resource.path.includes("..") || !safeHttpsUrl(resource.url) || !isHexSha256(resource.sha256)
      || !Number.isInteger(resource.bytes) || resource.bytes <= 0)) return [];
    if (!item.model?.path || !item.model.vocabularyPath || !item.model.inputNames?.tokens || !item.model.inputNames.lengths) return [];
    const resourcePaths = new Set(item.resources.map((resource) => resource.path));
    if (resourcePaths.size !== item.resources.length || !resourcePaths.has(item.model.path) || !resourcePaths.has(item.model.vocabularyPath)) return [];
    if (!/^\d+\.\d+\.\d+$/.test(String(item.minimumAppVersion || "")) || !Number.isInteger(item.minimumMemoryMb) || item.minimumMemoryMb < 128) return [];
    if (item.previewUrl && !safeHttpsUrl(item.previewUrl)) return [];
    return [{ ...item, revoked: Boolean(item.revoked) }];
  });
}

export function validateVoicePackManifest(candidate: unknown) {
  const parsed = parseVoicePackCatalog(JSON.stringify([candidate]));
  return parsed.length === 1 ? parsed[0] : null;
}

export function voicePackResourceFingerprint(manifest: VoicePackManifest) {
  return createHash("sha256").update(JSON.stringify(manifest.resources
    .map(({ path, url, sha256, bytes }) => ({ path, url, sha256: sha256.toLowerCase(), bytes }))
    .sort((left, right) => left.path.localeCompare(right.path)))).digest("hex");
}

export function ensureEnvironmentVoiceCatalogImported() {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM voice_pack_versions").get() as { count: number }).count;
  if (count > 0) return;
  const catalog = parseVoicePackCatalog();
  if (!catalog.length) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO voice_pack_versions
    (voice_id, name, version, language, manifest_json, resource_fingerprint, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`);
  const history = db.prepare(`INSERT INTO voice_pack_status_history
    (voice_pack_version_id, from_status, to_status, reason, revision) VALUES (?, NULL, ?, ?, 1)`);
  db.transaction(() => {
    for (const manifest of catalog) {
      const result = insert.run(manifest.voiceId, manifest.name, manifest.version, manifest.language,
        JSON.stringify({ ...manifest, revoked: undefined }), voicePackResourceFingerprint(manifest), manifest.revoked ? "revoked" : "published");
      if (result.changes) history.run(result.lastInsertRowid, manifest.revoked ? "revoked" : "published", "由 VOICE_PACK_CATALOG_JSON 一次性导入");
    }
  })();
}

export function parseVoicePackRow(row: VoicePackRow) {
  return JSON.parse(row.manifest_json) as VoicePackManifest;
}

function semverParts(value: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}

export function appVersionAtLeast(actual: string, minimum: string) {
  const left = semverParts(actual);
  const right = semverParts(minimum);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

export function publicVoicePackCatalog(clientVersion = "0.0.0") {
  ensureEnvironmentVoiceCatalogImported();
  const rows = db.prepare("SELECT * FROM voice_pack_versions ORDER BY voice_id, id DESC").all() as VoicePackRow[];
  const items = rows
    .filter((row) => row.status === "published")
    .map(parseVoicePackRow)
    .filter((manifest) => appVersionAtLeast(clientVersion, manifest.minimumAppVersion));
  const revoked = rows.filter((row) => row.status === "revoked").map((row) => ({ voiceId: row.voice_id, version: row.version }));
  const versionSource = rows.map((row) => `${row.id}:${row.revision}:${row.status}:${row.updated_at}`).join("|");
  return {
    items,
    revoked,
    catalogVersion: createHash("sha256").update(versionSource).digest("hex").slice(0, 20),
    authority: "database" as const,
  };
}

export function findPublishedVoicePack(voiceId: string, version?: string | null) {
  ensureEnvironmentVoiceCatalogImported();
  return db.prepare(`SELECT * FROM voice_pack_versions
    WHERE voice_id = ? AND status = 'published' ${version ? "AND version = ?" : ""}
    ORDER BY id DESC LIMIT 1`).get(...(version ? [voiceId, version] : [voiceId])) as VoicePackRow | undefined;
}
