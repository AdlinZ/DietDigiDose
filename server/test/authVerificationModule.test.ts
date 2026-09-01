import assert from "node:assert/strict";
import { describe, test } from "node:test";
import Database from "better-sqlite3";
import { AuthVerificationService } from "../src/modules/authVerification/service.js";
import { SqliteAuthVerificationRepository } from "../src/modules/authVerification/sqliteRepository.js";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE COLLATE NOCASE,email TEXT,phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,avatar_url TEXT,bio TEXT,role TEXT NOT NULL DEFAULT 'user',daily_calories_target INTEGER DEFAULT 2000,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,phone_verified_at TEXT,last_login_at TEXT,last_login_ip TEXT,is_disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE user_health_profiles(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE auth_verification_subjects(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,channel TEXT NOT NULL,provider TEXT NOT NULL,
      subject_hmac TEXT NOT NULL,subject_ciphertext TEXT NOT NULL,subject_iv TEXT NOT NULL,subject_auth_tag TEXT NOT NULL,
      last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(channel,provider,subject_hmac));
    CREATE TABLE auth_verification_challenges(id TEXT PRIMARY KEY,subject_id INTEGER NOT NULL,purpose TEXT NOT NULL,out_id TEXT NOT NULL UNIQUE,
      biz_id TEXT,provider_request_id TEXT,status TEXT NOT NULL DEFAULT 'pending',attempt_count INTEGER NOT NULL DEFAULT 0,
      registration_token_hash TEXT UNIQUE,registration_expires_at TEXT,expires_at TEXT NOT NULL,verified_at TEXT,consumed_at TEXT,
      source_ip TEXT,user_agent TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE auth_verification_events(id INTEGER PRIMARY KEY AUTOINCREMENT,subject_id INTEGER NOT NULL,challenge_id TEXT,channel TEXT NOT NULL,
      provider TEXT NOT NULL,event_type TEXT NOT NULL,outcome TEXT NOT NULL,provider_code TEXT,provider_message TEXT,provider_request_id TEXT,
      biz_id TEXT,out_id TEXT,source_ip TEXT,user_agent TEXT,details_json TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE auth_verification_usage_daily(usage_date TEXT NOT NULL,channel TEXT NOT NULL,provider TEXT NOT NULL,
      send_requests INTEGER NOT NULL DEFAULT 0,send_api_calls INTEGER NOT NULL DEFAULT 0,accepted INTEGER NOT NULL DEFAULT 0,
      delivered INTEGER NOT NULL DEFAULT 0,delivery_failed INTEGER NOT NULL DEFAULT 0,verify_api_calls INTEGER NOT NULL DEFAULT 0,
      verify_passed INTEGER NOT NULL DEFAULT 0,verify_failed INTEGER NOT NULL DEFAULT 0,local_rate_limited INTEGER NOT NULL DEFAULT 0,
      provider_errors INTEGER NOT NULL DEFAULT 0,delivery_units INTEGER NOT NULL DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(usage_date,channel,provider));
  `);
  return db;
}

describe("auth verification module", () => {
  test("stores settings and encrypts a stable, reusable subject", async () => {
    const db = database();
    const repository = new SqliteAuthVerificationRepository(db);
    const service = new AuthVerificationService(repository);
    await service.saveSettings([{ key: "auth.sms.enabled", value: "1" }, { key: "auth.sms.limit.phone_hour", value: "7" }]);
    const config = await service.config();
    assert.equal(config.enabled, true);
    assert.equal(config.phoneHourlyLimit, 7);
    const first = await service.findOrCreateSubject("13800138000");
    const second = await service.findOrCreateSubject("13800138000");
    assert.equal(second.id, first.id);
    assert.equal(service.decryptPhone(first), "13800138000");
    assert.equal(service.maskedPhone(first), "138****8000");
    db.close();
  });

  test("applies send counters and compare-and-set verification attempts", async () => {
    const db = database();
    const repository = new SqliteAuthVerificationRepository(db);
    const service = new AuthVerificationService(repository);
    const subject = await service.findOrCreateSubject("13900139000");
    await service.createChallenge({ id: "challenge-1", subjectId: subject.id, purpose: "login", outId: "out-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: "203.0.113.9", userAgent: "test" });
    await service.recordEvent({ subjectId: subject.id, challengeId: "challenge-1", eventType: "send_api_called",
      outcome: "pending", sourceIp: "203.0.113.9" });
    assert.equal(await service.countSubjectSends(subject.id, new Date(Date.now() - 60_000).toISOString()), 1);
    assert.equal(await service.countIpSends("203.0.113.9", new Date(Date.now() - 60_000).toISOString()), 1);
    assert.equal(await service.beginVerification("challenge-1"), true);
    assert.equal(await service.beginVerification("challenge-1"), false);
    await service.restoreVerification("challenge-1");
    assert.equal((await service.challenge("challenge-1"))?.status, "accepted");
    db.close();
  });

  test("atomically consumes a registration token and initializes the account", async () => {
    const db = database();
    const service = new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const subject = await service.findOrCreateSubject("13700137000");
    await service.createChallenge({ id: "register-1", subjectId: subject.id, purpose: "login", outId: "register-out",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: null, userAgent: null });
    await service.markRegistrationRequired({ challengeId: "register-1", at: new Date().toISOString(), tokenHash: "token-hash",
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const result = await service.register({ tokenHash: "token-hash", phone: "13700137000", username: "短信用户",
      passwordHash: "stored-hash", at: new Date().toISOString() });
    assert.equal(result.status, "created");
    if (result.status !== "created") return;
    assert.equal((await service.userResponse(result.userId))?.phone, "13700137000");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM user_health_profiles WHERE user_id=?")
      .get(result.userId) as { count: number }).count, 1);
    assert.equal((await service.register({ tokenHash: "token-hash", phone: "13700137000", username: "另一个用户",
      passwordHash: "hash", at: new Date().toISOString() })).status, "invalid_token");
    db.close();
  });

  test("deduplicates delivery callbacks while updating usage and admin queries", async () => {
    const db = database();
    const service = new AuthVerificationService(new SqliteAuthVerificationRepository(db));
    const subject = await service.findOrCreateSubject("13600136000");
    await service.createChallenge({ id: "delivery-1", subjectId: subject.id, purpose: "login", outId: "delivery-out",
      expiresAt: new Date(Date.now() + 60_000).toISOString(), sourceIp: "198.51.100.4", userAgent: null });
    await service.updateTestChallenge("delivery-1", "accepted", "biz-1", "request-1");
    const report = { bizId: "biz-1", outId: "delivery-out", providerCode: "OK", providerMessage: "sent to 13600136000",
      success: true, units: 2, usageDate: "2026-09-01", details: { smsSize: 2 } };
    assert.equal(await service.recordDeliveryReport(report), true);
    assert.equal(await service.recordDeliveryReport(report), false);
    const overview = await service.usageOverview("2026-09-01");
    assert.equal(overview.totals.delivered, 1);
    assert.equal(overview.totals.deliveryUnits, 2);
    const page = await service.events({ providerId: "biz-1" }, 1, 20);
    assert.equal(page.total, 1);
    assert.equal(page.rows[0]?.providerMessage, "sent to [phone]");
    db.close();
  });
});
