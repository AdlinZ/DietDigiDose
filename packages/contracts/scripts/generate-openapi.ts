import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInventoryOpenApiDocument } from "../src/openapi.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "openapi/inventory.v1.json");
const generated = `${JSON.stringify(createInventoryOpenApiDocument(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  const committed = await readFile(outputPath, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error("Inventory OpenAPI artifact is stale. Run: pnpm --dir packages/contracts openapi:generate");
    process.exitCode = 1;
  } else {
    console.log("Inventory OpenAPI artifact is up to date.");
  }
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log(`Generated ${outputPath}`);
}
