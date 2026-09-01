import { AdminKitchenwareError } from "./errors.js";
import type { AdminKitchenwareRepository } from "./repository.js";
import type { AuditContext, CatalogInput, Row } from "./types.js";

const ASSET_STATUSES = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);

function formatCatalog(row: Row): Row {
  const serialize = (value: unknown) => typeof value === "string" || value == null ? value : JSON.stringify(value);
  return { ...row, aliases: serialize(row.aliases), cooking_methods: serialize(row.cooking_methods) };
}

export class AdminKitchenwareService {
  private readonly repository: AdminKitchenwareRepository;
  constructor(repository: AdminKitchenwareRepository) { this.repository = repository; }

  async catalog(query: Row) {
    const rows = await this.repository.listCatalog({
      search: typeof query.search === "string" ? query.search.trim() : "",
      category: typeof query.category === "string" && query.category !== "全部" ? query.category.trim() : "",
    });
    return rows.map(formatCatalog);
  }

  async createCatalog(body: Row, context: AuditContext) {
    const result = await this.repository.createCatalog(this.catalogInput(body), context);
    if (result.kind === "duplicate") throw new AdminKitchenwareError(409, "该官方厨具已存在");
    return formatCatalog(result.item);
  }

  async updateCatalog(id: number, body: Row, context: AuditContext) {
    const result = await this.repository.updateCatalog(id, this.catalogInput(body), context);
    if (result.kind === "missing") throw new AdminKitchenwareError(404, "官方厨具不存在");
    if (result.kind === "duplicate") throw new AdminKitchenwareError(409, "该官方厨具已存在");
    return formatCatalog(result.item);
  }

  async removeCatalog(id: number, context: AuditContext) {
    if (!await this.repository.removeCatalog(id, context)) throw new AdminKitchenwareError(404, "官方厨具不存在");
    return { success: true, message: "官方厨具已删除" };
  }

  assets(query: Row) { return this.repository.listAssets({
    search: typeof query.search === "string" ? query.search.trim() : "",
    category: typeof query.category === "string" && query.category !== "全部" ? query.category.trim() : "",
    status: typeof query.status === "string" && query.status !== "全部" ? query.status.trim() : "",
  }); }

  async updateAssetStatus(id: number, status: string, context: AuditContext) {
    if (!ASSET_STATUSES.has(status)) throw new AdminKitchenwareError(400, "无效的厨具状态");
    if (!await this.repository.updateAssetStatus(id, status, context)) throw new AdminKitchenwareError(404, "厨具不存在");
    return { success: true, message: "厨具状态已更新" };
  }

  async removeAsset(id: number, context: AuditContext) {
    if (!await this.repository.removeAsset(id, context)) throw new AdminKitchenwareError(404, "厨具不存在");
    return { success: true, message: "厨具已移入回收站" };
  }

  private catalogInput(body: Row): CatalogInput { return {
    name: String(body.name), category: String(body.category), aliases: body.aliases as string[],
    cookingMethods: body.cooking_methods as string[], careNote: body.care_note ? String(body.care_note) : null,
  }; }
}
