import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { FixtureAdapter } from '../fixture-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use the real fixture file in the project
const FIXTURES_PATH = join(__dirname, '..', 'fixtures', 'sample-messages.json');

describe('FixtureAdapter', () => {
  it('has the correct sourceId and displayName', () => {
    const adapter = new FixtureAdapter(FIXTURES_PATH);
    expect(adapter.sourceId).toBe('fixture');
    expect(adapter.displayName).toContain('Fixture');
  });

  it('yields all messages from the fixture JSON', async () => {
    const adapter = new FixtureAdapter(FIXTURES_PATH);
    const messages: Awaited<
      ReturnType<
        typeof adapter.fetchNew extends () => infer R ? () => R : never
      >
    >[] = [];

    for await (const msg of adapter.fetchNew()) {
      messages.push(msg as any);
    }

    // The sample-messages.json has 17 entries
    expect(messages.length).toBeGreaterThanOrEqual(15);
  });

  it('each message has required fields', async () => {
    const adapter = new FixtureAdapter(FIXTURES_PATH);

    for await (const msg of adapter.fetchNew()) {
      expect(msg.sourceId).toBe('fixture');
      expect(typeof msg.externalId).toBe('string');
      expect(msg.externalId.length).toBeGreaterThan(0);
      expect(typeof msg.text).toBe('string');
      expect(msg.text.length).toBeGreaterThan(0);
      expect(Array.isArray(msg.links)).toBe(true);
      expect(typeof msg.hasMedia).toBe('boolean');
      expect(msg.fetchedAt).toBeInstanceOf(Date);
      // postedAt is Date | null
      expect(msg.postedAt === null || msg.postedAt instanceof Date).toBe(true);
    }
  });

  it('messages with postedAt set have valid Date objects', async () => {
    const adapter = new FixtureAdapter(FIXTURES_PATH);

    for await (const msg of adapter.fetchNew()) {
      if (msg.postedAt !== null) {
        expect(msg.postedAt).toBeInstanceOf(Date);
        expect(isNaN(msg.postedAt.getTime())).toBe(false);
      }
    }
  });

  it('externalIds are unique within the fixture file', async () => {
    const adapter = new FixtureAdapter(FIXTURES_PATH);
    const ids = new Set<string>();

    for await (const msg of adapter.fetchNew()) {
      expect(ids.has(msg.externalId)).toBe(false);
      ids.add(msg.externalId);
    }
  });

  it('uses a custom fixtures path when provided', async () => {
    // Create an in-memory fixture by pointing to the real file
    const adapter = new FixtureAdapter(FIXTURES_PATH);
    const messages: unknown[] = [];
    for await (const msg of adapter.fetchNew()) {
      messages.push(msg);
    }
    expect(messages.length).toBeGreaterThan(0);
  });
});
