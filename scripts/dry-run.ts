/**
 * dry-run.ts
 *
 * Dry-run test: fetches the real Telegram channel, runs posts through the
 * classifier, and prints exactly what would be delivered to your DM —
 * without needing BOT_TOKEN or OWNER_CHAT_ID.
 *
 * Run: npx tsx scripts/dry-run.ts
 */

import { parsePosts } from '../src/sources/telegram-web-adapter.js';
import { isJobAnnouncement } from '../src/matching/job-detector.js';
import { evaluate } from '../src/matching/engine.js';
import { normalizeText } from '../src/matching/normalizer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CHANNEL_URL = process.env['TELEGRAM_CHANNEL_URL'] ?? 'https://t.me/s/freelance_ethio';
const MIN_SCORE   = parseInt(process.env['NOTIFICATION_THRESHOLD'] ?? '30', 10);
const BACKFILL    = parseInt(process.argv[2] ?? '50', 10); // default: last 50 posts

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Broad Any-Tech profile (mirrors seed.ts) ──────────────────────────────────

const PROFILE = {
  id: 0,
  version: 1,
  name: 'Broad Any-Tech Profile (dry-run)',
  targetTitles: [
    'Software Engineer','Software Developer','Full Stack Developer','Fullstack Developer',
    'Frontend Developer','Frontend Engineer','Backend Developer','Backend Engineer',
    'Mobile Developer','Flutter Developer','Android Developer','iOS Developer',
    'React Native Developer','Web Developer','Node.js Developer','Python Developer',
    'Django Developer','React Developer','Vue Developer','Angular Developer',
    'Java Developer','Kotlin Developer','TypeScript Developer','DevOps Engineer',
    'Data Engineer','Data Scientist','Machine Learning Engineer','AI Engineer',
    'Cloud Engineer','Database Administrator','DBA','Systems Administrator',
    'Network Engineer','IT Support','IT Specialist','Cybersecurity Engineer',
    'UI Designer','UX Designer','UI/UX Designer','Product Designer','Tech Lead',
    'QA Engineer','Test Engineer','Automation Engineer','Blockchain Developer',
  ],
  targetRoleFamilies: [
    'software','engineering','developer','frontend','backend','fullstack','mobile',
    'web','devops','data','cloud','design','cybersecurity',
    'networking','database','tech','programming','coding','intern','internship',
  ],
  requiredSkills: [
    'JavaScript','TypeScript','Python','Java','Kotlin','Swift','Go','Rust','C#',
    'C++','PHP','Ruby','Dart','Flutter','React','Vue','Angular','Node.js','Django',
    'Laravel','Spring','SQL','HTML','CSS','Docker','Kubernetes','AWS','Azure',
    'GCP','Firebase','MongoDB','PostgreSQL','MySQL','Redis','GraphQL','REST API',
    'Git','Linux','Android','iOS','React Native','Next.js','TensorFlow','PyTorch',
    'Terraform','CI/CD',
  ],
  preferredSkills: ['TypeScript','React','Node.js','Flutter','Python','Docker','PostgreSQL'],
  seniorityLevels: ['intern','junior','mid','senior','lead','principal'],
  employmentTypes: ['fulltime','parttime','contract','freelance','internship'],
  workArrangements: ['remote','hybrid','onsite'],
  preferredLocations: ['remote','Africa','Ethiopia','Addis Ababa'],
  exclusions: [],
  dealBreakers: [
    'sales representative','sales rep','sales engineer','sales officer',
    'social media manager','social media marketing','content creator',
    'marketing specialist','marketing manager','marketing officer',
    'driving job','driver wanted','delivery driver','farming','agriculture',
    'hotel staff','sewing','garment','receptionist','nurse wanted','nursing',
    'accountant','waiter','waitress','chef','barista','security guard',
    'cashier','cleaning staff','housekeeper','delivery boy','manual labor',
    'teacher','store keeper','office secretary','reporters',
  ],
  minScoreThreshold: MIN_SCORE,
  scoringWeights: {
    requiredSkills: 40, preferredSkills: 20, workArrangement: 20,
    seniorityMatch: 10, employmentType: 10,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function hr(char = '─', width = 70) { return char.repeat(width); }

function truncate(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function badge(label: string, value: string | number, color: 'green' | 'red' | 'yellow' | 'blue' | 'grey') {
  const colors = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[36m', grey: '\x1b[90m' };
  return `${colors[color]}${label}: ${value}\x1b[0m`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + hr('═'));
  console.log(`  🔍  AfriPersonal Dry Run`);
  console.log(`  Channel : ${CHANNEL_URL}`);
  console.log(`  Posts   : last ${BACKFILL}`);
  console.log(`  Score ≥ : ${MIN_SCORE}`);
  console.log(hr('═') + '\n');

  // 1. Fetch posts with backward pagination up to BACKFILL
  process.stdout.write(`Fetching channel posts (target: ${BACKFILL})... `);
  const allPosts: ReturnType<typeof parsePosts> = [];
  let currentUrl = CHANNEL_URL;

  try {
    while (allPosts.length < BACKFILL) {
      const res = await fetch(currentUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        if (allPosts.length > 0) break;
        console.log(`\x1b[31mFAILED (HTTP ${res.status})\x1b[0m`);
        process.exit(1);
      }

      const html = await res.text();
      const parsed = parsePosts(html);
      if (parsed.length === 0) break;

      const newPosts = parsed.filter(
        (p) => !allPosts.some((existing) => existing.messageId === p.messageId),
      );
      if (newPosts.length === 0) break;

      allPosts.push(...newPosts);
      if (allPosts.length >= BACKFILL) break;

      const minId = Math.min(...allPosts.map((p) => parseInt(p.messageId, 10)));
      if (!isFinite(minId) || minId <= 1) break;

      currentUrl = `${CHANNEL_URL}?before=${minId}`;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    console.log(`\x1b[32mOK (${allPosts.length} posts fetched)\x1b[0m`);
  } catch (err) {
    console.log(`\x1b[31mFAILED\x1b[0m`);
    console.error('Network error:', err);
    process.exit(1);
  }

  if (allPosts.length === 0) {
    console.error('\x1b[31mNo posts found — HTML structure may have changed.\x1b[0m');
    process.exit(1);
  }

  // Take the last N (most recent)
  const sorted = allPosts.sort((a, b) => parseInt(a.messageId, 10) - parseInt(b.messageId, 10));
  const posts   = sorted.slice(-BACKFILL);

  console.log(`Evaluating last ${posts.length} posts...\n`);
  console.log(hr());

  // 3. Evaluate each post
  let matchCount   = 0;
  let noJobCount   = 0;
  let noMatchCount = 0;
  let excludedCount = 0;

  for (const post of posts) {
    const normalized = normalizeText(post.text);
    const isJob      = isJobAnnouncement(normalized);
    const postDate   = post.postedAt ? post.postedAt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : 'unknown date';
    const msgUrl     = `${CHANNEL_URL.replace('/s/', '/')}/${post.messageId}`;

    if (!isJob) {
      noJobCount++;
      console.log(`[${post.messageId}] ${badge('SKIP', 'not a job post', 'grey')}  — ${postDate}`);
      console.log(`         ${truncate(post.text.replace(/\n/g, ' '), 80)}`);
      console.log();
      continue;
    }

    const result = evaluate(post.text, PROFILE);

    if (result.verdict === 'excluded') {
      excludedCount++;
      console.log(`[${post.messageId}] ${badge('EXCLUDED', result.triggeredExclusions.join(', '), 'red')}  — ${postDate}`);
      console.log(`         ${truncate(post.text.replace(/\n/g, ' '), 80)}`);
      console.log();
      continue;
    }

    if (result.verdict !== 'match') {
      noMatchCount++;
      console.log(`[${post.messageId}] ${badge('NO MATCH', `score ${result.score}/${MIN_SCORE}`, 'yellow')}  — ${postDate}`);
      console.log(`         ${truncate(post.text.replace(/\n/g, ' '), 80)}`);
      if (result.matchedSkills.length > 0) {
        console.log(`         skills: ${result.matchedSkills.join(', ')}`);
      }
      console.log();
      continue;
    }

    // ── MATCH ────────────────────────────────────────────────────────────────
    matchCount++;
    console.log(hr('─'));
    console.log(`[${post.messageId}] ${badge('✅ MATCH', `score ${result.score}/100`, 'green')}  — ${postDate}`);
    console.log(`         ${badge('link', msgUrl, 'blue')}`);
    if (result.matchedSkills.length > 0) {
      console.log(`         Skills matched: ${result.matchedSkills.join(', ')}`);
    }
    if (result.matchedRoles.length > 0) {
      console.log(`         Roles matched:  ${result.matchedRoles.join(', ')}`);
    }
    console.log();
    console.log('  ── What would be delivered to your Telegram DM ──────────────────');
    console.log();
    // Print the verbatim message exactly as it would appear in Telegram
    const lines = post.text.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log();
    if (post.links.length > 0) {
      console.log(`  🔗 View original post: ${msgUrl}`);
    } else {
      console.log(`  🔗 View original post: ${msgUrl}`);
    }
    console.log();
    console.log('  [👍 Relevant]  [👎 Not relevant]  [💼 Applied]');
    console.log(hr('─'));
    console.log();
  }

  // 4. Summary
  console.log(hr('═'));
  console.log(`  📊  Summary`);
  console.log(`  Posts evaluated : ${posts.length}`);
  console.log(`  ${badge('✅ Matches', matchCount, 'green')}`);
  console.log(`  ${badge('⏭  Skipped (not a job)', noJobCount, 'grey')}`);
  console.log(`  ${badge('❌ Excluded (non-tech)', excludedCount, 'red')}`);
  console.log(`  ${badge('📉 Below threshold', noMatchCount, 'yellow')} (score < ${MIN_SCORE})`);
  console.log(hr('═'));

  if (matchCount === 0) {
    console.log('\n  No tech matches in these posts. Try increasing the batch size:');
    console.log('  npx tsx scripts/dry-run.ts 50\n');
  } else {
    console.log(`\n  ✅ ${matchCount} job(s) would be forwarded to your DM.\n`);
    console.log('  Once BOT_TOKEN and OWNER_CHAT_ID are set, run:');
    console.log('  npm run dev\n');
  }
}

main().catch((err) => {
  console.error('\x1b[31mDry run failed:\x1b[0m', err);
  process.exit(1);
});

