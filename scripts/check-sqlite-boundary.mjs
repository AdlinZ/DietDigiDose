import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "server", "src");
const baselinePath = path.join(root, "scripts", "sqlite-boundary-baseline.json");
const update = process.argv.includes("--update");
const patterns = [
  /\bdb\.(?:prepare|exec|transaction|pragma)\s*\(/g,
  /\b(?:database|this\.database)\.(?:prepare|exec|transaction|pragma)\s*\(/g,
  /from\s+["'][^"']*storage\/db\.js["']/g,
  /from\s+["']better-sqlite3["']/g,
];

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  });
}

const counts = Object.fromEntries(filesBelow(sourceRoot)
  .filter((filePath) => filePath.endsWith(".ts"))
  .map((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    const count = patterns.reduce((total, pattern) => total + [...source.matchAll(pattern)].length, 0);
    return [path.relative(root, filePath).split(path.sep).join("/"), count];
  })
  .filter(([, count]) => count > 0)
  .sort(([left], [right]) => left.localeCompare(right)));

const payload = `${JSON.stringify({
  policy: "Existing SQLite access is frozen. Counts may only decrease or move behind repository adapters during PostgreSQL migration.",
  files: counts,
}, null, 2)}\n`;

if (update) {
  fs.writeFileSync(baselinePath, payload);
  console.log(`Updated SQLite boundary baseline (${Object.keys(counts).length} files).`);
} else {
  const current = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, "utf8") : "";
  if (current !== payload) {
    console.error("SQLite boundary changed. New direct access is forbidden; if access was removed, run pnpm -w database:boundary:update and commit the smaller baseline.");
    process.exitCode = 1;
  } else {
    console.log(`SQLite boundary is frozen at ${Object.keys(counts).length} legacy/infrastructure files.`);
  }
}
