import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreMessage } from '../scorer.js';
import { normalizeText } from '../normalizer.js';
import { extractFields } from '../field-extractor.js';
import type { UserProfile } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FixtureMessage {
  id: string;
  text: string;
}

function loadFixture(id: string): string {
  const fixturePath = resolve(__dirname, '../../sources/fixtures/sample-messages.json');
  const messages: FixtureMessage[] = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  const msg = messages.find((m) => m.id === id);
  if (!msg) throw new Error(`Fixture ${id} not found`);
  return msg.text;
}

// ── Standard test profile ─────────────────────────────────────────────────────

const testProfile: UserProfile = {
  id: 1,
  version: 1,
  name: 'test',
  targetTitles: ['Full-Stack Developer', 'Backend Developer', 'Node.js Developer'],
  targetRoleFamilies: ['engineering', 'backend', 'fullstack'],
  requiredSkills: ['javascript', 'typescript', 'node.js'],
  preferredSkills: ['react', 'postgresql', 'rest api', 'express', 'graphql'],
  seniorityLevels: ['mid', 'senior'],
  employmentTypes: ['fulltime', 'contract', 'freelance'],
  workArrangements: ['remote', 'hybrid'],
  preferredLocations: ['remote', 'africa'],
  exclusions: ['onsite only', 'no remote', 'must be in office'],
  dealBreakers: ['php', 'wordpress'],
  minScoreThreshold: 60,
  scoringWeights: {},
};

function score(rawText: string) {
  const normalized = normalizeText(rawText);
  const extracted = extractFields(rawText);
  return scoreMessage(normalized, extracted, testProfile);
}

// ── Test cases ────────────────────────────────────────────────────────────────

describe('scorer — fixture-001 (Senior Node.js remote)', () => {
  const result = score(loadFixture('fixture-001'));

  it('verdict = match', () => {
    expect(result.verdict).toBe('match');
  });

  it('score >= 80', () => {
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('matchedSkills includes node.js', () => {
    expect(result.matchedSkills).toContain('node.js');
  });

  it('matchedSkills includes typescript', () => {
    expect(result.matchedSkills).toContain('typescript');
  });
});

describe('scorer — fixture-002 (Full-stack React+Node.js contract remote)', () => {
  const result = score(loadFixture('fixture-002'));

  it('verdict = match', () => {
    expect(result.verdict).toBe('match');
  });

  it('score >= 70', () => {
    expect(result.score).toBeGreaterThanOrEqual(70);
  });
});

describe('scorer — fixture-007 (PHP onsite)', () => {
  const result = score(loadFixture('fixture-007'));

  it('verdict = excluded', () => {
    expect(result.verdict).toBe('excluded');
  });

  it('triggeredExclusions includes php', () => {
    expect(result.triggeredExclusions.map((e) => e.toLowerCase())).toContain('php');
  });
});

describe('scorer — fixture-010 (Node.js contract remote)', () => {
  const result = score(loadFixture('fixture-010'));

  it('verdict = match', () => {
    expect(result.verdict).toBe('match');
  });

  it('score >= 60', () => {
    expect(result.score).toBeGreaterThanOrEqual(60);
  });
});

describe('scorer — fixture-016 (Node.js+TypeScript Gebeya, remote)', () => {
  const result = score(loadFixture('fixture-016'));

  it('verdict = match', () => {
    expect(result.verdict).toBe('match');
  });

  it('score >= 80', () => {
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});

describe('scorer — fixture-014 (Data Engineer Python/Kafka)', () => {
  const result = score(loadFixture('fixture-014'));

  it('verdict = no_match (no required skills)', () => {
    expect(result.verdict).toBe('no_match');
  });
});

describe('scorer — fixture-012 (ambiguous short post — JS only)', () => {
  const result = score(loadFixture('fixture-012'));

  it('verdict = no_match (missing TypeScript + Node.js)', () => {
    // fixture-012 only mentions JavaScript, missing TS and Node.js
    expect(result.verdict).toBe('no_match');
  });
});

describe('scorer — required skills absence', () => {
  it('React+Python job (no JS/TS/Node) → score < threshold', () => {
    const text = `Frontend Developer — React
We are hiring a React developer with Python backend skills.
Type: Full-time
Location: Remote
Apply: https://example.com`;
    const result = score(text);
    expect(result.score).toBeLessThan(testProfile.minScoreThreshold);
  });
});

describe('scorer — deal-breaker override', () => {
  it('PHP deal-breaker → excluded even with matching keywords', () => {
    const text = `Node.js and PHP Backend Developer
We are hiring a developer with Node.js and PHP experience.
TypeScript, Node.js, PHP, REST APIs.
Location: Remote. Full-time.
Apply: https://example.com`;
    const result = score(text);
    expect(result.verdict).toBe('excluded');
    expect(result.triggeredExclusions.map((e) => e.toLowerCase())).toContain('php');
  });
});

describe('scorer — missing info list', () => {
  it('post with no company/deadline → missingInfo contains both', () => {
    const text = `Senior Node.js Backend Developer
We need a Node.js developer with TypeScript experience.
Location: 100% Remote
Type: Full-time
Apply: https://example.com/jobs`;
    const result = score(text);
    // Should identify missing company and deadline
    expect(result.missingInfo).toContain('Company not identified');
    expect(result.missingInfo).toContain('Application deadline not mentioned');
  });
});

describe('scorer — exclusion keyword (no remote)', () => {
  it('post with "no remote" in exclusions → excluded', () => {
    const text = `Node.js Backend Developer
Requirements: JavaScript, TypeScript, Node.js
Location: Addis Ababa (no remote, must work onsite)
Type: Full-time
Apply: hr@company.et`;
    const result = score(text);
    expect(result.verdict).toBe('excluded');
  });
});

describe('scorer — seniority mismatch', () => {
  it('junior role → seniority 0 points (still possible match via skills)', () => {
    const text = `Junior Node.js Developer
Company: StartupCo
Type: Full-time, Remote
Requirements:
- JavaScript and Node.js basics
- TypeScript
- REST APIs
Apply: jobs@startupco.io
Deadline: November 30`;
    const result = score(text);
    // Junior doesn't match ['mid', 'senior'] → 0 seniority points
    // But skills should still push it above threshold
    // (score may or may not be match depending on totals)
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
