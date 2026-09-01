import { Router } from "express";
import { createAuthAccountRouter } from "../modules/authAccount/index.js";
import smsAuthRoutes from "./auth-sms.js";

const router = Router();
router.use("/sms", smsAuthRoutes);
router.use(createAuthAccountRouter());

export default router;
