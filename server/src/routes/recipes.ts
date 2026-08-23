import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";
import { ensureIngredientGroups, normalizeIngredientGroup, type IngredientGroup } from "../utils/ingredientGroups.js";
import { validateBody } from "../middleware/validate.js";
import { recipeSubmissionSchema } from "../validation/schemas.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import { decodeCursor, encodeCursor } from "../utils/cursor.js";

const router = Router();
router.param("id", positiveIntegerParam);

type RecipeInput = {
  title: string;
  description: string;
  imageUrl: string;
  cookTime: number;
  difficulty: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutrition: NutritionItem[];
  category: string;
  tags: string[];
  steps: string[];
  ingredients: Array<{ name: string; amount: string; group: IngredientGroup }>;
};

type NutritionItem = {
  key: string;
  label: string;
  value: number;
  unit: string;
};

const LEGACY_NUTRIENT_KEYS = new Set(["protein", "carbs", "fat"]);

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNutrition(value: unknown): NutritionItem[] {
  const seen = new Set<string>();
  return parseArray(value)
    .map((item, index) => {
      const nutrient = item as Record<string, unknown>;
      const label = String(nutrient?.label || "").trim().slice(0, 20);
      const key = String(nutrient?.key || `custom-${index}-${label}`).trim().slice(0, 40);
      const numericValue = Number(nutrient?.value);
      const unit = String(nutrient?.unit || "g").trim().slice(0, 10);
      return { key, label, value: numericValue, unit };
    })
    .filter((item) => {
      const normalizedKey = item.key.toLowerCase();
      if (!item.label || !Number.isFinite(item.value) || item.value < 0 || item.value > 1_000_000) return false;
      if (LEGACY_NUTRIENT_KEYS.has(normalizedKey) || seen.has(normalizedKey)) return false;
      seen.add(normalizedKey);
      return true;
    })
    .slice(0, 12);
}

function normalizeRecipeInput(body: Record<string, unknown>): RecipeInput {
  const ingredients = parseArray(body.ingredients ?? body.ingredients_json)
    .map((item) => {
      if (typeof item === "string") return { name: item.trim(), amount: "" };
      const value = item as Record<string, unknown>;
      return {
        name: String(value?.name || "").trim(),
        amount: String(value?.amount || "").trim(),
        group: normalizeIngredientGroup(value?.group) || undefined,
      };
    })
    .filter((item) => item.name);
  const steps = parseArray(body.steps ?? body.steps_json)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const tags = parseArray(body.tags)
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  return {
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim(),
    imageUrl: String(body.image_url || "").trim(),
    cookTime: Math.max(0, Number(body.cook_time) || 0),
    difficulty: String(body.difficulty || "简单").trim(),
    calories: Math.max(0, Number(body.calories) || 0),
    protein: Math.max(0, Number(body.protein) || 0),
    carbs: Math.max(0, Number(body.carbs) || 0),
    fat: Math.max(0, Number(body.fat) || 0),
    nutrition: parseNutrition(body.nutrition ?? body.nutrition_json),
    category: String(body.category || "其他").trim(),
    tags,
    steps,
    ingredients: ensureIngredientGroups(ingredients, String(body.title || "").trim()),
  };
}

function validateRecipe(input: RecipeInput): string | null {
  if (input.title.length < 2 || input.title.length > 80) return "食谱标题需为 2-80 个字符";
  if (input.description.length > 1000) return "食谱简介不能超过 1000 个字符";
  if (!input.ingredients.length) return "请至少填写一种食材";
  if (!input.steps.length) return "请至少填写一个烹饪步骤";
  if (input.ingredients.length > 50 || input.steps.length > 30) return "食材或步骤数量过多";
  if (input.nutrition.length > 12) return "自定义营养项不能超过 12 个";
  if (input.imageUrl.length > 4_000_000) return "封面图片过大，请压缩后重试";
  return null;
}

function formatRecipe(recipe: any, req?: { protocol: string; get(name: string): string | undefined }) {
  const {
    quality_issues_json: _qualityIssues,
    quality_reviewed_by: _qualityReviewer,
    quality_reviewed_at: _qualityReviewedAt,
    quality_review_reason: _qualityReviewReason,
    ...publicRecipe
  } = recipe;
  const imageUrl = typeof recipe.image_url === "string" && recipe.image_url.startsWith("/media/")
    ? `${req?.protocol || "http"}://${req?.get("host") || "localhost:9090"}${recipe.image_url}`
    : recipe.image_url;
  const legacyNutrition: NutritionItem[] = [
    { key: "protein", label: "蛋白质", value: Math.max(0, Number(recipe.protein) || 0), unit: "g" },
    { key: "carbs", label: "碳水", value: Math.max(0, Number(recipe.carbs) || 0), unit: "g" },
    { key: "fat", label: "脂肪", value: Math.max(0, Number(recipe.fat) || 0), unit: "g" },
  ];
  return {
    ...publicRecipe,
    quality_status: recipe.quality_status || "trusted",
    nutrition_basis: recipe.nutrition_basis || "source",
    nutrition_is_estimated: (recipe.nutrition_basis || "source") !== "source",
    image_url: imageUrl,
    tags: parseArray(recipe.tags),
    steps: parseArray(recipe.steps_json),
    ingredients: ensureIngredientGroups(
      parseArray(recipe.ingredients_json).map((item) => {
        if (typeof item === "string") return { name: item.trim(), amount: "", group: "" };
        const ingredient = item as Record<string, unknown>;
        return {
          name: String(ingredient?.name || "").trim(),
          amount: String(ingredient?.amount || "").trim(),
          group: String(ingredient?.group || ""),
        };
      }).filter((item) => item.name),
      String(recipe.title || ""),
    ),
    nutrition: [...legacyNutrition, ...parseNutrition(recipe.nutrition_json)],
  };
}

// GET /api/v1/recipes - 仅返回审核通过的公开食谱
router.get("/", (req, res) => {
  const { category, search } = req.query;
  const cursorMode = req.query.pageSize !== undefined || req.query.cursor !== undefined;
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 24));
  const requestedMaxCookTime = Number(req.query.maxCookTime);
  const maxCookTime = Number.isFinite(requestedMaxCookTime) && requestedMaxCookTime > 0
    ? Math.floor(requestedMaxCookTime)
    : null;
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  const cursorId = cursor ? Number(cursor.id) : null;
  if (req.query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
    return res.status(400).json({ error: "分页游标无效", code: "INVALID_CURSOR" });
  }
  const filters = [
    "r.deleted_at IS NULL",
    "r.status = 'approved'",
    "COALESCE(r.quality_status, 'trusted') <> 'needs_review'",
  ];
  const filterParams: Array<string | number> = [];

  if (typeof category === "string" && category !== "全部") {
    filters.push("r.category = ?");
    filterParams.push(category);
  }
  if (typeof search === "string" && search.trim()) {
    filters.push("(r.title LIKE ? OR r.description LIKE ? OR r.tags LIKE ? OR r.ingredients_json LIKE ?)");
    const term = `%${search.trim()}%`;
    filterParams.push(term, term, term, term);
  }
  if (maxCookTime !== null) {
    filters.push("r.cook_time <= ?");
    filterParams.push(maxCookTime);
  }

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM recipes r
    WHERE ${filters.join(" AND ")}
  `).get(...filterParams) as { total: number };

  let query = `
    SELECT
      r.*,
      COALESCE(u.username, '食友' || u.id) AS author_username,
      u.avatar_url AS author_avatar_url
    FROM recipes r
    LEFT JOIN users u ON u.id = r.author_user_id
    WHERE ${filters.join(" AND ")}
  `;
  const params = [...filterParams];
  if (cursorMode && cursorId) {
    query += " AND r.id < ?";
    params.push(cursorId);
  }
  query += " ORDER BY r.id DESC";
  if (cursorMode) query += " LIMIT ?";
  const rows = cursorMode
    ? db.prepare(query).all(...params, pageSize + 1)
    : db.prepare(query).all(...params);
  const hasMore = cursorMode && rows.length > pageSize;
  const pageRows = cursorMode ? rows.slice(0, pageSize) : rows;
  const items = pageRows.map((recipe) => formatRecipe(recipe, req));
  if (!cursorMode) return res.json(items);
  const last = pageRows.at(-1) as { id?: number } | undefined;
  return res.json({
    items,
    total: Number(totalRow?.total || 0),
    nextCursor: hasMore && last?.id ? encodeCursor({ v: 1, id: last.id }) : null,
  });
});

// GET /api/v1/recipes/mine - 当前用户的全部投稿
router.get("/mine", authMiddleware, (req: AuthRequest, res) => {
  const recipes = db.prepare(`
    SELECT *
    FROM recipes
    WHERE author_user_id = ? AND source = 'user' AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all(req.userId);
  res.json(recipes.map((recipe) => formatRecipe(recipe, req)));
});

// GET /api/v1/recipes/favorites - 当前用户收藏的菜谱
router.get("/favorites", authMiddleware, (req: AuthRequest, res) => {
  const recipes = db.prepare(`
    SELECT
      r.*,
      f.created_at AS favorited_at,
      COALESCE(u.username, '食友' || u.id) AS author_username,
      u.avatar_url AS author_avatar_url
    FROM recipe_favorites f
    JOIN recipes r ON r.id = f.recipe_id
    LEFT JOIN users u ON u.id = r.author_user_id
    WHERE f.user_id = ?
      AND r.deleted_at IS NULL
      AND r.status = 'approved'
      AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'
    ORDER BY f.created_at DESC
  `).all(req.userId);
  return res.json(recipes.map((recipe) => ({ ...formatRecipe(recipe, req), is_favorited: true })));
});

router.get("/favorites/count", authMiddleware, (req: AuthRequest, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM recipe_favorites f
    JOIN recipes r ON r.id = f.recipe_id
    WHERE f.user_id = ? AND r.deleted_at IS NULL AND r.status = 'approved'
      AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'
  `).get(req.userId) as { count: number };
  return res.json({ count: Number(row?.count || 0) });
});

// POST /api/v1/recipes/submissions
router.post("/submissions", authMiddleware, validateBody(recipeSubmissionSchema), (req: AuthRequest, res) => {
  try {
    const input = normalizeRecipeInput(req.body);
    const validationError = validateRecipe(input);
    if (validationError) return res.status(400).json({ error: validationError });

    const result = db.prepare(`
      INSERT INTO recipes (
        title, description, image_url, cook_time, difficulty,
        calories, protein, carbs, fat, nutrition_json, category, tags,
        steps_json, ingredients_json, author_user_id, source, status, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'pending', CURRENT_TIMESTAMP)
    `).run(
      input.title,
      input.description,
      input.imageUrl || null,
      input.cookTime,
      input.difficulty,
      input.calories,
      input.protein,
      input.carbs,
      input.fat,
      JSON.stringify(input.nutrition),
      input.category,
      JSON.stringify(input.tags),
      JSON.stringify(input.steps),
      JSON.stringify(input.ingredients),
      req.userId,
    );

    return res.status(201).json({
      success: true,
      id: Number(result.lastInsertRowid),
      status: "pending",
      message: "食谱投稿成功，等待管理员审核",
    });
  } catch (error) {
    console.error("[Recipe Submission Error]", error);
    return res.status(500).json({ error: "食谱投稿失败" });
  }
});

// PUT /api/v1/recipes/submissions/:id
router.put("/submissions/:id", authMiddleware, validateBody(recipeSubmissionSchema), (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare(`
      SELECT id, status
      FROM recipes
      WHERE id = ? AND author_user_id = ? AND source = 'user' AND deleted_at IS NULL
    `).get(id, req.userId) as { id: number; status: string } | undefined;
    if (!existing) return res.status(404).json({ error: "未找到该投稿" });
    if (!["pending", "rejected"].includes(existing.status)) {
      return res.status(400).json({ error: "已审核通过的食谱不能直接修改，请先撤回" });
    }

    const input = normalizeRecipeInput(req.body);
    const validationError = validateRecipe(input);
    if (validationError) return res.status(400).json({ error: validationError });

    db.prepare(`
      UPDATE recipes
      SET
        title = ?, description = ?, image_url = ?, cook_time = ?, difficulty = ?,
        calories = ?, protein = ?, carbs = ?, fat = ?, nutrition_json = ?, category = ?, tags = ?,
        steps_json = ?, ingredients_json = ?, status = 'pending',
        reject_reason = NULL, reviewed_by = NULL, reviewed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND author_user_id = ?
    `).run(
      input.title,
      input.description,
      input.imageUrl || null,
      input.cookTime,
      input.difficulty,
      input.calories,
      input.protein,
      input.carbs,
      input.fat,
      JSON.stringify(input.nutrition),
      input.category,
      JSON.stringify(input.tags),
      JSON.stringify(input.steps),
      JSON.stringify(input.ingredients),
      id,
      req.userId,
    );

    return res.json({ success: true, status: "pending", message: "投稿已更新并重新进入审核" });
  } catch (error) {
    console.error("[Recipe Submission Update Error]", error);
    return res.status(500).json({ error: "更新投稿失败" });
  }
});

// DELETE /api/v1/recipes/submissions/:id
router.delete("/submissions/:id", authMiddleware, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const result = db.prepare(`
    UPDATE recipes
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND author_user_id = ? AND source = 'user' AND deleted_at IS NULL
  `).run(req.userId, id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "未找到该投稿" });
  return res.json({ success: true, message: "投稿已撤回" });
});

router.get("/:id/favorite", authMiddleware, (req: AuthRequest, res) => {
  const recipeId = Number(req.params.id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) return res.status(400).json({ error: "无效的菜谱编号" });
  const row = db.prepare("SELECT 1 FROM recipe_favorites WHERE user_id = ? AND recipe_id = ?").get(req.userId, recipeId);
  return res.json({ is_favorited: Boolean(row) });
});

router.post("/:id/favorite", authMiddleware, (req: AuthRequest, res) => {
  const recipeId = Number(req.params.id);
  const recipe = db.prepare(`
    SELECT id FROM recipes
    WHERE id = ? AND deleted_at IS NULL AND status = 'approved'
      AND COALESCE(quality_status, 'trusted') <> 'needs_review'
  `).get(recipeId);
  if (!recipe) return res.status(404).json({ error: "未找到该食谱" });
  db.prepare("INSERT OR IGNORE INTO recipe_favorites (user_id, recipe_id) VALUES (?, ?)").run(req.userId, recipeId);
  return res.json({ success: true, is_favorited: true });
});

router.delete("/:id/favorite", authMiddleware, (req: AuthRequest, res) => {
  const recipeId = Number(req.params.id);
  db.prepare("DELETE FROM recipe_favorites WHERE user_id = ? AND recipe_id = ?").run(req.userId, recipeId);
  return res.json({ success: true, is_favorited: false });
});

// GET /api/v1/recipes/:id - 公开详情只允许已通过内容
router.get("/:id", (req, res) => {
  const recipe = db.prepare(`
    SELECT
      r.*,
      COALESCE(u.username, '食友' || u.id) AS author_username,
      u.avatar_url AS author_avatar_url
    FROM recipes r
    LEFT JOIN users u ON u.id = r.author_user_id
    WHERE r.id = ? AND r.deleted_at IS NULL AND r.status = 'approved'
      AND COALESCE(r.quality_status, 'trusted') <> 'needs_review'
  `).get(req.params.id);
  if (!recipe) return res.status(404).json({ error: "未找到该食谱" });
  return res.json(formatRecipe(recipe, req));
});

export default router;
