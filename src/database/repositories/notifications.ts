import { eq, and } from 'drizzle-orm';
import type { Db } from '../client.js';
import { notifications } from '../schema.js';

export type NewNotification = typeof notifications.$inferInsert;
export type Notification = typeof notifications.$inferSelect;

export type NotificationStatus =
  | 'queued'
  | 'sending'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export function createNotificationsRepo(db: Db) {
  return {
    queue(evaluationId: number): Notification {
      const now = new Date().toISOString();
      return db
        .insert(notifications)
        .values({
          evaluationId,
          status: 'queued',
          attemptCount: 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    findById(id: number): Notification | undefined {
      return db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .get();
    },

    getPending(): Notification[] {
      return db
        .select()
        .from(notifications)
        .where(and(eq(notifications.status, 'queued')))
        .all();
    },

    updateStatus(
      id: number,
      status: NotificationStatus,
      opts?: {
        telegramMessageId?: number;
        lastError?: string;
        nextRetryAt?: string;
      },
    ): void {
      const now = new Date().toISOString();
      db.update(notifications)
        .set({
          status,
          updatedAt: now,
          ...(opts?.telegramMessageId !== undefined && {
            telegramMessageId: opts.telegramMessageId,
          }),
          ...(opts?.lastError !== undefined && { lastError: opts.lastError }),
          ...(opts?.nextRetryAt !== undefined && {
            nextRetryAt: opts.nextRetryAt,
          }),
        })
        .where(eq(notifications.id, id))
        .run();
    },

    incrementAttempt(id: number): void {
      const current = db
        .select()
        .from(notifications)
        .where(eq(notifications.id, id))
        .get();

      if (current == null) return;

      db.update(notifications)
        .set({
          attemptCount: current.attemptCount + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(notifications.id, id))
        .run();
    },

    findByEvaluationId(evaluationId: number): Notification | undefined {
      return db
        .select()
        .from(notifications)
        .where(eq(notifications.evaluationId, evaluationId))
        .get();
    },
  };
}

export type NotificationsRepo = ReturnType<typeof createNotificationsRepo>;
