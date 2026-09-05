import { db } from "../storage/db.js";
import { normalizeContentTerm } from "./contentGovernance.js";
import { writeRecipeKitchenwareRequirements } from "./recipeKitchenwareRequirementWriter.js";

type Row = Record<string, unknown>;

function parseObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isSchemaDriftError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("no such table") || message.includes("no such column");
}

function tableExists(table: string) {
  try {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
  } catch {
    return false;
  }
}

function tableHasColumn(table: string, column: string) {
  try {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .some((row) => row.name === column);
  } catch {
    return false;
  }
}

export function resolveKitchenwareCatalog(rawName: string) {
  const normalized = normalizeContentTerm(rawName);
  if (!normalized) return null;

  const rows = (() => {
    try {
      const sql = tableHasColumn("kitchenware_catalog", "quality_status")
        ? "SELECT * FROM kitchenware_catalog WHERE quality_status = 'trusted'"
        : "SELECT * FROM kitchenware_catalog";
      return db.prepare(sql).all() as Row[];
    } catch (error) {
      if (isSchemaDriftError(error)) {
        return [];
      }
      throw error;
    }
  })();

  let best: { row: Row; score: number } | null = null;
  for (const row of rows) {
    let aliases: string[] = [];
    try { aliases = JSON.parse(String(row.aliases || "[]")); } catch { aliases = []; }
    const names = [String(row.name), ...aliases];
    const exact = names.some((name) => normalizeContentTerm(name) === normalized);
    const partial = names.some((name) => {
      const candidate = normalizeContentTerm(name);
      return candidate.includes(normalized) || normalized.includes(candidate);
    });
    const score = exact ? 1 : partial ? 0.72 : 0;
    if (score && (!best || score > best.score)) best = { row, score };
  }

  if (!best) return null;

  const capabilities = (() => {
    if (!tableExists("kitchenware_catalog_capabilities") || !tableExists("kitchenware_capabilities")) {
      return [] as Row[];
    }
    try {
      return db.prepare(`SELECT c.code, c.name, c.description, c.safety_level, cc.constraints_json
        FROM kitchenware_catalog_capabilities cc JOIN kitchenware_capabilities c ON c.code = cc.capability_code
        WHERE cc.catalog_id = ? ORDER BY c.code`).all(best.row.id) as Row[];
    } catch (error) {
      if (isSchemaDriftError(error)) return [] as Row[];
      throw error;
    }
  })();

  return {
    id: Number(best.row.id),
    name: String(best.row.name),
    category: String(best.row.category),
    confidence: best.score,
    attributes: parseObject(best.row.attributes_json),
    capabilities: capabilities.map((capability) => ({
      code: String(capability.code), name: String(capability.name), safetyLevel: String(capability.safety_level),
      constraints: parseObject(capability.constraints_json),
    })),
  };
}

export function enqueueKitchenwareMappingReview(rawName: string, sourceType: string, sourceId?: string | number, confidence = 0) {
  const normalized = normalizeContentTerm(rawName);
  if (!normalized) return;
  const suggestion = resolveKitchenwareCatalog(rawName);
  if (!tableExists("kitchenware_mapping_reviews")) return;
  try {
    db.prepare(`INSERT INTO kitchenware_mapping_reviews
      (raw_name, normalized_name, source_type, source_id, confidence, suggested_catalog_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_name, source_type, source_id) DO UPDATE SET
        raw_name = excluded.raw_name, confidence = excluded.confidence,
        suggested_catalog_id = excluded.suggested_catalog_id, status = 'pending', reviewed_at = NULL`)
      .run(rawName.trim(), normalized, sourceType, sourceId == null ? null : String(sourceId), confidence, suggestion?.id || null);
  } catch (error) {
    if (!isSchemaDriftError(error)) {
      throw error;
    }
  }
}

export function kitchenwareRequirementsForRecipe(recipeId: number) {
  if (!tableExists("recipe_kitchenware_requirements")) return [];
  try {
    return (db.prepare(`SELECT r.role, r.notes, r.confidence, r.capability_code,
        c.id AS catalog_id, c.name AS catalog_name
      FROM recipe_kitchenware_requirements r
      LEFT JOIN kitchenware_catalog c ON c.id = r.catalog_id
      WHERE r.recipe_id = ? ORDER BY CASE r.role WHEN 'required' THEN 0 WHEN 'optional' THEN 1 ELSE 2 END, r.id`)
      .all(recipeId) as Row[]).map((row) => ({
        role: String(row.role),
        catalogId: row.catalog_id == null ? null : Number(row.catalog_id),
        catalogName: row.catalog_name == null ? null : String(row.catalog_name),
        capabilityCode: row.capability_code == null ? null : String(row.capability_code),
        confidence: Number(row.confidence),
        notes: String(row.notes || ""),
      }));
  } catch (error) {
    if (isSchemaDriftError(error)) return [];
    throw error;
  }
}

export function setRecipeKitchenwareRequirements(recipeId: number, names: string[], input: {
  role?: "required" | "optional" | "convenience";
  source?: string;
  replace?: boolean;
} = {}) {
  const role = input.role || "required";
  return writeRecipeKitchenwareRequirements(names, {
    replace: input.replace !== false,
    resolve: resolveKitchenwareCatalog,
    isAvailable: () => tableExists("recipe_kitchenware_requirements"),
    prepareRemove: () => {
      const remove = db.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role = ?");
      return () => { remove.run(recipeId, role); };
    },
    prepareInsert: () => {
      const insert = db.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
        (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
        VALUES (?, ?, NULL, ?, ?, ?, ?)`);
      return (resolved, rawName) => insert.run(
        recipeId,
        resolved.id,
        role,
        input.source || "curated",
        resolved.confidence,
        `映射自：${rawName}`,
      ).changes === 1;
    },
    runAtomically: (operation) => db.transaction(operation)(),
    enqueueReview: (rawName, confidence) => {
      enqueueKitchenwareMappingReview(rawName, "recipe", recipeId, confidence);
    },
  });
}

export function evaluateKitchenwareRequirements(userId: number, recipeId: number) {
  const requirements = kitchenwareRequirementsForRecipe(recipeId);

  const owned = (() => {
    const hasCatalogId = tableHasColumn("kitchenware_items", "catalog_id");
    try {
      return hasCatalogId
        ? db.prepare(`SELECT i.id, i.name, i.catalog_id
            FROM kitchenware_items i WHERE i.user_id = ? AND i.deleted_at IS NULL AND i.status <> '维修中'`).all(userId) as Row[]
        : db.prepare(`SELECT i.id, i.name
            FROM kitchenware_items i WHERE i.user_id = ? AND i.deleted_at IS NULL AND i.status <> '维修中'`).all(userId) as Row[];
    } catch (error) {
      if (!isSchemaDriftError(error)) throw error;
      return [];
    }
  })();

  const ownedCatalogIds = new Set<number>();
  const ownedCapabilities = new Set<string>();

  for (const item of owned) {
    const maybeCatalogId = (item as Row & { catalog_id?: unknown }).catalog_id;
    const resolved = maybeCatalogId ? { id: Number(maybeCatalogId) } : resolveKitchenwareCatalog(String(item.name));
    if (!resolved) continue;
    ownedCatalogIds.add(resolved.id);

    let rows: Array<{ capability_code: string }> = [];
    if (tableExists("kitchenware_catalog_capabilities")) {
      try {
        rows = db.prepare("SELECT capability_code FROM kitchenware_catalog_capabilities WHERE catalog_id = ?").all(resolved.id) as Array<{ capability_code: string }>;
      } catch (error) {
        if (!isSchemaDriftError(error)) {
          throw error;
        }
      }
    }
    rows.forEach((row) => ownedCapabilities.add(row.capability_code));
  }

  const evaluated = requirements.map((requirement) => {
    const exact = Boolean(requirement.catalogId && ownedCatalogIds.has(requirement.catalogId));
    const capability = Boolean(requirement.capabilityCode && ownedCapabilities.has(requirement.capabilityCode));
    if (exact || capability) return { ...requirement, satisfied: true, substitution: null };
    if (!requirement.catalogId) return { ...requirement, satisfied: false, substitution: null };
    if (!tableExists("kitchenware_substitutions") || ownedCatalogIds.size === 0) {
      return { ...requirement, satisfied: false, substitution: null };
    }

    const substitution = (() => {
      const inClause = [...ownedCatalogIds].map(() => "?").join(",") || "NULL";
      try {
        return db.prepare(`SELECT s.relation_type, s.impact_json, s.safety_note, c.name
          FROM kitchenware_substitutions s JOIN kitchenware_catalog c ON c.id = s.substitute_catalog_id
          WHERE s.source_catalog_id = ? AND s.substitute_catalog_id IN (${inClause})
            AND s.relation_type <> 'forbidden'
          ORDER BY CASE s.relation_type WHEN 'equivalent' THEN 0 ELSE 1 END LIMIT 1`)
          .get(requirement.catalogId, ...ownedCatalogIds) as Row | undefined;
      } catch (error) {
        if (isSchemaDriftError(error)) return undefined;
        throw error;
      }
    })();

    return {
      ...requirement,
      satisfied: Boolean(substitution),
      substitution: substitution ? {
        name: String(substitution.name), relationType: String(substitution.relation_type),
        impact: parseObject(substitution.impact_json), safetyNote: String(substitution.safety_note || ""),
      } : null,
    };
  });

  return {
    requirements: evaluated,
    blocking: evaluated.filter((requirement) => requirement.role === "required" && !requirement.satisfied),
  };
}
