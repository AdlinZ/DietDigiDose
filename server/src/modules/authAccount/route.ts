import { Router, type NextFunction, type Response } from "express";
import { authMiddleware, type AuthRequest } from "../../middleware/auth.js";
import { clearLoginFailures, loginRateLimit, recordLoginFailure } from "../../middleware/loginRateLimit.js";
import { getRateLimitClientIp, sharedRateLimit } from "../../middleware/sharedRateLimit.js";
import { validateBody } from "../../middleware/validate.js";
import { sendError } from "../../utils/http.js";
import { changePasswordSchema, deleteAccountSchema, loginSchema, profileSchema, registerSchema } from "../../validation/schemas.js";
import { AuthAccountError } from "./errors.js";
import type { AuthAccountService } from "./service.js";

const windowMs = Math.max(1_000, Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000);
const registrationIpRateLimit = sharedRateLimit({ namespace: "registration-ip", limit: Math.max(1, Number(process.env.REGISTER_RATE_LIMIT) || 12),
  windowMs, key: getRateLimitClientIp, message: "注册请求过于频繁，请稍后重试", code: "REGISTER_RATE_LIMITED" });
const registrationGlobalRateLimit = sharedRateLimit({ namespace: "registration-global", limit: Math.max(1, Number(process.env.REGISTER_GLOBAL_RATE_LIMIT) || 500),
  windowMs, key: () => "all", message: "注册服务当前请求过多，请稍后重试", code: "REGISTER_RATE_LIMITED" });

function known(error: unknown, res: Response) {
  if (!(error instanceof AuthAccountError)) return false;
  if (error.code) sendError(res, error.status, error.message, error.code);
  else res.status(error.status).json({ error: error.message });
  return true;
}

function handle(error: unknown, res: Response, next: NextFunction) {
  if (!known(error,res)) next(error);
}

export function createAuthAccountRouter(service: AuthAccountService) {
  const router = Router();
  router.post("/register", registrationIpRateLimit, registrationGlobalRateLimit, validateBody(registerSchema), async (req, res) => {
    try { return res.status(201).json(await service.register(req.body.identifier, req.body.username, req.body.password)); }
    catch (error) { if (known(error, res)) return; console.error("Register error:", error); return sendError(res, 500, "注册失败", "REGISTER_FAILED"); }
  });
  router.post("/login", loginRateLimit, validateBody(loginSchema), async (req, res) => {
    try {
      const result = await service.login(req.body.identifier, req.body.password, getRateLimitClientIp(req), req.get("user-agent"));
      clearLoginFailures(result.rawIdentifier); return res.json({ token: result.token, user: result.user });
    } catch (error) {
      if (error instanceof AuthAccountError && error.recordLoginFailure) recordLoginFailure(req);
      if (known(error, res)) return;
      console.error("Login error:", error); return sendError(res, 500, "登录失败", "LOGIN_FAILED");
    }
  });
  router.get("/me", authMiddleware, (req: AuthRequest, res, next) => {
    void service.me(req.userId!).then((value) => res.json(value)).catch((error) => handle(error,res,next));
  });
  router.post("/change-password", authMiddleware, validateBody(changePasswordSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.changePassword(req.userId!, req.body.currentPassword, req.body.newPassword, req.ip, req.get("user-agent"))); }
    catch (error) { if (known(error, res)) return; console.error("Change password error:", error); return res.status(500).json({ error: "修改密码失败" }); }
  });
  router.put("/profile", authMiddleware, validateBody(profileSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.updateProfile(req.userId!, req.body)); }
    catch (error) { if (known(error, res)) return; console.error("Profile update error:", error); return sendError(res, 500, "更新资料失败", "PROFILE_UPDATE_FAILED"); }
  });
  router.get("/ai-data", authMiddleware, (req: AuthRequest, res, next) => {
    void service.exportAiData(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.delete("/ai-data", authMiddleware, (req: AuthRequest, res, next) => {
    void service.deleteAiData(req.userId!).then((value) => res.json(value)).catch(next);
  });
  router.delete("/account", authMiddleware, validateBody(deleteAccountSchema), async (req: AuthRequest, res) => {
    try { return res.json(await service.deleteAccount(req.userId!, req.body.password)); }
    catch (error) { if (known(error, res)) return; console.error("Delete account error:", error); return sendError(res, 500, "账号删除失败", "ACCOUNT_DELETE_FAILED"); }
  });
  return router;
}
