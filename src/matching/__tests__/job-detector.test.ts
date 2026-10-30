import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isJobAnnouncement } from '../job-detector.js';
import { normalizeText } from '../normalizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FixtureMessage {
  id: string;
  postedAt: string;
  text: string;
  links: string[];
  hasMedia: boolean;
}

function loadFixture(id: string): string {
  const fixturePath = resolve(__dirname, '../../sources/fixtures/sample-messages.json');
  const messages: FixtureMessage[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  const msg = messages.find((m) => m.id === id);
  if (!msg) throw new Error(`Fixture ${id} not found`);
  return msg.text;
}

describe('isJobAnnouncement', () => {
  it('fixture-001 (Node.js job) → true', () => {
    const text = normalizeText(loadFixture('fixture-001'));
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('fixture-002 (Full-stack remote job) → true', () => {
    const text = normalizeText(loadFixture('fixture-002'));
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('fixture-003 (Amharic news report) → false', () => {
    const text = normalizeText(loadFixture('fixture-003'));
    expect(isJobAnnouncement(text)).toBe(false);
  });

  it('fixture-005 (phone promo) → false', () => {
    const text = normalizeText(loadFixture('fixture-005'));
    expect(isJobAnnouncement(text)).toBe(false);
  });

  it('fixture-009 (Amharic job) → false (Amharic threshold)', () => {
    // This is actually a job but written entirely in Amharic.
    // Our detector will return false because >60% Amharic.
    // This is the documented "handle gracefully" case.
    const text = normalizeText(loadFixture('fixture-009'));
    expect(isJobAnnouncement(text)).toBe(false);
  });

  it('fixture-015 (Amharic phone case promo) → false', () => {
    const text = normalizeText(loadFixture('fixture-015'));
    expect(isJobAnnouncement(text)).toBe(false);
  });

  it('fixture-006 (backend engineer) → true', () => {
    const text = normalizeText(loadFixture('fixture-006'));
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('fixture-007 (PHP onsite) → true', () => {
    const text = normalizeText(loadFixture('fixture-007'));
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('fixture-016 (Gebeya backend) → true', () => {
    const text = normalizeText(loadFixture('fixture-016'));
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('"we are hiring a React developer" → true', () => {
    const text = normalizeText('We are hiring a React developer to join our team.');
    expect(isJobAnnouncement(text)).toBe(true);
  });

  it('"Hello world" → false', () => {
    const text = normalizeText('Hello world');
    expect(isJobAnnouncement(text)).toBe(false);
  });

  it('very short message with no job keywords → false', () => {
    const text = normalizeText('Check this out!');
    expect(isJobAnnouncement(text)).toBe(false);
  });
});
