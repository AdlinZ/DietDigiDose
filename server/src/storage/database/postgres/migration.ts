import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { PoolClient } from "pg";

export type BaselineColumn = {
  name: string;
  sqliteType: string;
  postgresType: string;
  transform: "identity" | "0/1 -> false/true" | "safe integer -> bigint" | "JSON text -> jsonb" | "SQLite UTC datetime -> timestamptz";
  nullable: boolean;
};

export type BaselineTable = {
  name: string;
  autoIncrement: boolean;
  primaryKey: string[];
  foreignKeys: Array<{
    column: string;
    referencedTable: string;
    referencedColumn: string;
    onUpdate: string;
    onDelete: string;
  }>;
  columns: BaselineColumn[];
};

export type BaselineManifest = {
  version: number;
  sourceSchemaSha256: string;
  tableCount: number;
  indexCount: number;
  foreignKeyCount: number;
  tables: BaselineTable[];
};

export type ArchiveTable = {
  name: string;
  file: string;
  rowCount: number;
  sha256: string;
};

export type ArchiveManifest = {
  version: 1;
  exportedAt: string;
  sourceFileSha256Before: string;
  sourceFileSha256After: string;
  baselineSchemaSha256: string;
  tables: ArchiveTable[];
  criticalMetrics: Record<string, number>;
};

const CRITICAL_METRICS = [
  { name: "inventory.quantity_value", table: "inventory_items", column: "quantity_value" },
  { name: "diet.calories", table: "diet_records", column: "calories" },
  { name: "health.weight", table: "health_logs", column: "weight" },
  { name: "ai.total_tokens", table: "ai_usage_logs", column: "total_tokens" },
] as const;

export function quotePgIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function transformValue(value: unknown, column: BaselineColumn): unknown {
  if (value == null) return null;
  if (column.transform === "0/1 -> false/true") {
    if (value === true || value === 1 || value === "1") return true;
    if (value === false || value === 0 || value === "0") return false;
    throw new Error(`${column.name} contains an invalid SQLite boolean: ${String(value)}`);
  }
  if (column.transform === "safe integer -> bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error(`${column.name} contains an unsafe JavaScript integer: ${String(value)}`);
    return number;
  }
  if (column.transform === "JSON text -> jsonb") {
    if (typeof value === "string") {
      try {
        return stableValue(JSON.parse(value));
      } catch {
        throw new Error(`${column.name} contains invalid JSON`);
      }
    }
    return stableValue(value);
  }
  if (column.transform === "SQLite UTC datetime -> timestamptz") {
    const date = value instanceof Date
      ? value
      : new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(value))
        ? String(value)
        : `${String(value).replace(" ", "T")}Z`);
    if (Number.isNaN(date.getTime())) throw new Error(`${column.name} contains an invalid datetime: ${String(value)}`);
    return date.toISOString();
  }
  if (column.postgresType === "bytea") {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
    return { __bytea_base64: bytes.toString("base64") };
  }
  return value;
}

export function postgresParameter(value: unknown, column: BaselineColumn) {
  if (value == null) return null;
  if (column.postgresType === "jsonb") return JSON.stringify(value);
  if (column.postgresType === "bytea" && typeof value === "object" && "__bytea_base64" in value) {
    return Buffer.from(String((value as { __bytea_base64: unknown }).__bytea_base64), "base64");
  }
  return value;
}

export function topologicalTableOrder(tables: BaselineTable[]) {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const dependencies = new Map(tables.map((table) => [
    table.name,
    new Set(table.foreignKeys.map((foreignKey) => foreignKey.referencedTable).filter((name) => name !== table.name)),
  ]));
  for (const [tableName, parents] of dependencies) {
    for (const parent of parents) if (!byName.has(parent)) throw new Error(`${tableName} references unknown table ${parent}`);
  }
  const ordered: BaselineTable[] = [];
  const remaining = new Set(byName.keys());
  while (remaining.size) {
    const ready = [...remaining].filter((name) => [...dependencies.get(name)!].every((parent) => !remaining.has(parent))).sort();
    if (!ready.length) throw new Error(`PostgreSQL import dependency cycle: ${[...remaining].sort().join(", ")}`);
    for (const name of ready) {
      ordered.push(byName.get(name)!);
      remaining.delete(name);
    }
  }
  return ordered;
}

function sha256File(filePath: string) {
  const hash = createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function assertSourceSchema(database: Database.Database, baseline: BaselineManifest) {
  const integrity = database.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") throw new Error(`SQLite integrity_check failed: ${canonicalJson(integrity)}`);
  const foreignKeyFailures = database.pragma("foreign_key_check") as unknown[];
  if (foreignKeyFailures.length) throw new Error(`SQLite foreign_key_check failed: ${canonicalJson(foreignKeyFailures.slice(0, 20))}`);
  for (const table of baseline.tables) {
    const actual = database.prepare(`PRAGMA table_info(${quotePgIdentifier(table.name)})`).all() as Array<{ name: string }>;
    if (!actual.length) throw new Error(`SQLite source is missing table ${table.name}`);
    const actualNames = new Set(actual.map((column) => column.name));
    const missing = table.columns.filter((column) => !actualNames.has(column.name)).map((column) => column.name);
    if (missing.length) throw new Error(`SQLite source ${table.name} is missing columns: ${missing.join(", ")}`);
  }
}

function tableRows(database: Database.Database, table: BaselineTable) {
  const columns = table.columns.map((column) => quotePgIdentifier(column.name)).join(", ");
  const order = table.primaryKey.map(quotePgIdentifier).join(", ");
  return database.prepare(`SELECT ${columns} FROM ${quotePgIdentifier(table.name)} ORDER BY ${order}`).iterate() as Iterable<Record<string, unknown>>;
}

function transformedRow(row: Record<string, unknown>, table: BaselineTable) {
  return Object.fromEntries(table.columns.map((column) => [column.name, transformValue(row[column.name], column)]));
}

function criticalMetricsFromSqlite(database: Database.Database, baseline: BaselineManifest) {
  const tableNames = new Set(baseline.tables.map((table) => table.name));
  return Object.fromEntries(CRITICAL_METRICS.filter((metric) => tableNames.has(metric.table)).map((metric) => {
    const row = database.prepare(`SELECT COALESCE(SUM(${quotePgIdentifier(metric.column)}), 0) AS value FROM ${quotePgIdentifier(metric.table)}`).get() as { value: number };
    return [metric.name, Number(row.value)];
  }));
}

export function exportMigrationArchive(options: {
  database: Database.Database;
  sqlitePath: string;
  outputDirectory: string;
  baseline: BaselineManifest;
}) {
  const sourcePath = path.resolve(options.sqlitePath);
  const outputDirectory = path.resolve(options.outputDirectory);
  if (outputDirectory === path.parse(outputDirectory).root || outputDirectory === path.dirname(outputDirectory)) {
    throw new Error(`Unsafe migration archive directory: ${outputDirectory}`);
  }
  if (fs.existsSync(outputDirectory)) throw new Error(`Migration archive directory already exists: ${outputDirectory}`);
  assertSourceSchema(options.database, options.baseline);
  const dataVersionBefore = options.database.pragma("data_version", { simple: true }) as number;
  const sourceFileSha256Before = sha256File(sourcePath);
  fs.mkdirSync(outputDirectory, { recursive: false });
  const archiveTables: ArchiveTable[] = [];
  for (const table of topologicalTableOrder(options.baseline.tables)) {
    const file = `${table.name}.ndjson`;
    const filePath = path.join(outputDirectory, file);
    const descriptor = fs.openSync(filePath, "wx");
    const hash = createHash("sha256");
    let rowCount = 0;
    try {
      for (const row of tableRows(options.database, table)) {
        const line = `${canonicalJson(transformedRow(row, table))}\n`;
        fs.writeSync(descriptor, line);
        hash.update(line);
        rowCount += 1;
      }
    } finally {
      fs.closeSync(descriptor);
    }
    archiveTables.push({ name: table.name, file, rowCount, sha256: hash.digest("hex") });
  }
  const sourceFileSha256After = sha256File(sourcePath);
  const dataVersionAfter = options.database.pragma("data_version", { simple: true }) as number;
  if (dataVersionAfter !== dataVersionBefore) throw new Error("SQLite source received writes while exporting; discard the archive and retry during a write freeze");
  if (sourceFileSha256After !== sourceFileSha256Before) throw new Error("SQLite source changed while exporting; discard the archive and retry during a write freeze");
  const manifest: ArchiveManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceFileSha256Before,
    sourceFileSha256After,
    baselineSchemaSha256: options.baseline.sourceSchemaSha256,
    tables: archiveTables,
    criticalMetrics: criticalMetricsFromSqlite(options.database, options.baseline),
  };
  fs.writeFileSync(path.join(outputDirectory, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return manifest;
}

export function readArchive(archiveDirectory: string, baseline: BaselineManifest) {
  const root = path.resolve(archiveDirectory);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "archive-manifest.json"), "utf8")) as ArchiveManifest;
  if (manifest.version !== 1) throw new Error(`Unsupported archive version: ${manifest.version}`);
  if (manifest.baselineSchemaSha256 !== baseline.sourceSchemaSha256) throw new Error("Archive and PostgreSQL baseline schema hashes differ");
  for (const table of manifest.tables) {
    const filePath = path.join(root, table.file);
    if (path.dirname(filePath) !== root) throw new Error(`Unsafe archive file path: ${table.file}`);
    if (sha256File(filePath) !== table.sha256) throw new Error(`Archive checksum mismatch: ${table.file}`);
  }
  return { root, manifest };
}

function readNdjson(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!content) return [];
  return content.trimEnd().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function buildUpsertStatement(table: BaselineTable, rowCount: number) {
  if (rowCount < 1) throw new Error("rowCount must be positive");
  const columns = table.columns.map((column) => quotePgIdentifier(column.name));
  const values = Array.from({ length: rowCount }, (_unused, rowIndex) => `(${columns.map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`).join(", ");
  const updates = table.columns.filter((column) => !table.primaryKey.includes(column.name));
  const conflict = updates.length
    ? `DO UPDATE SET ${updates.map((column) => `${quotePgIdentifier(column.name)} = EXCLUDED.${quotePgIdentifier(column.name)}`).join(", ")}`
    : "DO NOTHING";
  return `INSERT INTO ${quotePgIdentifier(table.name)} (${columns.join(", ")}) VALUES ${values} ON CONFLICT (${table.primaryKey.map(quotePgIdentifier).join(", ")}) ${conflict}`;
}

export async function importMigrationArchive(client: PoolClient, archiveDirectory: string, baseline: BaselineManifest, batchSize = 100) {
  const archive = readArchive(archiveDirectory, baseline);
  const archiveByTable = new Map(archive.manifest.tables.map((table) => [table.name, table]));
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dietdigidose:sqlite-import'))");
    for (const table of topologicalTableOrder(baseline.tables)) {
      const archived = archiveByTable.get(table.name);
      if (!archived) throw new Error(`Archive is missing table ${table.name}`);
      const rows = readNdjson(path.join(archive.root, archived.file));
      if (rows.length !== archived.rowCount) throw new Error(`Archive row count mismatch: ${table.name}`);
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const parameters = batch.flatMap((row) => table.columns.map((column) => postgresParameter(row[column.name], column)));
        await client.query(buildUpsertStatement(table, batch.length), parameters);
      }
      if (table.autoIncrement && table.primaryKey.length === 1) {
        const primaryKey = table.primaryKey[0]!;
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${quotePgIdentifier(primaryKey)}) FROM ${quotePgIdentifier(table.name)}), 1), EXISTS(SELECT 1 FROM ${quotePgIdentifier(table.name)}))`,
          [table.name, primaryKey],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return archive.manifest;
}

async function targetTableChecksum(client: PoolClient, table: BaselineTable, expectedRows: number) {
  const hash = createHash("sha256");
  const columns = table.columns.map((column) => quotePgIdentifier(column.name)).join(", ");
  const order = table.primaryKey.map(quotePgIdentifier).join(", ");
  let rowCount = 0;
  const pageSize = 1000;
  while (rowCount < expectedRows) {
    const result = await client.query(`SELECT ${columns} FROM ${quotePgIdentifier(table.name)} ORDER BY ${order} LIMIT $1 OFFSET $2`, [pageSize, rowCount]);
    if (!result.rows.length) break;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      hash.update(`${canonicalJson(transformedRow(row, table))}\n`);
      rowCount += 1;
    }
  }
  return { rowCount, sha256: hash.digest("hex") };
}

async function criticalMetricsFromPostgres(client: PoolClient, names: Set<string>) {
  const entries: Array<[string, number]> = [];
  for (const metric of CRITICAL_METRICS.filter((candidate) => names.has(candidate.name))) {
    const result = await client.query(`SELECT COALESCE(SUM(${quotePgIdentifier(metric.column)}), 0)::double precision AS value FROM ${quotePgIdentifier(metric.table)}`);
    entries.push([metric.name, Number(result.rows[0]?.value)]);
  }
  return Object.fromEntries(entries);
}

export async function validateMigrationTarget(client: PoolClient, archiveDirectory: string, baseline: BaselineManifest) {
  const archive = readArchive(archiveDirectory, baseline);
  const baselineByName = new Map(baseline.tables.map((table) => [table.name, table]));
  const failures: string[] = [];
  for (const archived of archive.manifest.tables) {
    const table = baselineByName.get(archived.name);
    if (!table) {
      failures.push(`unexpected archive table ${archived.name}`);
      continue;
    }
    const actual = await targetTableChecksum(client, table, archived.rowCount + 1);
    if (actual.rowCount !== archived.rowCount) failures.push(`${table.name}: expected ${archived.rowCount} rows, found ${actual.rowCount}`);
    if (actual.sha256 !== archived.sha256) failures.push(`${table.name}: canonical row checksum differs`);
    for (const foreignKey of table.foreignKeys) {
      const orphan = await client.query(`
        SELECT COUNT(*)::integer AS count
        FROM ${quotePgIdentifier(table.name)} child
        LEFT JOIN ${quotePgIdentifier(foreignKey.referencedTable)} parent
          ON child.${quotePgIdentifier(foreignKey.column)} = parent.${quotePgIdentifier(foreignKey.referencedColumn)}
        WHERE child.${quotePgIdentifier(foreignKey.column)} IS NOT NULL
          AND parent.${quotePgIdentifier(foreignKey.referencedColumn)} IS NULL
      `);
      if (Number(orphan.rows[0]?.count)) failures.push(`${table.name}.${foreignKey.column}: ${orphan.rows[0]?.count} orphan rows`);
    }
  }
  const targetMetrics = await criticalMetricsFromPostgres(client, new Set(Object.keys(archive.manifest.criticalMetrics)));
  for (const [name, expected] of Object.entries(archive.manifest.criticalMetrics)) {
    const actual = targetMetrics[name];
    if (actual === undefined || Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
      failures.push(`${name}: expected aggregate ${expected}, found ${String(actual)}`);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    tableCount: archive.manifest.tables.length,
    rowCount: archive.manifest.tables.reduce((total, table) => total + table.rowCount, 0),
    criticalMetrics: targetMetrics,
  };
}
