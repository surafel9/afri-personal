/**
 * CLI entry point for database migrations.
 * Run with: npm run db:migrate
 */
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

const dbPath = process.env['DB_PATH'] ?? 'data/afripersonal.db';

if (dbPath !== ':memory:') {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

runMigrations(sqlite)
  .then(() => {
    sqlite.close();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('[migrate] Fatal:', err);
    process.exit(1);
  });
