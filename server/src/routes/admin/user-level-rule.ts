import { Router } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { getUserLevelRule, saveUserLevelRule, type UserLevelRule } from "../../services/userLevel.js";
import { adminUserLevelRuleSchema } from "../../validation/schemas.js";
import { auditAdminAction as audit } from "./shared.js";

export function createAdminUserLevelRuleRouter() {
  const router = Router();

  router.get("/user-level-rule", (_req, res) => {
    res.json(getUserLevelRule());
  });

  router.put("/user-level-rule", validateBody(adminUserLevelRuleSchema), (req: AuthRequest, res) => {
    const previous = getUserLevelRule();
    const rule = req.body as UserLevelRule;
    saveUserLevelRule(rule);
    audit(req, {
      action: "user_level_rule.update",
      resourceType: "user_level_rule",
      resourceId: "global",
      summary: "更新账户成长等级规则",
      details: { previous, current: rule },
    });
    res.json({ success: true, rule });
  });

  return router;
}
