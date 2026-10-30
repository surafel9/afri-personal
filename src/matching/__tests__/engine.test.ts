import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, RULE_ENGINE_VERSION } from '../engine.js';
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

describe('engine — EvaluationResult shape', () => {
  it('always sets ruleEngineVersion', () => {
    const result = evaluate(loadFixture('fixture-001'), testProfile);
    expect(result.ruleEngineVersion).toBe(RULE_ENGINE_VERSION);
  });

  it('always sets evaluatedAt as recent ISO datetime', () => {
    const before = new Date();
    const result = evaluate(loadFixture('fixture-001'), testProfile);
    const after = new Date();
    const evaluatedAt = new Date(result.evaluatedAt);
    expect(evaluatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(evaluatedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('result has all expected keys', () => {
    const result = evaluate(loadFixture('fixture-001'), testProfile);
    expect(result).toHaveProperty('isJobAnnouncement');
    expect(result).toHaveProperty('extracted');
    expect(result).toHaveProperty('matchedSkills');
    expect(result).toHaveProperty('matchedRoles');
    expect(result).toHaveProperty('missingInfo');
    expect(result).toHaveProperty('triggeredExclusions');
    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('verdict');
    expect(result).toHaveProperty('matchReasons');
    expect(result).toHaveProperty('ruleEngineVersion');
    expect(result).toHaveProperty('evaluatedAt');
  });
});

describe('engine — end-to-end fixture-001', () => {
  const result = evaluate(loadFixture('fixture-001'), testProfile);

  it('isJobAnnouncement = true', () => {
    expect(result.isJobAnnouncement).toBe(true);
  });

  it('verdict = match', () => {
    expect(result.verdict).toBe('match');
  });

  it('score >= 80', () => {
    expect(result.score).toBeGreaterThanOrEqual(80);
  });
});

describe('engine — fixture-003 (Amharic news)', () => {
  const result = evaluate(loadFixture('fixture-003'), testProfile);

  it('verdict = skipped', () => {
    expect(result.verdict).toBe('skipped');
  });

  it('isJobAnnouncement = false', () => {
    expect(result.isJobAnnouncement).toBe(false);
  });

  it('score = 0', () => {
    expect(result.score).toBe(0);
  });

  it('matchReasons includes "not a job"', () => {
    expect(result.matchReasons.join(' ').toLowerCase()).toMatch(/not a job/);
  });
});

describe('engine — fixture-005 (phone promo)', () => {
  const result = evaluate(loadFixture('fixture-005'), testProfile);

  it('verdict = skipped', () => {
    expect(result.verdict).toBe('skipped');
  });
});

describe('engine — fixture-007 (PHP onsite)', () => {
  const result = evaluate(loadFixture('fixture-007'), testProfile);

  it('verdict = excluded', () => {
    expect(result.verdict).toBe('excluded');
  });

  it('score = 0', () => {
    expect(result.score).toBe(0);
  });
});

describe('engine — RULE_ENGINE_VERSION constant', () => {
  it('is a semver string', () => {
    expect(RULE_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('engine — profileFromDb conversion', () => {
  it('parses a DB row with JSON string fields', async () => {
    const { profileFromDb } = await import('../engine.js');

    const fakeRow = {
      id: 5,
      version: 2,
      name: 'my profile',
      targetTitles: '["Backend Developer"]',
      targetRoleFamilies: '["backend"]',
      requiredSkills: '["javascript","node.js"]',
      preferredSkills: '["react"]',
      seniorityLevels: '["senior"]',
      employmentTypes: '["fulltime"]',
      workArrangements: '["remote"]',
      preferredLocations: '["africa"]',
      exclusions: '[]',
      dealBreakers: '["php"]',
      minScoreThreshold: 70,
      scoringWeights: '{"requiredSkills":50}',
      isActive: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    const profile = profileFromDb(fakeRow as Parameters<typeof profileFromDb>[0]);

    expect(profile.id).toBe(5);
    expect(profile.version).toBe(2);
    expect(profile.requiredSkills).toEqual(['javascript', 'node.js']);
    expect(profile.dealBreakers).toEqual(['php']);
    expect(profile.scoringWeights.requiredSkills).toBe(50);
    expect(profile.minScoreThreshold).toBe(70);
  });
});

describe('engine — regression dataset suite', () => {
  it('correctly evaluates all 12 regression dataset entries', async () => {
    const { regressionDataset } = await import('../fixtures/regression-dataset.js');

    for (const entry of regressionDataset) {
      const result = evaluate(entry.messageText, testProfile);
      expect(
        result.verdict,
        `Expected ${entry.id} (${entry.notes}) to be ${entry.expectedVerdict}, got ${result.verdict} (score=${result.score})`
      ).toBe(entry.expectedVerdict);
    }
  });
});
