import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const command = process.argv[2];
const sourcePath = path.resolve(process.env.DATABASE_PATH || path.join(process.cwd(), "data/dietdigidose.db"));
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

if (command === "backup") {
  const destination = path.resolve(process.argv[3] || path.join(process.cwd(), `backups/dietdigidose-${timestamp}.db`));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
    console.log(`Backup created: ${destination}`);
  } finally {
    source.close();
  }
} else if (command === "restore") {
  const backupPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
  if (!backupPath || !fs.existsSync(backupPath) || process.argv[4] !== "--force") {
    throw new Error("Usage: pnpm db:restore <backup.db> --force (stop the server first)");
  }
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  if (fs.existsSync(sourcePath)) {
    const safetyCopy = `${sourcePath}.before-restore-${timestamp}`;
    fs.copyFileSync(sourcePath, safetyCopy);
    console.log(`Current database preserved: ${safetyCopy}`);
  }
  fs.copyFileSync(backupPath, sourcePath);
  console.log(`Database restored: ${sourcePath}`);
} else {
  throw new Error("Usage: pnpm db:backup [destination.db] | pnpm db:restore <backup.db> --force");
}
