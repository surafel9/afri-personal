import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import {
  createMessagesRepo,
  computeTextHash,
} from '../repositories/messages.js';
import { createSourcesRepo } from '../repositories/sources.js';

function setupTestDb() {
  const { db, sqlite } = createDb(':memory:');
  return { db, sqlite };
}

describe('messages repository', () => {
  let db: ReturnType<typeof createDb>['db'];
  let sqlite: ReturnType<typeof createDb>['sqlite'];
  let messagesRepo: ReturnType<typeof createMessagesRepo>;
  let sourcesRepo: ReturnType<typeof createSourcesRepo>;

  beforeEach(async () => {
    ({ db, sqlite } = setupTestDb());
    await runMigrations(sqlite);
    messagesRepo = createMessagesRepo(db);
    sourcesRepo = createSourcesRepo(db);

    // Seed a test source
    sourcesRepo.upsert({
      id: 'test-source',
      displayName: 'Test Source',
      enabled: 1,
      ingestionMethod: 'fixture',
      createdAt: new Date().toISOString(),
    });
  });

  it('inserts a new message successfully', () => {
    const now = new Date().toISOString();
    const text =
      'Senior Node.js Developer needed. Remote. TypeScript required.';
    const msg = messagesRepo.insertIfNew({
      sourceId: 'test-source',
      externalId: 'msg-001',
      postedAt: now,
      fetchedAt: now,
      originalText: text,
      links: '[]',
      hasMedia: 0,
      textHash: computeTextHash(text),
      processingStatus: 'pending',
      createdAt: now,
    });

    expect(msg).not.toBeNull();
    expect(msg?.externalId).toBe('msg-001');
    expect(msg?.processingStatus).toBe('pending');
  });

  it('returns null on duplicate (sourceId, externalId)', () => {
    const now = new Date().toISOString();
    const text = 'Some job post text';
    const base = {
      sourceId: 'test-source',
      externalId: 'msg-dup',
      postedAt: now,
      fetchedAt: now,
      originalText: text,
      links: '[]',
      hasMedia: 0,
      textHash: computeTextHash(text),
      processingStatus: 'pending',
      createdAt: now,
    } as const;

    const first = messagesRepo.insertIfNew(base);
    const second = messagesRepo.insertIfNew({
      ...base,
      originalText: 'slightly different text',
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('status transitions work correctly', () => {
    const now = new Date().toISOString();
    const text = 'Job post for status test';
    const msg = messagesRepo.insertIfNew({
      sourceId: 'test-source',
      externalId: 'msg-status',
      postedAt: now,
      fetchedAt: now,
      originalText: text,
      links: '[]',
      hasMedia: 0,
      textHash: computeTextHash(text),
      processingStatus: 'pending',
      createdAt: now,
    });

    expect(msg).not.toBeNull();
    const id = msg!.id;

    messagesRepo.updateStatus(id, 'processing');
    let fetched = messagesRepo.findById(id);
    expect(fetched?.processingStatus).toBe('processing');

    messagesRepo.updateStatus(id, 'evaluated');
    fetched = messagesRepo.findById(id);
    expect(fetched?.processingStatus).toBe('evaluated');

    messagesRepo.updateStatus(id, 'failed', 'Connection timeout');
    fetched = messagesRepo.findById(id);
    expect(fetched?.processingStatus).toBe('failed');
    expect(fetched?.processingError).toBe('Connection timeout');
  });

  it('findPending returns only pending messages', () => {
    const now = new Date().toISOString();

    const makeMsg = (id: string, text: string) => ({
      sourceId: 'test-source',
      externalId: id,
      postedAt: now,
      fetchedAt: now,
      originalText: text,
      links: '[]',
      hasMedia: 0,
      textHash: computeTextHash(text),
      processingStatus: 'pending' as const,
      createdAt: now,
    });

    const m1 = messagesRepo.insertIfNew(makeMsg('p1', 'job post one'));
    const m2 = messagesRepo.insertIfNew(makeMsg('p2', 'job post two'));
    const m3 = messagesRepo.insertIfNew(makeMsg('p3', 'job post three'));

    messagesRepo.updateStatus(m2!.id, 'evaluated');

    const pending = messagesRepo.findPending();
    const pendingIds = pending.map(m => m.externalId);

    expect(pendingIds).toContain('p1');
    expect(pendingIds).toContain('p3');
    expect(pendingIds).not.toContain('p2');
  });

  it('computeTextHash is case and whitespace insensitive', () => {
    const h1 = computeTextHash('Senior Node.js Developer   ');
    const h2 = computeTextHash('senior node.js developer');
    const h3 = computeTextHash('SENIOR NODE.JS DEVELOPER');
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  it('findByHash returns messages with the same hash', () => {
    const now = new Date().toISOString();
    const text = 'Duplicate job post content';
    const hash = computeTextHash(text);

    messagesRepo.insertIfNew({
      sourceId: 'test-source',
      externalId: 'hash-1',
      postedAt: now,
      fetchedAt: now,
      originalText: text,
      links: '[]',
      hasMedia: 0,
      textHash: hash,
      processingStatus: 'pending',
      createdAt: now,
    });

    const found = messagesRepo.findByHash(hash);
    expect(found).toHaveLength(1);
    expect(found[0]?.externalId).toBe('hash-1');
  });
});
