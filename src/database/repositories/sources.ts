import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { sources } from '../schema.js';

export type NewSource = typeof sources.$inferInsert;
export type Source = typeof sources.$inferSelect;

export function createSourcesRepo(db: Db) {
  return {
    findById(id: string): Source | undefined {
      return db.select().from(sources).where(eq(sources.id, id)).get();
    },

    findAll(): Source[] {
      return db.select().from(sources).all();
    },

    findEnabled(): Source[] {
      return db.select().from(sources).where(eq(sources.enabled, 1)).all();
    },

    upsert(data: NewSource): Source {
      return db
        .insert(sources)
        .values(data)
        .onConflictDoUpdate({
          target: sources.id,
          set: {
            displayName: data.displayName,
            enabled: data.enabled,
            ingestionMethod: data.ingestionMethod,
          },
        })
        .returning()
        .get();
    },

    markSuccess(id: string, at: Date): void {
      db.update(sources)
        .set({ lastSuccessAt: at.toISOString() })
        .where(eq(sources.id, id))
        .run();
    },

    markError(id: string, at: Date, message: string): void {
      db.update(sources)
        .set({
          lastErrorAt: at.toISOString(),
          lastErrorMsg: message,
        })
        .where(eq(sources.id, id))
        .run();
    },

    setEnabled(id: string, enabled: boolean): void {
      db.update(sources)
        .set({ enabled: enabled ? 1 : 0 })
        .where(eq(sources.id, id))
        .run();
    },
  };
}

export type SourcesRepo = ReturnType<typeof createSourcesRepo>;
