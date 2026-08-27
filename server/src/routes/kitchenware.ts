import { Router } from "express";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { db } from "../storage/db.js";
import { validateBody } from "../middleware/validate.js";
import { kitchenwareSchema } from "../validation/schemas.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import {
  enqueueKitchenwareMappingReview,
  evaluateKitchenwareRequirements,
  resolveKitchenwareCatalog,
} from "../services/kitchenwareCapabilities.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.param("recipeId", positiveIntegerParam);
const CATEGORIES = new Set(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
const STATUSES = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);

router.use(authMiddleware);

function normalizeInput(body: Record<string, unknown>) {
  const category = String(body.category || "其他").trim();
  const status = String(body.status || "良好").trim();
  return {
    name: String(body.name || "").trim(),
    category: CATEGORIES.has(category) ? category : "其他",
    status: STATUSES.has(status) ? status : "良好",
    note: String(body.note || "").trim(),
    imageUrl: String(body.image_url || "").trim(),
    purchaseDate: String(body.purchase_date || "").trim(),
  };
}

function parseJson(value: unknown, fallback: unknown) {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function formatCatalogItem(item: Record<string, unknown>) {
  const capabilities = db.prepare(`SELECT c.code, c.name, c.description, c.safety_level, cc.constraints_json
    FROM kitchenware_catalog_capabilities cc
    JOIN kitchenware_capabilities c ON c.code = cc.capability_code
    WHERE cc.catalog_id = ? ORDER BY c.code`).all(item.id) as Array<Record<string, unknown>>;
  const substitutions = db.prepare(`SELECT c.id, c.name, s.relation_type, s.impact_json, s.safety_note
    FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
    WHERE s.source_catalog_id = ? ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 WHEN 'conditional' THEN 1 ELSE 2 END, c.name`)
    .all(item.id) as Array<Record<string, unknown>>;
  return {
    ...item,
    aliases: parseJson(item.aliases, []),
    cooking_methods: parseJson(item.cooking_methods, []),
    attributes: parseJson(item.attributes_json, {}),
    capabilities: capabilities.map((capability) => ({
      ...capability,
      constraints: parseJson(capability.constraints_json, {}),
      constraints_json: undefined,
    })),
    substitutions: substitutions.map((substitution) => ({
      ...substitution,
      impact: parseJson(substitution.impact_json, {}),
      impact_json: undefined,
    })),
  };
}

function validateInput(input: ReturnType<typeof normalizeInput>) {
  if (input.name.length < 1 || input.name.length > 80) return "厨具名称需为 1-80 个字符";
  if (input.note.length > 300) return "规格或备注不能超过 300 个字符";
  if (input.imageUrl.length > 4_000_000) return "厨具图片过大，请压缩后重试";
  if (input.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) {
    return "购买日期格式不正确";
  }
  return null;
}

// GET /api/v1/kitchenware - 当前用户的厨具资产
router.get("/", (req: AuthRequest, res) => {
  const items = db.prepare(`
    SELECT *
    FROM kitchenware_items
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all(req.userId);
  return res.json(items);
});

// GET /api/v1/kitchenware/catalog - 官方标准厨具类型库
router.get("/catalog", (req, res) => {
  const query = String(req.query.query || "").trim();
  const items = db.prepare(`SELECT * FROM kitchenware_catalog
    WHERE quality_status = 'trusted' ORDER BY category, name`).all() as Array<Record<string, unknown>>;
  const filtered = query
    ? items.filter((item) => {
      const aliases = parseJson(item.aliases, []) as string[];
      return resolveKitchenwareCatalog(query)?.id === Number(item.id)
        || [String(item.name), ...aliases].some((name) => name.includes(query) || query.includes(name));
    })
    : items;
  return res.json(filtered.map(formatCatalogItem));
});

router.get("/capabilities", (_req, res) => {
  return res.json(db.prepare("SELECT * FROM kitchenware_capabilities ORDER BY code").all());
});

router.get("/recipes/:recipeId/compatibility", (req: AuthRequest, res) => {
  const recipe = db.prepare("SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL AND status = 'approved'").get(req.params.recipeId);
  if (!recipe) return res.status(404).json({ error: "菜谱不存在" });
  return res.json(evaluateKitchenwareRequirements(req.userId!, Number(req.params.recipeId)));
});

// POST /api/v1/kitchenware
router.post("/", validateBody(kitchenwareSchema), (req: AuthRequest, res) => {
  const input = normalizeInput(req.body || {});
  const validationError = validateInput(input);
  if (validationError) return res.status(400).json({ error: validationError });

  const catalog = resolveKitchenwareCatalog(input.name);
  if (!catalog || catalog.confidence < 0.7) enqueueKitchenwareMappingReview(input.name, "user_kitchenware", req.userId, catalog?.confidence || 0);
  const result = db.prepare(`
    INSERT INTO kitchenware_items (
      user_id, name, original_name, catalog_id, category, status, note, image_url, purchase_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId,
    catalog?.name || input.name,
    catalog && catalog.name !== input.name ? input.name : null,
    catalog?.id || null,
    catalog?.category || input.category,
    input.status,
    input.note || null,
    input.imageUrl || null,
    input.purchaseDate || null,
  );

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(result.lastInsertRowid);
  return res.status(201).json(item);
});

// PUT /api/v1/kitchenware/:id
router.put("/:id", validateBody(kitchenwareSchema), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`
    SELECT id FROM kitchenware_items
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).get(id, req.userId);
  if (!existing) return res.status(404).json({ error: "厨具不存在或无权修改" });

  const input = normalizeInput(req.body || {});
  const validationError = validateInput(input);
  if (validationError) return res.status(400).json({ error: validationError });

  const catalog = resolveKitchenwareCatalog(input.name);
  if (!catalog || catalog.confidence < 0.7) enqueueKitchenwareMappingReview(input.name, "user_kitchenware", id, catalog?.confidence || 0);
  db.prepare(`
    UPDATE kitchenware_items
    SET name = ?, original_name = ?, catalog_id = ?, category = ?, status = ?, note = ?, image_url = ?,
        purchase_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
  `).run(
    catalog?.name || input.name,
    catalog && catalog.name !== input.name ? input.name : null,
    catalog?.id || null,
    catalog?.category || input.category,
    input.status,
    input.note || null,
    input.imageUrl || null,
    input.purchaseDate || null,
    id,
    req.userId,
  );

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(id);
  return res.json(item);
});

// POST /api/v1/kitchenware/:id/maintain
router.post("/:id/maintain", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const result = db.prepare(`
    UPDATE kitchenware_items
    SET status = '良好', last_maintained_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "厨具不存在或无权修改" });

  const item = db.prepare("SELECT * FROM kitchenware_items WHERE id = ?").get(id);
  return res.json(item);
});

// DELETE /api/v1/kitchenware/:id
router.delete("/:id", (req: AuthRequest, res) => {
  const result = db.prepare(`
    UPDATE kitchenware_items
    SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(req.params.id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "厨具不存在或无权删除" });
  return res.json({ success: true, message: "厨具已移除" });
});

export default router;
