import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb } from '../../database/client.js';
import { runMigrations } from '../../database/migrate.js';
import { PipelineCoordinator } from '../coordinator.js';
import { IngestionService } from '../ingestion.js';
import { ManualImportAdapter } from '../../sources/manual-adapter.js';
import { createProfileRepo } from '../../database/repositories/profile.js';
import { createMessagesRepo } from '../../database/repositories/messages.js';
import { createNotificationsRepo } from '../../database/repositories/notifications.js';
import { createSourcesRepo } from '../../database/repositories/sources.js';
import { createAppStateRepo } from '../../database/repositories/app-state.js';
import { NotificationDeliveryService, type TelegramSender } from '../../notifications/delivery.js';
import type { Database } from 'better-sqlite3';
import type { Db } from '../../database/client.js';

describe('PipelineCoordinator', () => {
  let sqlite: Database;
  let db: Db;
  let coordinator: PipelineCoordinator;
  let ingestionService: IngestionService;
  let profileRepo: ReturnType<typeof createProfileRepo>;
  let messagesRepo: ReturnType<typeof createMessagesRepo>;
  let notificationsRepo: ReturnType<typeof createNotificationsRepo>;
  let appStateRepo: ReturnType<typeof createAppStateRepo>;

  beforeEach(async () => {
    const conn = createDb(':memory:');
    sqlite = conn.sqlite;
    db = conn.db;
    await runMigrations(sqlite);

    profileRepo = createProfileRepo(db);
    messagesRepo = createMessagesRepo(db);
    notificationsRepo = createNotificationsRepo(db);
    appStateRepo = createAppStateRepo(db);
    ingestionService = new IngestionService(db);

    // Seed source
    const sourcesRepo = createSourcesRepo(db);
    sourcesRepo.upsert({
      id: 'manual',
      displayName: 'Manual Source',
      enabled: 1,
      ingestionMethod: 'manual',
      createdAt: new Date().toISOString(),
    });

    // Seed test profile
    profileRepo.create({
      name: 'Fullstack Profile',
      targetTitles: ['Senior Node.js Developer', 'Fullstack Engineer'],
      requiredSkills: ['Node.js', 'TypeScript'],
      preferredSkills: ['React', 'PostgreSQL'],
      workArrangements: ['remote'],
      employmentTypes: ['fulltime'],
      minScoreThreshold: 60,
    });

    coordinator = new PipelineCoordinator(db);
  });

  afterEach(() => {
    coordinator.stop();
    sqlite.close();
  });

  it('recovers unfinished work from previous crash', async () => {
    // Insert a message stuck in 'processing'
    const msg = messagesRepo.insertIfNew({
      sourceId: 'manual',
      externalId: 'crash-msg-1',
      postedAt: null,
      fetchedAt: new Date().toISOString(),
      originalText: 'Job post',
      links: '[]',
      hasMedia: 0,
      textHash: 'hash-crash-1',
      processingStatus: 'processing', // stuck state
      processingError: null,
      createdAt: new Date().toISOString(),
    })!;

    // Recovery run
    const result = coordinator.recoverUnfinishedWork();
    expect(result.recoveredMessages).toBe(1);

    const reloaded = messagesRepo.findById(msg.id);
    expect(reloaded?.processingStatus).toBe('pending');
  });

  it('evaluates pending messages and queues notifications for matches', async () => {
    const adapter = new ManualImportAdapter();
    const raw = adapter.enqueue({
      text: '🚀 Senior Node.js Developer\nRequirements: Node.js, TypeScript.\nRemote, Full-time.',
      externalId: 'eval-test-1',
    });

    await ingestionService.ingestMessage(raw);

    const summary = await coordinator.processPendingMessages();
    expect(summary.processed).toBe(1);
    expect(summary.matches).toBe(1);
    expect(summary.notificationsQueued).toBe(1);

    const pendingNotifs = notificationsRepo.getPending();
    expect(pendingNotifs.length).toBe(1);
  });

  it('suppresses duplicate notifications for reposted jobs', async () => {
    const adapter = new ManualImportAdapter();
    const postText = 'Senior Node.js Developer with TypeScript needed! Remote full-time.';

    // Ingest post 1
    const raw1 = adapter.enqueue({ text: postText, externalId: 'post-original' });
    await ingestionService.ingestMessage(raw1);

    // Evaluate post 1
    const summary1 = await coordinator.processPendingMessages();
    expect(summary1.notificationsQueued).toBe(1);

    // Ingest repost (same textHash)
    const raw2 = adapter.enqueue({ text: postText, externalId: 'post-repost' });
    await ingestionService.ingestMessage(raw2);

    // Evaluate repost: should match, but suppress duplicate notification
    const summary2 = await coordinator.processPendingMessages();
    expect(summary2.processed).toBe(1);
    expect(summary2.matches).toBe(1);
    expect(summary2.notificationsQueued).toBe(0); // Suppressed!
  });

  it('respects paused state and skips evaluation', async () => {
    appStateRepo.set('paused', 'true');

    const adapter = new ManualImportAdapter();
    const raw = adapter.enqueue({
      text: 'Senior Node.js Developer. Remote.',
      externalId: 'pause-test-1',
    });
    await ingestionService.ingestMessage(raw);

    const summary = await coordinator.processPendingMessages();
    expect(summary.processed).toBe(0);
  });
});
