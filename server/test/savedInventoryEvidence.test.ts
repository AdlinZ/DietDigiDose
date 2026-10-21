import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { savedInventoryEvidence, editedInventoryEvidence } from "../src/modules/inventory/savedEvidence.js";
import { SqliteInventoryRepository } from "../src/modules/inventory/sqliteRepository.js";
import { verifySavedInventoryEvidence } from "./helpers/savedInventoryEvidence.js";
const directory = mkdtempSync(join(tmpdir(), "saved-evidence-"));
let db: Database.Database;
before(async () => {
  process.env.DATABASE_PATH = join(directory, "test.sqlite"); process.env.ADMIN_INITIAL_PASSWORD = "EvidenceFixturePassword1234"; process.env.ENABLE_DEMO_SEED = "0";
  const storage = await import("../src/storage/db.js"); db = storage.db; storage.initDatabase();
});
after(() => { db?.close(); rmSync(directory, { recursive: true, force: true }); });
test("SQLite saved evidence round-trips edits and consumption, fences owner/deleted records and corrupt metadata", async () => {
  const user = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('saved-evidence-owner','unused')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO users(username,password_hash) VALUES('saved-evidence-other','unused')").run().lastInsertRowid);
  await verifySavedInventoryEvidence(new SqliteInventoryRepository(db), user, other, async (id, mode) => {
    if (mode === "gap") { db.prepare("DELETE FROM inventory_change_logs WHERE inventory_item_id=? AND id NOT IN (SELECT MAX(id) FROM inventory_change_logs WHERE inventory_item_id=?)").run(id, id); return; }
    db.prepare("UPDATE inventory_change_logs SET metadata_json='broken' WHERE inventory_item_id=?").run(id);
  });
});
const item = { version: 2, food_name: "米", storage_location: "常温", expiration_date: "" };
const known = { status: "known", source: "recognition" };
const log = (version: number, evidence: object, action = "created", extra = {}) => ({ action, metadata_json: { inventory_version: version, field_evidence: evidence, ...extra } });
test("ambiguous old edits, gaps, corrupt fields, future/old versions and mismatched values never restore evidence", () => {
  const original = log(1, { food_name: known, expiration_date: { status: "estimated", source: "rule" } });
  assert.equal(savedInventoryEvidence(item, [original]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [original, log(2, { quantity: known }, "adjusted")]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence({ ...item, version: 3 }, [original, log(3, { quantity: known }, "consume_partial")]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(2, { food_name: { status: "confirmed", source: "user" } })]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(3, { food_name: known })]).food_name?.status, "unknown");
  assert.equal(savedInventoryEvidence(item, [log(2, { food_name: known }, "adjusted", { field_values: { food_name: "旧名称" } })]).food_name?.status, "unknown");
});
test("AI edit never manufactures user confirmation; text-only quantity edit invalidates old structured evidence", () => {
  const before = { ...item, version: 1, quantity: "1袋", quantity_value: 500, quantity_unit: "g" };
  const original = log(1, { food_name: known, quantity: { status: "estimated", source: "recognition" } });
  const result = editedInventoryEvidence(before, { ...before, version: 2, food_name: "面", quantity: "2袋" }, [original], "ai", { inventory_version: 2 });
  assert.equal(result.saved_field_evidence.food_name?.status, "unknown");
  assert.equal(result.saved_field_evidence.quantity?.status, "unknown");
});

test("unrelated legacy edit leaves quantity provenance absent for existing operational semantics", () => {
  const before = { ...item, version: 1, quantity: "500g", quantity_value: 500, quantity_unit: "g" };
  const result = editedInventoryEvidence(before, { ...before, version: 2, food_name: "新名称" }, [], "manual", { inventory_version: 2, field_evidence: {} });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "field_evidence"), false);
  assert.equal(result.saved_field_evidence.food_name?.source, "user");
});

test("unanchored, corrupt and gapped derivatives cannot certify any field", () => {
  const derivative = (v: number) => log(v, { quantity: { ...known, derived_from_version: v - 1 } }, "consume_partial");
  for (const logs of [[derivative(3)], [log(1, { quantity: known }), derivative(3)], [log(1, { quantity: known }), { action: "adjusted", metadata_json: "broken" }, derivative(3)]]) {
    assert.equal(savedInventoryEvidence({ ...item, version: 3 }, logs).quantity?.status, "unknown");
  }
});
