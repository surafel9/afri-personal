<img src="assets/AfriPersonal.png" align="right" width="220" alt="AfriPersonal Mascot" />

# AfriPersonal

A private, single-user Telegram assistant that filters noisy job channels and delivers matching opportunities directly to your private chat using a fast, deterministic rule engine.

## The Problem

Job channels on Telegram (such as Freelance Ethiopia and regional tech boards) publish dozens or hundreds of messages every day. Finding relevant opportunities manually is tedious and inefficient:

- High Noise: Promotional advertisements, non-technical roles, and generic announcements clutter the feed.
- Repost Fatigue: The same job listing is frequently reposted over days or weeks with minor text or formatting variations.
- Wasted Time: Developers have to manually skim through hundreds of posts every day just to find the few opportunities that fit their specific niche.

## The Solution

AfriPersonal serves as an automated personal filter between noisy job channels and your private inbox:

- Deterministic Matching: Evaluates opportunities locally in under 1 millisecond using rule-based scoring and skill alias normalization (e.g. NodeJS, React, Flutter, SQL, Python).
- Repost Deduplication: Uses cryptographic text hashing to recognize reposted announcements, ensuring you are never alerted for the same job twice.
- Verbatim Delivery: Delivers the exact, unedited original post text and direct application links straight to your private Telegram DM.
- Zero AI Overhead: Operates with zero monthly API bills, no external LLM dependencies, and no network latency.
- Single-Owner Security: Strict access controls ensure the bot only processes requests and delivers alerts to your verified Telegram user ID.

## Tech Stack

- Runtime: Node.js 22 LTS (TypeScript, ESM)
- Bot Framework: grammY (Telegram Bot API framework)
- Database: SQLite with better-sqlite3 and Drizzle ORM
- Testing: Vitest

## License

MIT
