/**
 * Seed script — populates initial data for AfriPersonal.
 * Safe to run multiple times (idempotent).
 *
 * Run with: npm run db:seed
 */
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { createSourcesRepo } from './repositories/sources.js';
import { createProfileRepo } from './repositories/profile.js';

const DB_PATH = process.env['DB_PATH'] ?? 'data/afripersonal.db';

async function seed() {
  const { db, sqlite } = createDb(DB_PATH);

  // Ensure schema is up to date before seeding
  await runMigrations(sqlite);

  const sourcesRepo = createSourcesRepo(db);
  const profileRepo = createProfileRepo(db);

  const now = new Date().toISOString();

  // ── Seed sources ────────────────────────────────────────────────────────────
  sourcesRepo.upsert({
    id: 'manual',
    displayName: 'Manual Import (Forwarded / /import command)',
    enabled: 1,
    ingestionMethod: 'manual',
    createdAt: now,
  });
  console.log('[seed] Upserted source: manual');

  sourcesRepo.upsert({
    id: 'fixture',
    displayName: 'Fixture Loader (Test Data)',
    enabled: 1,
    ingestionMethod: 'fixture',
    createdAt: now,
  });
  console.log('[seed] Upserted source: fixture');

  // ── Seed example profile ────────────────────────────────────────────────────
  // This is an example fullstack developer profile — NOT real preferences.
  // Replace with your own profile via bot commands once the bot is running.

  const existing = profileRepo.getActive();
  if (existing == null) {
    profileRepo.create({
      name: 'Example Fullstack Developer Profile',
      targetTitles: [
        'Full-Stack Developer',
        'Fullstack Engineer',
        'Backend Developer',
        'Frontend Developer',
        'Software Engineer',
        'Node.js Developer',
        'React Developer',
        'TypeScript Developer',
      ],
      targetRoleFamilies: [
        'engineering',
        'software',
        'backend',
        'frontend',
        'fullstack',
      ],
      requiredSkills: ['JavaScript', 'TypeScript', 'Node.js'],
      preferredSkills: [
        'React',
        'PostgreSQL',
        'SQLite',
        'REST API',
        'Docker',
        'Git',
        'Express',
        'Fastify',
        'Next.js',
        'GraphQL',
        'Redis',
        'AWS',
        'Vitest',
      ],
      seniorityLevels: ['mid', 'senior'],
      employmentTypes: ['fulltime', 'contract', 'freelance'],
      workArrangements: ['remote', 'hybrid'],
      preferredLocations: ['remote', 'Africa', 'Ethiopia'],
      exclusions: [
        'PHP only',
        'WordPress only',
        'no remote',
        'onsite only',
        'must be in office',
        'no visa sponsorship',
      ],
      dealBreakers: ['PHP', 'WordPress', 'no remote work option'],
      minScoreThreshold: 60,
      scoringWeights: {
        requiredSkills: 40,
        preferredSkills: 20,
        workArrangement: 20,
        seniorityMatch: 10,
        employmentType: 10,
      },
    });
    console.log('[seed] Created example profile.');
  } else {
    console.log(
      `[seed] Active profile already exists (id=${existing.id}), skipping.`,
    );
  }

  console.log('[seed] Done.');
  sqlite.close();
}

seed().catch(err => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
