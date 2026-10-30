import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { appState } from '../schema.js';

export type AppStateRow = typeof appState.$inferSelect;

export function createAppStateRepo(db: Db) {
  return {
    get(key: string): string | undefined {
      const row = db.select().from(appState).where(eq(appState.key, key)).get();
      return row?.value;
    },

    set(key: string, value: string): void {
      const now = new Date().toISOString();
      db.insert(appState)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: appState.key,
          set: { value, updatedAt: now },
        })
        .run();
    },

    delete(key: string): void {
      db.delete(appState).where(eq(appState.key, key)).run();
    },
  };
}

export type AppStateRepo = ReturnType<typeof createAppStateRepo>;

