import { Router } from "express";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminRecipeQualitySchema, adminRecipeRejectSchema, recipeSubmissionSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit, deletedFilter } from "./shared.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { findRecipeDuplicateCandidates, normalizeContentTerm, recipeContentFingerprint, validateRecipePublication } from "../../services/contentGovernance.js";
import { enqueueKitchenwareMappingReview, resolveKitchenwareCatalog } from "../../services/kitchenwareCapabilities.js";

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
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json,
      serving_size, prep_time, cuisine, meal_types, required_kitchenware, optional_kitchenware, source_url,
      data_license, source_revision, source_attribution } = req.body;
    const explicitRequired = Array.isArray(required_kitchenware) ? required_kitchenware : [];
    const required = explicitRequired.length ? explicitRequired : inferKitchenware(`${title} ${String(steps_json || "")}`);
    const publicationIssues = validateRecipePublication({ title, source: "official", sourceUrl: source_url,
      dataLicense: data_license || "DietDigiDose-Original", sourceAttribution: source_attribution,
      servingSize: Number(serving_size) || 2, prepTime: Number(prep_time) || 0, cookTime: Number(cook_time) || 0,
      ingredients: ingredients_json, steps: steps_json, requiredKitchenware: required.length ? required : ["通用厨具"] });
    if (publicationIssues.some((issue) => !["missing_kitchenware_mapping"].includes(issue))) {
      return res.status(400).json({ error: "食谱发布质量校验未通过", issues: publicationIssues });
    }
    
    const stmt = db.prepare(`
      INSERT INTO recipes (
        title, description, image_url, cook_time, difficulty, calories,
        protein, carbs, fat, category, tags, steps_json, ingredients_json,
        source, status, reviewed_by, reviewed_at, quality_status, nutrition_basis,
        quality_issues_json, quality_reviewed_by, quality_reviewed_at, quality_review_reason,
        canonical_key, source_content_hash, serving_size, prep_time, cuisine, meal_types_json,
        required_kitchenware_json, optional_kitchenware_json, source_url, data_license,
        source_revision, source_attribution, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'official', 'approved', ?, CURRENT_TIMESTAMP,
        'trusted', 'source', '[]', ?, CURRENT_TIMESTAMP, '管理员创建的官方菜谱',
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      normalizeContentTerm(title),
      recipeContentFingerprint({ title, ingredients: ingredients_json, steps: steps_json }),
      Number(serving_size) || 2,
      Number(prep_time) || 0,
      cuisine || null,
      JSON.stringify(Array.isArray(meal_types) ? meal_types : []),
      JSON.stringify(required),
      JSON.stringify(Array.isArray(optional_kitchenware) ? optional_kitchenware : []),
      source_url || null,
      data_license || "DietDigiDose-Original",
      source_revision || "manual-v1",
      source_attribution || "DietDigiDose 编辑团队",
    );
    const recipeId = Number(info.lastInsertRowid);
    setRecipeKitchenwareRequirements(recipeId, required, Array.isArray(optional_kitchenware) ? optional_kitchenware : []);
    findRecipeDuplicateCandidates(recipeId);
    
    audit(req, {
      action: "recipe.create",
      resourceType: "recipes",
      resourceId: recipeId,
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
    const { title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json,
      serving_size, prep_time, cuisine, meal_types, required_kitchenware, optional_kitchenware, source_url,
      data_license, source_revision, source_attribution } = req.body;
    const required = Array.isArray(required_kitchenware) && required_kitchenware.length
      ? required_kitchenware
      : inferKitchenware(`${title} ${String(steps_json || "")}`);
    const optional = Array.isArray(optional_kitchenware) ? optional_kitchenware : [];
    const publicationIssues = validateRecipePublication({
      title, source: "official", sourceUrl: source_url, dataLicense: data_license || "DietDigiDose-Original",
      sourceAttribution: source_attribution, servingSize: Number(serving_size) || 2,
      prepTime: Number(prep_time) || 0, cookTime: Number(cook_time) || 0,
      ingredients: ingredients_json, steps: steps_json, requiredKitchenware: required,
    });
    if (publicationIssues.length) return res.status(400).json({ error: "食谱发布质量校验未通过", issues: publicationIssues });
    
    const stmt = db.prepare(`
      UPDATE recipes 
      SET title=?, description=?, image_url=?, cook_time=?, difficulty=?, calories=?, protein=?, carbs=?, fat=?, category=?, tags=?, steps_json=?, ingredients_json=?,
        canonical_key=?, source_content_hash=?, serving_size=?, prep_time=?, cuisine=?, meal_types_json=?,
        required_kitchenware_json=?, optional_kitchenware_json=?, source_url=?, data_license=?, source_revision=?, source_attribution=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL
    `);
    const info = stmt.run(
      title, description, image_url, cook_time, difficulty, calories, protein, carbs, fat, category, tags, steps_json, ingredients_json,
      normalizeContentTerm(title), recipeContentFingerprint({ title, ingredients: ingredients_json, steps: steps_json }),
      Number(serving_size) || 2, Number(prep_time) || 0, cuisine || null,
      JSON.stringify(Array.isArray(meal_types) ? meal_types : []), JSON.stringify(required), JSON.stringify(optional),
      source_url || null, data_license || "DietDigiDose-Original", source_revision || "manual-v1",
      source_attribution || "DietDigiDose 编辑团队", id,
    );
    
    if (info.changes > 0) {
      setRecipeKitchenwareRequirements(id, required, optional);
      findRecipeDuplicateCandidates(id);
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

function setRecipeKitchenwareRequirements(recipeId: number, required: unknown[], optional: unknown[]) {
  const insert = db.prepare(`INSERT INTO recipe_kitchenware_requirements
    (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
    VALUES (?, ?, ?, ?, 'admin', ?, ?)`);
  db.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ?").run(recipeId);
  for (const [items, role] of [[required, "required"], [optional, "optional"]] as const) {
    for (const raw of items) {
      const name = typeof raw === "string" ? raw.trim() : String((raw as Record<string, unknown>)?.name || "").trim();
      const capabilityCode = typeof raw === "object" && raw ? String((raw as Record<string, unknown>).capabilityCode || "").trim() : "";
      if (!name && !capabilityCode) continue;
      const catalog = name ? resolveKitchenwareCatalog(name) : null;
      if (name && (!catalog || catalog.confidence < 0.7)) enqueueKitchenwareMappingReview(name, "recipe", recipeId, catalog?.confidence || 0);
      insert.run(recipeId, catalog?.id || null, capabilityCode || catalog?.capabilities[0]?.code || null, role, catalog?.confidence || (capabilityCode ? 1 : 0), name || capabilityCode);
    }
  }
}

function inferKitchenware(text: string) {
  const rules: Array<[RegExp, string]> = [
    [/空气炸锅/, "空气炸锅"], [/微波炉/, "微波炉"], [/(?:破壁机|料理机|搅拌机)/, "破壁机"],
    [/(?:烤箱|烘焙)/, "烤箱"], [/(?:蒸|蒸笼)/, "蒸锅"], [/(?:炒|爆|煎)/, "炒锅"],
    [/(?:煮|炖|煲)/, "汤锅"],
  ];
  const inferred = rules.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  return [...new Set(inferred.length ? inferred : ["菜刀", "砧板"] )];
}

router.put("/recipes/:id/kitchenware", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const recipe = db.prepare("SELECT id, title FROM recipes WHERE id = ? AND deleted_at IS NULL").get(id) as { id: number; title: string } | undefined;
  if (!recipe) return res.status(404).json({ error: "食谱未找到" });
  const required = Array.isArray(req.body?.required) ? req.body.required.slice(0, 30) : [];
  const optional = Array.isArray(req.body?.optional) ? req.body.optional.slice(0, 30) : [];
  db.transaction(() => setRecipeKitchenwareRequirements(id, required, optional))();
  db.prepare("UPDATE recipes SET required_kitchenware_json = ?, optional_kitchenware_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(JSON.stringify(required), JSON.stringify(optional), id);
  audit(req, { action: "recipe.kitchenware_update", resourceType: "recipes", resourceId: id, summary: `更新食谱厨具能力：${recipe.title}` });
  return res.json({ success: true, required, optional });
});

router.post("/recipes/:id/duplicates/scan", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const candidates = findRecipeDuplicateCandidates(id);
  audit(req, { action: "recipe.duplicate_scan", resourceType: "recipes", resourceId: id, summary: `执行食谱相似度扫描，发现 ${candidates.length} 项` });
  return res.json({ candidates });
});

router.get("/recipes/governance/coverage", (_req, res) => {
  const boundary = "deleted_at IS NULL AND status = 'approved' AND COALESCE(quality_status, 'trusted') <> 'needs_review'";
  const byCategory = db.prepare(`SELECT COALESCE(category, '未分类') AS value, COUNT(*) AS count FROM recipes WHERE ${boundary} GROUP BY COALESCE(category, '未分类') ORDER BY count DESC`).all();
  const byDifficulty = db.prepare(`SELECT COALESCE(difficulty, '未知') AS value, COUNT(*) AS count FROM recipes WHERE ${boundary} GROUP BY COALESCE(difficulty, '未知') ORDER BY count DESC`).all();
  const byTime = db.prepare(`SELECT CASE WHEN cook_time <= 15 THEN '15分钟' WHEN cook_time <= 30 THEN '30分钟' WHEN cook_time <= 60 THEN '60分钟' ELSE '60分钟以上' END AS value,
      COUNT(*) AS count FROM recipes WHERE ${boundary} GROUP BY value ORDER BY value`).all();
  const sources = db.prepare(`SELECT source, data_license, COUNT(*) AS count FROM recipes WHERE ${boundary} GROUP BY source, data_license ORDER BY count DESC`).all();
  const qualityFailures = db.prepare(`SELECT id, title, quality_status, quality_issues_json FROM recipes WHERE deleted_at IS NULL AND
    (status <> 'approved' OR quality_status = 'needs_review' OR data_license IS NULL OR source_content_hash IS NULL) ORDER BY id DESC LIMIT 200`).all();
  const duplicates = db.prepare("SELECT * FROM recipe_duplicate_candidates WHERE status = 'pending' ORDER BY similarity DESC LIMIT 200").all();
  const baselines = (db.prepare("SELECT dimension, value, minimum_candidates FROM recipe_coverage_baselines ORDER BY dimension, value").all() as Array<{ dimension: string; value: string; minimum_candidates: number }>).map((baseline) => {
    let actual = 0;
    if (baseline.dimension === "time") {
      const max = Number.parseInt(baseline.value, 10);
      actual = (db.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${boundary} AND cook_time <= ?`).get(max) as { count: number }).count;
    } else if (baseline.dimension === "difficulty") {
      actual = (db.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${boundary} AND difficulty = ?`).get(baseline.value) as { count: number }).count;
    } else {
      actual = (db.prepare(`SELECT COUNT(*) AS count FROM recipes WHERE ${boundary} AND (tags LIKE ? OR category LIKE ? OR meal_types_json LIKE ?)`)
        .get(`%${baseline.value}%`, `%${baseline.value}%`, `%${baseline.value}%`) as { count: number }).count;
    }
    return { ...baseline, actual, met: actual >= baseline.minimum_candidates };
  });
  return res.json({ byCategory, byDifficulty, byTime, sources, qualityFailures, duplicates, baselines });
});

router.post("/recipes/:id/approve", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const recipe = db.prepare(`
      SELECT title, status, source, source_url, data_license, source_attribution, serving_size,
        prep_time, cook_time, ingredients_json, steps_json, required_kitchenware_json
      FROM recipes
      WHERE id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id) as Record<string, unknown> | undefined;
    if (!recipe) return res.status(404).json({ error: "未找到用户投稿" });
    const publicationIssues = validateRecipePublication({
      title: String(recipe.title || ""), source: String(recipe.source || "user"),
      sourceUrl: String(recipe.source_url || ""), dataLicense: String(recipe.data_license || ""),
      sourceAttribution: String(recipe.source_attribution || ""), servingSize: Number(recipe.serving_size),
      prepTime: Number(recipe.prep_time), cookTime: Number(recipe.cook_time),
      ingredients: recipe.ingredients_json, steps: recipe.steps_json,
      requiredKitchenware: recipe.required_kitchenware_json,
    });
    if (publicationIssues.length) return res.status(400).json({ error: "食谱发布质量校验未通过", issues: publicationIssues });

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
      details: { before: String(recipe.status), after: "approved" },
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
