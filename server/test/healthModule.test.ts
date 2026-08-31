import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HealthRepository } from "../src/modules/health/repository.js";
import { HealthService } from "../src/modules/health/service.js";

function fakeRepository(overrides: Partial<HealthRepository> = {}) {
  const repository: HealthRepository = {
    latestLog: async () => null,
    listLogs: async () => [],
    upsertLog: async (_userId, recordedDate) => ({ created: true, log: { recorded_date: recordedDate } }),
    removeLog: async () => true,
    getOrCreateProfile: async (userId) => ({
      user_id: userId,
      allergies_json: JSON.stringify([{ name: "坚果" }]),
      medical_conditions_json: ["高血压"],
      dietary_restrictions_json: "[]",
      kitchen_constraints_json: { servings: 2 },
      nutrition_targets_json: "{}",
      tracking_enabled: 1,
    }),
    upsertProfile: async (userId, input) => ({ user_id: userId, ...input }),
    ...overrides,
  };
  return repository;
}

describe("health module", () => {
  test("normalizes SQLite text JSON and PostgreSQL JSONB through one service shape", async () => {
    const service = new HealthService(fakeRepository());
    const profile = await service.getProfile(7);
    assert.deepEqual(profile.allergies, [{ name: "坚果" }]);
    assert.deepEqual(profile.medical_conditions, ["高血压"]);
    assert.deepEqual(profile.kitchen_constraints, { servings: 2 });
    assert.equal(profile.tracking_enabled, true);
    assert.equal("allergies_json" in profile, false);
  });

  test("uses the current date when a health log omits recorded_date", async () => {
    let capturedDate = "";
    const service = new HealthService(fakeRepository({
      upsertLog: async (_userId, recordedDate) => {
        capturedDate = recordedDate;
        return { created: true, log: {} };
      },
    }));
    await service.upsertLog(7, { weight: 65 });
    assert.match(capturedDate, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("maps structured profile fields to driver-neutral JSON values", async () => {
    let captured: Record<string, unknown> = {};
    const service = new HealthService(fakeRepository({
      upsertProfile: async (_userId, input) => {
        captured = input;
        return { ...input, tracking_enabled: input.tracking_enabled ?? false };
      },
    }));
    await service.upsertProfile(7, {
      allergies: [{ name: "坚果" }],
      medical_conditions: ["高血压"],
      kitchen_constraints: { servings: 2 },
      tracking_enabled: true,
    });
    assert.deepEqual(captured.allergies_json, [{ name: "坚果" }]);
    assert.deepEqual(captured.medical_conditions_json, ["高血压"]);
    assert.deepEqual(captured.kitchen_constraints_json, { servings: 2 });
  });
});
