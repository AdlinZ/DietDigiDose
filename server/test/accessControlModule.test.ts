import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AccessControlRepository } from "../src/modules/accessControl/repository.js";
import { AccessControlService } from "../src/modules/accessControl/service.js";

function repository(overrides: Partial<AccessControlRepository> = {}): AccessControlRepository {
  return {
    user: async () => null,
    ...overrides,
  };
}

describe("access control module", () => {
  test("normalizes SQLite and PostgreSQL access values", async () => {
    const sqlite = new AccessControlService(repository({
      user: async () => ({ sessionVersion: 3, isDisabled: 0, role: "admin", mustChangePassword: 1 }),
    }));
    assert.deepEqual(await sqlite.user(7), {
      sessionVersion: 3,
      isDisabled: false,
      role: "admin",
      mustChangePassword: true,
    });

    const postgres = new AccessControlService(repository({
      user: async () => ({ sessionVersion: "4", isDisabled: true, role: "user", mustChangePassword: false }),
    }));
    assert.deepEqual(await postgres.user(8), {
      sessionVersion: 4,
      isDisabled: true,
      role: "user",
      mustChangePassword: false,
    });
  });

  test("signs versioned sessions and rejects missing users", async () => {
    const service = new AccessControlService(repository({
      user: async () => ({ sessionVersion: 5, isDisabled: 0, role: "user", mustChangePassword: 0 }),
    }));
    const token = await service.signUserToken(9);
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
    assert.equal(claims.userId, 9);
    assert.equal(claims.sessionVersion, 5);
    await assert.rejects(() => new AccessControlService(repository()).signUserToken(99), /USER_NOT_FOUND/);
  });
});
