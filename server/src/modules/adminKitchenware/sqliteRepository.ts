import type Database from "better-sqlite3";
import type { AdminKitchenwareRepository } from "./repository.js";
import type { AssetQuery, AuditContext, CatalogInput, CatalogQuery, Row } from "./types.js";

function duplicate(error: unknown) { return String((error as { message?: string })?.message || "").includes("UNIQUE"); }

export class SqliteAdminKitchenwareRepository implements AdminKitchenwareRepository {
  private readonly database: Database.Database;
  constructor(database: Database.Database) { this.database = database; }

  async listCatalog(input: CatalogQuery) {
    const filters: string[] = []; const values: string[] = [];
    if (input.search) { filters.push("(name LIKE ? OR aliases LIKE ? OR cooking_methods LIKE ? OR care_note LIKE ?)");
      const term = `%${input.search}%`; values.push(term, term, term, term); }
    if (input.category) { filters.push("category = ?"); values.push(input.category); }
    return this.database.prepare(`SELECT * FROM kitchenware_catalog ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY category, name`).all(...values) as Row[];
  }

  async createCatalog(input: CatalogInput, audit: AuditContext) {
    try { return this.database.transaction(() => {
      const result = this.database.prepare(`INSERT INTO kitchenware_catalog (name, category, aliases, cooking_methods, care_note)
        VALUES (?, ?, ?, ?, ?)`).run(input.name, input.category, JSON.stringify(input.aliases), JSON.stringify(input.cookingMethods), input.careNote);
      const id = Number(result.lastInsertRowid);
      this.insertAudit(audit, "kitchenware_catalog.create", "kitchenware_catalog", id, `新增官方厨具：${input.name}`);
      return { kind: "created" as const, item: this.catalogById(id)! };
    })(); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async updateCatalog(id: number, input: CatalogInput, audit: AuditContext) {
    try { return this.database.transaction(() => {
      const existing = this.catalogById(id); if (!existing) return { kind: "missing" as const };
      this.database.prepare(`UPDATE kitchenware_catalog SET name=?, category=?, aliases=?, cooking_methods=?, care_note=? WHERE id=?`)
        .run(input.name, input.category, JSON.stringify(input.aliases), JSON.stringify(input.cookingMethods), input.careNote, id);
      this.insertAudit(audit, "kitchenware_catalog.update", "kitchenware_catalog", id,
        `更新官方厨具：${existing.name} → ${input.name}`);
      return { kind: "updated" as const, item: this.catalogById(id)! };
    })(); } catch (error) { if (duplicate(error)) return { kind: "duplicate" as const }; throw error; }
  }

  async removeCatalog(id: number, audit: AuditContext) { return this.database.transaction(() => {
    const item = this.catalogById(id); if (!item) return false;
    this.database.prepare("DELETE FROM kitchenware_catalog WHERE id=?").run(id);
    this.insertAudit(audit, "kitchenware_catalog.delete", "kitchenware_catalog", id, `删除官方厨具：${item.name}`);
    return true;
  })(); }

  async listAssets(input: AssetQuery) {
    const filters = ["k.deleted_at IS NULL"]; const values: string[] = [];
    if (input.search) { filters.push("(k.name LIKE ? OR k.note LIKE ? OR u.username LIKE ?)");
      const term = `%${input.search}%`; values.push(term, term, term); }
    if (input.category) { filters.push("k.category = ?"); values.push(input.category); }
    if (input.status) { filters.push("k.status = ?"); values.push(input.status); }
    return this.database.prepare(`SELECT k.*, u.username AS owner_username FROM kitchenware_items k JOIN users u ON u.id=k.user_id
      WHERE ${filters.join(" AND ")} ORDER BY k.updated_at DESC, k.id DESC`).all(...values) as Row[];
  }

  async updateAssetStatus(id: number, status: string, audit: AuditContext) { return this.database.transaction(() => {
    const item = this.assetById(id); if (!item) return false;
    this.database.prepare("UPDATE kitchenware_items SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").run(status, id);
    this.insertAudit(audit, "kitchenware.status_update", "kitchenware", id, `更新厨具状态：${item.name} → ${status}`);
    return true;
  })(); }

  async removeAsset(id: number, audit: AuditContext) { return this.database.transaction(() => {
    const item = this.assetById(id); if (!item) return false;
    this.database.prepare(`UPDATE kitchenware_items SET deleted_at=CURRENT_TIMESTAMP, deleted_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND deleted_at IS NULL`).run(audit.adminUserId, id);
    this.insertAudit(audit, "kitchenware.delete", "kitchenware", id, `将厨具移入回收站：${item.name}`);
    return true;
  })(); }

  private catalogById(id: number) { return this.database.prepare("SELECT * FROM kitchenware_catalog WHERE id=?").get(id) as Row | undefined; }
  private assetById(id: number) { return this.database.prepare("SELECT name FROM kitchenware_items WHERE id=? AND deleted_at IS NULL").get(id) as Row | undefined; }
  private insertAudit(context: AuditContext, action: string, resourceType: string, resourceId: number, summary: string) {
    this.database.prepare(`INSERT INTO admin_audit_logs
      (admin_user_id, action, resource_type, resource_id, summary, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(context.adminUserId, action, resourceType, String(resourceId), summary, context.ipAddress || null, context.userAgent || null);
  }
}
