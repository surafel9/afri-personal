import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function createDb(dbPath: string): {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: Database.Database;
} {
  // Ensure the parent directory exists (not needed for :memory:)
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better read concurrency
  sqlite.pragma('journal_mode = WAL');
  // Enforce foreign key constraints
  sqlite.pragma('foreign_keys = ON');
  // Recommended for WAL + busy_timeout to avoid SQLITE_BUSY errors
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

/**
 * Returns the singleton database instance, initialised with the given path.
 * Call this once from main.ts (or test setup) before importing repositories.
 */
export function initDb(
  dbPath: string,
): ReturnType<typeof drizzle<typeof schema>> {
  const { db, sqlite } = createDb(dbPath);
  _db = db;
  _sqlite = sqlite;
  return db;
}

/**
 * Returns the singleton db instance. Throws if initDb() was not called first.
 */
export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db === null) {
    throw new Error(
      'Database not initialized. Call initDb(dbPath) before using getDb().',
    );
  }
  return _db;
}

/**
 * Returns the raw better-sqlite3 instance (for migrations and raw SQL).
 */
export function getSqlite(): Database.Database {
  if (_sqlite === null) {
    throw new Error(
      'Database not initialized. Call initDb(dbPath) before using getSqlite().',
    );
  }
  return _sqlite;
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;
