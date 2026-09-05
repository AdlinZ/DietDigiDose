import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { MediaCleanupRepository } from "../src/modules/mediaCleanup/repository.js";
import { MediaCleanupService, sanitizeMediaCleanupError } from "../src/modules/mediaCleanup/service.js";

function repository(overrides: Partial<MediaCleanupRepository> = {}): MediaCleanupRepository {
  return {
    enqueue: async () => 1,
    claim: async () => null,
    complete: async () => false,
    release: async () => undefined,
    pending: async () => [],
    job: async () => null,
    list: async () => ({ rows: [], total: 0, summary: {} }),
    ...overrides,
  };
}

describe("media cleanup module", () => {
  test("claims, deletes JSONB references and commits only with the claim token", async () => {
    const completed: Array<[number, string]> = [];
    const deleted: unknown[] = [];
    const service = new MediaCleanupService(repository({
      claim: async () => ({ id: 9, owner_user_id: 3, urls_json: ["/media/uploads/a.png"],
        objects_json: [{ backend: "local", path: "/tmp/a.png" }], status: "processing", attempts: 1,
        last_error: null, created_at: new Date(), updated_at: new Date(), completed_at: null,
        claim_token: "claim-9", claimed_at: new Date() }),
      complete: async (id, token) => { completed.push([id, token]); return true; },
    }), async (references) => { deleted.push(...references); });
    assert.equal(await service.process(9), true);
    assert.deepEqual(deleted, [{ backend: "local", path: "/tmp/a.png" }]);
    assert.deepEqual(completed, [[9, "claim-9"]]);
  });

  test("releases failed jobs with a redacted error", async () => {
    let released = "";
    const service = new MediaCleanupService(repository({
      claim: async () => ({ id: 4, owner_user_id: 3, urls_json: [], objects_json: [], status: "processing", attempts: 1,
        last_error: null, created_at: "2026-09-01", updated_at: "2026-09-01", completed_at: null,
        claim_token: "claim-4", claimed_at: "2026-09-01" }),
      release: async (_id, _token, error) => { released = error; },
    }), async () => { throw new Error("service_role_key=secret https://private.example/object"); });
    await assert.rejects(() => service.process(4));
    assert.equal(released.includes("secret"), false);
    assert.equal(released.includes("private.example"), false);
    assert.match(sanitizeMediaCleanupError("/media/uploads/private.png"), /已隐藏媒体路径/);
  });

  test("keeps legacy jobs pending across an origin change and retries after configuration is restored", async () => {
    const previousUrl = process.env.SUPABASE_URL;
    const oldOrigin = "https://old-project.example";
    const url = `${oldOrigin}/storage/v1/object/public/community-media/community/3/photo.png`;
    let attempt = 0;
    let releasedError = "";
    const deleted: unknown[] = [];
    const completed: Array<[number, string]> = [];
    const service = new MediaCleanupService(repository({
      claim: async () => {
        attempt += 1;
        return { id: 8, owner_user_id: 3, urls_json: [url], objects_json: null, status: "processing", attempts: attempt,
          last_error: null, created_at: new Date(), updated_at: new Date(), completed_at: null,
          claim_token: `claim-${attempt}`, claimed_at: new Date() };
      },
      complete: async (id, token) => { completed.push([id, token]); return true; },
      release: async (_id, _token, error) => { releasedError = error; },
    }), async (references) => { deleted.push(...references); });

    try {
      process.env.SUPABASE_URL = "https://new-project.example";
      await assert.rejects(() => service.process(8), /无法定位任何存储对象/);
      assert.deepEqual(deleted, []);
      assert.deepEqual(completed, []);
      assert.match(releasedError, /保留等待重试/);

      process.env.SUPABASE_URL = oldOrigin;
      assert.equal(await service.process(8), true);
      assert.deepEqual(deleted, [{
        backend: "supabase",
        origin: oldOrigin,
        bucket: "community-media",
        objectPath: "community/3/photo.png",
      }]);
      assert.deepEqual(completed, [[8, "claim-2"]]);
    } finally {
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
    }
  });
});
