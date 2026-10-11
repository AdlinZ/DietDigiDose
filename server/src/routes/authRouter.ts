import { Router, type Router as ExpressRouter } from "express";
import smsAuthRoutes, { reauthRouter, passwordRecoveryRouter } from "./auth-sms.js";

export function createAuthRouter(accountRoutes: ExpressRouter) {
  const router = Router();
  router.use("/sms", smsAuthRoutes);
  router.use("/reauth/sms", reauthRouter);
  router.use("/password-recovery", passwordRecoveryRouter);
  router.use(accountRoutes);
  return router;
}
