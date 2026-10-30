/**
 * ingestion.ts
 * Ingestion pipeline: extracts messages from adapters, deduplicates,
 * records jobs, updates checkpoints, and persists to SQLite idempotently.
 */

import type { Db } from '../database/client.js';
import {
  createMessagesRepo,
  computeTextHash,
  type SourceMessage,
} from '../database/repositories/messages.js';
import { createSourcesRepo } from '../database/repositories/sources.js';
import { createJobsRepo, type Job } from '../database/repositories/jobs.js';
import { createAppStateRepo } from '../database/repositories/app-state.js';
import type { RawMessage, SourceAdapter } from '../sources/types.js';
import { logger } from '../observability/logger.js';

export interface IngestResult {
  inserted: boolean;
  message?: SourceMessage;
  job?: Job;
  isDuplicate: boolean;
  duplicateOfJobId?: number;
  reason?: 'duplicate_external_id' | 'error';
  error?: string;
}

export interface IngestBatchResult {
  sourceId: string;
  totalFetched: number;
  insertedCount: number;
  duplicateCount: number;
  errorCount: number;
}

export class IngestionService {
  private messagesRepo: ReturnType<typeof createMessagesRepo>;
  private sourcesRepo: ReturnType<typeof createSourcesRepo>;
  private jobsRepo: ReturnType<typeof createJobsRepo>;
  private appStateRepo: ReturnType<typeof createAppStateRepo>;

  constructor(private db: Db) {
    this.messagesRepo = createMessagesRepo(db);
    this.sourcesRepo = createSourcesRepo(db);
    this.jobsRepo = createJobsRepo(db);
    this.appStateRepo = createAppStateRepo(db);
  }

  /**
   * Ingest a single raw message idempotently.
   */
  async ingestMessage(raw: RawMessage): Promise<IngestResult> {
    try {
      // 1. Ensure source exists
      const existingSource = this.sourcesRepo.findById(raw.sourceId);
      if (!existingSource) {
        this.sourcesRepo.upsert({
          id: raw.sourceId,
          displayName: raw.sourceId,
          enabled: 1,
          ingestionMethod: 'manual',
          createdAt: new Date().toISOString(),
        });
      }

      const textHash = computeTextHash(raw.text);
      const nowIso = new Date().toISOString();

      // 2. Insert into source_messages (unique constraint on sourceId + externalId)
      const inserted = this.messagesRepo.insertIfNew({
        sourceId: raw.sourceId,
        externalId: raw.externalId,
        postedAt: raw.postedAt ? raw.postedAt.toISOString() : null,
        fetchedAt: raw.fetchedAt.toISOString(),
        originalText: raw.text,
        links: JSON.stringify(raw.links),
        hasMedia: raw.hasMedia ? 1 : 0,
        textHash,
        processingStatus: 'pending',
        processingError: null,
        createdAt: nowIso,
      });

      if (!inserted) {
        // Message was already ingested previously
        return {
          inserted: false,
          isDuplicate: true,
          reason: 'duplicate_external_id',
        };
      }

      // 3. Deduplication check via textHash
      const existingWithSameHash = this.messagesRepo
        .findByHash(textHash)
        .filter((m) => m.id !== inserted.id);

      let duplicateOfJobId: number | null = null;
      let isDuplicateCertain = false;

      if (existingWithSameHash.length > 0) {
        // Find existing job for any previous message with same hash
        for (const prevMsg of existingWithSameHash) {
          const prevJob = this.jobsRepo.findByMessageId(prevMsg.id);
          if (prevJob) {
            duplicateOfJobId = prevJob.duplicateOfJobId ?? prevJob.id;
            isDuplicateCertain = true;
            break;
          }
        }
      }

      // 4. Create Job record
      const job = this.jobsRepo.insert(
        inserted.id,
        duplicateOfJobId,
        isDuplicateCertain,
      );

      // 5. Update source last success and checkpoint
      this.sourcesRepo.markSuccess(raw.sourceId, new Date());
      this.appStateRepo.set(`checkpoint:${raw.sourceId}`, raw.externalId);

      return {
        inserted: true,
        message: inserted,
        job,
        isDuplicate: isDuplicateCertain,
        ...(duplicateOfJobId ? { duplicateOfJobId } : {}),
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { sourceId: raw.sourceId, externalId: raw.externalId, err },
        'Failed to ingest message',
      );
      this.sourcesRepo.markError(raw.sourceId, new Date(), errMsg);
      return {
        inserted: false,
        isDuplicate: false,
        reason: 'error',
        error: errMsg,
      };
    }
  }

  /**
   * Consume an adapter and ingest all available messages.
   */
  async ingestFromAdapter(adapter: SourceAdapter): Promise<IngestBatchResult> {
    const result: IngestBatchResult = {
      sourceId: adapter.sourceId,
      totalFetched: 0,
      insertedCount: 0,
      duplicateCount: 0,
      errorCount: 0,
    };

    try {
      for await (const raw of adapter.fetchNew()) {
        result.totalFetched++;
        const res = await this.ingestMessage(raw);
        if (res.inserted) {
          result.insertedCount++;
        } else if (res.reason === 'duplicate_external_id' || res.isDuplicate) {
          result.duplicateCount++;
        } else if (res.reason === 'error') {
          result.errorCount++;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ sourceId: adapter.sourceId, err }, 'Batch ingestion failed');
      this.sourcesRepo.markError(adapter.sourceId, new Date(), errMsg);
    }

    return result;
  }
}

