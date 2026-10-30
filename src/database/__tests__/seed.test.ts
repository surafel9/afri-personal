import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createSourcesRepo } from '../repositories/sources.js';
import { createProfileRepo } from '../repositories/profile.js';

/**
 * Minimal inline seed function for test isolation.
 * Mirrors the logic in seed.ts without requiring the DB_PATH env var.
 */
async function runSeed(
  db: ReturnType<typeof createDb>['db'],
  sqlite: ReturnType<typeof createDb>['sqlite'],
) {
  await runMigrations(sqlite);

  const sourcesRepo = createSourcesRepo(db);
  const profileRepo = createProfileRepo(db);
  const now = new Date().toISOString();

  sourcesRepo.upsert({
    id: 'manual',
    displayName: 'Manual Import (Forwarded / /import command)',
    enabled: 1,
    ingestionMethod: 'manual',
    createdAt: now,
  });

  sourcesRepo.upsert({
    id: 'fixture',
    displayName: 'Fixture Loader (Test Data)',
    enabled: 1,
    ingestionMethod: 'fixture',
    createdAt: now,
  });

  const existing = profileRepo.getActive();
  if (existing == null) {
    profileRepo.create({
      name: 'Example Fullstack Developer Profile',
      requiredSkills: ['JavaScript', 'TypeScript', 'Node.js'],
      preferredSkills: ['React', 'PostgreSQL'],
      seniorityLevels: ['mid', 'senior'],
      employmentTypes: ['fulltime', 'contract', 'freelance'],
      workArrangements: ['remote', 'hybrid'],
    });
  }
}

describe('seed idempotency', () => {
  let db: ReturnType<typeof createDb>['db'];
  let sqlite: ReturnType<typeof createDb>['sqlite'];

  beforeEach(async () => {
    ({ db, sqlite } = createDb(':memory:'));
    await runMigrations(sqlite);
  });

  it('seeds sources and profile on first run', async () => {
    await runSeed(db, sqlite);

    const sourcesRepo = createSourcesRepo(db);
    const profileRepo = createProfileRepo(db);

    const sources = sourcesRepo.findAll();
    expect(sources).toHaveLength(2);
    expect(sources.map(s => s.id)).toContain('manual');
    expect(sources.map(s => s.id)).toContain('fixture');

    const profile = profileRepo.getActive();
    expect(profile).not.toBeUndefined();
    expect(profile!.name).toBe('Example Fullstack Developer Profile');
  });

  it('is idempotent — running seed twice does not duplicate data', async () => {
    await runSeed(db, sqlite);
    await runSeed(db, sqlite);

    const sourcesRepo = createSourcesRepo(db);
    const profileRepo = createProfileRepo(db);

    const sources = sourcesRepo.findAll();
    // Should still be exactly 2 sources, not 4
    expect(sources).toHaveLength(2);

    const profiles = profileRepo.list();
    // Should still be exactly 1 profile (second run skips creation)
    expect(profiles).toHaveLength(1);
  });

  it('does not throw on repeated seed calls', async () => {
    await expect(runSeed(db, sqlite)).resolves.not.toThrow();
    await expect(runSeed(db, sqlite)).resolves.not.toThrow();
    await expect(runSeed(db, sqlite)).resolves.not.toThrow();
  });

  it('migrations are idempotent (IF NOT EXISTS guards)', async () => {
    // Run migrations twice — should not throw
    await expect(runMigrations(sqlite)).resolves.not.toThrow();
    await expect(runMigrations(sqlite)).resolves.not.toThrow();
  });
});
