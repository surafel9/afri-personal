import { createHash } from 'node:crypto';
import { eq, and, inArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import { sourceMessages } from '../schema.js';

export type NewSourceMessage = typeof sourceMessages.$inferInsert;
export type SourceMessage = typeof sourceMessages.$inferSelect;

export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'evaluated'
  | 'failed'
  | 'skipped';

/**
 * Normalize text for hashing: lowercase, collapse whitespace.
 * This makes near-duplicate detection insensitive to minor formatting changes.
 */
export function normalizeTextForHash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute a SHA-256 hash of the normalized text.
 */
export function computeTextHash(text: string): string {
  return createHash('sha256').update(normalizeTextForHash(text)).digest('hex');
}

export function createMessagesRepo(db: Db) {
  return {
    /**
     * Insert a message. Returns null if the (sourceId, externalId) pair already exists.
     * Returns the inserted row on success.
     */
    insertIfNew(data: NewSourceMessage): SourceMessage | null {
      // Check for existing by externalId + sourceId first
      const existing = db
        .select()
        .from(sourceMessages)
        .where(
          and(
            eq(sourceMessages.sourceId, data.sourceId),
            eq(sourceMessages.externalId, data.externalId),
          ),
        )
        .get();

      if (existing != null) {
        return null;
      }

      return db.insert(sourceMessages).values(data).returning().get();
    },

    findById(id: number): SourceMessage | undefined {
      return db
        .select()
        .from(sourceMessages)
        .where(eq(sourceMessages.id, id))
        .get();
    },

    findBySourceAndExternalId(sourceId: string, externalId: string): SourceMessage | undefined {
      return db
        .select()
        .from(sourceMessages)
        .where(
          and(
            eq(sourceMessages.sourceId, sourceId),
            eq(sourceMessages.externalId, externalId),
          ),
        )
        .get();
    },

    findByHash(hash: string): SourceMessage[] {
      return db
        .select()
        .from(sourceMessages)
        .where(eq(sourceMessages.textHash, hash))
        .all();
    },

    findPending(): SourceMessage[] {
      return db
        .select()
        .from(sourceMessages)
        .where(eq(sourceMessages.processingStatus, 'pending'))
        .all();
    },

    updateStatus(id: number, status: ProcessingStatus, error?: string): void {
      db.update(sourceMessages)
        .set({
          processingStatus: status,
          processingError: error ?? null,
        })
        .where(eq(sourceMessages.id, id))
        .run();
    },

    countByStatus(status: ProcessingStatus): number {
      const result = db
        .select()
        .from(sourceMessages)
        .where(eq(sourceMessages.processingStatus, status))
        .all();
      return result.length;
    },
  };
}

export type MessagesRepo = ReturnType<typeof createMessagesRepo>;
