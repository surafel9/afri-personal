/**
 * Seed script — populates initial data for AfriPersonal.
 * Safe to run multiple times (idempotent).
 *
 * Run with: npm run db:seed
 */
import { createDb } from './client.js';
import { runMigrations } from './migrate.js';
import { createSourcesRepo } from './repositories/sources.js';
import type { Db } from './client.js';
import { createProfileRepo } from './repositories/profile.js';

const DB_PATH = process.env['DB_PATH'] ?? 'data/afripersonal.db';

export function seedDatabase(db: Db): void {
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

  // ── Seed telegram-web source ─────────────────────────────────────────────────
  // The actual channel URL is set via TELEGRAM_CHANNEL_URL env var.
  // This record registers the source type so it appears in the sources table.
  sourcesRepo.upsert({
    id: 'telegram-web:freelance_ethio',
    displayName: 'Telegram Web Channel (freelance_ethio)',
    enabled: 1,
    ingestionMethod: 'polling',
    createdAt: now,
  });
  console.log('[seed] Upserted source: telegram-web:freelance_ethio');

  // ── Seed broad tech profile ──────────────────────────────────────────────────
  // Broad "Any Tech Work" profile per the AfriPersonal roadmap.
  // Accepts any technical role across all employment types, including internships.
  // Aggressively rejects non-tech clutter.
  // The minScoreThreshold is kept low (30) because the job-detector pre-filters
  // non-job posts before scoring, so we only want to reject truly irrelevant
  // tech-adjacent posts — not miss valid tech jobs.

  const existing = profileRepo.getActive();
  if (existing == null) {
    profileRepo.create({
      name: 'Broad Any-Tech Profile',

      // ── Titles: any tech role is welcome ────────────────────────────────────
      targetTitles: [
        'Software Engineer',
        'Software Developer',
        'Full Stack Developer',
        'Fullstack Developer',
        'Frontend Developer',
        'Frontend Engineer',
        'Backend Developer',
        'Backend Engineer',
        'Mobile Developer',
        'Flutter Developer',
        'Android Developer',
        'iOS Developer',
        'React Native Developer',
        'Web Developer',
        'Node.js Developer',
        'Python Developer',
        'Django Developer',
        'React Developer',
        'Vue Developer',
        'Angular Developer',
        'Java Developer',
        'Kotlin Developer',
        'TypeScript Developer',
        'DevOps Engineer',
        'Site Reliability Engineer',
        'Data Engineer',
        'Data Scientist',
        'Machine Learning Engineer',
        'AI Engineer',
        'Cloud Engineer',
        'Database Administrator',
        'DBA',
        'Systems Administrator',
        'Sysadmin',
        'Network Engineer',
        'IT Support',
        'IT Specialist',
        'Cybersecurity Engineer',
        'UI Designer',
        'UX Designer',
        'UI/UX Designer',
        'Product Designer',
        'Tech Lead',
        'Engineering Manager',
        'CTO',
        'Software Architect',
        'QA Engineer',
        'Test Engineer',
        'Automation Engineer',
        'Blockchain Developer',
        'Smart Contract Developer',
        'Embedded Systems Engineer',
        'Firmware Engineer',
      ],

      // ── Role families: broad tech umbrella ────────────────────────────────
      targetRoleFamilies: [
        'software',
        'engineering',
        'developer',
        'frontend',
        'backend',
        'fullstack',
        'mobile',
        'web',
        'devops',
        'data',
        'cloud',
        'design',
        'cybersecurity',
        'networking',
        'database',
        'tech',
        'programming',
        'coding',
        'intern',
        'internship',
      ],

      // ── Required skills: any mention of a tech stack is enough ────────────
      // The scorer requires at least one required skill to avoid capping at 50.
      // We use a wide list so almost any tech post hits at least one.
      requiredSkills: [
        'JavaScript',
        'TypeScript',
        'Python',
        'Java',
        'Kotlin',
        'Swift',
        'Go',
        'Rust',
        'C#',
        'C++',
        'PHP',
        'Ruby',
        'Dart',
        'Flutter',
        'React',
        'Vue',
        'Angular',
        'Node.js',
        'Django',
        'Laravel',
        'Spring',
        'SQL',
        'HTML',
        'CSS',
        'Docker',
        'Kubernetes',
        'AWS',
        'Azure',
        'GCP',
        'Firebase',
        'MongoDB',
        'PostgreSQL',
        'MySQL',
        'Redis',
        'GraphQL',
        'REST API',
        'Git',
        'Linux',
        'Android',
        'iOS',
        'React Native',
        'Next.js',
        'TensorFlow',
        'PyTorch',
        'Terraform',
        'CI/CD',
      ],

      preferredSkills: [
        'TypeScript',
        'React',
        'Node.js',
        'Flutter',
        'Python',
        'Docker',
        'PostgreSQL',
      ],

      // ── Accept every seniority level including internships ────────────────
      seniorityLevels: ['intern', 'junior', 'mid', 'senior', 'lead', 'principal'],

      // ── Accept every employment type ──────────────────────────────────────
      employmentTypes: ['fulltime', 'parttime', 'contract', 'freelance', 'internship'],

      // ── Accept any work arrangement ───────────────────────────────────────
      workArrangements: ['remote', 'hybrid', 'onsite'],

      preferredLocations: ['remote', 'Africa', 'Ethiopia', 'Addis Ababa'],

      // ── Exclusions: non-tech clutter (soft filter) ────────────────────────
      exclusions: [],

      // ── Deal-breakers: hard non-tech professions (hard filter) ────────────
      // If any of these appear, the post is immediately rejected.
      dealBreakers: [
        'sales representative',
        'sales rep',
        'sales engineer',
        'sales officer',
        'social media manager',
        'social media marketing',
        'content creator',
        'marketing specialist',
        'marketing manager',
        'marketing officer',
        'driving job',
        'driver wanted',
        'delivery driver',
        'farming',
        'agriculture',
        'hotel staff',
        'sewing',
        'garment',
        'receptionist',
        'nurse wanted',
        'nursing',
        'accountant',
        'waiter',
        'waitress',
        'chef',
        'barista',
        'security guard',
        'cashier',
        'cleaning staff',
        'housekeeper',
        'delivery boy',
        'manual labor',
        'teacher',
        'store keeper',
        'office secretary',
        'reporters',
      ],

      // ── Scoring: low threshold so we catch broad tech matches ─────────────
      // The job-detector already pre-filters non-job posts.
      // A score of 30 means at least one required tech skill was found.
      minScoreThreshold: 30,

      scoringWeights: {
        requiredSkills: 40,
        preferredSkills: 20,
        workArrangement: 20,
        seniorityMatch: 10,
        employmentType: 10,
      },
    });
    console.log('[seed] Created broad Any-Tech profile.');
  } else {
    console.log(
      `[seed] Active profile already exists (id=${existing.id}), skipping.`,
    );
  }
}

async function runCliSeed() {
  const { db, sqlite } = createDb(DB_PATH);
  await runMigrations(sqlite);
  seedDatabase(db);
  console.log('[seed] Done.');
  sqlite.close();
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  runCliSeed().catch(err => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  });
}
