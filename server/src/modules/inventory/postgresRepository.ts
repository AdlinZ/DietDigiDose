import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  inventoryBulkIntakeResponseSchema,
  inventoryConsumptionResponseSchema,
  inventoryHistoryResponseSchema,
  inventoryImportResponseSchema,
  inventoryItemSchema,
  inventoryListResponseSchema,
} from "@dietdigidose/contracts";
import {
  calculateInventoryConsumption,
  InventoryQuantityError,
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

function formatInventoryItem(item: QueryResultRow) {
  return inventoryItemSchema.parse({
    ...item,
    is_available: Boolean(item.is_available),
    version: Number(item.version) || 1,
    quantity_value: item.quantity_value == null ? null : Number(item.quantity_value),
    package_size_value: item.package_size_value == null ? null : Number(item.package_size_value),
    updated_at: item.updated_at instanceof Date ? item.updated_at.toISOString() : item.updated_at,
  });
}

export class PostgresInventoryRepository implements InventoryRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockIdempotency(client: PoolClient, scope: string, userId: number, key: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`inventory:${scope}:${userId}:${key}`]);
  }

  private async insertInventoryItem(
    client: PoolClient,
    userId: number,
    item: InventoryCreateData | InventoryBulkIntakeData["items"][number],
  ) {
    const result = await client.query(`
      INSERT INTO inventory_items (
        user_id, food_name, category, quantity, expiration_date, storage_location, image_url,
        is_available, quantity_value, quantity_unit, package_size_value, package_size_unit, batch_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      userId, item.food_name, item.category, item.quantity || "1份", item.expiration_date,
      item.storage_location || "冷藏", item.image_url || null, item.quantity_value ?? null,
      item.quantity_unit ?? null, item.package_size_value ?? null, item.package_size_unit ?? null,
      item.batch_code ?? null,
    ]);
    return formatInventoryItem(result.rows[0]!);
  }

  async list(userId: number) {
    const result = await this.pool.query(`
      SELECT * FROM inventory_items
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY expiration_date ASC
    `, [userId]);
    return inventoryListResponseSchema.parse(result.rows.map(formatInventoryItem));
  }

  async findOwned(userId: number, itemId: number) {
    const result = await this.pool.query(`
      SELECT * FROM inventory_items
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `, [itemId, userId]);
    return result.rows[0] ? formatInventoryItem(result.rows[0]) : null;
  }

  async create(userId: number, input: InventoryCreateData) {
    return this.transaction(async (client) => {
      const item = await this.insertInventoryItem(client, userId, input);
      await client.query(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES ($1, $2, 'created', 'manual', NULL, $3, $4, $3, $5)
      `, [userId, item.id, item.quantity_value ?? null, item.quantity_unit ?? null, `create:${item.id}`]);
      return item;
    });
  }

  async importShoppingList(userId: number, input: InventoryImportData) {
    return this.transaction(async (client) => {
      await this.lockIdempotency(client, "shopping", userId, input.idempotency_key);
      const existing = await client.query(`
        SELECT result_json FROM shopping_inventory_imports WHERE user_id = $1 AND idempotency_key = $2
      `, [userId, input.idempotency_key]);
      if (existing.rows[0]) return inventoryImportResponseSchema.parse({ items: existing.rows[0].result_json, repeated: true });
      const items = [];
      for (const item of input.items) items.push(await this.insertInventoryItem(client, userId, item));
      await client.query(`
        INSERT INTO shopping_inventory_imports (user_id, idempotency_key, result_json) VALUES ($1, $2, $3::jsonb)
      `, [userId, input.idempotency_key, JSON.stringify(items)]);
      return inventoryImportResponseSchema.parse({ items, repeated: false });
    });
  }

  async bulkIntake(userId: number, input: InventoryBulkIntakeData) {
    return this.transaction(async (client) => {
      await this.lockIdempotency(client, "intake", userId, input.idempotency_key);
      const existing = await client.query(`
        SELECT result_json FROM inventory_intake_batches WHERE user_id = $1 AND idempotency_key = $2
      `, [userId, input.idempotency_key]);
      if (existing.rows[0]) return inventoryBulkIntakeResponseSchema.parse({ ...existing.rows[0].result_json, repeated: true });
      const items = [];
      for (const item of input.items) items.push(await this.insertInventoryItem(client, userId, item));
      const response = inventoryBulkIntakeResponseSchema.parse({ batch_id: randomUUID(), items, repeated: false });
      await client.query(`
        INSERT INTO inventory_intake_batches
          (id, user_id, idempotency_key, source, source_reference, confirmed_payload_json, result_json)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
      `, [
        response.batch_id, userId, input.idempotency_key, input.source, input.source_reference ?? null,
        JSON.stringify(input.items), JSON.stringify(response),
      ]);
      return response;
    });
  }

  async listPreviewCandidates(userId: number): Promise<InventoryPreviewCandidate[]> {
    const result = await this.pool.query(`
      SELECT id, food_name, quantity_value, quantity_unit, expiration_date, batch_code, version
      FROM inventory_items
      WHERE user_id = $1 AND is_available = TRUE AND deleted_at IS NULL
      ORDER BY expiration_date ASC, id ASC
    `, [userId]);
    return result.rows.map((row) => ({
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
    return this.transaction(async (client) => {
      await this.lockIdempotency(client, "consume", userId, input.idempotency_key);
      const existing = await client.query(`
        SELECT result_json FROM inventory_consumption_requests WHERE user_id = $1 AND idempotency_key = $2
      `, [userId, input.idempotency_key]);
      if (existing.rows[0]) return inventoryConsumptionResponseSchema.parse({ ...existing.rows[0].result_json, repeated: true });

      const changes = [];
      const items = [];
      for (const [index, consumption] of (input.items as InventoryConsumption[]).entries()) {
        const selected = await client.query(`
          SELECT * FROM inventory_items WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL FOR UPDATE
        `, [consumption.item_id, userId]);
        const row = selected.rows[0];
        if (!row) throw new InventoryQuantityError("INVENTORY_CONFLICT", "库存食材不存在、已用完或不属于当前账号");
        const transition = calculateInventoryConsumption(row, consumption);
        const updated = await client.query(`
          UPDATE inventory_items SET quantity = $1, quantity_value = $2, is_available = $3,
            version = version + 1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4 AND user_id = $5 AND version = $6 AND is_available = TRUE AND deleted_at IS NULL
          RETURNING *
        `, [transition.nextQuantity, transition.storedValue === null ? null : transition.remaining, transition.available, consumption.item_id, userId, consumption.version]);
        if (!updated.rows[0]) throw new InventoryQuantityError("INVENTORY_VERSION_CONFLICT", "库存已变化，请刷新后重试");
        await client.query(`
          INSERT INTO inventory_change_logs
            (user_id, inventory_item_id, action, source, quantity_before, quantity_after,
             quantity_unit, delta_value, idempotency_key, metadata_json)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        `, [
          userId, consumption.item_id, consumption.mode === "all" ? "consume_all" : "consume_partial",
          input.source, transition.storedValue, transition.storedValue === null ? null : transition.remaining,
          transition.storedUnit, transition.amountUsed === null ? null : -Math.round((transition.amountUsed + Number.EPSILON) * 1000) / 1000,
          `${input.idempotency_key}:${consumption.item_id}:${index}`, "{}",
        ]);
        changes.push({
          item_id: consumption.item_id,
          quantity_before: transition.storedValue,
          quantity_after: transition.storedValue === null ? null : transition.remaining,
          quantity_unit: transition.storedUnit,
          consumed_value: transition.amountUsed,
          is_available: transition.available,
          version: consumption.version + 1,
        });
        items.push(formatInventoryItem(updated.rows[0]));
      }
      const response = inventoryConsumptionResponseSchema.parse({ changes, items, repeated: false });
      await client.query(`
        INSERT INTO inventory_consumption_requests (user_id, idempotency_key, result_json)
        VALUES ($1, $2, $3::jsonb)
      `, [userId, input.idempotency_key, JSON.stringify(response)]);
      return response;
    });
  }

  async history(userId: number, itemId: number) {
    const owned = await this.pool.query("SELECT id FROM inventory_items WHERE id = $1 AND user_id = $2", [itemId, userId]);
    if (!owned.rows[0]) return null;
    const result = await this.pool.query(`
      SELECT id, action, source, quantity_before, quantity_after, quantity_unit, delta_value,
        metadata_json AS metadata, created_at
      FROM inventory_change_logs
      WHERE user_id = $1 AND inventory_item_id = $2
      ORDER BY created_at DESC, id DESC
    `, [userId, itemId]);
    return inventoryHistoryResponseSchema.parse(result.rows.map((row) => ({
      ...row,
      id: Number(row.id),
      quantity_before: row.quantity_before == null ? null : Number(row.quantity_before),
      quantity_after: row.quantity_after == null ? null : Number(row.quantity_after),
      delta_value: row.delta_value == null ? null : Number(row.delta_value),
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    })));
  }

  async update(userId: number, itemId: number, expectedVersion: number, input: InventoryUpdatePersistence) {
    return this.transaction(async (client) => {
      const currentResult = await client.query(`
        SELECT * FROM inventory_items WHERE id = $1 AND user_id = $2 AND version = $3 AND deleted_at IS NULL FOR UPDATE
      `, [itemId, userId, expectedVersion]);
      const current = currentResult.rows[0];
      if (!current) return { kind: "conflict" } as const;
      const { patch } = input;
      const has = (key: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, key);
      const updatedResult = await client.query(`
        UPDATE inventory_items SET
          food_name = COALESCE($1, food_name), category = COALESCE($2, category), quantity = COALESCE($3, quantity),
          expiration_date = COALESCE($4, expiration_date), storage_location = COALESCE($5, storage_location),
          image_url = COALESCE($6, image_url), is_available = COALESCE($7, is_available),
          quantity_value = $8, quantity_unit = $9, package_size_value = $10, package_size_unit = $11,
          batch_code = $12, version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $13 AND user_id = $14 AND version = $15 AND deleted_at IS NULL RETURNING *
      `, [
        patch.food_name, patch.category, patch.quantity, patch.expiration_date, patch.storage_location,
        patch.image_url, patch.is_available, input.nextQuantityValue, input.nextQuantityUnit,
        has("package_size_value") ? patch.package_size_value : current.package_size_value,
        has("package_size_unit") ? patch.package_size_unit : current.package_size_unit,
        has("batch_code") ? patch.batch_code : current.batch_code, itemId, userId, expectedVersion,
      ]);
      if (!updatedResult.rows[0]) return { kind: "conflict" } as const;
      const updated = formatInventoryItem(updatedResult.rows[0]);
      const currentQuantity = current.quantity_value == null ? null : Number(current.quantity_value);
      if (currentQuantity !== updated.quantity_value || current.quantity_unit !== updated.quantity_unit || Boolean(current.is_available) !== updated.is_available) {
        await client.query(`
          INSERT INTO inventory_change_logs
            (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
          VALUES ($1, $2, 'adjusted', 'manual', $3, $4, $5, $6, $7)
          ON CONFLICT (user_id, idempotency_key) DO NOTHING
        `, [
          userId, itemId, current.quantity_value, updated.quantity_value, updated.quantity_unit,
          current.quantity_value == null || updated.quantity_value == null ? null : Number(updated.quantity_value) - Number(current.quantity_value),
          `manual-update:${itemId}:${expectedVersion}`,
        ]);
      }
      return { kind: "updated", item: updated } as const;
    });
  }

  async remove(userId: number, item: InventoryItem) {
    return this.transaction(async (client) => {
      const removed = await client.query(`
        UPDATE inventory_items SET deleted_at = CURRENT_TIMESTAMP, is_available = FALSE,
          version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id
      `, [item.id, userId]);
      if (!removed.rows[0]) return { kind: "not_found" } as const;
      await client.query(`
        INSERT INTO inventory_change_logs
          (user_id, inventory_item_id, action, source, quantity_before, quantity_after, quantity_unit, delta_value, idempotency_key)
        VALUES ($1, $2, 'removed', 'manual', $3, $3, $4, 0, $5)
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
      `, [userId, item.id, item.quantity_value ?? null, item.quantity_unit ?? null, `remove:${item.id}:${item.version}`]);
      return { kind: "removed" } as const;
    });
  }
}
