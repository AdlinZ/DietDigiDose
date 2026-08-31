import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const inventoryRoot = path.join(root, "server", "src", "modules", "inventory");
const failures = [];

function read(name) {
  return fs.readFileSync(path.join(inventoryRoot, name), "utf8");
}

function reject(name, patterns) {
  const source = read(name);
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) failures.push(`${name} must not depend on ${label}`);
  }
}

const persistencePatterns = [
  ["the SQLite driver", /better-sqlite3/],
  ["the database singleton", /storage\/db|\bdb\s*\./],
  ["raw SQL execution", /\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET)/i],
];

reject("route.ts", [
  ...persistencePatterns,
  ["a concrete repository", /sqliteRepository|SqliteInventoryRepository/],
]);
reject("service.ts", [
  ...persistencePatterns,
  ["a concrete repository", /sqliteRepository|SqliteInventoryRepository/],
]);
reject("repository.ts", persistencePatterns);

const appSource = fs.readFileSync(path.join(root, "server", "src", "app.ts"), "utf8");
if (!appSource.includes("./modules/inventory/index.js")) failures.push("app.ts must compose the inventory module entry point");
if (fs.existsSync(path.join(root, "server", "src", "routes", "inventory.ts"))) failures.push("legacy inventory route must stay removed");

if (failures.length) {
  console.error(`Module boundary violations:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Inventory module boundaries are valid (route → service → repository).");
}
