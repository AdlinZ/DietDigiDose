import { createHash } from "node:crypto";
import type { VoicePackManifest, VoicePackResource, VoicePackRow } from "./types.js";

function isHexSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
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
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(String(item.voiceId || "")) || !/^\d+\.\d+\.\d+$/.test(String(item.version || ""))) return [];
    if (!item.name || item.language !== "zh-CN" || item.outputFormat !== "pcm-f32") return [];
    if (item.gender && !["male", "female", "neutral", "unspecified"].includes(item.gender)) return [];
    if (item.deviceRequirements && (!Array.isArray(item.deviceRequirements) || item.deviceRequirements.length > 12
      || item.deviceRequirements.some((value) => typeof value !== "string" || !value.trim() || value.length > 120))) return [];
    if (!Number.isInteger(item.sampleRate) || item.sampleRate < 8_000 || item.sampleRate > 48_000) return [];
    if (!item.license?.name || !safeHttpsUrl(item.license.url) || !item.license.speakerAuthorization || !item.license.modelNotice) return [];
    if (!Array.isArray(item.resources) || !item.resources.length || item.resources.some((resource) =>
      !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(resource.path) || resource.path.includes("..") || !safeHttpsUrl(resource.url)
      || !isHexSha256(resource.sha256) || !Number.isInteger(resource.bytes) || resource.bytes <= 0)) return [];
    if (!item.model?.path || !item.model.vocabularyPath || !item.model.inputNames?.tokens || !item.model.inputNames.lengths) return [];
    const paths = new Set(item.resources.map((resource) => resource.path));
    if (paths.size !== item.resources.length || !paths.has(item.model.path) || !paths.has(item.model.vocabularyPath)) return [];
    if (!/^\d+\.\d+\.\d+$/.test(String(item.minimumAppVersion || "")) || !Number.isInteger(item.minimumMemoryMb) || item.minimumMemoryMb < 128) return [];
    if (item.previewUrl && !safeHttpsUrl(item.previewUrl)) return [];
    return [{ ...item, revoked: Boolean(item.revoked) }];
  });
}
export function validateVoicePackManifest(value: unknown) { return parseVoicePackCatalog(JSON.stringify([value]))[0] || null; }
export function voicePackResourceFingerprint(manifest: VoicePackManifest) {
  return createHash("sha256").update(JSON.stringify(manifest.resources
    .map(({ path, url, sha256, bytes }: VoicePackResource) => ({ path, url, sha256: sha256.toLowerCase(), bytes }))
    .sort((left, right) => left.path.localeCompare(right.path)))).digest("hex");
}
export function parseVoicePackRow(row: VoicePackRow) {
  return (typeof row.manifest_json === "string" ? JSON.parse(row.manifest_json) : row.manifest_json) as VoicePackManifest;
}
function semverParts(value: string) { return /^\d+\.\d+\.\d+/.test(value) ? value.split(".").slice(0, 3).map(Number) : [0, 0, 0]; }
export function appVersionAtLeast(actual: string, minimum: string) {
  const left = semverParts(actual); const right = semverParts(minimum);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index]! > right[index]!;
  return true;
}
