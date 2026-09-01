import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const moduleSpecs = [
  {
    name: "accessControl",
    routeFile: null,
    concreteRepository: /sqliteRepository|SqliteAccessControlRepository/,
    compositionFile: "server/src/middleware/auth.ts",
    compositionImport: "../modules/accessControl/index.js",
    legacyFile: null,
    extraLegacyFiles: ["server/src/services/sessionTokens.ts"],
  },
  {
    name: "authAccount",
    concreteRepository: /sqliteRepository|SqliteAuthAccountRepository/,
    compositionFile: "server/src/routes/auth.ts",
    compositionImport: "../modules/authAccount/index.js",
    legacyFile: null,
  },
  {
    name: "community",
    concreteRepository: /sqliteRepository|SqliteCommunityRepository/,
    compositionFile: "server/src/routes/community.ts",
    compositionImport: "../modules/community/index.js",
    legacyFile: null,
  },
  {
    name: "cookingQueue",
    concreteRepository: /sqliteRepository|SqliteCookingQueueRepository/,
    legacyFile: "server/src/routes/cooking-queue.ts",
  },
  {
    name: "dietRecords",
    concreteRepository: /sqliteRepository|SqliteDietRecordsRepository/,
    legacyFile: "server/src/routes/diet-records.ts",
  },
  { name: "inventory", concreteRepository: /sqliteRepository|SqliteInventoryRepository/ },
  {
    name: "voicePacks",
    concreteRepository: /sqliteRepository|SqliteVoicePacksRepository/,
    legacyFile: "server/src/routes/voice-packs.ts",
    extraLegacyFiles: ["server/src/routes/admin/voice-packs.ts", "server/src/services/voicePacks.ts"],
  },
  {
    name: "kitchenware",
    concreteRepository: /sqliteRepository|SqliteKitchenwareRepository/,
    legacyFile: "server/src/routes/kitchenware.ts",
  },
  {
    name: "recommendations",
    concreteRepository: /sqliteRepository|SqliteRecommendationsRepository/,
    legacyFile: "server/src/routes/recommendations.ts",
  },
  {
    name: "recipes",
    concreteRepository: /sqliteRepository|SqliteRecipesRepository/,
    legacyFile: "server/src/routes/recipes.ts",
  },
  {
    name: "adminRecipes",
    concreteRepository: /sqliteRepository|SqliteAdminRecipesRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminRecipes/index.js",
    legacyFile: "server/src/routes/admin/recipes.ts",
  },
  {
    name: "adminKitchenware",
    concreteRepository: /sqliteRepository|SqliteAdminKitchenwareRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminKitchenware/index.js",
  },
  {
    name: "adminFoodAssets",
    concreteRepository: /sqliteRepository|SqliteAdminFoodAssetsRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminFoodAssets/index.js",
    legacyFile: "server/src/routes/admin/assets.ts",
  },
  {
    name: "adminConsole",
    concreteRepository: /sqliteRepository|SqliteAdminConsoleRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminConsole/index.js",
  },
  {
    name: "adminCommunity",
    concreteRepository: /sqliteRepository|SqliteAdminCommunityRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminCommunity/index.js",
    legacyFile: "server/src/routes/admin/community.ts",
  },
  {
    name: "adminUsers",
    concreteRepository: /sqliteRepository|SqliteAdminUsersRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/adminUsers/index.js",
    legacyFile: "server/src/routes/admin/users.ts",
    extraLegacyFiles: ["server/src/routes/admin/user-level-rule.ts", "server/src/services/userLevel.ts"],
  },
  {
    name: "mealPlans",
    concreteRepository: /sqliteRepository|SqliteMealPlansRepository/,
    legacyFile: "server/src/routes/meal-plans.ts",
  },
  {
    name: "households",
    concreteRepository: /sqliteRepository|SqliteHouseholdsRepository/,
    compositionFile: "server/src/routes/households.ts",
    compositionImport: "../modules/households/index.js",
    legacyFile: null,
  },
  {
    name: "insights",
    concreteRepository: /sqliteRepository|SqliteInsightsRepository/,
    legacyFile: "server/src/routes/insights.ts",
  },
  { name: "feedback", concreteRepository: /sqliteRepository|SqliteFeedbackRepository/ },
  { name: "foods", concreteRepository: /sqliteRepository|SqliteFoodRepository/ },
  {
    name: "health",
    concreteRepository: /sqliteRepository|SqliteHealthRepository/,
    legacyFile: "server/src/routes/health-data.ts",
  },
  {
    name: "shopping",
    concreteRepository: /sqliteRepository|SqliteShoppingRepository/,
    legacyFile: "server/src/routes/shopping-list.ts",
  },
  {
    name: "worker",
    concreteRepository: /sqliteRepository|SqliteWorkerRepository/,
    compositionFile: "server/src/routes/admin.ts",
    compositionImport: "../modules/worker/index.js",
    legacyFile: "server/src/routes/admin/worker-runs.ts",
  },
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function read(moduleName, fileName) {
  return fs.readFileSync(path.join(root, "server", "src", "modules", moduleName, fileName), "utf8");
}

function reject(moduleName, fileName, patterns) {
  const source = read(moduleName, fileName);
  for (const [label, pattern] of patterns) {
    if (pattern.test(source)) failures.push(`${moduleName}/${fileName} must not depend on ${label}`);
  }
}

const persistencePatterns = [
  ["the SQLite driver", /better-sqlite3/],
  ["the database singleton", /storage\/db|\bdb\s*\./],
  ["raw SQL execution", /\.prepare\s*\(|\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|SET)/i],
];

for (const spec of moduleSpecs) {
  if (spec.routeFile !== null) {
    reject(spec.name, spec.routeFile || "route.ts", [
      ...persistencePatterns,
      ["a concrete repository", spec.concreteRepository],
    ]);
  }
  reject(spec.name, "service.ts", [
    ...persistencePatterns,
    ["a concrete repository", spec.concreteRepository],
  ]);
  reject(spec.name, "repository.ts", persistencePatterns);
  const compositionFile = spec.compositionFile || "server/src/app.ts";
  const compositionImport = spec.compositionImport || `./modules/${spec.name}/index.js`;
  const compositionSource = fs.readFileSync(path.join(root, compositionFile), "utf8");
  if (!compositionSource.includes(compositionImport)) {
    failures.push(`${compositionFile} must compose the ${spec.name} module entry point`);
  }
  const legacyFile = Object.hasOwn(spec, "legacyFile") ? spec.legacyFile : `server/src/routes/${spec.name}.ts`;
  if (legacyFile && fs.existsSync(path.join(root, legacyFile))) {
    failures.push(`legacy ${spec.name} route must stay removed`);
  }
  for (const extraLegacyFile of spec.extraLegacyFiles || []) {
    if (fs.existsSync(path.join(root, extraLegacyFile))) failures.push(`legacy ${extraLegacyFile} must stay removed`);
  }
}

const businessRoots = ["routes", "services", "modules"].map((name) => path.join(root, "server", "src", name));
const concreteCloudSdk = /from\s+["'](?:@supabase\/supabase-js|@alicloud\/[^"']+)["']/;
for (const file of businessRoots.flatMap(walk).filter((name) => name.endsWith(".ts"))) {
  if (concreteCloudSdk.test(fs.readFileSync(file, "utf8"))) {
    failures.push(`${path.relative(root, file)} must depend on a provider interface, not a cloud SDK`);
  }
}

if (failures.length) {
  console.error(`Module boundary violations:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Module boundaries are valid (domain layers and provider SDK isolation).");
}
