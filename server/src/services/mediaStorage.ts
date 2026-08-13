import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getSupabaseClient, getSupabaseServiceRoleKey } from "../storage/database/supabase-client.js";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class MediaStorageUnavailableError extends Error {}
export class InvalidMediaError extends Error {}

export async function uploadImageDataUrl(dataUrl: string, userId: number, scope: "community") {
  const parsed = parseImageDataUrl(dataUrl);
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  if (!bucket || !getSupabaseServiceRoleKey()) {
    return uploadToLocalMedia(parsed, userId, scope);
  }
  const client = getSupabaseClient();
  if (!client) return uploadToLocalMedia(parsed, userId, scope);

  const objectPath = `${scope}/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${parsed.extension}`;
  const { error } = await client.storage.from(bucket).upload(objectPath, parsed.buffer, {
    contentType: parsed.mimeType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`媒体上传失败: ${error.message}`);
  const { data } = client.storage.from(bucket).getPublicUrl(objectPath);
  if (!data.publicUrl) throw new Error("媒体对象存储未返回公开 URL");
  return { url: data.publicUrl, objectPath, bytes: parsed.buffer.byteLength, mimeType: parsed.mimeType };
}

const getPublicMediaRoot = () => path.resolve(process.env.MEDIA_LOCAL_ROOT || path.join(process.cwd(), "public"));

async function uploadToLocalMedia(
  parsed: ReturnType<typeof parseImageDataUrl>,
  userId: number,
  scope: "community",
) {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `${randomUUID()}.${parsed.extension}`;
  const objectPath = `uploads/${scope}/${userId}/${date}/${fileName}`;
  const publicMediaRoot = getPublicMediaRoot();
  const destination = path.resolve(publicMediaRoot, objectPath);
  if (!destination.startsWith(`${publicMediaRoot}${path.sep}`)) {
    throw new InvalidMediaError("媒体保存路径无效");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, parsed.buffer, { flag: "wx" });
  return {
    url: `/media/${objectPath}`,
    objectPath,
    bytes: parsed.buffer.byteLength,
    mimeType: parsed.mimeType,
  };
}

function getPublicObjectPrefix() {
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  const baseUrl = process.env.SUPABASE_URL?.trim();
  if (!bucket || !baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
}

export function isStoredMediaUrlForUser(url: string, userId: number, scope: "community" = "community") {
  const prefix = getPublicObjectPrefix();
  const localPrefix = `/media/uploads/${scope}/${userId}/`;
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* relative media URL */ }
  return pathname.startsWith(localPrefix) || Boolean(prefix && url.startsWith(`${prefix}${scope}/${userId}/`));
}

export async function deleteStoredMediaUrls(userId: number, urls: Array<string | null | undefined>) {
  const localUrls = urls.flatMap((url) => {
    if (typeof url !== "string") return [];
    try {
      const pathname = new URL(url).pathname;
      return pathname.startsWith(`/media/uploads/community/${userId}/`) ? [pathname] : [];
    } catch {
      return url.startsWith(`/media/uploads/community/${userId}/`) ? [url] : [];
    }
  });
  const publicMediaRoot = getPublicMediaRoot();
  await Promise.all(localUrls.map(async (url) => {
    const relativePath = url.slice("/media/".length);
    const destination = path.resolve(publicMediaRoot, relativePath);
    if (destination.startsWith(`${publicMediaRoot}${path.sep}`)) await rm(destination, { force: true });
  }));
  const bucket = process.env.SUPABASE_MEDIA_BUCKET?.trim();
  const prefix = getPublicObjectPrefix();
  if (!bucket || !prefix || !getSupabaseServiceRoleKey()) return;
  const objectPaths = [...new Set(urls
    .filter((url): url is string => typeof url === "string" && isStoredMediaUrlForUser(url, userId))
    .map((url) => decodeURIComponent(url.slice(prefix.length)))
    .filter(Boolean))];
  if (!objectPaths.length) return;
  const client = getSupabaseClient();
  if (!client) throw new MediaStorageUnavailableError("媒体对象存储尚未配置");
  const { error } = await client.storage.from(bucket).remove(objectPaths);
  if (error) throw new Error(`媒体删除失败: ${error.message}`);
}

export function parseImageDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new InvalidMediaError("仅支持 JPEG、PNG、WebP 或 GIF 图片");
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new InvalidMediaError("图片不能为空且不得超过 4 MB");
  }
  if (!matchesMagicBytes(buffer, mimeType)) throw new InvalidMediaError("图片内容与声明格式不一致");
  return { buffer, mimeType, extension: MIME_EXTENSIONS[mimeType] };
}

function matchesMagicBytes(buffer: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (mimeType === "image/gif") return buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
  return false;
}
