import { Router } from "express";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminRecipeQualitySchema, adminRecipeRejectSchema, recipeSubmissionSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit, deletedFilter } from "./shared.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";

const router = Router();
router.param("id", positiveIntegerParam);

// 6. 获取食谱列表
router.get("/recipes", (req, res) => {
  try {
    const filters = [deletedFilter(req.query.deleted, "r")];
    const params: Array<string | number> = [];
    const cursorMode = req.query.pageSize !== undefined || req.query.cursor !== undefined;
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
    const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    const cursorId = cursor ? Number(cursor.id) : null;
    if (req.query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
      return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
    }
    if (req.query.source === "official" || req.query.source === "user") {
      // Imported recipes are maintained by the platform too. Treat every
      // non-user source as a catalog recipe, matching the admin UI wording.
      if (req.query.source === "user") {
        filters.push("r.source = ?");
        params.push("user");
      } else {
        filters.push("(r.source IS NULL OR r.source <> 'user')");
      }
    }
    if (["pending", "approved", "rejected"].includes(String(req.query.reviewStatus))) {
      filters.push("r.status = ?");
      params.push(String(req.query.reviewStatus));
    }
    if (["trusted", "estimated", "needs_review"].includes(String(req.query.qualityStatus))) {
      filters.push("r.quality_status = ?");
      params.push(String(req.query.qualityStatus));
    }
    if (typeof req.query.category === "string" && req.query.category.trim()) {
      filters.push("r.category = ?");
      params.push(req.query.category.trim());
    }
    if (typeof req.query.search === "string" && req.query.search.trim()) {
      filters.push("(r.title LIKE ? OR r.description LIKE ?)");
      const search = `%${req.query.search.trim()}%`;
      params.push(search, search);
    }
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN r.source = 'user' THEN 0 ELSE 1 END) AS platform,
        SUM(CASE WHEN r.source = 'user' THEN 1 ELSE 0 END) AS user,
        SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN r.quality_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review
      FROM recipes r
      WHERE ${filters.join(" AND ")}
    `).get(...params) as { total: number; platform: number; user: number; pending: number; needs_review: number };
    if (cursorId) {
      filters.push("r.id < ?");
      params.push(cursorId);
    }
    const recipes = db.prepare(`
      SELECT
        r.*,
        u.username AS author_username,
        u.avatar_url AS author_avatar_url
      FROM recipes r
      LEFT JOIN users u ON u.id = r.author_user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY r.id DESC
      ${cursorMode ? "LIMIT ?" : ""}
    `).all(...params, ...(cursorMode ? [pageSize + 1] : [])) as Array<{ id: number }>;
    const hasMore = cursorMode && recipes.length > pageSize;
    const items = cursorMode ? recipes.slice(0, pageSize) : recipes;
    if (!cursorMode) return res.json(items);
    return res.json({ items, total: summary.total, summary, nextCursor: hasMore ? encodeCursor({ v: 1, id: items.at(-1)!.id }) : null });
  } catch (error) {
    res.status(500).json({ error: "获取食谱列表失败" });
  }
});

// 7. 添加食谱
router.post("/recipes", validateBody(recipeSubmissionSchema), (req: AuthRequest, res) => {
  try {
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json } = req.body;
    
    const stmt = db.prepare(`
      INSERT INTO recipes (
        title, description, image_url, cook_time, difficulty, calories,
        protein, carbs, fat, category, tags, steps_json, ingredients_json,
        source, status, reviewed_by, reviewed_at, quality_status, nutrition_basis,
        quality_issues_json, quality_reviewed_by, quality_reviewed_at, quality_review_reason, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official', 'approved', ?, CURRENT_TIMESTAMP,
        'trusted', 'source', '[]', ?, CURRENT_TIMESTAMP, '管理员创建的官方菜谱', CURRENT_TIMESTAMP)
    `);
    const info = stmt.run(
      title,
      description,
      image_url,
      cook_time,
      difficulty,
      calories,
      protein,
      carbs,
      fat,
      category,
      tags,
      steps_json,
      ingredients_json,
      req.userId,
      req.userId,
    );
    
    audit(req, {
      action: "recipe.create",
      resourceType: "recipes",
      resourceId: Number(info.lastInsertRowid),
      summary: `创建食谱：${title}`,
    });
    res.json({ success: true, id: info.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "添加食谱失败" });
  }
});

// 8. 修改食谱
router.put("/recipes/:id", validateBody(recipeSubmissionSchema), (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json } = req.body;
    
    const stmt = db.prepare(`
      UPDATE recipes 
      SET title=?, description=?, image_url=?, cook_time=?, difficulty=?, calories=?, protein=?, carbs=?, fat=?, category=?, tags=?, steps_json=?, ingredients_json=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL
    `);
    const info = stmt.run(title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json, id);
    
    if (info.changes > 0) {
      audit(req, {
        action: "recipe.update",
        resourceType: "recipes",
        resourceId: id,
        summary: `更新食谱：${title}`,
      });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "食谱未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "修改食谱失败" });
  }
});

router.post("/recipes/:id/approve", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const recipe = db.prepare(`
      SELECT title, status
      FROM recipes
      WHERE id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id) as { title: string; status: string } | undefined;
    if (!recipe) return res.status(404).json({ error: "未找到用户投稿" });

    db.prepare(`
      UPDATE recipes
      SET
        status = 'approved',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        reject_reason = NULL,
        quality_status = 'trusted', nutrition_basis = 'source', quality_issues_json = '[]',
        quality_reviewed_by = ?, quality_reviewed_at = CURRENT_TIMESTAMP,
        quality_review_reason = '用户投稿审核通过',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.userId, req.userId, id);
    audit(req, {
      action: "recipe_submission.approve",
      resourceType: "recipes",
      resourceId: id,
      summary: `审核通过用户食谱：${recipe.title}`,
      details: { before: recipe.status, after: "approved" },
    });
    return res.json({ success: true, message: "用户食谱已审核通过" });
  } catch (error) {
    return res.status(500).json({ error: "审核食谱失败" });
  }
});

router.put("/recipes/:id/quality", validateBody(adminRecipeQualitySchema), (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const status = req.body.status as "trusted" | "needs_review";
    const reason = String(req.body.reason).trim();
    const recipe = db.prepare(`
      SELECT title, quality_status FROM recipes WHERE id = ? AND deleted_at IS NULL
    `).get(id) as { title: string; quality_status: string } | undefined;
    if (!recipe) return res.status(404).json({ error: "食谱未找到" });

    const info = db.prepare(`
      UPDATE recipes
      SET quality_status = ?, quality_reviewed_by = ?, quality_reviewed_at = CURRENT_TIMESTAMP,
          quality_review_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(status, req.userId, reason, id);
    if (!info.changes) return res.status(404).json({ error: "食谱未找到" });
    audit(req, {
      action: "recipe.quality_review",
      resourceType: "recipes",
      resourceId: id,
      summary: `${status === "trusted" ? "设为可信" : "设为待复核"}：${recipe.title}`,
      details: { before: recipe.quality_status, after: status, reason },
    });
    return res.json({ success: true, quality_status: status });
  } catch (error) {
    return res.status(500).json({ error: "更新食谱质量状态失败" });
  }
});

router.post("/recipes/:id/reject", validateBody(adminRecipeRejectSchema), (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 2 || reason.length > 300) {
      return res.status(400).json({ error: "请填写 2-300 字的驳回原因" });
    }
    const recipe = db.prepare(`
      SELECT title, status
      FROM recipes
      WHERE id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id) as { title: string; status: string } | undefined;
    if (!recipe) return res.status(404).json({ error: "未找到用户投稿" });

    db.prepare(`
      UPDATE recipes
      SET
        status = 'rejected',
        reviewed_by = ?,
        reviewed_at = CURRENT_TIMESTAMP,
        reject_reason = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.userId, reason, id);
    audit(req, {
      action: "recipe_submission.reject",
      resourceType: "recipes",
      resourceId: id,
      summary: `驳回用户食谱：${recipe.title}`,
      details: { before: recipe.status, after: "rejected", reason },
    });
    return res.json({ success: true, message: "用户食谱已驳回" });
  } catch (error) {
    return res.status(500).json({ error: "驳回食谱失败" });
  }
});

// 9. 删除食谱
router.delete("/recipes/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const recipe = db.prepare("SELECT title FROM recipes WHERE id = ? AND deleted_at IS NULL").get(id) as
      | { title: string }
      | undefined;
    const info = db.prepare(`
      UPDATE recipes
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.userId, id);
    if (info.changes > 0) {
      audit(req, {
        action: "recipe.delete",
        resourceType: "recipes",
        resourceId: id,
        summary: `将食谱移入回收站：${recipe?.title || id}`,
      });
      res.json({ success: true, message: "食谱已移入回收站" });
    } else {
      res.status(404).json({ error: "食谱未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "删除食谱失败" });
  }
});

export function createAdminRecipesRouter() {
  return router;
}
