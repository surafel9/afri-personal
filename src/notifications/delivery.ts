/**
 * delivery.ts
 * Reliable Telegram notification delivery service with bounded exponential
 * backoff, rate-limit awareness (429 retry_after), and crash recovery.
 */

import type { Bot } from 'grammy';
import type { Db } from '../database/client.js';
import {
  createNotificationsRepo,
  type Notification,
} from '../database/repositories/notifications.js';
import { createEvaluationsRepo } from '../database/repositories/evaluations.js';
import { createMessagesRepo } from '../database/repositories/messages.js';
import { formatNotification, formatVerbatim } from './formatter.js';
import { logger } from '../observability/logger.js';

export interface TelegramSender {
  sendMessage(
    chatId: number | string,
    text: string,
    other?: { parse_mode?: string; reply_markup?: unknown },
  ): Promise<{ message_id: number }>;
}

export class NotificationDeliveryService {
  private notificationsRepo: ReturnType<typeof createNotificationsRepo>;
  private evaluationsRepo: ReturnType<typeof createEvaluationsRepo>;
  private messagesRepo: ReturnType<typeof createMessagesRepo>;

  constructor(
    private db: Db,
    private sender: TelegramSender,
    private ownerChatId: number,
    private maxRetries = 5,
  ) {
    this.notificationsRepo = createNotificationsRepo(db);
    this.evaluationsRepo = createEvaluationsRepo(db);
    this.messagesRepo = createMessagesRepo(db);
  }

  /**
   * Process all pending or due-for-retry notifications.
   */
  async processQueue(): Promise<{ delivered: number; failed: number; delayed: number }> {
    const pending = this.notificationsRepo.getPending();
    const now = new Date();
    let delivered = 0;
    let failed = 0;
    let delayed = 0;

    for (const notif of pending) {
      // Check if nextRetryAt is in future
      if (notif.nextRetryAt && new Date(notif.nextRetryAt) > now) {
        delayed++;
        continue;
      }

      const outcome = await this.deliverOne(notif);
      if (outcome === 'delivered') delivered++;
      else if (outcome === 'failed') failed++;
      else if (outcome === 'delayed') delayed++;
    }

    return { delivered, failed, delayed };
  }

  /**
   * Deliver a single notification.
   */
  async deliverOne(notif: Notification): Promise<'delivered' | 'failed' | 'delayed'> {
    const evaluation = this.evaluationsRepo.findById(notif.evaluationId);
    if (!evaluation) {
      logger.error({ notificationId: notif.id }, 'Evaluation not found for notification');
      this.notificationsRepo.updateStatus(notif.id, 'failed', {
        lastError: 'Evaluation record not found',
      });
      return 'failed';
    }

    const sourceMsg = this.messagesRepo.findById(evaluation.messageId);

    // Choose delivery format based on source:
    //  - telegram-web adapter → verbatim (exact post text + link, per roadmap)
    //  - manual / fixture → structured card with match details
    const isWebAdapter = sourceMsg?.sourceId?.startsWith('telegram-web:') ?? false;

    const { text, keyboard } = isWebAdapter
      ? formatVerbatim(
          sourceMsg?.originalText ?? '',
          sourceMsg?.links ? (JSON.parse(sourceMsg.links) as string[]) : [],
          notif.id,
        )
      : formatNotification(evaluation, notif.id, sourceMsg);

    this.notificationsRepo.updateStatus(notif.id, 'sending');
    this.notificationsRepo.incrementAttempt(notif.id);

    try {
      const sent = await this.sender.sendMessage(this.ownerChatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });

      this.notificationsRepo.updateStatus(notif.id, 'delivered', {
        telegramMessageId: sent.message_id,
      });

      logger.info(
        { notificationId: notif.id, telegramMessageId: sent.message_id },
        'Notification delivered successfully',
      );
      return 'delivered';
    } catch (err: unknown) {
      return this.handleDeliveryError(notif, err);
    }
  }

  private handleDeliveryError(
    notif: Notification,
    err: unknown,
  ): 'failed' | 'delayed' {
    const currentAttempt = notif.attemptCount + 1;
    let retryAfterSeconds: number | null = null;
    let isPermanent = false;
    let errorMessage = 'Unknown delivery error';

    if (err && typeof err === 'object') {
      const tgErr = err as {
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      };
      errorMessage = tgErr.description ?? String(err);

      // Check 429 rate limit
      if (tgErr.error_code === 429 && tgErr.parameters?.retry_after) {
        retryAfterSeconds = tgErr.parameters.retry_after;
      }

      // Check permanent errors (e.g. 400 Bad Request, 403 Forbidden / bot blocked)
      if (tgErr.error_code === 400 || tgErr.error_code === 403) {
        isPermanent = true;
      }
    } else {
      errorMessage = String(err);
    }

    if (isPermanent || currentAttempt >= this.maxRetries) {
      logger.error(
        { notificationId: notif.id, attempt: currentAttempt, err },
        'Notification failed permanently',
      );
      this.notificationsRepo.updateStatus(notif.id, 'failed', {
        lastError: errorMessage,
      });
      return 'failed';
    }

    // Calculate delay: either Telegram's retry_after or exponential backoff with jitter
    const delaySeconds =
      retryAfterSeconds ??
      Math.min(2 ** currentAttempt * 2 + Math.random(), 300);

    const nextRetry = new Date(Date.now() + delaySeconds * 1000).toISOString();

    logger.warn(
      { notificationId: notif.id, attempt: currentAttempt, delaySeconds, err },
      'Transient delivery failure, queued for retry',
    );

    this.notificationsRepo.updateStatus(notif.id, 'queued', {
      lastError: errorMessage,
      nextRetryAt: nextRetry,
    });

    return 'delayed';
  }
}

