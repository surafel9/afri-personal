import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Find migrations dir in local relative path or root project path
const MIGRATIONS_DIR = existsSync(join(__dirname, "migrations"))
  ? join(__dirname, "migrations")
  : join(process.cwd(), "src/database/migrations");

/**
 * Runs all pending SQL migrations in alphabetical order.
 * Tracks applied migrations in a __migrations table.
 */
export async function runMigrations(sqlite: Database.Database): Promise<void> {
  // Create migration tracking table if it doesn't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      appliedAt TEXT NOT NULL
    )
  `);

  // Get list of already applied migrations
  const applied = new Set(
    (
      sqlite
        .prepare("SELECT filename FROM __migrations ORDER BY filename")
        .all() as Array<{ filename: string }>
    ).map((r) => r.filename)
  );

  // Read migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");

    sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare(
          "INSERT INTO __migrations (filename, appliedAt) VALUES (?, ?)"
        )
        .run(file, new Date().toISOString());
    })();

    console.log(`[migrate] Applied: ${file}`);
  }

  console.log("[migrate] All migrations up to date.");
}

