import { Router } from "express";
import { db } from "../storage/db.js";
import { authMiddleware, type AuthRequest } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  inventoryBulkIntakeSchema,
  inventoryConsumptionPreviewSchema,
  inventoryConsumptionSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  shoppingInventoryImportSchema,
} from "../validation/schemas.js";
import { randomUUID } from "node:crypto";
import { sendError } from "../utils/http.js";
import { positiveIntegerParam } from "../middleware/validateParam.js";
import { recordFunnelEvent } from "../services/funnelEvents.js";
import {
  applyInventoryConsumptions,
  buildFefoConsumptionPreview,
  InventoryQuantityError,
  type InventoryConsumption,
} from "../services/inventoryQuantity.js";

const router = Router();
router.param("id", positiveIntegerParam);
router.use(authMiddleware);

function formatInventoryItem(item: Record<string, unknown>) {
  return {
    ...item,
    is_available: Boolean(item.is_available),
    version: Number(item.version) || 1,
  };
}

function insertInventoryItem(userId: number, item: Record<string, any>) {
  const row = db.prepare(`
    INSERT INTO inventory_items (
      user_id, food_name, category, quantity, expiration_date, storage_location, image_url,
      is_available, quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    userId, item.food_name, item.category, item.quantity || "1份", item.expiration_date,
    item.storage_location || "冷藏", item.image_url || null,
    item.quantity_value ?? null, item.quantity_unit ?? null,
    item.package_size_value ?? null, item.package_size_unit ?? null, item.batch_code ?? null,
  );
  return db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(row.lastInsertRowid) as Record<string, unknown>;
}

router.post("/import-shopping-list", validateBody(shoppingInventoryImportSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const { idempotency_key: idempotencyKey, items } = req.body;
  const existing = db.prepare(`
    SELECT result_json FROM shopping_inventory_imports WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, idempotencyKey) as { result_json: string } | undefined;
  if (existing) return res.json({ items: JSON.parse(existing.result_json), repeated: true });

  const imported = db.transaction(() => {
    const result = items.map((item: any) => {
      return formatInventoryItem(insertInventoryItem(userId, item));
    });
    db.prepare(`
      INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES (?, ?, ?)
    `).run(userId, idempotencyKey, JSON.stringify(result));
    return result;
  })();
  if (imported.length > 0) recordFunnelEvent(userId, "inventory_added");
  return res.status(201).json({ items: imported, repeated: false });
});

router.post("/bulk-intake", validateBody(inventoryBulkIntakeSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const existing = db.prepare(`
    SELECT result_json FROM inventory_intake_batches
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, req.body.idempotency_key) as { result_json: string } | undefined;
  if (existing) return res.json({ ...JSON.parse(existing.result_json), repeated: true });
  const response = db.transaction(() => {
    const items = req.body.items.map((item: Record<string, any>) => formatInventoryItem(insertInventoryItem(userId, item)));
    const result = { batch_id: randomUUID(), items, repeated: false };
    db.prepare(`
      INSERT INTO inventory_intake_batches
        (id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.batch_id, userId, req.body.idempotency_key, req.body.source,
      req.body.source_reference ?? null, JSON.stringify(req.body.items), JSON.stringify(result),
    );
    return result;
  })();
  recordFunnelEvent(userId, "inventory_added");
  return res.status(201).json(response);
});

// GET /api/v1/inventory
router.get("/", (req: AuthRequest, res) => {
  const items = db.prepare(`
    SELECT * FROM inventory_items
    WHERE user_id = ? AND deleted_at IS NULL
    ORDER BY expiration_date ASC
  `).all(req.userId);

  // Convert SQLite 1/0 integer to boolean for JS
  const formatted = (items as Array<Record<string, unknown>>).map(formatInventoryItem);

  res.json(formatted);
});

// POST /api/v1/inventory
router.post("/", validateBody(inventoryCreateSchema), (req: AuthRequest, res) => {
  const newItem = insertInventoryItem(req.userId!, req.body);
  db.prepare(`
    INSERT INTO inventory_change_logs
      (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
    VALUES (?, ?, 'created', 'manual', NULL, ?, ?, ?, ?)
  `).run(
    req.userId!, newItem.id, newItem.quantity_value ?? null, newItem.quantity_unit ?? null,
    newItem.quantity_value ?? null, `create:${newItem.id}`,
  );
  recordFunnelEvent(req.userId!, "inventory_added");
  res.status(201).json(formatInventoryItem(newItem));
});

router.post("/consumption-preview", validateBody(inventoryConsumptionPreviewSchema), (req: AuthRequest, res) => {
  return res.json({ items: buildFefoConsumptionPreview(db, req.userId!, req.body.items) });
});

router.post("/consume", validateBody(inventoryConsumptionSchema), (req: AuthRequest, res) => {
  const userId = req.userId!;
  const existing = db.prepare(`
    SELECT result_json FROM inventory_consumption_requests
    WHERE user_id = ? AND idempotency_key = ?
  `).get(userId, req.body.idempotency_key) as { result_json: string } | undefined;
  if (existing) return res.json({ ...JSON.parse(existing.result_json), repeated: true });
  try {
    const result = db.transaction(() => {
      const changes = applyInventoryConsumptions(db, userId, req.body.items as InventoryConsumption[], {
        idempotencyKey: req.body.idempotency_key,
        source: req.body.source,
      });
      const response = {
        changes,
        items: req.body.items.map((item: InventoryConsumption) => formatInventoryItem(
          db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(item.item_id, userId) as Record<string, unknown>,
        )),
        repeated: false,
      };
      db.prepare(`
        INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json)
        VALUES (?, ?, ?)
      `).run(userId, req.body.idempotency_key, JSON.stringify(response));
      return response;
    })();
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof InventoryQuantityError) {
      const status = ["INVENTORY_UNIT_MISMATCH", "STRUCTURED_QUANTITY_REQUIRED", "INVALID_CONSUMPTION_AMOUNT"].includes(error.code) ? 400 : 409;
      return sendError(res, status, error.message, error.code);
    }
    throw error;
  }
});

router.get("/:id/history", (req: AuthRequest, res) => {
  const owned = db.prepare("SELECT id FROM inventory_items WHERE id = ? AND user_id = ?").get(req.params.id, req.userId!);
  if (!owned) return sendError(res, 404, "食材不存在或无权查看", "INVENTORY_NOT_FOUND");
  const rows = db.prepare(`
    SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, metadata_json, created_at
    FROM inventory_change_logs
    WHERE user_id = ? AND inventory_item_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(req.userId!, req.params.id) as Array<Record<string, unknown>>;
  return res.json(rows.map((row) => ({
    ...row,
    metadata: typeof row.metadata_json === "string" ? JSON.parse(row.metadata_json) : {},
    metadata_json: undefined,
  })));
});

// PUT /api/v1/inventory/:id
router.put("/:id", validateBody(inventoryUpdateSchema), (req: AuthRequest, res) => {
  const {
    food_name, category, quantity, expiration_date, storage_location, image_url, is_available,
    quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code, version,
  } = req.body;
  const itemId = req.params.id;

  const item: any = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(itemId, req.userId);
  if (!item) {
    return sendError(res, 404, "食材不存在或无权修改", "INVENTORY_NOT_FOUND");
  }

  const has = (key: string) => Object.prototype.hasOwnProperty.call(req.body, key);
  const nextQuantityValue = has("quantity_value") ? quantity_value : item.quantity_value;
  const nextQuantityUnit = has("quantity_unit") ? quantity_unit : item.quantity_unit;
  if ((nextQuantityValue == null) !== (nextQuantityUnit == null)) {
    return sendError(res, 400, "结构化数量和单位必须同时填写", "INVALID_STRUCTURED_QUANTITY");
  }
  if (version !== undefined && Number(item.version) !== version) {
    return sendError(res, 409, "库存已在其他设备更新，请刷新后重试", "INVENTORY_VERSION_CONFLICT");
  }
  const updatedResult = db.prepare(`
    UPDATE inventory_items
    SET food_name = COALESCE(?, food_name),
        category = COALESCE(?, category),
        quantity = COALESCE(?, quantity),
        expiration_date = COALESCE(?, expiration_date),
        storage_location = COALESCE(?, storage_location),
        image_url = COALESCE(?, image_url),
        is_available = COALESCE(?, is_available),
        quantity_value = ?, quantity_unit = ?, package_size_value = ?, package_size_unit = ?, batch_code = ?,
        version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
  `).run(
    food_name,
    category,
    quantity,
    expiration_date,
    storage_location,
    image_url,
    is_available !== undefined ? (is_available ? 1 : 0) : null,
    nextQuantityValue,
    nextQuantityUnit,
    has("package_size_value") ? package_size_value : item.package_size_value,
    has("package_size_unit") ? package_size_unit : item.package_size_unit,
    has("batch_code") ? batch_code : item.batch_code,
    itemId,
    req.userId,
    item.version,
  );
  if (updatedResult.changes !== 1) return sendError(res, 409, "库存已变化，请刷新后重试", "INVENTORY_VERSION_CONFLICT");

  const updated = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as Record<string, any>;
  if (item.quantity_value !== updated.quantity_value || item.quantity_unit !== updated.quantity_unit || item.is_available !== updated.is_available) {
    db.prepare(`
      INSERT OR IGNORE INTO inventory_change_logs
        (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
      VALUES (?, ?, 'adjusted', 'manual', ?, ?, ?, ?, ?)
    `).run(
      req.userId!, itemId, item.quantity_value, updated.quantity_value, updated.quantity_unit,
      item.quantity_value == null || updated.quantity_value == null ? null : Number(updated.quantity_value) - Number(item.quantity_value),
      `manual-update:${itemId}:${item.version}`,
    );
  }
  res.json(formatInventoryItem(updated));

});

// DELETE /api/v1/inventory/:id
router.delete("/:id", (req: AuthRequest, res) => {
  const item = db.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL").get(req.params.id, req.userId) as Record<string, unknown> | undefined;
  if (!item) return sendError(res, 404, "未找到相关食材", "INVENTORY_NOT_FOUND");
  const result = db.prepare(`
    UPDATE inventory_items SET deleted_at = CURRENT_TIMESTAMP, is_available = 0,
      version = version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL
  `).run(req.params.id, req.userId);
  if (result.changes === 0) {
    return sendError(res, 404, "未找到相关食材", "INVENTORY_NOT_FOUND");
  }

  db.prepare(`
    INSERT OR IGNORE INTO inventory_change_logs
      (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
    VALUES (?, ?, 'removed', 'manual', ?, ?, ?, 0, ?)
  `).run(req.userId!, req.params.id, item.quantity_value ?? null, item.quantity_value ?? null, item.quantity_unit ?? null, `remove:${req.params.id}:${item.version}`);
  res.json({ message: "删除成功" });
});

export default router;
