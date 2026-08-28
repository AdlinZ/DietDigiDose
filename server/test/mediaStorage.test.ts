import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InvalidMediaError, isStoredMediaUrlForUser, parseImageDataUrl } from "../src/services/mediaStorage.js";

describe("media storage validation", () => {
  it("accepts a PNG only when its signature matches", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const parsed = parseImageDataUrl(`data:image/png;base64,${png.toString("base64")}`);
    assert.equal(parsed.mimeType, "image/png");
    assert.equal(parsed.extension, "png");
    assert.throws(() => parseImageDataUrl(`data:image/jpeg;base64,${png.toString("base64")}`), InvalidMediaError);
  });

  it("rejects unsupported or empty payloads", () => {
    assert.throws(() => parseImageDataUrl("data:image/svg+xml;base64,PHN2Zz4="), InvalidMediaError);
    assert.throws(() => parseImageDataUrl("data:image/png;base64,"), InvalidMediaError);
  });

  it("only recognizes media from the current user's object prefix", () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousBucket = process.env.SUPABASE_MEDIA_BUCKET;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_MEDIA_BUCKET = "community-media";
    try {
      assert.equal(isStoredMediaUrlForUser("/media/uploads/community/42/2026-08-28/a.png", 42), true);
      assert.equal(isStoredMediaUrlForUser("/media/uploads/community/43/2026-08-28/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("https://attacker.example/media/uploads/community/42/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("//attacker.example/media/uploads/community/42/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("/media/uploads/community/42/../43/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("https://project.supabase.co/storage/v1/object/public/community-media/community/42/a.png", 42), true);
      assert.equal(isStoredMediaUrlForUser("https://project.supabase.co/storage/v1/object/public/community-media/community/43/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("https://attacker.example/storage/v1/object/public/community-media/community/42/a.png", 42), false);
      assert.equal(isStoredMediaUrlForUser("https://example.test/a.png", 42), false);
    } finally {
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousBucket === undefined) delete process.env.SUPABASE_MEDIA_BUCKET;
      else process.env.SUPABASE_MEDIA_BUCKET = previousBucket;
    }
  });
});
