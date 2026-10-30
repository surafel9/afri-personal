import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../../database/client.js';
import { runMigrations } from '../../database/migrate.js';
import { IngestionService } from '../ingestion.js';
import { ManualImportAdapter } from '../../sources/manual-adapter.js';
import { FixtureAdapter } from '../../sources/fixture-adapter.js';
import { createAppStateRepo } from '../../database/repositories/app-state.js';
import { createSourcesRepo } from '../../database/repositories/sources.js';
import type { Database } from 'better-sqlite3';
import type { Db } from '../../database/client.js';

describe('IngestionService', () => {
  let sqlite: Database;
  let db: Db;
  let service: IngestionService;

  beforeEach(async () => {
    const conn = createDb(':memory:');
    sqlite = conn.sqlite;
    db = conn.db;
    await runMigrations(sqlite);
    service = new IngestionService(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('ingests a single message successfully and records checkpoint', async () => {
    const adapter = new ManualImportAdapter();
    const raw = adapter.enqueue({
      text: 'We are hiring a Node.js developer!\nApply: https://example.com',
      externalId: 'test-msg-1',
      postedAt: new Date('2026-10-25T10:00:00Z'),
    });

    const result = await service.ingestMessage(raw);

    expect(result.inserted).toBe(true);
    expect(result.message).toBeDefined();
    expect(result.message?.externalId).toBe('test-msg-1');
    expect(result.job).toBeDefined();
    expect(result.job?.duplicateOfJobId).toBeNull();
    expect(result.isDuplicate).toBe(false);

    // Checkpoint in app_state
    const appState = createAppStateRepo(db);
    expect(appState.get('checkpoint:manual')).toBe('test-msg-1');

    // Source lastSuccessAt updated
    const sources = createSourcesRepo(db);
    const source = sources.findById('manual');
    expect(source?.lastSuccessAt).not.toBeNull();
  });

  it('is idempotent on duplicate (sourceId, externalId)', async () => {
    const adapter = new ManualImportAdapter();
    const raw = adapter.enqueue({
      text: 'Test message text',
      externalId: 'msg-repeat',
    });

    const res1 = await service.ingestMessage(raw);
    expect(res1.inserted).toBe(true);

    const res2 = await service.ingestMessage(raw);
    expect(res2.inserted).toBe(false);
    expect(res2.reason).toBe('duplicate_external_id');
  });

  it('detects reposted content with same textHash as duplicate job', async () => {
    const adapter = new ManualImportAdapter();
    const raw1 = adapter.enqueue({
      text: 'Senior Go Developer wanted. Fully remote.\nContact @hire',
      externalId: 'first-post',
    });
    const raw2 = adapter.enqueue({
      text: 'Senior Go Developer wanted.  Fully remote.\nContact @hire', // minor whitespace difference
      externalId: 'second-post',
    });

    const res1 = await service.ingestMessage(raw1);
    expect(res1.inserted).toBe(true);
    expect(res1.isDuplicate).toBe(false);

    const res2 = await service.ingestMessage(raw2);
    expect(res2.inserted).toBe(true); // new message row inserted
    expect(res2.isDuplicate).toBe(true); // marked as duplicate job
    expect(res2.job?.duplicateOfJobId).toBe(res1.job?.id);
    expect(res2.job?.isDuplicateCertain).toBe(1);
  });

  it('ingests all messages from FixtureAdapter in batch', async () => {
    const fixtureAdapter = new FixtureAdapter();
    const batch1 = await service.ingestFromAdapter(fixtureAdapter);

    expect(batch1.totalFetched).toBe(17);
    expect(batch1.insertedCount).toBe(17);
    expect(batch1.duplicateCount).toBe(0);
    expect(batch1.errorCount).toBe(0);

    // Ingest again: should detect duplicates and insert 0 new
    const batch2 = await service.ingestFromAdapter(new FixtureAdapter());
    expect(batch2.totalFetched).toBe(17);
    expect(batch2.insertedCount).toBe(0);
    expect(batch2.duplicateCount).toBe(17);
  });
});

