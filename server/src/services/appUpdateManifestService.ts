import { randomUUID } from "node:crypto";
import { open, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  APP_UPDATE_MANIFEST_MAX_BYTES,
  appUpdateManifestSchema,
  type AppUpdateManifest,
  type AppUpdateRelease,
} from "@dietdigidose/contracts";

export function parseAllowedOrigins(raw?: string): string[] {
  if (!raw?.trim()) return [];
  const origins = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  const validated: string[] = [];
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" && parsed.origin === origin) {
        validated.push(origin);
      }
    } catch {
      // Invalid origin ignored in list
    }
  }
  return validated;
}

export async function readAppUpdateManifest(manifestPath?: string): Promise<{
  configured: boolean;
  path: string;
  manifest: AppUpdateManifest;
  error?: string;
}> {
  if (!manifestPath?.trim()) {
    return {
      configured: false,
      path: "",
      manifest: { schemaVersion: 1, releases: [] },
    };
  }
  try {
    const file = await open(manifestPath, "r");
    let contents: string;
    try {
      const buffer = Buffer.alloc(APP_UPDATE_MANIFEST_MAX_BYTES + 1);
      const { bytesRead } = await file.read(buffer);
      if (bytesRead > APP_UPDATE_MANIFEST_MAX_BYTES) {
        return {
          configured: true,
          path: manifestPath,
          manifest: { schemaVersion: 1, releases: [] },
          error: "清单文件超出大小上限",
        };
      }
      contents = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
    const parsed = appUpdateManifestSchema.safeParse(JSON.parse(contents));
    if (!parsed.success) {
      return {
        configured: true,
        path: manifestPath,
        manifest: { schemaVersion: 1, releases: [] },
        error: "清单文件内容格式无效",
      };
    }
    return {
      configured: true,
      path: manifestPath,
      manifest: parsed.data,
    };
  } catch (err: unknown) {
    const nodeError = err as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return {
        configured: true,
        path: manifestPath,
        manifest: { schemaVersion: 1, releases: [] },
      };
    }
    return {
      configured: true,
      path: manifestPath,
      manifest: { schemaVersion: 1, releases: [] },
      error: nodeError?.message || "无法读取清单文件",
    };
  }
}

export function replaceManifestRelease(
  previous: AppUpdateManifest,
  release: AppUpdateRelease,
): AppUpdateManifest {
  const existing = previous.releases.find(
    (item) => item.applicationId === release.applicationId && item.channel === release.channel,
  );
  if (
    existing &&
    (release.buildNumber < existing.buildNumber ||
      (release.buildNumber === existing.buildNumber &&
        JSON.stringify(release) !== JSON.stringify(existing)))
  ) {
    throw new Error("不能发布低于或重复且不一致的构建编号版本");
  }
  return appUpdateManifestSchema.parse({
    schemaVersion: 1,
    releases: [
      ...previous.releases.filter(
        (item) => item.applicationId !== release.applicationId || item.channel !== release.channel,
      ),
      release,
    ],
  });
}

export function revokeManifestRelease(
  previous: AppUpdateManifest,
  applicationId: string,
  channel: string,
): AppUpdateManifest {
  return appUpdateManifestSchema.parse({
    schemaVersion: 1,
    releases: previous.releases.filter(
      (item) => item.applicationId !== applicationId || item.channel !== channel,
    ),
  });
}

export async function writeAppUpdateManifest(
  manifestPath: string,
  manifest: AppUpdateManifest,
): Promise<void> {
  const validated = appUpdateManifestSchema.parse(manifest);
  const serialized = `${JSON.stringify(validated, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > APP_UPDATE_MANIFEST_MAX_BYTES) {
    throw new Error("更新清单超出大小上限");
  }
  const tempPath = `${manifestPath}.tmp.${randomUUID()}`;
  try {
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, manifestPath);
  } catch (err) {
    await unlink(tempPath).catch(() => undefined);
    throw err;
  }
}
