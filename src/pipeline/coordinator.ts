/**
 * coordinator.ts
 * End-to-end pipeline coordinator:
 * - Recovers abandoned processing state after crashes or restarts.
 * - Processes pending ingested messages against active profile.
 * - Suppresses duplicate notifications for reposted jobs.
 * - Orchestrates delivery queue.
 * - Supports graceful startup and shutdown.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import { sourceMessages, notifications } from '../database/schema.js';
import { createMessagesRepo, type SourceMessage } from '../database/repositories/messages.js';
import { createProfileRepo } from '../database/repositories/profile.js';
import { createEvaluationsRepo } from '../database/repositories/evaluations.js';
import { createNotificationsRepo } from '../database/repositories/notifications.js';
import { createJobsRepo } from '../database/repositories/jobs.js';
import { createAppStateRepo } from '../database/repositories/app-state.js';
import { NotificationDeliveryService } from '../notifications/delivery.js';
import { evaluate, profileFromDb } from '../matching/engine.js';
import { cleanupOldData } from './retention.js';
import { logger } from '../observability/logger.js';

export interface CoordinatorOptions {
  pollingIntervalMs?: number;
  retentionDays?: number;
}

export class PipelineCoordinator {
  private messagesRepo: ReturnType<typeof createMessagesRepo>;
  private profileRepo: ReturnType<typeof createProfileRepo>;
  private evaluationsRepo: ReturnType<typeof createEvaluationsRepo>;
  private notificationsRepo: ReturnType<typeof createNotificationsRepo>;
  private jobsRepo: ReturnType<typeof createJobsRepo>;
  private appStateRepo: ReturnType<typeof createAppStateRepo>;

  private isRunning = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private pollingIntervalMs: number;
  private retentionDays: number;

  constructor(
    private db: Db,
    private deliveryService?: NotificationDeliveryService,
    opts?: CoordinatorOptions,
  ) {
    this.messagesRepo = createMessagesRepo(db);
    this.profileRepo = createProfileRepo(db);
    this.evaluationsRepo = createEvaluationsRepo(db);
    this.notificationsRepo = createNotificationsRepo(db);
    this.jobsRepo = createJobsRepo(db);
    this.appStateRepo = createAppStateRepo(db);

    this.pollingIntervalMs = opts?.pollingIntervalMs ?? 5000;
    this.retentionDays = opts?.retentionDays ?? 90;
  }

  /**
   * Resets abandoned processing leases / states after a crash or restart.
   */
  recoverUnfinishedWork(): { recoveredMessages: number; recoveredNotifications: number } {
    logger.info('Checking for abandoned processing work to recover...');

    // 1. Reset messages stuck in 'processing' back to 'pending'
    const stuckMessages = this.db
      .update(sourceMessages)
      .set({ processingStatus: 'pending' })
      .where(eq(sourceMessages.processingStatus, 'processing'))
      .run();

    // 2. Reset notifications stuck in 'sending' back to 'queued'
    const stuckNotifications = this.db
      .update(notifications)
      .set({ status: 'queued' })
      .where(eq(notifications.status, 'sending'))
      .run();

    logger.info(
      {
        recoveredMessages: stuckMessages.changes,
        recoveredNotifications: stuckNotifications.changes,
      },
      'Crash recovery check finished',
    );

    return {
      recoveredMessages: stuckMessages.changes,
      recoveredNotifications: stuckNotifications.changes,
    };
  }

  /**
   * Evaluates all pending messages against the active profile.
   */
  async processPendingMessages(): Promise<{
    processed: number;
    matches: number;
    skipped: number;
    excluded: number;
    notificationsQueued: number;
  }> {
    const isPaused = this.appStateRepo.get('paused') === 'true';
    if (isPaused) {
      logger.debug('Pipeline is paused, skipping pending message evaluation');
      return { processed: 0, matches: 0, skipped: 0, excluded: 0, notificationsQueued: 0 };
    }

    const activeProfileRow = this.profileRepo.getActive();
    if (!activeProfileRow) {
      logger.warn('No active profile configured, skipping message evaluation');
      return { processed: 0, matches: 0, skipped: 0, excluded: 0, notificationsQueued: 0 };
    }

    const profile = profileFromDb(activeProfileRow);
    const pending = this.messagesRepo.findPending();

    let matches = 0;
    let skipped = 0;
    let excluded = 0;
    let notificationsQueued = 0;

    for (const msg of pending) {
      // Lease message by setting status to 'processing'
      this.messagesRepo.updateStatus(msg.id, 'processing');

      try {
        const evalRes = evaluate(msg.originalText, profile);

        const evalRow = this.evaluationsRepo.insert({
          messageId: msg.id,
          profileVersion: profile.version,
          ruleEngineVersion: evalRes.ruleEngineVersion,
          isJobAnnouncement: evalRes.isJobAnnouncement,
          extractedTitle: evalRes.extracted.title,
          extractedCompany: evalRes.extracted.company,
          extractedLocation: evalRes.extracted.location,
          extractedWorkMode: evalRes.extracted.workMode,
          extractedEmploymentType: evalRes.extracted.employmentType,
          extractedDeadline: evalRes.extracted.deadline,
          extractedApplyMethod: evalRes.extracted.applyMethod,
          matchedSkills: evalRes.matchedSkills,
          matchedRoles: evalRes.matchedRoles,
          missingInfo: evalRes.missingInfo,
          triggeredExclusions: evalRes.triggeredExclusions,
          score: evalRes.score,
          verdict: evalRes.verdict,
          matchReasons: evalRes.matchReasons,
        });

        const finalStatus =
          evalRes.verdict === 'skipped' ? 'skipped' : 'evaluated';
        this.messagesRepo.updateStatus(msg.id, finalStatus);

        if (evalRes.verdict === 'match') {
          matches++;
          // Check if duplicate job already had a notification sent to prevent duplicate alerts
          const shouldNotify = this.shouldNotifyForMessage(msg.id);
          if (shouldNotify) {
            this.notificationsRepo.queue(evalRow.id);
            notificationsQueued++;
          } else {
            logger.info(
              { messageId: msg.id },
              'Suppressing duplicate notification for already alerted job',
            );
          }
        } else if (evalRes.verdict === 'skipped') {
          skipped++;
        } else if (evalRes.verdict === 'excluded') {
          excluded++;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ messageId: msg.id, err }, 'Failed to evaluate message');
        this.messagesRepo.updateStatus(msg.id, 'failed', errMsg);
      }
    }

    return {
      processed: pending.length,
      matches,
      skipped,
      excluded,
      notificationsQueued,
    };
  }

  /**
   * Determine if a notification should be queued, suppressing alerts if
   * a notification for this job or its duplicate primary job was already delivered or queued.
   */
  private shouldNotifyForMessage(messageId: number): boolean {
    const job = this.jobsRepo.findByMessageId(messageId);
    if (!job) return true;

    // Check if this job is a duplicate of an earlier job
    if (job.duplicateOfJobId != null) {
      const primaryJob = this.jobsRepo.findById(job.duplicateOfJobId);
      if (primaryJob) {
        const primaryEval = this.evaluationsRepo.findByMessageId(primaryJob.primaryMessageId);
        if (primaryEval) {
          const existingNotif = this.notificationsRepo.findByEvaluationId(primaryEval.id);
          if (existingNotif && existingNotif.status !== 'cancelled') {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Perform one complete iteration of evaluation + delivery queue.
   */
  async runCycle(): Promise<void> {
    const evalSummary = await this.processPendingMessages();
    if (evalSummary.processed > 0) {
      logger.info(evalSummary, 'Evaluated batch of pending messages');
    }

    if (this.deliveryService) {
      const isPaused = this.appStateRepo.get('paused') === 'true';
      if (!isPaused) {
        await this.deliveryService.processQueue();
      }
    }
  }

  /**
   * Start background orchestration loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Recover any unfinished work from before shutdown
    this.recoverUnfinishedWork();

    // 2. Perform retention cleanup at start
    cleanupOldData(this.db, this.retentionDays);

    logger.info({ intervalMs: this.pollingIntervalMs }, 'Starting pipeline coordinator loop');

    const scheduleNext = () => {
      if (!this.isRunning) return;
      this.loopTimer = setTimeout(async () => {
        try {
          await this.runCycle();
        } catch (err) {
          logger.error({ err }, 'Error in coordinator cycle');
        } finally {
          scheduleNext();
        }
      }, this.pollingIntervalMs);
    };

    scheduleNext();
  }

  /**
   * Stop background loop gracefully.
   */
  stop(): void {
    this.isRunning = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    logger.info('Pipeline coordinator stopped');
  }
}

