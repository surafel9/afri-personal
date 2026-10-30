import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../database/client.js';
import { runMigrations } from '../../database/migrate.js';
import { NotificationDeliveryService, type TelegramSender } from '../delivery.js';
import { createNotificationsRepo } from '../../database/repositories/notifications.js';
import { createEvaluationsRepo } from '../../database/repositories/evaluations.js';
import { createMessagesRepo } from '../../database/repositories/messages.js';
import { createSourcesRepo } from '../../database/repositories/sources.js';
import type { Database } from 'better-sqlite3';
import type { Db } from '../../database/client.js';

describe('NotificationDeliveryService', () => {
  let sqlite: Database;
  let db: Db;
  let notificationsRepo: ReturnType<typeof createNotificationsRepo>;
  let evaluationsRepo: ReturnType<typeof createEvaluationsRepo>;
  let messagesRepo: ReturnType<typeof createMessagesRepo>;

  beforeEach(async () => {
    const conn = createDb(':memory:');
    sqlite = conn.sqlite;
    db = conn.db;
    await runMigrations(sqlite);
    notificationsRepo = createNotificationsRepo(db);
    evaluationsRepo = createEvaluationsRepo(db);
    messagesRepo = createMessagesRepo(db);

    const sourcesRepo = createSourcesRepo(db);
    sourcesRepo.upsert({
      id: 'manual',
      displayName: 'Manual Source',
      enabled: 1,
      ingestionMethod: 'manual',
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  function setupTestNotification() {
    const msg = messagesRepo.insertIfNew({
      sourceId: 'manual',
      externalId: 'ext-100',
      postedAt: null,
      fetchedAt: new Date().toISOString(),
      originalText: 'Senior Backend Developer',
      links: '[]',
      hasMedia: 0,
      textHash: 'hash-100',
      processingStatus: 'evaluated',
      processingError: null,
      createdAt: new Date().toISOString(),
    })!;

    const evaluation = evaluationsRepo.insert({
      messageId: msg.id,
      profileVersion: 1,
      ruleEngineVersion: '1.0.0',
      isJobAnnouncement: true,
      extractedTitle: 'Senior Backend Developer',
      extractedCompany: 'Acme Corp',
      matchedSkills: ['Node.js'],
      matchedRoles: ['Backend'],
      missingInfo: [],
      triggeredExclusions: [],
      score: 85,
      verdict: 'match',
      matchReasons: ['High match'],
    });

    const notif = notificationsRepo.queue(evaluation.id);
    return { msg, evaluation, notif };
  }

  it('delivers notification and marks status as delivered with messageId', async () => {
    const { notif } = setupTestNotification();

    const mockSender: TelegramSender = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
    };

    const service = new NotificationDeliveryService(db, mockSender, 999);
    const result = await service.processQueue();

    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(0);

    const updated = notificationsRepo.findById(notif.id);
    expect(updated?.status).toBe('delivered');
    expect(updated?.telegramMessageId).toBe(12345);
    expect(updated?.attemptCount).toBe(1);
  });

  it('handles 429 rate limit with retry_after header', async () => {
    const { notif } = setupTestNotification();

    const rateLimitError = {
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 45 },
    };

    const mockSender: TelegramSender = {
      sendMessage: vi.fn().mockRejectedValue(rateLimitError),
    };

    const service = new NotificationDeliveryService(db, mockSender, 999);
    const outcome = await service.deliverOne(notif);

    expect(outcome).toBe('delayed');

    const updated = notificationsRepo.findById(notif.id);
    expect(updated?.status).toBe('queued');
    expect(updated?.attemptCount).toBe(1);
    expect(updated?.nextRetryAt).toBeDefined();

    // Verify nextRetryAt is ~45s in the future
    const retryDate = new Date(updated!.nextRetryAt!);
    const diffSeconds = (retryDate.getTime() - Date.now()) / 1000;
    expect(diffSeconds).toBeGreaterThan(40);
    expect(diffSeconds).toBeLessThan(50);
  });

  it('marks notification as permanently failed when max retries exceeded', async () => {
    const { notif } = setupTestNotification();

    const mockSender: TelegramSender = {
      sendMessage: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };

    const service = new NotificationDeliveryService(db, mockSender, 999, 2);

    // Attempt 1 -> delayed
    await service.deliverOne(notif);
    const after1 = notificationsRepo.findById(notif.id)!;
    expect(after1.status).toBe('queued');

    // Attempt 2 -> failed permanently
    await service.deliverOne(after1);
    const after2 = notificationsRepo.findById(notif.id)!;
    expect(after2.status).toBe('failed');
    expect(after2.lastError).toContain('Network timeout');
  });
});
