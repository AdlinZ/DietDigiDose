import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";

const testDirectory = mkdtempSync(path.join(tmpdir(), "dietdigidose-api-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = path.join(testDirectory, "integration.db");
process.env.JWT_SECRET = "integration-test-jwt-secret-at-least-32-characters-long";
process.env.ADMIN_INITIAL_PASSWORD = "AdminPassword1234";

type JsonObject = Record<string, any>;

let server: Server;
let baseUrl = "";
let db: typeof import("../src/storage/db.js").db;
let first: JsonObject;
let second: JsonObject;

async function api(
  pathname: string,
  options: RequestInit & { token?: string } = {},
) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const body = await response.json().catch(() => null) as JsonObject | JsonObject[] | null;
  return { response, body };
}

async function register(identifier: string) {
  const result = await api("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ identifier, password: "Password1234" }),
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.body && !Array.isArray(result.body));
  return result.body as JsonObject;
}

before(async () => {
  const [{ createApp }, database] = await Promise.all([
    import("../src/app.js"),
    import("../src/storage/db.js"),
  ]);
  db = database.db;
  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  if (db) db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

describe("API security baseline", () => {
  test("health check returns a request id", async () => {
    const { response, body } = await api("/api/v1/health");
    assert.equal(response.status, 200);
    assert.equal((body as JsonObject).status, "ok");
    assert.ok(response.headers.get("x-request-id"));
  });

  test("registration rejects weak passwords and unknown fields", async () => {
    const weak = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ identifier: "weak@example.com", password: "123456" }),
    });
    assert.equal(weak.response.status, 400);
    assert.equal((weak.body as JsonObject).code, "VALIDATION_ERROR");

    const extra = await api("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ identifier: "extra@example.com", password: "Password1234", role: "admin" }),
    });
    assert.equal(extra.response.status, 400);
  });

  test("invalid and missing tokens use stable error codes", async () => {
    const missing = await api("/api/v1/inventory");
    assert.equal(missing.response.status, 401);
    assert.equal((missing.body as JsonObject).code, "AUTH_REQUIRED");

    const invalid = await api("/api/v1/auth/me", { token: "not-a-token" });
    assert.equal(invalid.response.status, 401);
    assert.equal((invalid.body as JsonObject).code, "INVALID_TOKEN");

    const expiredToken = jwt.sign(
      { userId: 999 },
      process.env.JWT_SECRET!,
      { expiresIn: -1 },
    );
    const expired = await api("/api/v1/auth/me", { token: expiredToken });
    assert.equal(expired.response.status, 401);
    assert.equal((expired.body as JsonObject).code, "TOKEN_EXPIRED");
  });

  test("registered users can log in with the strong password", async () => {
    await register("login-success@example.com");
    const result = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: "login-success@example.com", password: "Password1234" }),
    });
    assert.equal(result.response.status, 200);
    assert.ok((result.body as JsonObject).token);
  });

  test("login failures are rate limited", async () => {
    const body = JSON.stringify({ identifier: "rate-limit@example.com", password: "WrongPassword123" });
    for (let index = 0; index < 5; index += 1) {
      const attempt = await api("/api/v1/auth/login", { method: "POST", body });
      assert.equal(attempt.response.status, 401);
    }
    const blocked = await api("/api/v1/auth/login", { method: "POST", body });
    assert.equal(blocked.response.status, 429);
    assert.equal((blocked.body as JsonObject).code, "LOGIN_RATE_LIMITED");
    assert.ok(blocked.response.headers.get("retry-after"));
  });
});

describe("new user MVP journey", () => {
  test("connects registration, health goals, expiring inventory, recipes and diet progress", async () => {
    const account = await register("mvp-journey@example.com");

    const profile = await api("/api/v1/health-data/profile", {
      method: "PUT",
      token: account.token,
      body: JSON.stringify({
        gender: "保密",
        age: 30,
        height: 170,
        weight: 65,
        target_weight: 62,
        health_goal: "healthy",
        activity_level: "moderate",
        dietary_preference: "无特别偏好",
      }),
    });
    assert.equal(profile.response.status, 200);
    assert.equal((profile.body as JsonObject).target_weight, 62);

    const inventory = await api("/api/v1/inventory", {
      method: "POST",
      token: account.token,
      body: JSON.stringify({
        food_name: "番茄",
        category: "蔬菜",
        quantity: "2个",
        expiration_date: "2026-08-05",
        storage_location: "冷藏",
      }),
    });
    assert.equal(inventory.response.status, 201);

    const inventoryList = await api("/api/v1/inventory", { token: account.token });
    assert.equal(inventoryList.response.status, 200);
    assert.equal((inventoryList.body as JsonObject[]).length, 1);
    assert.equal((inventoryList.body as JsonObject[])[0].food_name, "番茄");

    const recipes = await api("/api/v1/recipes");
    assert.equal(recipes.response.status, 200);
    assert.ok(Array.isArray(recipes.body));
    assert.ok(recipes.body.length > 0);
    const selectedRecipe = recipes.body[0] as JsonObject;

    const dietRecord = await api("/api/v1/diet-records", {
      method: "POST",
      token: account.token,
      body: JSON.stringify({
        meal_type: "午餐",
        food_name: selectedRecipe.title,
        amount: "1份",
        calories: selectedRecipe.calories,
        protein: selectedRecipe.protein,
        carbs: selectedRecipe.carbs,
        fat: selectedRecipe.fat,
        recorded_at: "2026-08-03",
      }),
    });
    assert.equal(dietRecord.response.status, 201);

    const progress = await api("/api/v1/diet-records?date=2026-08-03", { token: account.token });
    assert.equal(progress.response.status, 200);
    assert.equal((progress.body as JsonObject[]).length, 1);
    assert.equal((progress.body as JsonObject[])[0].food_name, selectedRecipe.title);
  });
});

describe("user data isolation", () => {
  before(async () => {
    first = await register("first@example.com");
    second = await register("second@example.com");
  });

  test("inventory CRUD is scoped to its owner", async () => {
    const created = await api("/api/v1/inventory", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({
        food_name: "番茄",
        category: "蔬菜",
        quantity: "2个",
        expiration_date: "2026-08-06",
        storage_location: "冷藏",
      }),
    });
    assert.equal(created.response.status, 201);
    const item = created.body as JsonObject;

    const secondList = await api("/api/v1/inventory", { token: second.token });
    assert.deepEqual(secondList.body, []);

    const forbiddenUpdate = await api(`/api/v1/inventory/${item.id}`, {
      method: "PUT",
      token: second.token,
      body: JSON.stringify({ quantity: "99个" }),
    });
    assert.equal(forbiddenUpdate.response.status, 404);

    const updated = await api(`/api/v1/inventory/${item.id}`, {
      method: "PUT",
      token: first.token,
      body: JSON.stringify({ is_available: false }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal((updated.body as JsonObject).is_available, false);

    const restored = await api(`/api/v1/inventory/${item.id}`, {
      method: "PUT",
      token: first.token,
      body: JSON.stringify({ is_available: true }),
    });
    assert.equal(restored.response.status, 200);
    assert.equal((restored.body as JsonObject).is_available, true);

    const forbiddenDelete = await api(`/api/v1/inventory/${item.id}`, {
      method: "DELETE",
      token: second.token,
    });
    assert.equal(forbiddenDelete.response.status, 404);

    const removed = await api(`/api/v1/inventory/${item.id}`, {
      method: "DELETE",
      token: first.token,
    });
    assert.equal(removed.response.status, 200);
  });

  test("diet records are isolated and missing nutrition stays unknown", async () => {
    const created = await api("/api/v1/diet-records", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({
        meal_type: "午餐",
        food_name: "番茄鸡蛋",
        amount: "1份",
        recorded_at: "2026-08-03",
      }),
    });
    assert.equal(created.response.status, 201);
    const record = created.body as JsonObject;
    assert.equal(record.calories, null);
    assert.equal(record.protein, null);

    const secondList = await api("/api/v1/diet-records?date=2026-08-03", { token: second.token });
    assert.deepEqual(secondList.body, []);

    const forbiddenDelete = await api(`/api/v1/diet-records/${record.id}`, {
      method: "DELETE",
      token: second.token,
    });
    assert.equal(forbiddenDelete.response.status, 404);
  });

  test("health logs and profiles are isolated and range-validated", async () => {
    const invalid = await api("/api/v1/health-data/log", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({ weight: 999 }),
    });
    assert.equal(invalid.response.status, 400);

    const profile = await api("/api/v1/health-data/profile", {
      method: "PUT",
      token: first.token,
      body: JSON.stringify({ age: 28, height: 172, weight: 65, health_goal: "healthy" }),
    });
    assert.equal(profile.response.status, 200);

    const log = await api("/api/v1/health-data/log", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({
        weight: 65,
        height_cm: 172,
        water_ml: 1500,
        resting_heart_rate: 68,
        blood_pressure_systolic: 118,
        blood_pressure_diastolic: 76,
        sleep_hours: 7.5,
        recorded_date: "2026-08-03",
      }),
    });
    assert.equal(log.response.status, 201);
    assert.equal((log.body as JsonObject).resting_heart_rate, 68);
    assert.equal((log.body as JsonObject).sleep_hours, 7.5);

    const secondProfile = await api("/api/v1/health-data/profile", { token: second.token });
    assert.equal(secondProfile.body, null);
    const secondLogs = await api("/api/v1/health-data", { token: second.token });
    assert.deepEqual(secondLogs.body, []);
  });

  test("ordinary users cannot access admin routes", async () => {
    const stats = await api("/api/v1/admin/stats", { token: first.token });
    assert.equal(stats.response.status, 403);
    const roleChange = await api(`/api/v1/admin/users/${second.user.id}/role`, {
      method: "PUT",
      token: first.token,
      body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(roleChange.response.status, 403);
  });
});

describe("core business authorization", () => {
  test("kitchenware writes are owner-scoped", async () => {
    const created = await api("/api/v1/kitchenware", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({
        name: "平底锅",
        category: "烹饪锅具",
        status: "良好",
        note: "测试厨具",
        image_url: null,
        purchase_date: null,
      }),
    });
    assert.equal(created.response.status, 201);
    const item = created.body as JsonObject;

    const forbidden = await api(`/api/v1/kitchenware/${item.id}`, {
      method: "PUT",
      token: second.token,
      body: JSON.stringify({ name: "别人的锅", category: "烹饪锅具", status: "良好", note: "" }),
    });
    assert.equal(forbidden.response.status, 404);
  });

  test("community question acceptance is limited to the post owner", async () => {
    const post = await api("/api/v1/community/posts", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({ content: "如何保存番茄？", category: "问答", image_urls: [] }),
    });
    assert.equal(post.response.status, 201);
    const postId = (post.body as JsonObject).id;

    const comment = await api(`/api/v1/community/posts/${postId}/comments`, {
      method: "POST",
      token: second.token,
      body: JSON.stringify({ content: "冷藏并尽快食用" }),
    });
    assert.equal(comment.response.status, 201);
    const commentId = (comment.body as JsonObject).id;

    const forbidden = await api(`/api/v1/community/posts/${postId}/comments/${commentId}/accept`, {
      method: "POST",
      token: second.token,
    });
    assert.equal(forbidden.response.status, 403);

    const accepted = await api(`/api/v1/community/posts/${postId}/comments/${commentId}/accept`, {
      method: "POST",
      token: first.token,
    });
    assert.equal(accepted.response.status, 200);
  });

  test("pending recipe submissions stay private and cannot be edited by another user", async () => {
    const payload = {
      title: "番茄鸡蛋测试菜谱",
      description: "集成测试菜谱",
      cook_time: 15,
      difficulty: "简单",
      calories: 280,
      protein: 15,
      carbs: 18,
      fat: 12,
      category: "家常菜",
      tags: ["快手"],
      ingredients: [{ name: "番茄", amount: "2个", group: "主料" }],
      steps: ["番茄切块并炒熟"],
    };
    const created = await api("/api/v1/recipes/submissions", {
      method: "POST",
      token: first.token,
      body: JSON.stringify(payload),
    });
    assert.equal(created.response.status, 201);
    const recipeId = (created.body as JsonObject).id;

    const publicDetail = await api(`/api/v1/recipes/${recipeId}`);
    assert.equal(publicDetail.response.status, 404);

    const forbidden = await api(`/api/v1/recipes/submissions/${recipeId}`, {
      method: "PUT",
      token: second.token,
      body: JSON.stringify({ ...payload, title: "试图修改别人的菜谱" }),
    });
    assert.equal(forbidden.response.status, 404);

    db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'admin'").run();
    const adminLogin = await api("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier: "admin", password: "AdminPassword1234" }),
    });
    assert.equal(adminLogin.response.status, 200);
    const adminToken = (adminLogin.body as JsonObject).token;

    const approved = await api(`/api/v1/admin/recipes/${recipeId}/approve`, {
      method: "POST",
      token: adminToken,
    });
    assert.equal(approved.response.status, 200);

    const visible = await api(`/api/v1/recipes/${recipeId}`);
    assert.equal(visible.response.status, 200);
  });

  test("AI transcription requires authentication and validates MIME type before external calls", async () => {
    const anonymous = await api("/api/v1/ai/transcribe", {
      method: "POST",
      body: JSON.stringify({ audioBase64: "AAAA", mimeType: "audio/m4a" }),
    });
    assert.equal(anonymous.response.status, 401);

    const invalidMime = await api("/api/v1/ai/transcribe", {
      method: "POST",
      token: first.token,
      body: JSON.stringify({ audioBase64: "AAAA", mimeType: "application/octet-stream" }),
    });
    assert.equal(invalidMime.response.status, 400);
    assert.equal((invalidMime.body as JsonObject).code, "VALIDATION_ERROR");
  });

  test("account deletion requires the password and cascades private data", async () => {
    const account = await register("delete-me@example.com");
    await api("/api/v1/inventory", {
      method: "POST",
      token: account.token,
      body: JSON.stringify({
        food_name: "待删除食材",
        category: "蔬菜",
        quantity: "1份",
        expiration_date: "2026-08-09",
        storage_location: "冷藏",
      }),
    });

    const wrongPassword = await api("/api/v1/auth/account", {
      method: "DELETE",
      token: account.token,
      body: JSON.stringify({ password: "WrongPassword123", confirmation: "DELETE" }),
    });
    assert.equal(wrongPassword.response.status, 400);

    const removed = await api("/api/v1/auth/account", {
      method: "DELETE",
      token: account.token,
      body: JSON.stringify({ password: "Password1234", confirmation: "DELETE" }),
    });
    assert.equal(removed.response.status, 200);
    const remainingUser = db.prepare("SELECT COUNT(*) AS count FROM users WHERE id = ?").get(account.user.id) as { count: number };
    const remainingInventory = db.prepare("SELECT COUNT(*) AS count FROM inventory_items WHERE user_id = ?").get(account.user.id) as { count: number };
    assert.equal(remainingUser.count, 0);
    assert.equal(remainingInventory.count, 0);
  });
});
