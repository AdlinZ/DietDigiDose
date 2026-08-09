import { randomUUID } from "node:crypto";

const baseUrl = String(process.env.STAGING_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("STAGING_BASE_URL is required");
if (!baseUrl.startsWith("https://") && process.env.ALLOW_HTTP !== "1") {
  throw new Error("STAGING_BASE_URL must use HTTPS (set ALLOW_HTTP=1 only for a local drill)");
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const identifier = `staging-smoke-${suffix}@example.invalid`;
const password = `Smoke${randomUUID().replaceAll("-", "").slice(0, 14)}9`;
let token = "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers, signal: AbortSignal.timeout(20_000) });
  const body = await response.json().catch(() => null);
  const durationMs = Math.round(performance.now() - startedAt);
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  return { body, durationMs, status: response.status };
}

const checks = [];
function checked(name, result) {
  checks.push({ name, status: result.status, durationMs: result.durationMs });
  return result.body;
}

try {
  checked("health", await request("/api/v1/health"));
  checked("version", await request("/api/v1/version", { headers: { "x-client-version": "staging-smoke" } }));

  const registered = checked("register", await request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({ identifier, username: "烟测食友", password }),
  }));
  token = registered.token;

  token = "";
  const loggedIn = checked("login", await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password }),
  }));
  token = loggedIn.token;

  const expirationDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const inventory = checked("inventory.create", await request("/api/v1/inventory", {
    method: "POST",
    body: JSON.stringify({
      food_name: "烟测番茄",
      category: "蔬菜",
      quantity: "2个",
      expiration_date: expirationDate,
      storage_location: "冷藏",
    }),
  }));
  const inventoryList = checked("inventory.list", await request("/api/v1/inventory"));
  if (!inventoryList.some((item) => item.id === inventory.id)) throw new Error("created inventory item was not readable");

  const recipes = checked("recipes.list", await request("/api/v1/recipes"));
  if (!Array.isArray(recipes) || recipes.length === 0) throw new Error("no approved recipe is available for the smoke test");
  const recipe = recipes[0];

  checked("cooking.complete", await request("/api/v1/diet-records/cooking-completions", {
    method: "POST",
    body: JSON.stringify({
      idempotency_key: `staging-smoke-${suffix}`,
      recipe_id: recipe.id,
      inventory_item_ids: [inventory.id],
      diet_record: {
        meal_type: "午餐",
        food_name: recipe.title,
        amount: "1份",
        calories: recipe.calories,
        recorded_at: new Date().toISOString().slice(0, 10),
      },
    }),
  }));
  const dietRecords = checked("diet-records.list", await request("/api/v1/diet-records"));
  if (!dietRecords.some((record) => record.food_name === recipe.title)) throw new Error("cooking completion did not create a diet record");

  checked("account.delete", await request("/api/v1/auth/account", {
    method: "DELETE",
    body: JSON.stringify({ password, confirmation: "DELETE" }),
  }));
  token = "";

  console.log(JSON.stringify({ success: true, baseUrl, checks }, null, 2));
} catch (error) {
  if (token) {
    await request("/api/v1/auth/account", { method: "DELETE", body: JSON.stringify({ password, confirmation: "DELETE" }) }).catch(() => undefined);
  }
  console.error(JSON.stringify({ success: false, baseUrl, checks, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
