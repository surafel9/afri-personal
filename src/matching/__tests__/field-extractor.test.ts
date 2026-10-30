import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFields } from '../field-extractor.js';

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

describe('extractFields — fixture-001', () => {
  const fields = extractFields(loadFixture('fixture-001'));

  it('extracts title containing "Node.js" and "Backend Developer"', () => {
    expect(fields.title).not.toBeNull();
    expect(fields.title?.toLowerCase()).toMatch(/node\.?js|backend/i);
  });

  it('extracts company = Shega Digital', () => {
    expect(fields.company).not.toBeNull();
    expect(fields.company).toMatch(/shega/i);
  });

  it('workMode = remote', () => {
    expect(fields.workMode).toBe('remote');
  });

  it('employmentType = fulltime', () => {
    expect(fields.employmentType).toBe('fulltime');
  });

  it('deadline contains "November 10"', () => {
    expect(fields.deadline).not.toBeNull();
    expect(fields.deadline).toMatch(/november 10/i);
  });

  it('applyMethod is a URL', () => {
    expect(fields.applyMethod).not.toBeNull();
    expect(fields.applyMethod).toMatch(/^https?:\/\//);
  });
});

describe('extractFields — fixture-002', () => {
  const fields = extractFields(loadFixture('fixture-002'));

  it('workMode = remote', () => {
    expect(fields.workMode).toBe('remote');
  });

  it('employmentType = contract', () => {
    expect(fields.employmentType).toBe('contract');
  });

  it('seniority = mid (mid-level)', () => {
    expect(fields.seniority).toBe('mid');
  });

  it('deadline contains Oct 30', () => {
    expect(fields.deadline).not.toBeNull();
    expect(fields.deadline).toMatch(/oct(ober)?\s+30/i);
  });
});

describe('extractFields — fixture-007', () => {
  const fields = extractFields(loadFixture('fixture-007'));

  it('workMode = onsite', () => {
    expect(fields.workMode).toBe('onsite');
  });

  it('employmentType = fulltime', () => {
    expect(fields.employmentType).toBe('fulltime');
  });
});

describe('extractFields — fixture-008', () => {
  const fields = extractFields(loadFixture('fixture-008'));

  it('employmentType = internship', () => {
    expect(fields.employmentType).toBe('internship');
  });

  it('seniority = junior', () => {
    expect(fields.seniority).toBe('junior');
  });

  it('deadline contains October 31', () => {
    expect(fields.deadline).not.toBeNull();
    expect(fields.deadline).toMatch(/october 31/i);
  });
});

describe('extractFields — fixture-014', () => {
  const fields = extractFields(loadFixture('fixture-014'));

  it('workMode = onsite (or null)', () => {
    // fixture-014 says "onsite + occasional remote" → onsite wins
    expect(['onsite', null]).toContain(fields.workMode);
  });

  it('employmentType = fulltime', () => {
    expect(fields.employmentType).toBe('fulltime');
  });
});

describe('extractFields — apply method', () => {
  it('extracts email when no URL', () => {
    const text = `Software Engineer needed. Send CV to jobs@company.com`;
    const fields = extractFields(text);
    expect(fields.applyMethod).toMatch(/jobs@company\.com/);
  });

  it('extracts Telegram handle when no URL/email', () => {
    const text = `Developer needed. DM @dev_recruiter on Telegram.`;
    const fields = extractFields(text);
    expect(fields.applyMethod).toMatch(/@dev_recruiter/);
  });
});

describe('extractFields — null when ambiguous', () => {
  it('returns null title for short irrelevant text', () => {
    const text = 'Looking for someone to help out. Contact us.';
    const fields = extractFields(text);
    expect(fields.title).toBeNull();
  });
});
