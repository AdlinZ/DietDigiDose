import { createHash } from "node:crypto";
import { decodeCursor, encodeCursor } from "../../utils/cursor.js";
import { normalizeContentTerm } from "../../utils/contentNormalization.js";
import { AdminRecipesError } from "./errors.js";
import type { AdminRecipesRepository } from "./repository.js";
import type { AdminAudit, AdminRecipeWrite, AuditContext, DuplicateWrite, RequirementWrite, Row } from "./types.js";

type CatalogResolver = {
  resolveCatalog(rawName: string): Promise<{
    id: number;
    confidence: number;
    capabilities: Array<{ code: string }>;
  } | null>;
};

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

function stringSet(value: unknown) {
  return new Set(parseArray(value).flatMap((item) => {
    const raw = typeof item === "string" ? item : String((item as Row)?.name || "");
    const normalized = normalizeContentTerm(raw);
    return normalized ? [normalized] : [];
  }));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size && !right.size) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

function similarity(left: Row, right: Row) {
  const leftTitle = normalizeContentTerm(String(left.title || ""));
  const rightTitle = normalizeContentTerm(String(right.title || ""));
  const title = leftTitle === rightTitle ? 1 : leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle) ? 0.75 : 0;
  const ingredients = jaccard(stringSet(left.ingredients_json ?? left.ingredients), stringSet(right.ingredients_json));
  const steps = jaccard(stringSet(left.steps_json ?? left.steps), stringSet(right.steps_json));
  const score = Math.round((title * 0.45 + ingredients * 0.4 + steps * 0.15) * 10_000) / 10_000;
  return { score, reasons: [...(title >= 0.75 ? ["title"] : []), ...(ingredients >= 0.7 ? ["ingredients"] : []), ...(steps >= 0.7 ? ["steps"] : [])] };
}

function fingerprint(title: string, ingredients: unknown[], steps: unknown[]) {
  return createHash("sha256").update(JSON.stringify({
    title: normalizeContentTerm(title),
    ingredients: [...stringSet(ingredients)].sort(),
    steps: steps.map((step) => normalizeContentTerm(String(step))).filter(Boolean),
  })).digest("hex");
}

function inferredKitchenware(text: string) {
  const rules: Array<[RegExp, string]> = [
    [/空气炸锅/, "空气炸锅"], [/微波炉/, "微波炉"], [/(?:破壁机|料理机|搅拌机)/, "破壁机"],
    [/(?:烤箱|烘焙)/, "烤箱"], [/(?:蒸|蒸笼)/, "蒸锅"], [/(?:炒|爆|煎)/, "炒锅"], [/(?:煮|炖|煲)/, "汤锅"],
  ];
  const inferred = rules.filter(([pattern]) => pattern.test(text)).map(([, name]) => name);
  return [...new Set(inferred.length ? inferred : ["菜刀", "砧板"])];
}

function publicationIssues(input: AdminRecipeWrite) {
  const issues: string[] = [];
  if (!input.title) issues.push("missing_title");
  if (!input.dataLicense) issues.push("missing_license");
  if (!Number.isInteger(input.servingSize) || input.servingSize <= 0) issues.push("missing_serving_size");
  if (input.prepTime + input.cookTime <= 0) issues.push("missing_time");
  if (!input.ingredients.length) issues.push("missing_ingredients");
  if (input.steps.length < 2) issues.push("missing_steps");
  if (!input.requiredKitchenware.length) issues.push("missing_kitchenware_mapping");
  return issues;
}

function audit(context: AuditContext, input: Omit<AdminAudit, keyof AuditContext>): AdminAudit {
  return { ...context, ...input };
}

export class AdminRecipesService {
  private readonly repository: AdminRecipesRepository;
  private readonly catalog: CatalogResolver;
  constructor(repository: AdminRecipesRepository, catalog: CatalogResolver) { this.repository = repository; this.catalog = catalog; }

  async list(query: Row) {
    const cursorMode = query.pageSize !== undefined || query.cursor !== undefined;
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const cursor = query.cursor ? decodeCursor(String(query.cursor)) : null;
    const cursorId = cursor ? Number(cursor.id) : null;
    if (query.cursor && (!cursor || cursor.v !== 1 || !Number.isInteger(cursorId) || cursorId! <= 0)) {
      throw new AdminRecipesError(400, "分页游标无效", "INVALID_CURSOR");
    }
    const source = query.source === "official" || query.source === "user" ? query.source : undefined;
    const reviewStatus = ["pending", "approved", "rejected"].includes(String(query.reviewStatus))
      ? query.reviewStatus as "pending" | "approved" | "rejected" : undefined;
    const qualityStatus = ["trusted", "estimated", "needs_review"].includes(String(query.qualityStatus))
      ? query.qualityStatus as "trusted" | "estimated" | "needs_review" : undefined;
    const result = await this.repository.list({
      deleted: query.deleted === "deleted" || query.deleted === "all" ? query.deleted : "active",
      source, reviewStatus, qualityStatus,
      category: typeof query.category === "string" && query.category.trim() ? query.category.trim() : undefined,
      search: typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined,
      cursorId: cursorMode ? cursorId : null, limit: cursorMode ? pageSize + 1 : null,
    });
    const hasMore = cursorMode && result.rows.length > pageSize;
    const items = cursorMode ? result.rows.slice(0, pageSize) : result.rows;
    if (!cursorMode) return items;
    return { items, total: result.summary.total, summary: result.summary,
      nextCursor: hasMore ? encodeCursor({ v: 1, id: Number(items.at(-1)!.id) }) : null };
  }

  async create(adminUserId: number, body: Row, context: AuditContext) {
    const input = await this.write(body);
    const issues = publicationIssues(input).filter((issue) => issue !== "missing_kitchenware_mapping");
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    input.duplicates = this.duplicates(input, await this.repository.duplicateSources());
    return { success: true, id: await this.repository.create(input, { ...context, adminUserId }) };
  }

  async update(adminUserId: number, recipeId: number, body: Row, context: AuditContext) {
    const input = await this.write(body);
    const issues = publicationIssues(input);
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    input.duplicates = this.duplicates(input, await this.repository.duplicateSources(recipeId));
    if (!await this.repository.update(recipeId, input, { ...context, adminUserId })) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true };
  }

  async replaceKitchenware(adminUserId: number, recipeId: number, body: Row, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const required = Array.isArray(body.required) ? body.required.slice(0, 30) : [];
    const optional = Array.isArray(body.optional) ? body.optional.slice(0, 30) : [];
    const requirements = await this.requirements(required, optional);
    const event = audit({ ...context, adminUserId }, { action: "recipe.kitchenware_update", resourceId: recipeId,
      summary: `更新食谱厨具能力：${recipe.title}` });
    if (!await this.repository.replaceKitchenware(recipeId, required, optional, requirements, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, required, optional };
  }

  async scanDuplicates(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const duplicates = this.duplicates(recipe, await this.repository.duplicateSources(recipeId));
    await this.repository.scanDuplicates(recipeId, duplicates, audit({ ...context, adminUserId }, {
      action: "recipe.duplicate_scan", resourceId: recipeId, summary: `执行食谱相似度扫描，发现 ${duplicates.length} 项`,
    }));
    return { candidates: duplicates.map((item) => ({ recipeId: item.candidateRecipeId, score: item.similarity, reasons: item.reasons })) };
  }

  coverage() { return this.repository.coverage(); }

  async approve(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe || recipe.source !== "user") throw new AdminRecipesError(404, "未找到用户投稿");
    const input = this.writeFromStored(recipe);
    const issues = publicationIssues(input);
    if (issues.length) throw new AdminRecipesError(400, "食谱发布质量校验未通过", undefined, { issues });
    const event = audit({ ...context, adminUserId }, { action: "recipe_submission.approve", resourceId: recipeId,
      summary: `审核通过用户食谱：${recipe.title}`, details: { before: String(recipe.status), after: "approved" } });
    if (!await this.repository.approve(recipeId, adminUserId, event)) throw new AdminRecipesError(404, "未找到用户投稿");
    return { success: true, message: "用户食谱已审核通过" };
  }

  async reviewQuality(adminUserId: number, recipeId: number, status: "trusted" | "needs_review", reason: string, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const event = audit({ ...context, adminUserId }, { action: "recipe.quality_review", resourceId: recipeId,
      summary: `${status === "trusted" ? "设为可信" : "设为待复核"}：${recipe.title}`,
      details: { before: recipe.quality_status, after: status, reason } });
    if (!await this.repository.reviewQuality(recipeId, status, reason, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, quality_status: status };
  }

  async reject(adminUserId: number, recipeId: number, reason: string, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe || recipe.source !== "user") throw new AdminRecipesError(404, "未找到用户投稿");
    const event = audit({ ...context, adminUserId }, { action: "recipe_submission.reject", resourceId: recipeId,
      summary: `驳回用户食谱：${recipe.title}`, details: { before: recipe.status, after: "rejected", reason } });
    if (!await this.repository.reject(recipeId, adminUserId, reason, event)) throw new AdminRecipesError(404, "未找到用户投稿");
    return { success: true, message: "用户食谱已驳回" };
  }

  async remove(adminUserId: number, recipeId: number, context: AuditContext) {
    const recipe = await this.repository.find(recipeId);
    if (!recipe) throw new AdminRecipesError(404, "食谱未找到");
    const event = audit({ ...context, adminUserId }, { action: "recipe.delete", resourceId: recipeId,
      summary: `将食谱移入回收站：${recipe.title || recipeId}` });
    if (!await this.repository.remove(recipeId, adminUserId, event)) throw new AdminRecipesError(404, "食谱未找到");
    return { success: true, message: "食谱已移入回收站" };
  }

  private async write(body: Row): Promise<AdminRecipeWrite> {
    const steps = parseArray(body.steps ?? body.steps_json);
    const ingredients = parseArray(body.ingredients ?? body.ingredients_json);
    const explicitRequired = parseArray(body.required_kitchenware);
    const requiredKitchenware = explicitRequired.length ? explicitRequired : inferredKitchenware(`${body.title || ""} ${steps.join(" ")}`);
    const optionalKitchenware = parseArray(body.optional_kitchenware);
    const title = String(body.title || "").trim();
    return {
      title, description: String(body.description || "").trim(), imageUrl: body.image_url ? String(body.image_url) : null,
      cookTime: Number(body.cook_time) || 0, difficulty: String(body.difficulty || "简单"), calories: Number(body.calories) || 0,
      protein: Number(body.protein) || 0, carbs: Number(body.carbs) || 0, fat: Number(body.fat) || 0,
      category: String(body.category || "其他"), tags: parseArray(body.tags), steps, ingredients,
      canonicalKey: normalizeContentTerm(title), sourceContentHash: fingerprint(title, ingredients, steps),
      servingSize: Number(body.serving_size) || 2, prepTime: Number(body.prep_time) || 0,
      cuisine: body.cuisine ? String(body.cuisine) : null, mealTypes: parseArray(body.meal_types), requiredKitchenware,
      optionalKitchenware, sourceUrl: body.source_url ? String(body.source_url) : null,
      dataLicense: String(body.data_license || "DietDigiDose-Original"), sourceRevision: String(body.source_revision || "manual-v1"),
      sourceAttribution: String(body.source_attribution || "DietDigiDose 编辑团队"),
      requirements: await this.requirements(requiredKitchenware, optionalKitchenware), duplicates: [],
    };
  }

  private writeFromStored(row: Row): AdminRecipeWrite {
    return {
      title: String(row.title || ""), description: String(row.description || ""), imageUrl: row.image_url ? String(row.image_url) : null,
      cookTime: Number(row.cook_time), difficulty: String(row.difficulty || ""), calories: Number(row.calories), protein: Number(row.protein),
      carbs: Number(row.carbs), fat: Number(row.fat), category: String(row.category || ""), tags: parseArray(row.tags),
      steps: parseArray(row.steps_json), ingredients: parseArray(row.ingredients_json), canonicalKey: String(row.canonical_key || ""),
      sourceContentHash: String(row.source_content_hash || ""), servingSize: Number(row.serving_size), prepTime: Number(row.prep_time),
      cuisine: row.cuisine ? String(row.cuisine) : null, mealTypes: parseArray(row.meal_types_json),
      requiredKitchenware: parseArray(row.required_kitchenware_json), optionalKitchenware: parseArray(row.optional_kitchenware_json),
      sourceUrl: row.source_url ? String(row.source_url) : null, dataLicense: String(row.data_license || ""),
      sourceRevision: String(row.source_revision || ""), sourceAttribution: String(row.source_attribution || ""), requirements: [], duplicates: [],
    };
  }

  private async requirements(required: unknown[], optional: unknown[]) {
    const output: RequirementWrite[] = [];
    for (const [items, role] of [[required, "required"], [optional, "optional"]] as const) {
      for (const raw of items) {
        const row = raw && typeof raw === "object" ? raw as Row : null;
        const rawName = (typeof raw === "string" ? raw : String(row?.name || "")).trim();
        const explicitCapability = String(row?.capabilityCode || "").trim() || null;
        if (!rawName && !explicitCapability) continue;
        const resolved = rawName ? await this.catalog.resolveCatalog(rawName) : null;
        output.push({ rawName: rawName || explicitCapability!, normalizedName: normalizeContentTerm(rawName || explicitCapability!),
          catalogId: resolved?.id || null, capabilityCode: explicitCapability || resolved?.capabilities[0]?.code || null,
          role, confidence: resolved?.confidence || (explicitCapability ? 1 : 0) });
      }
    }
    return output;
  }

  private duplicates(recipe: Row, candidates: Row[]): DuplicateWrite[] {
    return candidates.flatMap((candidate) => {
      const result = similarity(recipe, candidate);
      return result.score < 0.72 ? [] : [{ candidateRecipeId: Number(candidate.id), similarity: result.score, reasons: result.reasons }];
    }).sort((left, right) => right.similarity - left.similarity);
  }
}
