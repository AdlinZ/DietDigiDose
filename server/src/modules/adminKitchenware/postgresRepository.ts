import type { Pool, PoolClient } from "pg";
import type { AdminKitchenwareRepository } from "./repository.js";
import type { AssetQuery, AuditContext, CatalogInput, CatalogQuery, Row } from "./types.js";

function duplicate(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "23505"; }

export class PostgresAdminKitchenwareRepository implements AdminKitchenwareRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listCatalog(input: CatalogQuery) {
    const filters: string[] = []; const values: string[] = [];
    if (input.search) { values.push(`%${input.search}%`); const value = `$${values.length}`;
      filters.push(`(name ILIKE ${value} OR aliases::text ILIKE ${value} OR cooking_methods::text ILIKE ${value} OR care_note ILIKE ${value})`); }
    if (input.category) { values.push(input.category); filters.push(`category=$${values.length}`); }
    return (await this.pool.query(`SELECT * FROM kitchenware_catalog ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY category, name`, values)).rows as Row[];
  }

  async createCatalog(input: CatalogInput, audit: AuditContext) {
    try { return await this.tx(async (client) => {
      const result = await client.query(`INSERT INTO kitchenware_catalog (name, category, aliases, cooking_methods, care_note)
        VALUES ($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING *`, [input.name, input.category, JSON.stringify(input.aliases),
        JSON.stringify(input.cookingMethods), input.careNote]);
      const item = result.rows[0] as Row; await this.insertAudit(client, audit, "kitchenware_catalog.create", "kitchenware_catalog",
        Number(item.id), `新增官方厨具：${input.name}`); return { kind: "created" as const, item };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async updateCatalog(id: number, input: CatalogInput, audit: AuditContext) {
    try { return await this.tx(async (client) => {
      const existing = (await client.query("SELECT name FROM kitchenware_catalog WHERE id=$1 FOR UPDATE", [id])).rows[0] as Row | undefined;
      if (!existing) return { kind: "missing" as const };
      const result = await client.query(`UPDATE kitchenware_catalog SET name=$1, category=$2, aliases=$3::jsonb,
        cooking_methods=$4::jsonb, care_note=$5 WHERE id=$6 RETURNING *`, [input.name, input.category, JSON.stringify(input.aliases),
        JSON.stringify(input.cookingMethods), input.careNote, id]);
      await this.insertAudit(client, audit, "kitchenware_catalog.update", "kitchenware_catalog", id,
        `更新官方厨具：${existing.name} → ${input.name}`);
      return { kind: "updated" as const, item: result.rows[0] as Row };
    }); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async removeCatalog(id: number, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query("DELETE FROM kitchenware_catalog WHERE id=$1 RETURNING name", [id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware_catalog.delete", "kitchenware_catalog", id, `删除官方厨具：${item.name}`);
    return true;
  }); }

  async listAssets(input: AssetQuery) {
    const filters = ["k.deleted_at IS NULL"]; const values: string[] = [];
    if (input.search) { values.push(`%${input.search}%`); const value = `$${values.length}`;
      filters.push(`(k.name ILIKE ${value} OR k.note ILIKE ${value} OR u.username ILIKE ${value})`); }
    if (input.category) { values.push(input.category); filters.push(`k.category=$${values.length}`); }
    if (input.status) { values.push(input.status); filters.push(`k.status=$${values.length}`); }
    return (await this.pool.query(`SELECT k.*, u.username AS owner_username FROM kitchenware_items k JOIN users u ON u.id=k.user_id
      WHERE ${filters.join(" AND ")} ORDER BY k.updated_at DESC, k.id DESC`, values)).rows as Row[];
  }

  async updateAssetStatus(id: number, status: string, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE kitchenware_items SET status=$1, updated_at=CURRENT_TIMESTAMP
      WHERE id=$2 AND deleted_at IS NULL RETURNING name`, [status, id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware.status_update", "kitchenware", id, `更新厨具状态：${item.name} → ${status}`);
    return true;
  }); }

  async removeAsset(id: number, audit: AuditContext) { return this.tx(async (client) => {
    const result = await client.query(`UPDATE kitchenware_items SET deleted_at=CURRENT_TIMESTAMP, deleted_by=$1,
      updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND deleted_at IS NULL RETURNING name`, [audit.adminUserId, id]);
    const item = result.rows[0] as Row | undefined; if (!item) return false;
    await this.insertAudit(client, audit, "kitchenware.delete", "kitchenware", id, `将厨具移入回收站：${item.name}`);
    return true;
  }); }

  private insertAudit(client: PoolClient, context: AuditContext, action: string, resourceType: string, resourceId: number, summary: string) {
    return client.query(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [context.adminUserId, action, resourceType, String(resourceId), summary, context.ipAddress || null, context.userAgent || null]);
  }
  private async tx<T>(operation: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
}
