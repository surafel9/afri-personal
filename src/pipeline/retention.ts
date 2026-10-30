/**
 * retention.ts
 * Configurable data retention cleanup for SQLite.
 * Prunes old evaluated messages, evaluations, and notifications.
 */

import { lte, inArray, and, eq } from 'drizzle-orm';
import type { Db } from '../database/client.js';
import {
  sourceMessages,
  evaluations,
  notifications,
  feedback,
  jobs,
} from '../database/schema.js';
import { logger } from '../observability/logger.js';

export interface RetentionCleanupResult {
  prunedMessagesCount: number;
  prunedEvaluationsCount: number;
}

export function cleanupOldData(
  db: Db,
  retentionDays: number,
): RetentionCleanupResult {
  if (retentionDays <= 0) return { prunedMessagesCount: 0, prunedEvaluationsCount: 0 };

  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  logger.info({ cutoff, retentionDays }, 'Starting retention data cleanup');

  // Find old messages that have been fully evaluated or skipped
  const oldMessages = db
    .select({ id: sourceMessages.id })
    .from(sourceMessages)
    .where(
      and(
        lte(sourceMessages.createdAt, cutoff),
        inArray(sourceMessages.processingStatus, ['evaluated', 'skipped', 'failed']),
      ),
    )
    .all();

  if (oldMessages.length === 0) {
    return { prunedMessagesCount: 0, prunedEvaluationsCount: 0 };
  }

  const messageIds = oldMessages.map((m) => m.id);

  // Find evaluations for these messages
  const oldEvals = db
    .select({ id: evaluations.id })
    .from(evaluations)
    .where(inArray(evaluations.messageId, messageIds))
    .all();

  const evalIds = oldEvals.map((e) => e.id);

  if (evalIds.length > 0) {
    // Find notifications
    const oldNotifs = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(inArray(notifications.evaluationId, evalIds))
      .all();

    const notifIds = oldNotifs.map((n) => n.id);

    if (notifIds.length > 0) {
      // 1. Delete feedback
      db.delete(feedback).where(inArray(feedback.notificationId, notifIds)).run();
      // 2. Delete notifications
      db.delete(notifications).where(inArray(notifications.id, notifIds)).run();
    }

    // 3. Delete evaluations
    db.delete(evaluations).where(inArray(evaluations.id, evalIds)).run();
  }

  // 4. Delete jobs referencing these messages
  db.delete(jobs).where(inArray(jobs.primaryMessageId, messageIds)).run();

  // 5. Delete source messages
  const deleteResult = db
    .delete(sourceMessages)
    .where(inArray(sourceMessages.id, messageIds))
    .run();

  logger.info(
    { prunedMessages: deleteResult.changes, prunedEvaluations: evalIds.length },
    'Retention cleanup completed',
  );

  return {
    prunedMessagesCount: deleteResult.changes,
    prunedEvaluationsCount: evalIds.length,
  };
}

