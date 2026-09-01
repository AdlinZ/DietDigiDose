import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
} from "@dietdigidose/contracts";
import {
  applyInventoryConsumptions,
  type InventoryConsumption,
} from "../../services/inventoryQuantity.js";
import type { InventoryRepository } from "./repository.js";
import type {
  InventoryBulkIntakeData,
  InventoryConsumptionData,
  InventoryCreateData,
  InventoryImportData,
  InventoryItem,
  InventoryPreviewCandidate,
  InventoryUpdatePersistence,
} from "./types.js";

function formatInventoryItem(item: Record<string, unknown>) {
  return inventoryItemSchema.parse({
    ...item,
    is_available: Boolean(item.is_available),
    version: Number(item.version) || 1,
  });
}

export class SqliteInventoryRepository implements InventoryRepository {
  private readonly database: Database.Database;

  constructor(database: Database.Database) {
    this.database = database;
  }

  async recordFunnelEvent(eventName: string, actorHash: string) {
    this.database.prepare("INSERT INTO funnel_events (event_name,actor_hash) VALUES (?,?)").run(eventName, actorHash);
  }

  private insertInventoryItem(userId: number, item: InventoryCreateData | InventoryBulkIntakeData["items"][number]) {
    const row = this.database.prepare(`
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
    return this.database.prepare("SELECT * FROM inventory_items WHERE id = ?").get(row.lastInsertRowid) as Record<string, unknown>;
  }

  async list(userId: number) {
    const rows = this.database.prepare(`
      SELECT * FROM inventory_items
      WHERE user_id = ? AND deleted_at IS NULL
      ORDER BY expiration_date ASC
    `).all(userId) as Array<Record<string, unknown>>;
    return inventoryListResponseSchema.parse(rows.map(formatInventoryItem));
  }

  async findOwned(userId: number, itemId: number) {
    const row = this.database.prepare(`
      SELECT * FROM inventory_items
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).get(itemId, userId) as Record<string, unknown> | undefined;
    return row ? formatInventoryItem(row) : null;
  }

  async create(userId: number, input: InventoryCreateData) {
    return this.database.transaction(() => {
      const newItem = this.insertInventoryItem(userId, input);
      this.database.prepare(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES (?, ?, 'created', 'manual', NULL, ?, ?, ?, ?)
      `).run(
        userId, newItem.id, newItem.quantity_value ?? null, newItem.quantity_unit ?? null,
        newItem.quantity_value ?? null, `create:${newItem.id}`,
      );
      return formatInventoryItem(newItem);
    })();
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM shopping_inventory_imports WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryImportResponseSchema.parse({ items: JSON.parse(existing.result_json), repeated: true });
      }

      const items = input.items.map((item) => formatInventoryItem(this.insertInventoryItem(userId, item)));
      this.database.prepare(`
        INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES (?, ?, ?)
      `).run(userId, input.idempotency_key, JSON.stringify(items));
      return inventoryImportResponseSchema.parse({ items, repeated: false });
    })();
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM inventory_intake_batches
        WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryBulkIntakeResponseSchema.parse({
          ...(JSON.parse(existing.result_json) as Record<string, unknown>),
          repeated: true,
        });
      }

      const items = input.items.map((item) => formatInventoryItem(this.insertInventoryItem(userId, item)));
      const result = inventoryBulkIntakeResponseSchema.parse({ batch_id: randomUUID(), items, repeated: false });
      this.database.prepare(`
        INSERT INTO inventory_intake_batches
          (id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.batch_id, userId, input.idempotency_key, input.source,
        input.source_reference ?? null, JSON.stringify(input.items), JSON.stringify(result),
      );
      return result;
    })();
  }

  async listPreviewCandidates(userId: number): Promise<InventoryPreviewCandidate[]> {
    const rows = this.database.prepare(`
      SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version
      FROM inventory_items
      WHERE user_id = ? AND is_available = 1 AND deleted_at IS NULL
      ORDER BY expiration_date ASC, id ASC
    `).all(userId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      food_name: String(row.food_name),
      quantity_value: row.quantity_value == null ? null : Number(row.quantity_value),
      quantity_unit: row.quantity_unit as InventoryPreviewCandidate["quantity_unit"],
      expiration_date: String(row.expiration_date),
      batch_code: row.batch_code == null ? null : String(row.batch_code),
      version: Number(row.version),
    }));
  }

  async consume(userId: number, input: InventoryConsumptionData) {
    return this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT result_json FROM inventory_consumption_requests
        WHERE user_id = ? AND idempotency_key = ?
      `).get(userId, input.idempotency_key) as { result_json: string } | undefined;
      if (existing) {
        return inventoryConsumptionResponseSchema.parse({
          ...(JSON.parse(existing.result_json) as Record<string, unknown>),
          repeated: true,
        });
      }

      const changes = applyInventoryConsumptions(this.database, userId, input.items as InventoryConsumption[], {
        idempotencyKey: input.idempotency_key,
        source: input.source,
      });
      const items = input.items.map((item) => formatInventoryItem(
        this.database.prepare("SELECT * FROM inventory_items WHERE id = ? AND user_id = ?").get(item.item_id, userId) as Record<string, unknown>,
      ));
      const response = inventoryConsumptionResponseSchema.parse({ changes, items, repeated: false });
      this.database.prepare(`
        INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json)
        VALUES (?, ?, ?)
      `).run(userId, input.idempotency_key, JSON.stringify(response));
      return response;
    })();
  }

  async history(userId: number, itemId: number) {
    const owned = this.database.prepare("SELECT id FROM inventory_items WHERE id = ? AND user_id = ?").get(itemId, userId);
    if (!owned) return null;
    const rows = this.database.prepare(`
      SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, metadata_json, created_at
      FROM inventory_change_logs
      WHERE user_id = ? AND inventory_item_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(userId, itemId) as Array<Record<string, unknown>>;
    return inventoryHistoryResponseSchema.parse(rows.map((row) => {
      const { metadata_json: metadataJson, ...historyItem } = row;
      return {
        ...historyItem,
        metadata: typeof metadataJson === "string" ? JSON.parse(metadataJson) : {},
      };
    }));
  }

  async update(
    userId: number,
    itemId: number,
    expectedVersion: number,
    input: InventoryUpdatePersistence,
  ) {
    return this.database.transaction(() => {
      const current = this.database.prepare(`
        SELECT * FROM inventory_items
        WHERE id = ? AND user_id = ? AND version = ? AND deleted_at IS NULL
      `).get(itemId, userId, expectedVersion) as Record<string, unknown> | undefined;
      if (!current) return { kind: "conflict" } as const;

      const { patch } = input;
      const has = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
      const result = this.database.prepare(`
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
        patch.food_name,
        patch.category,
        patch.quantity,
        patch.expiration_date,
        patch.storage_location,
        patch.image_url,
        patch.is_available !== undefined ? (patch.is_available ? 1 : 0) : null,
        input.nextQuantityValue,
        input.nextQuantityUnit,
        has("package_size_value") ? patch.package_size_value : current.package_size_value,
        has("package_size_unit") ? patch.package_size_unit : current.package_size_unit,
        has("batch_code") ? patch.batch_code : current.batch_code,
        itemId,
        userId,
        expectedVersion,
      );
      if (result.changes !== 1) return { kind: "conflict" } as const;

      const updatedRow = this.database.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId) as Record<string, unknown>;
      const updated = formatInventoryItem(updatedRow);
      const currentAvailable = Boolean(current.is_available);
      if (current.quantity_value !== updated.quantity_value || current.quantity_unit !== updated.quantity_unit || currentAvailable !== updated.is_available) {
        this.database.prepare(`
          INSERT OR IGNORE INTO inventory_change_logs
            (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
          VALUES (?, ?, 'adjusted', 'manual', ?, ?, ?, ?, ?)
        `).run(
          userId, itemId, current.quantity_value, updated.quantity_value, updated.quantity_unit,
          current.quantity_value == null || updated.quantity_value == null
            ? null
            : Number(updated.quantity_value) - Number(current.quantity_value),
          `manual-update:${itemId}:${expectedVersion}`,
        );
      }
      return { kind: "updated", item: updated } as const;
    })();
  }

  async remove(userId: number, item: InventoryItem) {
    return this.database.transaction(() => {
      const result = this.database.prepare(`
        UPDATE inventory_items SET deleted_at = CURRENT_TIMESTAMP, is_available = 0,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL
      `).run(item.id, userId);
      if (result.changes === 0) return { kind: "not_found" } as const;

      this.database.prepare(`
        INSERT OR IGNORE INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES (?, ?, 'removed', 'manual', ?, ?, ?, 0, ?)
      `).run(
        userId, item.id, item.quantity_value ?? null, item.quantity_value ?? null,
        item.quantity_unit ?? null, `remove:${item.id}:${item.version}`,
      );
      return { kind: "removed" } as const;
    })();
  }
}
