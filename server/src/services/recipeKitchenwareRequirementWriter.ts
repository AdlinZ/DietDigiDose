import type Database from "better-sqlite3";

export type ResolvedKitchenware = {
  id: number;
  name: string;
  confidence: number;
};

export type RecipeKitchenwareWriteResult = {
  mapped: Array<{
    rawName: string;
    catalogId: number;
    catalogName: string;
    confidence: number;
  }>;
  unresolved: string[];
};

type WriteOptions = {
  role: "required" | "optional" | "convenience";
  source: string;
  replace: boolean;
  resolve: (rawName: string) => ResolvedKitchenware | null;
  enqueueReview: (rawName: string, confidence: number) => void;
};

function isSchemaDriftError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("has no column named")
  );
}

function tableExists(database: Database.Database, table: string) {
  try {
    return Boolean(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
  } catch {
    return false;
  }
}

export function writeRecipeKitchenwareRequirements(
  database: Database.Database,
  recipeId: number,
  names: string[],
  options: WriteOptions,
): RecipeKitchenwareWriteResult {
  const normalizedNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const unavailable = { mapped: [], unresolved: normalizedNames };
  if (!tableExists(database, "recipe_kitchenware_requirements")) return unavailable;

  try {
    const remove = options.replace
      ? database.prepare("DELETE FROM recipe_kitchenware_requirements WHERE recipe_id = ? AND role = ?")
      : null;
    const insert = normalizedNames.length
      ? database.prepare(`INSERT OR IGNORE INTO recipe_kitchenware_requirements
          (recipe_id, catalog_id, capability_code, role, source, confidence, notes)
          VALUES (?, ?, NULL, ?, ?, ?, ?)`)
      : null;

    return database.transaction(() => {
      const result: RecipeKitchenwareWriteResult = { mapped: [], unresolved: [] };
      remove?.run(recipeId, options.role);

      for (const rawName of normalizedNames) {
        const resolved = options.resolve(rawName);
        if (!resolved || resolved.confidence < 0.7) {
          options.enqueueReview(rawName, resolved?.confidence || 0);
          result.unresolved.push(rawName);
          continue;
        }

        const write = insert?.run(
          recipeId,
          resolved.id,
          options.role,
          options.source,
          resolved.confidence,
          `映射自：${rawName}`,
        );
        if (!write || write.changes !== 1) {
          throw new Error(`厨具需求未写入：${rawName}`);
        }
        result.mapped.push({
          rawName,
          catalogId: resolved.id,
          catalogName: resolved.name,
          confidence: resolved.confidence,
        });
      }
      return result;
    })();
  } catch (error) {
    if (isSchemaDriftError(error)) return unavailable;
    throw error;
  }
}
