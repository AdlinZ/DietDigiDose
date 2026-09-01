import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { KitchenwareError } from "./errors.js";
import { formatCatalogItem, formatRequirement, parseJson } from "./formatters.js";
import type { KitchenwareRepository } from "./repository.js";
import type { KitchenwareInput, ResolvedCatalog, Row, StoredKitchenwareInput } from "./types.js";

const CATEGORIES = new Set(["小家电", "烹饪锅具", "刀具餐具", "烘焙工具", "其他"]);
const STATUSES = new Set(["常用", "良好", "需保养", "维修中", "闲置"]);

export class KitchenwareService {
  private readonly repository: KitchenwareRepository;
  constructor(repository: KitchenwareRepository) { this.repository = repository; }

  list(userId: number) { return this.repository.listItems(userId); }
  capabilities() { return this.repository.listCapabilities(); }

  async catalog(query: string) {
    const items = await this.repository.listCatalog();
    const resolved = query ? await this.resolveCatalog(query, items) : null;
    const filtered = query ? items.filter((item) => {
      const aliases = parseJson<string[]>(item.aliases, []);
      return resolved?.id === Number(item.id)
        || [String(item.name), ...aliases].some((name) => name.includes(query) || query.includes(name));
    }) : items;
    return Promise.all(filtered.map(async (item) => formatCatalogItem(
      item,
      await this.repository.capabilitiesForCatalog(Number(item.id)),
      await this.repository.substitutionsForCatalog(Number(item.id)),
    )));
  }

  async compatibility(userId: number, recipeId: number) {
    if (!await this.repository.recipeAvailable(recipeId)) throw new KitchenwareError(404, "菜谱不存在");
    return this.evaluateRequirements(userId, recipeId);
  }

  async requirements(recipeId: number) {
    return (await this.repository.requirementsForRecipe(recipeId)).map(formatRequirement);
  }

  async create(userId: number, body: Row) {
    const input = this.normalizeInput(body);
    this.validate(input);
    const catalog = await this.resolveCatalog(input.name);
    if (!catalog || catalog.confidence < 0.7) {
      await this.enqueueReview(input.name, "user_kitchenware", userId, catalog?.confidence || 0, catalog?.id || null);
    }
    return this.repository.createItem(userId, this.storedInput(input, catalog));
  }

  async update(userId: number, id: number, body: Row) {
    if (!await this.repository.findOwnedItem(userId, id)) throw new KitchenwareError(404, "厨具不存在或无权修改");
    const input = this.normalizeInput(body);
    this.validate(input);
    const catalog = await this.resolveCatalog(input.name);
    if (!catalog || catalog.confidence < 0.7) {
      await this.enqueueReview(input.name, "user_kitchenware", id, catalog?.confidence || 0, catalog?.id || null);
    }
    const item = await this.repository.updateItem(userId, id, this.storedInput(input, catalog));
    if (!item) throw new KitchenwareError(404, "厨具不存在或无权修改");
    return item;
  }

  async maintain(userId: number, id: number) {
    const item = await this.repository.maintainItem(userId, id);
    if (!item) throw new KitchenwareError(404, "厨具不存在或无权修改");
    return item;
  }

  async remove(userId: number, id: number) {
    if (!await this.repository.removeItem(userId, id)) throw new KitchenwareError(404, "厨具不存在或无权删除");
    return { success: true, message: "厨具已移除" };
  }

  async resolveCatalog(rawName: string, rows?: Row[]): Promise<ResolvedCatalog | null> {
    const normalized = normalizeContentTerm(rawName);
    if (!normalized) return null;
    const catalog = rows || await this.repository.listCatalog();
    let best: { row: Row; score: number } | null = null;
    for (const row of catalog) {
      const aliases = parseJson<string[]>(row.aliases, []);
      const names = [String(row.name), ...aliases];
      const exact = names.some((name) => normalizeContentTerm(name) === normalized);
      const partial = names.some((name) => {
        const candidate = normalizeContentTerm(name);
        if (candidate.length < 2 || normalized.length < 2) return false;
        const contained = candidate.includes(normalized) || normalized.includes(candidate);
        return contained && Math.min(candidate.length, normalized.length) / Math.max(candidate.length, normalized.length) >= 0.5;
      });
      const score = exact ? 1 : partial ? 0.72 : 0;
      if (score && (!best || score > best.score)) best = { row, score };
    }
    if (!best) return null;
    const capabilities = await this.repository.capabilitiesForCatalog(Number(best.row.id));
    return {
      id: Number(best.row.id), name: String(best.row.name), category: String(best.row.category), confidence: best.score,
      attributes: parseJson(best.row.attributes_json, {}),
      capabilities: capabilities.map((capability) => ({
        code: String(capability.code), name: String(capability.name), safetyLevel: String(capability.safety_level),
        constraints: parseJson(capability.constraints_json, {}),
      })),
    };
  }

  async evaluateRequirements(userId: number, recipeId: number) {
    const requirements = await this.requirements(recipeId);
    const owned = await this.repository.ownedItems(userId);
    const catalog = await this.repository.listCatalog();
    const ownedCatalogIds = new Set<number>();
    for (const item of owned) {
      if (item.catalog_id) ownedCatalogIds.add(Number(item.catalog_id));
      else {
        const resolved = await this.resolveCatalog(String(item.name), catalog);
        if (resolved) ownedCatalogIds.add(resolved.id);
      }
    }
    const ownedCapabilities = new Set(await this.repository.capabilityCodesForCatalogIds([...ownedCatalogIds]));
    const evaluated = await Promise.all(requirements.map(async (requirement) => {
      const exact = Boolean(requirement.catalogId && ownedCatalogIds.has(requirement.catalogId));
      const capability = Boolean(!requirement.catalogId && requirement.capabilityCode && ownedCapabilities.has(requirement.capabilityCode));
      if (exact || capability) return { ...requirement, satisfied: true, substitution: null };
      if (!requirement.catalogId || ownedCatalogIds.size === 0) return { ...requirement, satisfied: false, substitution: null };
      const substitution = await this.repository.substitutionFor(requirement.catalogId, [...ownedCatalogIds]);
      const allowedSubstitution = substitution && String(substitution.relation_type) !== "forbidden" ? substitution : null;
      return {
        ...requirement,
        satisfied: Boolean(allowedSubstitution),
        substitution: allowedSubstitution ? {
          name: String(allowedSubstitution.name), relationType: String(allowedSubstitution.relation_type),
          impact: parseJson(allowedSubstitution.impact_json, {}), safetyNote: String(allowedSubstitution.safety_note || ""),
        } : null,
      };
    }));
    return { requirements: evaluated, blocking: evaluated.filter((item) => item.role === "required" && !item.satisfied) };
  }

  private normalizeInput(body: Row): KitchenwareInput {
    const category = String(body.category || "其他").trim();
    const status = String(body.status || "良好").trim();
    return {
      name: String(body.name || "").trim(), category: CATEGORIES.has(category) ? category : "其他",
      status: STATUSES.has(status) ? status : "良好", note: String(body.note || "").trim(),
      imageUrl: String(body.image_url || "").trim(), purchaseDate: String(body.purchase_date || "").trim(),
    };
  }

  private validate(input: KitchenwareInput) {
    if (input.name.length < 1 || input.name.length > 80) throw new KitchenwareError(400, "厨具名称需为 1-80 个字符");
    if (input.note.length > 300) throw new KitchenwareError(400, "规格或备注不能超过 300 个字符");
    if (input.imageUrl.length > 4_000_000) throw new KitchenwareError(400, "厨具图片过大，请压缩后重试");
    if (input.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) throw new KitchenwareError(400, "购买日期格式不正确");
  }

  private storedInput(input: KitchenwareInput, catalog: ResolvedCatalog | null): StoredKitchenwareInput {
    return { ...input, name: catalog?.name || input.name, originalName: catalog && catalog.name !== input.name ? input.name : null,
      catalogId: catalog?.id || null, category: catalog?.category || input.category };
  }

  private enqueueReview(rawName: string, sourceType: string, sourceId: string | number, confidence: number, suggestedCatalogId: number | null) {
    const normalizedName = normalizeContentTerm(rawName);
    if (!normalizedName) return Promise.resolve();
    return this.repository.upsertMappingReview({ rawName: rawName.trim(), normalizedName, sourceType,
      sourceId: String(sourceId), confidence, suggestedCatalogId });
  }
}
