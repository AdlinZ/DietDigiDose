import { Router } from "express";
import { z } from "zod";
import {
  appUpdateApplicationIdSchema,
  appUpdateChannelSchema,
  appUpdateReleaseSchema,
} from "@dietdigidose/contracts";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { auditAdminAction } from "./shared.js";
import {
  parseAllowedOrigins,
  readAppUpdateManifest,
  replaceManifestRelease,
  revokeManifestRelease,
  writeAppUpdateManifest,
} from "../../services/appUpdateManifestService.js";

const revokeBodySchema = z.object({
  applicationId: appUpdateApplicationIdSchema,
  channel: appUpdateChannelSchema,
}).strict();

export function createAdminAppUpdatesRouter(options = {
  manifestPath: process.env.APP_UPDATE_MANIFEST_PATH,
  allowedOrigins: process.env.APP_UPDATE_ALLOWED_ORIGINS,
}) {
  const router = Router();

  router.get("/app-updates", async (_req, res, next) => {
    try {
      const allowedOrigins = parseAllowedOrigins(options.allowedOrigins);
      const { configured, path, manifest, error } = await readAppUpdateManifest(options.manifestPath);
      res.json({
        configured: configured && allowedOrigins.length > 0,
        manifestPath: path,
        allowedOrigins,
        manifest,
        error: error || null,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/app-updates/publish",
    validateBody(appUpdateReleaseSchema),
    async (req: AuthRequest, res, next) => {
      try {
        const manifestPath = options.manifestPath;
        const allowedOrigins = parseAllowedOrigins(options.allowedOrigins);
        if (!manifestPath || allowedOrigins.length === 0) {
          return sendError(res, 400, "服务端尚未配置 APP_UPDATE_MANIFEST_PATH 或 APP_UPDATE_ALLOWED_ORIGINS", "APP_UPDATE_CONFIG_MISSING");
        }
        const release = req.body;
        const urlOrigin = new URL(release.url).origin.toLowerCase();
        if (!allowedOrigins.some((allowed) => allowed.toLowerCase() === urlOrigin)) {
          return sendError(res, 400, `APK 下载域名 ${urlOrigin} 不在受信任的下载源白名单中`, "UNTRUSTED_APK_ORIGIN");
        }

        const current = await readAppUpdateManifest(manifestPath);
        if (current.error) {
          return sendError(res, 500, `现有清单读取失败: ${current.error}`, "APP_UPDATE_READ_ERROR");
        }

        let updatedManifest;
        try {
          updatedManifest = replaceManifestRelease(current.manifest, release);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "无法更新清单版本";
          return sendError(res, 400, message, "INVALID_RELEASE_OPERATION");
        }

        await writeAppUpdateManifest(manifestPath, updatedManifest);

        await auditAdminAction(req, {
          action: "app_updates.publish",
          resourceType: "app_updates",
          resourceId: `${release.channel}:${release.snapshot}`,
          summary: `发布 ${release.channel} 渠道应用更新 (${release.snapshot})`,
          details: {
            applicationId: release.applicationId,
            channel: release.channel,
            version: release.version,
            snapshot: release.snapshot,
            buildNumber: release.buildNumber,
            url: release.url,
            sizeBytes: release.sizeBytes,
            sha256: release.sha256,
          },
        });

        res.json({
          success: true,
          message: `已发布 ${release.channel} 渠道版本 ${release.snapshot}`,
          manifest: updatedManifest,
          release,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/app-updates/revoke",
    validateBody(revokeBodySchema),
    async (req: AuthRequest, res, next) => {
      try {
        const manifestPath = options.manifestPath;
        if (!manifestPath) {
          return sendError(res, 400, "服务端尚未配置 APP_UPDATE_MANIFEST_PATH", "APP_UPDATE_CONFIG_MISSING");
        }
        const { applicationId, channel } = req.body;
        const current = await readAppUpdateManifest(manifestPath);
        if (current.error) {
          return sendError(res, 500, `现有清单读取失败: ${current.error}`, "APP_UPDATE_READ_ERROR");
        }

        const targetRelease = current.manifest.releases.find(
          (item) => item.applicationId === applicationId && item.channel === channel,
        );
        if (!targetRelease) {
          return sendError(res, 404, `未找到应用 ${applicationId} 在 ${channel} 渠道的在线版本`, "RELEASE_NOT_FOUND");
        }

        const updatedManifest = revokeManifestRelease(current.manifest, applicationId, channel);
        await writeAppUpdateManifest(manifestPath, updatedManifest);

        await auditAdminAction(req, {
          action: "app_updates.revoke",
          resourceType: "app_updates",
          resourceId: `${channel}:${targetRelease.snapshot}`,
          summary: `撤下 ${channel} 渠道应用更新 (${targetRelease.snapshot})`,
          details: {
            applicationId,
            channel,
            revokedSnapshot: targetRelease.snapshot,
            revokedBuildNumber: targetRelease.buildNumber,
          },
        });

        res.json({
          success: true,
          message: `已撤下 ${channel} 渠道版本 ${targetRelease.snapshot}`,
          manifest: updatedManifest,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
