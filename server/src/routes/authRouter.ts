import { Router, type Router as ExpressRouter } from "express";
import smsAuthRoutes from "./auth-sms.js";

export function createAuthRouter(accountRoutes: ExpressRouter) {
  const router = Router();
  router.use("/sms", smsAuthRoutes);
  router.use(accountRoutes);
  return router;
}
