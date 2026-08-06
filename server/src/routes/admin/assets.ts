import { Router } from "express";
import { db } from "../../storage/db.js";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { adminIngredientSchema, adminKitchenwareCatalogSchema, adminKitchenwareStatusSchema } from "../../validation/schemas.js";
import { positiveIntegerParam } from "../../middleware/validateParam.js";
import { auditAdminAction as audit, deletedFilter } from "./shared.js";

const router = Router();
router.param("id", positiveIntegerParam);

// 官方厨具目录：供客户端录入时选择，不等同于用户已拥有的厨具资产。
router.get("/kitchenware/catalog", (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const filters: string[] = [];
    const params: string[] = [];
    if (search) {
      filters.push("(name LIKE ? OR aliases LIKE ? OR cooking_methods LIKE ? OR care_note LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }
    if (category && category !== "全部") {
      filters.push("category = ?");
      params.push(category);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    return res.json(db.prepare(`SELECT * FROM kitchenware_catalog ${where} ORDER BY category, name`).all(...params));
  } catch (error) {
    console.error("[Admin Kitchenware Catalog List Error]", error);
    return res.status(500).json({ error: "获取官方厨具目录失败" });
  }
});

router.post("/kitchenware/catalog", validateBody(adminKitchenwareCatalogSchema), (req: AuthRequest, res) => {
  try {
    const input = req.body;
    const result = db.prepare(`
      INSERT INTO kitchenware_catalog (name, category, aliases, cooking_methods, care_note)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.name, input.category, JSON.stringify(input.aliases), JSON.stringify(input.cooking_methods), input.care_note || null);
    audit(req, { action: "kitchenware_catalog.create", resourceType: "kitchenware_catalog", resourceId: Number(result.lastInsertRowid), summary: `新增官方厨具：${input.name}` });
    return res.status(201).json(db.prepare("SELECT * FROM kitchenware_catalog WHERE id = ?").get(result.lastInsertRowid));
  } catch (error: any) {
    if (String(error?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "该官方厨具已存在" });
    console.error("[Admin Kitchenware Catalog Create Error]", error);
    return res.status(500).json({ error: "新增官方厨具失败" });
  }
});

router.put("/kitchenware/catalog/:id", validateBody(adminKitchenwareCatalogSchema), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const input = req.body;
  const existing = db.prepare("SELECT name FROM kitchenware_catalog WHERE id = ?").get(id) as { name: string } | undefined;
  if (!existing) return res.status(404).json({ error: "官方厨具不存在" });
  try {
    db.prepare(`UPDATE kitchenware_catalog SET name = ?, category = ?, aliases = ?, cooking_methods = ?, care_note = ? WHERE id = ?`)
      .run(input.name, input.category, JSON.stringify(input.aliases), JSON.stringify(input.cooking_methods), input.care_note || null, id);
    audit(req, { action: "kitchenware_catalog.update", resourceType: "kitchenware_catalog", resourceId: id, summary: `更新官方厨具：${existing.name} → ${input.name}` });
    return res.json(db.prepare("SELECT * FROM kitchenware_catalog WHERE id = ?").get(id));
  } catch (error: any) {
    if (String(error?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "该官方厨具已存在" });
    console.error("[Admin Kitchenware Catalog Update Error]", error);
    return res.status(500).json({ error: "更新官方厨具失败" });
  }
});

router.delete("/kitchenware/catalog/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const item = db.prepare("SELECT name FROM kitchenware_catalog WHERE id = ?").get(id) as { name: string } | undefined;
  if (!item) return res.status(404).json({ error: "官方厨具不存在" });
  db.prepare("DELETE FROM kitchenware_catalog WHERE id = ?").run(id);
  audit(req, { action: "kitchenware_catalog.delete", resourceType: "kitchenware_catalog", resourceId: id, summary: `删除官方厨具：${item.name}` });
  return res.json({ success: true, message: "官方厨具已删除" });
});

// 厨具资产管理
router.get("/kitchenware", (req, res) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const filters = ["k.deleted_at IS NULL"];
    const params: string[] = [];
    if (search) {
      filters.push("(k.name LIKE ? OR k.note LIKE ? OR u.username LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (category && category !== "全部") {
      filters.push("k.category = ?");
      params.push(category);
    }
    if (status && status !== "全部") {
      filters.push("k.status = ?");
      params.push(status);
    }
    const items = db.prepare(`
      SELECT
        k.*,
        u.username AS owner_username
      FROM kitchenware_items k
      JOIN users u ON u.id = k.user_id
      WHERE ${filters.join(" AND ")}
      ORDER BY k.updated_at DESC, k.id DESC
    `).all(...params);
    return res.json(items);
  } catch (error) {
    console.error("[Admin Kitchenware List Error]", error);
    return res.status(500).json({ error: "获取厨具列表失败" });
  }
});

router.put("/kitchenware/:id/status", validateBody(adminKitchenwareStatusSchema), (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const status = String(req.body?.status || "").trim();
  const allowedStatuses = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);
  if (!allowedStatuses.has(status)) {
    return res.status(400).json({ error: "无效的厨具状态" });
  }
  const item = db.prepare(`
    SELECT name FROM kitchenware_items WHERE id = ? AND deleted_at IS NULL
  `).get(id) as { name: string } | undefined;
  if (!item) return res.status(404).json({ error: "厨具不存在" });

  db.prepare(`
    UPDATE kitchenware_items
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(status, id);
  audit(req, {
    action: "kitchenware.status_update",
    resourceType: "kitchenware",
    resourceId: id,
    summary: `更新厨具状态：${item.name} → ${status}`,
  });
  return res.json({ success: true, message: "厨具状态已更新" });
});

router.delete("/kitchenware/:id", (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`
    SELECT name FROM kitchenware_items WHERE id = ? AND deleted_at IS NULL
  `).get(id) as { name: string } | undefined;
  if (!item) return res.status(404).json({ error: "厨具不存在" });

  db.prepare(`
    UPDATE kitchenware_items
    SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(req.userId, id);
  audit(req, {
    action: "kitchenware.delete",
    resourceType: "kitchenware",
    resourceId: id,
    summary: `将厨具移入回收站：${item.name}`,
  });
  return res.json({ success: true, message: "厨具已移入回收站" });
});

// 10. 获取基础食材库
router.get("/ingredients", (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));
    const params: Array<string | number> = [];
    let where = deletedFilter(req.query.status);
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      where += ' AND (name LIKE ? OR brands LIKE ? OR barcode LIKE ?)';
      const term = `%${req.query.search.trim()}%`;
      params.push(term, term, term);
    }
    if (typeof req.query.category === 'string' && req.query.category !== '全部') {
      where += ' AND category = ?'; params.push(req.query.category);
    }
    if (typeof req.query.source === 'string' && req.query.source !== '全部') {
      where += ' AND source = ?'; params.push(req.query.source);
    }
    const total = (db.prepare(`SELECT COUNT(*) AS count FROM ingredients_library WHERE ${where}`).get(...params) as { count: number }).count;
    const items = db.prepare(`SELECT * FROM ingredients_library WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    res.json({ items, total, page, pageSize });
  } catch (error) {
    res.status(500).json({ error: "获取食材库失败" });
  }
});

// 10.1 管理员添加官方标准食材
router.post("/ingredients", validateBody(adminIngredientSchema), (req: AuthRequest, res) => {
  try {
    const { name, calories_100g, protein_100g, carbs_100g, fat_100g, source } = req.body;
    if (!name || calories_100g === undefined) {
      return res.status(400).json({ error: "食材名称和热量为必填项" });
    }

    const stmt = db.prepare(`
      INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      name,
      Number(calories_100g) || 0,
      Number(protein_100g) || 0,
      Number(carbs_100g) || 0,
      Number(fat_100g) || 0,
      source || 'official'
    );

    audit(req, {
      action: "ingredient.create",
      resourceType: "ingredients",
      resourceId: Number(info.lastInsertRowid),
      summary: `创建食材：${name}`,
    });
    res.json({ success: true, id: info.lastInsertRowid, message: "食材添加成功" });
  } catch (error) {
    res.status(500).json({ error: "添加食材失败" });
  }
});

// 10.2 管理员删除官方标准食材
router.delete("/ingredients/:id", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const ingredient = db.prepare("SELECT name FROM ingredients_library WHERE id = ? AND deleted_at IS NULL").get(id) as
      | { name: string }
      | undefined;
    const info = db.prepare(`
      UPDATE ingredients_library
      SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(req.userId, id);
    if (info.changes > 0) {
      audit(req, {
        action: "ingredient.delete",
        resourceType: "ingredients",
        resourceId: id,
        summary: `将食材移入回收站：${ingredient?.name || id}`,
      });
      res.json({ success: true, message: "食材已移入回收站" });
    } else {
      res.status(404).json({ error: "食材未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "删除食材失败" });
  }
});

// 10.3 管理员编辑官方标准食材
router.put("/ingredients/:id", validateBody(adminIngredientSchema), (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { name, calories_100g, protein_100g, carbs_100g, fat_100g, category, source } = req.body;
    if (!name || calories_100g === undefined) {
      return res.status(400).json({ error: "食材名称和热量为必填项" });
    }

    const stmt = db.prepare(`
      UPDATE ingredients_library 
      SET name=?, calories_100g=?, protein_100g=?, carbs_100g=?, fat_100g=?, category=?, source=?
      WHERE id=? AND deleted_at IS NULL
    `);
    const info = stmt.run(
      name,
      Number(calories_100g) || 0,
      Number(protein_100g) || 0,
      Number(carbs_100g) || 0,
      Number(fat_100g) || 0,
      category || null,
      source || 'official',
      id
    );

    if (info.changes > 0) {
      audit(req, {
        action: "ingredient.update",
        resourceType: "ingredients",
        resourceId: id,
        summary: `更新食材：${name}`,
      });
      res.json({ success: true, message: "食材更新成功" });
    } else {
      res.status(404).json({ error: "食材未找到" });
    }
  } catch (error) {
    res.status(500).json({ error: "更新食材失败" });
  }
});

// 11. 获取待审核的自定义食材
router.get("/custom-foods/pending", (req, res) => {
  try {
    const pending = db.prepare(`
      SELECT ucf.*, u.username as author_name
      FROM user_custom_foods ucf
      LEFT JOIN users u ON ucf.user_id = u.id
      WHERE ucf.status = 'pending'
      ORDER BY ucf.created_at DESC
    `).all();
    res.json(pending);
  } catch (error) {
    res.status(500).json({ error: "获取待审核食材失败" });
  }
});

// 12. 审核通过 UGC 食材
router.post("/custom-foods/:id/approve", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare('SELECT * FROM user_custom_foods WHERE id = ?').get(id) as any;
    if (!item) {
      return res.status(404).json({ error: "记录未找到" });
    }

    db.transaction(() => {
      // 1. Update status
      db.prepare("UPDATE user_custom_foods SET status = 'approved' WHERE id = ?").run(id);
      
      // 2. Insert into library
      db.prepare(`
        INSERT INTO ingredients_library (name, calories_100g, protein_100g, carbs_100g, fat_100g, source)
        VALUES (?, ?, ?, ?, ?, 'ugc')
      `).run(item.name, item.calories_100g, item.protein_100g, item.carbs_100g, item.fat_100g);
    })();

    audit(req, {
      action: "custom_food.approve",
      resourceType: "custom_food",
      resourceId: id,
      summary: `审核通过自定义食材：${item.name}`,
    });
    res.json({ success: true, message: "审核通过并已入库" });
  } catch (error) {
    res.status(500).json({ error: "操作失败" });
  }
});

// 13. 拒绝 UGC 食材
router.post("/custom-foods/:id/reject", (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const item = db.prepare("SELECT name FROM user_custom_foods WHERE id = ?").get(id) as
      | { name: string }
      | undefined;
    db.prepare("UPDATE user_custom_foods SET status = 'rejected' WHERE id = ?").run(id);
    audit(req, {
      action: "custom_food.reject",
      resourceType: "custom_food",
      resourceId: id,
      summary: `驳回自定义食材：${item?.name || id}`,
    });
    res.json({ success: true, message: "已拒绝" });
  } catch (error) {
    res.status(500).json({ error: "操作失败" });
  }
});

export function createAdminAssetsRouter() {
  return router;
}
