import type { Pool } from "pg";
import { KITCHENWARE_CATALOG_V4, KITCHENWARE_CATALOG_V4_RELEASE } from "../data/kitchenwareCatalogV4.generated.js";
import { normalizeContentTerm } from "../utils/contentNormalization.js";

const CAPABILITIES = [
  ["fry", "煎炒", "可进行煎、炒或翻炒", "normal"],
  ["boil", "煮炖", "可进行煮、炖或煲汤", "normal"],
  ["steam", "蒸制", "可安全产生并容纳蒸汽", "caution"],
  ["bake", "烘烤", "可在受控腔体内持续干热烘烤", "caution"],
  ["blend", "搅拌粉碎", "可搅拌、打浆或粉碎", "caution"],
  ["weigh", "称量", "可进行重量测量", "normal"],
  ["cut", "切配", "可安全切割或处理食材", "caution"],
  ["temperature", "测温", "可测量食物中心温度", "normal"],
] as const;

const CAPABILITY_CATALOGS: Record<string, readonly string[]> = {
  fry: ["平底锅", "炒锅", "电火锅", "电热锅", "电磁炉", "电陶炉", "煎烤机", "煎饼机", "炒菜机", "燃气灶", "集成灶", "卡式炉", "户外炉具"],
  boil: ["汤锅", "炖锅", "砂锅", "奶锅", "压力锅", "电压力锅", "电饭煲", "电炖锅", "电热锅", "电火锅", "煮蛋器", "煮面炉", "养生壶", "电水壶"],
  steam: ["蒸锅", "蒸笼", "电蒸锅", "蒸箱", "蒸烤一体机", "微蒸烤一体机", "肠粉机"],
  bake: ["烤箱", "空气炸锅", "蒸烤一体机", "微蒸烤一体机", "烤面包机", "面包机", "烘焙机", "烧烤炉"],
  blend: ["搅拌机", "破壁机", "切碎机", "磨粉机", "绞肉机", "食品混合机", "辅食机"],
  weigh: ["厨房秤", "电子秤"],
  cut: ["菜刀", "厨房通用刀", "水果刀", "面包刀", "砍骨刀", "厨房剪刀", "食物切片器", "面包切片机"],
  temperature: ["厨房温度计", "测温勺"],
};

const SUBSTITUTIONS = [
  ["平底锅", "炒锅", "equivalent", { result: "锅体更深，翻炒空间更大" }, "使用与热源兼容的锅具"],
  ["炒锅", "平底锅", "conditional", { portion: "减少单次份量", time: "可能需要分批烹饪" }, "避免食材堆叠导致受热不均"],
  ["烤箱", "空气炸锅", "conditional", { portion: "减少份量", time: "缩短并分段检查" }, "不得使用不耐高温容器"],
  ["空气炸锅", "烤箱", "conditional", { time: "适当延长预热和烘烤时间" }, "按烤箱说明设置温度"],
  ["豆浆机", "养生壶", "forbidden", {}, "养生壶不具备豆浆机的粉碎与受控煮浆能力"],
  ["养生壶", "豆浆机", "forbidden", {}, "豆浆机不得作为通用烧水壶或开放式煮饮设备使用"],
] as const;

const LEGACY_REDIRECTS = [
  ["多功能锅", "电火锅"],
  ["慢炖锅", "电炖锅"],
  ["电子秤", "厨房秤"],
  ["打蛋器", "手动打蛋器"],
  ["饭碗", "碗"],
  ["餐盘", "盘"],
  ["汤匙", "汤勺"],
  ["密封罐", "储物罐"],
] as const;

function catalogAttributes(entry: (typeof KITCHENWARE_CATALOG_V4)[number]) {
  return {
    datasetRelease: KITCHENWARE_CATALOG_V4_RELEASE.release,
    conceptId: entry.conceptId,
    sourceCategory: entry.sourceCategory,
    parentConceptId: entry.parentConceptId,
    parentConceptName: entry.parentConceptName,
    isElectric: entry.isElectric,
    definitionScope: entry.definitionScope,
    boundaryNote: entry.boundaryNote,
    conceptStatus: entry.status,
    replacesLegacySeed: entry.replacesLegacySeed,
  };
}

function aliasOwners() {
  const owners = new Map<string, string>();
  for (const entry of KITCHENWARE_CATALOG_V4) {
    owners.set(normalizeContentTerm(entry.name), entry.name);
    for (const alias of entry.aliases) owners.set(normalizeContentTerm(alias), entry.name);
  }
  return owners;
}

function safeAliases(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function sqliteLiteral(value: unknown) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function kitchenwareCatalogV4Sql() {
  const release = KITCHENWARE_CATALOG_V4_RELEASE.release;
  const statements = KITCHENWARE_CATALOG_V4.map((entry) => `INSERT INTO kitchenware_catalog
    (name, category, aliases, cooking_methods, care_note, source, attributes_json, quality_status, capability_version, updated_at)
    VALUES (${sqliteLiteral(entry.name)}, ${sqliteLiteral(entry.category)}, ${sqliteLiteral(JSON.stringify(entry.aliases))}, '[]', '',
      ${sqliteLiteral(release)}, ${sqliteLiteral(JSON.stringify(catalogAttributes(entry)))}, 'trusted', 1, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET category=excluded.category, aliases=excluded.aliases, source=excluded.source,
      attributes_json=excluded.attributes_json, quality_status='trusted', updated_at=CURRENT_TIMESTAMP
    WHERE kitchenware_catalog.source=excluded.source
      OR (kitchenware_catalog.source='system' AND json_extract(excluded.attributes_json, '$.replacesLegacySeed')=1)`);

  statements.push(`UPDATE kitchenware_catalog SET aliases='[]', updated_at=CURRENT_TIMESTAMP
    WHERE source='system' AND name NOT IN (${KITCHENWARE_CATALOG_V4.map((entry) => sqliteLiteral(entry.name)).join(", ")})`);
  for (const [legacyName, canonicalName] of LEGACY_REDIRECTS) {
    statements.push(`UPDATE kitchenware_catalog SET quality_status='deprecated', updated_at=CURRENT_TIMESTAMP
      WHERE name=${sqliteLiteral(legacyName)} AND source='system'
        AND EXISTS(SELECT 1 FROM kitchenware_catalog WHERE name=${sqliteLiteral(canonicalName)})`);
  }
  for (const [code, name, description, safety] of CAPABILITIES) {
    statements.push(`INSERT INTO kitchenware_capabilities (code, name, description, safety_level)
      VALUES (${sqliteLiteral(code)}, ${sqliteLiteral(name)}, ${sqliteLiteral(description)}, ${sqliteLiteral(safety)})
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, description=excluded.description, safety_level=excluded.safety_level`);
  }
  for (const [code, names] of Object.entries(CAPABILITY_CATALOGS)) {
    for (const name of names) {
      statements.push(`INSERT OR IGNORE INTO kitchenware_catalog_capabilities (catalog_id, capability_code, constraints_json)
        SELECT id, ${sqliteLiteral(code)}, '{}' FROM kitchenware_catalog WHERE name=${sqliteLiteral(name)}`);
    }
  }
  const substitutions = [
    ...SUBSTITUTIONS.map(([sourceName, substituteName, relation, impact, safetyNote]) => ({ sourceName, substituteName, relation, impact, safetyNote })),
    ...LEGACY_REDIRECTS.flatMap(([legacyName, canonicalName]) => ([
      { sourceName: legacyName, substituteName: canonicalName, relation: "equivalent", impact: {}, safetyNote: `标准名称已归一为“${canonicalName}”` },
      { sourceName: canonicalName, substituteName: legacyName, relation: "equivalent", impact: {}, safetyNote: `兼容旧目录名称“${legacyName}”` },
    ])),
  ];
  for (const substitution of substitutions) {
    statements.push(`INSERT INTO kitchenware_substitutions
      (source_catalog_id, substitute_catalog_id, relation_type, impact_json, safety_note)
      SELECT source.id, substitute.id, ${sqliteLiteral(substitution.relation)}, ${sqliteLiteral(JSON.stringify(substitution.impact))},
        ${sqliteLiteral(substitution.safetyNote)}
      FROM kitchenware_catalog source JOIN kitchenware_catalog substitute
        ON source.name=${sqliteLiteral(substitution.sourceName)} AND substitute.name=${sqliteLiteral(substitution.substituteName)}
      ON CONFLICT(source_catalog_id, substitute_catalog_id) DO UPDATE SET relation_type=excluded.relation_type,
        impact_json=excluded.impact_json, safety_note=excluded.safety_note`);
  }
  return `${statements.join(";\n")}\n`;
}

export async function seedKitchenwareCatalogV4Postgres(pool: Pool) {
  const release = KITCHENWARE_CATALOG_V4_RELEASE.release;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dietdigidose:kitchenware-v4'))");
    const catalogRows = KITCHENWARE_CATALOG_V4.map((entry) => ({
      name: entry.name,
      category: entry.category,
      aliases: entry.aliases,
      source: release,
      attributes: catalogAttributes(entry),
    }));
    await client.query(`INSERT INTO kitchenware_catalog
      (name, category, aliases, cooking_methods, care_note, source, attributes_json, quality_status, capability_version, updated_at)
      SELECT row.name, row.category, row.aliases, '[]'::jsonb, '', row.source, row.attributes, 'trusted', 1, CURRENT_TIMESTAMP
      FROM jsonb_to_recordset($1::jsonb) AS row(name text, category text, aliases jsonb, source text, attributes jsonb)
      ON CONFLICT(name) DO UPDATE SET
        category=excluded.category, aliases=excluded.aliases, source=excluded.source,
        attributes_json=excluded.attributes_json, quality_status='trusted', updated_at=CURRENT_TIMESTAMP
      WHERE kitchenware_catalog.source=excluded.source
        OR (kitchenware_catalog.source='system' AND (excluded.attributes_json->>'replacesLegacySeed')::boolean)`,
    [JSON.stringify(catalogRows)]);

    const owners = aliasOwners();
    const legacyRows = (await client.query("SELECT id, name, aliases FROM kitchenware_catalog WHERE source = 'system'")).rows as Array<{
      id: number; name: string; aliases: unknown;
    }>;
    for (const row of legacyRows) {
      const aliases = safeAliases(row.aliases);
      const filtered = aliases.filter((alias) => {
        const owner = owners.get(normalizeContentTerm(alias));
        return !owner || owner === row.name;
      });
      if (filtered.length !== aliases.length) {
        await client.query("UPDATE kitchenware_catalog SET aliases=$1::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=$2", [JSON.stringify(filtered), row.id]);
      }
    }

    await client.query(`INSERT INTO kitchenware_capabilities (code, name, description, safety_level)
      SELECT row.code, row.name, row.description, row.safety
      FROM jsonb_to_recordset($1::jsonb) AS row(code text, name text, description text, safety text)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, description=excluded.description, safety_level=excluded.safety_level`,
    [JSON.stringify(CAPABILITIES.map(([code, name, description, safety]) => ({ code, name, description, safety })))]);

    const capabilityLinks = Object.entries(CAPABILITY_CATALOGS).flatMap(([code, names]) => names.map((name) => ({ code, name })));
    await client.query(`INSERT INTO kitchenware_catalog_capabilities (catalog_id, capability_code, constraints_json)
      SELECT catalog.id, row.code, '{}'::jsonb
      FROM jsonb_to_recordset($1::jsonb) AS row(code text, name text)
      JOIN kitchenware_catalog catalog ON catalog.name=row.name
      ON CONFLICT(catalog_id, capability_code) DO NOTHING`, [JSON.stringify(capabilityLinks)]);

    await client.query(`UPDATE kitchenware_catalog legacy SET quality_status='deprecated', updated_at=CURRENT_TIMESTAMP
      FROM jsonb_to_recordset($1::jsonb) AS row(legacy_name text, canonical_name text)
      WHERE legacy.name=row.legacy_name AND legacy.source='system'
        AND EXISTS(SELECT 1 FROM kitchenware_catalog canonical WHERE canonical.name=row.canonical_name)`,
    [JSON.stringify(LEGACY_REDIRECTS.map(([legacyName, canonicalName]) => ({ legacy_name: legacyName, canonical_name: canonicalName })))]);

    const substitutionRows = [
      ...SUBSTITUTIONS.map(([sourceName, substituteName, relation, impact, safetyNote]) => ({ sourceName, substituteName, relation, impact, safetyNote })),
      ...LEGACY_REDIRECTS.flatMap(([legacyName, canonicalName]) => ([
        { sourceName: legacyName, substituteName: canonicalName, relation: "equivalent", impact: {}, safetyNote: `标准名称已归一为“${canonicalName}”` },
        { sourceName: canonicalName, substituteName: legacyName, relation: "equivalent", impact: {}, safetyNote: `兼容旧目录名称“${legacyName}”` },
      ])),
    ];
    await client.query(`INSERT INTO kitchenware_substitutions
      (source_catalog_id, substitute_catalog_id, relation_type, impact_json, safety_note)
      SELECT source.id, substitute.id, row.relation, row.impact, row.safety_note
      FROM jsonb_to_recordset($1::jsonb) AS row(source_name text, substitute_name text, relation text, impact jsonb, safety_note text)
      JOIN kitchenware_catalog source ON source.name=row.source_name
      JOIN kitchenware_catalog substitute ON substitute.name=row.substitute_name
      ON CONFLICT(source_catalog_id, substitute_catalog_id) DO UPDATE SET
        relation_type=excluded.relation_type, impact_json=excluded.impact_json, safety_note=excluded.safety_note`,
    [JSON.stringify(substitutionRows.map((row) => ({
      source_name: row.sourceName,
      substitute_name: row.substituteName,
      relation: row.relation,
      impact: row.impact,
      safety_note: row.safetyNote,
    })))]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
