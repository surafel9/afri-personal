import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../../database/client.js';
import { runMigrations } from '../../database/migrate.js';
import { cleanupOldData } from '../retention.js';
import { createMessagesRepo } from '../../database/repositories/messages.js';
import { createEvaluationsRepo } from '../../database/repositories/evaluations.js';
import { createNotificationsRepo } from '../../database/repositories/notifications.js';
import { createFeedbackRepo } from '../../database/repositories/feedback.js';
import { createSourcesRepo } from '../../database/repositories/sources.js';
import type { Database } from 'better-sqlite3';
import type { Db } from '../../database/client.js';

describe('Data Retention Cleanup', () => {
  let sqlite: Database;
  let db: Db;
  let messagesRepo: ReturnType<typeof createMessagesRepo>;
  let evaluationsRepo: ReturnType<typeof createEvaluationsRepo>;
  let notificationsRepo: ReturnType<typeof createNotificationsRepo>;
  let feedbackRepo: ReturnType<typeof createFeedbackRepo>;

  beforeEach(async () => {
    const conn = createDb(':memory:');
    sqlite = conn.sqlite;
    db = conn.db;
    await runMigrations(sqlite);

    messagesRepo = createMessagesRepo(db);
    evaluationsRepo = createEvaluationsRepo(db);
    notificationsRepo = createNotificationsRepo(db);
    feedbackRepo = createFeedbackRepo(db);

    const sourcesRepo = createSourcesRepo(db);
    sourcesRepo.upsert({
      id: 'manual',
      displayName: 'Manual',
      enabled: 1,
      ingestionMethod: 'manual',
      createdAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  it('prunes messages and evaluations older than retention cutoff', () => {
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days old
    const newDate = new Date().toISOString();

    // Old message
    const oldMsg = messagesRepo.insertIfNew({
      sourceId: 'manual',
      externalId: 'old-msg-1',
      postedAt: null,
      fetchedAt: oldDate,
      originalText: 'Old job post',
      links: '[]',
      hasMedia: 0,
      textHash: 'hash-old-1',
      processingStatus: 'evaluated',
      processingError: null,
      createdAt: oldDate,
    })!;

    const oldEval = evaluationsRepo.insert({
      messageId: oldMsg.id,
      profileVersion: 1,
      ruleEngineVersion: '1.0.0',
      isJobAnnouncement: true,
      extractedTitle: 'Old Developer',
      matchedSkills: [],
      matchedRoles: [],
      missingInfo: [],
      triggeredExclusions: [],
      score: 70,
      verdict: 'match',
      matchReasons: [],
    });

    const oldNotif = notificationsRepo.queue(oldEval.id);
    feedbackRepo.insert(oldNotif.id, 'relevant');

    // New message
    const newMsg = messagesRepo.insertIfNew({
      sourceId: 'manual',
      externalId: 'new-msg-1',
      postedAt: null,
      fetchedAt: newDate,
      originalText: 'New job post',
      links: '[]',
      hasMedia: 0,
      textHash: 'hash-new-1',
      processingStatus: 'evaluated',
      processingError: null,
      createdAt: newDate,
    })!;

    // Run cleanup with 90 days retention
    const result = cleanupOldData(db, 90);

    expect(result.prunedMessagesCount).toBe(1);
    expect(result.prunedEvaluationsCount).toBe(1);

    // Old message should be deleted
    expect(messagesRepo.findById(oldMsg.id)).toBeUndefined();
    // New message should remain
    expect(messagesRepo.findById(newMsg.id)).toBeDefined();
  });
});

