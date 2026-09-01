import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import type { AgentOperationsRepository } from "../src/modules/agentOperations/repository.js";
import { AgentOperationsService } from "../src/modules/agentOperations/service.js";
import { SqliteAgentOperationsRepository } from "../src/modules/agentOperations/sqliteRepository.js";

describe("Agent operations module", () => {
  test("delegates execution and undo through a database-neutral service", async () => {
    const calls: string[] = [];
    const repository: AgentOperationsRepository = {
      executeActions: async (userId, runId) => { calls.push(`execute:${userId}:${runId}`); return [{ actionId: "a", result: { ok: true } }]; },
      undoActions: async (userId, runId) => { calls.push(`undo:${userId}:${runId}`); return { undone: 1 }; },
    };
    const service = new AgentOperationsService(repository);
    assert.deepEqual(await service.executeActions(42, "run-1", []), [{ actionId: "a", result: { ok: true } }]);
    assert.deepEqual(await service.undoActions(42, "run-1"), { undone: 1 });
    assert.deepEqual(calls, ["execute:42:run-1", "undo:42:run-1"]);
  });

  test("SQLite executes idempotently, rolls back failed bundles, and safely undoes writes", async () => {
    const database = new Database(":memory:");
    try {
      database.exec(`CREATE TABLE agent_runs (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,status TEXT NOT NULL);
        CREATE TABLE agent_actions (
          id TEXT PRIMARY KEY,run_id TEXT NOT NULL,user_id INTEGER NOT NULL,action_type TEXT NOT NULL,status TEXT NOT NULL,
          before_json TEXT,result_json TEXT,executed_at TEXT,undone_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE shopping_list_items (
          id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,client_id TEXT,name TEXT NOT NULL,amount TEXT NOT NULL DEFAULT '适量',
          category TEXT NOT NULL DEFAULT '其他',checked INTEGER NOT NULL DEFAULT 0,purchase_date TEXT,storage_location TEXT,
          source_run_id TEXT,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT
        );
        CREATE TABLE meal_plans (
          id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,title TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',constraints_json TEXT NOT NULL DEFAULT '{}',created_by_run_id TEXT,
          version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT
        )`);
      database.prepare("INSERT INTO agent_runs(id,user_id,status) VALUES('run-ok',42,'running'),('run-fail',42,'running'),('run-cancelled',42,'cancelled')").run();
      database.prepare(`INSERT INTO agent_actions(id,run_id,user_id,action_type,status) VALUES
        ('action-ok','run-ok',42,'add_shopping_items','proposed'),
        ('action-first','run-fail',42,'add_shopping_items','proposed'),
        ('action-fail','run-fail',42,'update_shopping_item','proposed'),
        ('action-cancelled','run-cancelled',42,'add_shopping_items','proposed'),
        ('action-locked','run-ok',42,'add_shopping_items','undone')`).run();
      const repository = new SqliteAgentOperationsRepository(database);
      const add = { id: "action-ok", actionType: "add_shopping_items" as const, riskLevel: "low" as const,
        summary: "加入采购", payload: { items: [{ name: "番茄", amount: "2个" }] } };
      const first = await repository.executeActions(42, "run-ok", [add]);
      const repeated = await repository.executeActions(42, "run-ok", [add]);
      assert.deepEqual(repeated, first);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='番茄'").get() as { count: number }).count, 1);

      await assert.rejects(() => repository.executeActions(42, "run-fail", [
        { id: "action-first", actionType: "add_shopping_items", riskLevel: "low", summary: "加入采购", payload: { items: [{ name: "应回滚" }] } },
        { id: "action-fail", actionType: "update_shopping_item", riskLevel: "low", summary: "更新不存在项", payload: { itemId: "missing" } },
      ]), /不存在或无权修改/);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='应回滚'").get() as { count: number }).count, 0);
      assert.deepEqual(database.prepare("SELECT status FROM agent_actions WHERE run_id='run-fail' ORDER BY id").all(),
        [{ status: "failed" }, { status: "failed" }]);

      await assert.rejects(() => repository.executeActions(42, "run-cancelled", [
        { ...add, id: "action-cancelled", payload: { items: [{ name: "取消后写入" }] } },
      ]), /已取消|不再允许/);
      assert.equal((database.prepare("SELECT COUNT(*) AS count FROM shopping_list_items WHERE name='取消后写入'").get() as { count: number }).count, 0);
      await assert.rejects(() => repository.executeActions(42, "run-ok", [
        { ...add, id: "action-locked", payload: { items: [{ name: "已撤销后写入" }] } },
      ]), /状态不允许/);
      assert.equal((database.prepare("SELECT status FROM agent_actions WHERE id='action-locked'").get() as { status: string }).status, "undone");

      assert.deepEqual(await repository.undoActions(42, "run-ok"), { undone: 1 });
      assert.deepEqual(database.prepare("SELECT deleted_at IS NOT NULL AS deleted,version FROM shopping_list_items WHERE name='番茄'").get(),
        { deleted: 1, version: 2 });
      assert.equal((database.prepare("SELECT status FROM agent_actions WHERE id='action-ok'").get() as { status: string }).status, "undone");
    } finally {
      database.close();
    }
  });
});
