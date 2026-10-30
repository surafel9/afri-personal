import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createProfileRepo } from '../repositories/profile.js';

function setupTestDb() {
  const { db, sqlite } = createDb(':memory:');
  return { db, sqlite };
}

describe('profile repository', () => {
  let db: ReturnType<typeof createDb>['db'];
  let sqlite: ReturnType<typeof createDb>['sqlite'];
  let profileRepo: ReturnType<typeof createProfileRepo>;

  beforeEach(async () => {
    ({ db, sqlite } = setupTestDb());
    await runMigrations(sqlite);
    profileRepo = createProfileRepo(db);
  });

  it('returns undefined when no active profile exists', () => {
    const active = profileRepo.getActive();
    expect(active).toBeUndefined();
  });

  it('creates a profile and retrieves it as active', () => {
    const created = profileRepo.create({
      name: 'Test Profile',
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: ['React', 'PostgreSQL'],
      seniorityLevels: ['mid', 'senior'],
      workArrangements: ['remote'],
      employmentTypes: ['fulltime', 'contract'],
      minScoreThreshold: 65,
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe('Test Profile');
    expect(created.isActive).toBe(1);

    const active = profileRepo.getActive();
    expect(active).not.toBeUndefined();
    expect(active!.id).toBe(created.id);
  });

  it('stores and retrieves JSON fields correctly', () => {
    profileRepo.create({
      requiredSkills: ['TypeScript', 'Node.js'],
      preferredSkills: ['React', 'Postgres'],
      exclusions: ['PHP only', 'WordPress'],
      dealBreakers: ['onsite only'],
    });

    const active = profileRepo.getActive();
    expect(active).not.toBeUndefined();
    // JSON columns are stored as strings — parse them to verify
    expect(JSON.parse(active!.requiredSkills)).toEqual([
      'TypeScript',
      'Node.js',
    ]);
    expect(JSON.parse(active!.preferredSkills)).toEqual(['React', 'Postgres']);
    expect(JSON.parse(active!.exclusions)).toEqual(['PHP only', 'WordPress']);
    expect(JSON.parse(active!.dealBreakers)).toEqual(['onsite only']);
  });

  it('updates profile fields', () => {
    const created = profileRepo.create({ name: 'Original Name' });
    const updated = profileRepo.update(created.id, {
      name: 'Updated Name',
      minScoreThreshold: 75,
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.minScoreThreshold).toBe(75);
  });

  it('lists all profiles', () => {
    profileRepo.create({ name: 'Profile A' });
    profileRepo.create({ name: 'Profile B' });

    const all = profileRepo.list();
    expect(all).toHaveLength(2);
  });

  it('setActive deactivates all others and activates the specified one', () => {
    const p1 = profileRepo.create({ name: 'P1' });
    const p2 = profileRepo.create({ name: 'P2' });

    // Both created with isActive=1, but p2 was created last so it's the active one
    // Let's explicitly set p1 as active
    profileRepo.setActive(p1.id);

    const active = profileRepo.getActive();
    expect(active!.id).toBe(p1.id);

    // Now switch to p2
    profileRepo.setActive(p2.id);
    const newActive = profileRepo.getActive();
    expect(newActive!.id).toBe(p2.id);

    // p1 should now be inactive
    const p1Fetched = profileRepo.findById(p1.id);
    expect(p1Fetched!.isActive).toBe(0);
  });
});
