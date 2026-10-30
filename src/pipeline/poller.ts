/**
 * poller.ts
 * AdapterPoller — owns the fetch loop for SourceAdapters.
 *
 * Responsibilities:
 *  - Runs on its own timer, completely independent of PipelineCoordinator.
 *  - On each tick, calls IngestionService.ingestFromAdapter(adapter).
 *  - If ingestion fails, logs the error and continues — does not crash.
 *  - Adds ±30s jitter to the polling interval to avoid thundering-herd
 *    patterns if multiple instances or restarts happen simultaneously.
 *  - Supports graceful start/stop.
 *
 * Why separate from PipelineCoordinator?
 *  - Fetching from the internet (network I/O) is conceptually different from
 *    evaluating what's already in the database (CPU-bound + DB I/O).
 *  - If the network fetch fails, message evaluation still runs uninterrupted.
 *  - In the future, different adapters could have different polling intervals.
 */

import type { Db } from '../database/client.js';
import { IngestionService } from './ingestion.js';
import type { SourceAdapter } from '../sources/types.js';
import { logger } from '../observability/logger.js';

export interface AdapterPollerOptions {
  /** Polling interval in milliseconds. Default: 900_000 (15 minutes). */
  intervalMs?: number;
  /** Jitter range in milliseconds (±). Default: 30_000 (30 seconds). */
  jitterMs?: number;
}

export class AdapterPoller {
  private readonly ingestionService: IngestionService;
  private readonly intervalMs: number;
  private readonly jitterMs: number;

  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly adapters: SourceAdapter[],
    opts?: AdapterPollerOptions,
  ) {
    this.ingestionService = new IngestionService(db);
    this.intervalMs = opts?.intervalMs ?? 900_000;
    this.jitterMs = opts?.jitterMs ?? 30_000;
  }

  /**
   * Start the polling loop.
   * Runs the first poll immediately on start, then schedules subsequent polls.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info(
      {
        adapters: this.adapters.map((a) => a.sourceId),
        intervalMs: this.intervalMs,
        jitterMs: this.jitterMs,
      },
      'AdapterPoller: starting',
    );

    // Run immediately, then schedule recurring polls.
    this.runPoll().catch((err) => {
      logger.error({ err }, 'AdapterPoller: error during initial poll');
    });

    this.scheduleNext();
  }

  /**
   * Stop the polling loop gracefully.
   * In-flight polls are allowed to finish.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('AdapterPoller: stopped');
  }

  /**
   * Schedule the next poll with jitter applied.
   */
  private scheduleNext(): void {
    if (!this.isRunning) return;

    // Apply ±jitter so repeated restarts don't always land on the same second.
    const jitter = Math.floor((Math.random() * 2 - 1) * this.jitterMs);
    const delay = Math.max(this.intervalMs + jitter, 60_000); // never shorter than 1 min

    logger.debug(
      { nextPollMs: delay },
      'AdapterPoller: next poll scheduled',
    );

    this.timer = setTimeout(async () => {
      try {
        await this.runPoll();
      } catch (err) {
        logger.error({ err }, 'AdapterPoller: unhandled error in poll cycle');
      } finally {
        this.scheduleNext();
      }
    }, delay);
  }

  /**
   * Run one complete ingestion cycle across all registered adapters.
   */
  private async runPoll(): Promise<void> {
    if (!this.isRunning) return;

    logger.info(
      { adapters: this.adapters.map((a) => a.sourceId) },
      'AdapterPoller: poll cycle started',
    );

    for (const adapter of this.adapters) {
      try {
        const result = await this.ingestionService.ingestFromAdapter(adapter);
        logger.info(
          {
            sourceId: result.sourceId,
            totalFetched: result.totalFetched,
            inserted: result.insertedCount,
            duplicates: result.duplicateCount,
            errors: result.errorCount,
          },
          'AdapterPoller: ingestion complete for adapter',
        );
      } catch (err) {
        // Never let one adapter's failure prevent others from running.
        logger.error(
          { sourceId: adapter.sourceId, err },
          'AdapterPoller: adapter ingestion threw unexpectedly',
        );
      }
    }

    logger.info('AdapterPoller: poll cycle complete');
  }
}

