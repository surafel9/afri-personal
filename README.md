<img src="assets/AfriPersonal.png" align="right" width="140" alt="AfriPersonal Mascot" />

# AfriPersonal

A private, single-user Telegram assistant that filters noisy job channels and delivers matching opportunities directly to your private chat using a fast, deterministic rule engine.

## The Problem

Job channels on Telegram (such as Freelance Ethiopia and regional tech boards) publish dozens or hundreds of messages every day. Finding relevant opportunities manually is tedious and inefficient:

- **High Noise**: Promotional advertisements, non-technical roles, and generic announcements clutter the feed.
- **Repost Fatigue**: The same job listing is frequently reposted over days or weeks with minor text or formatting variations.
- **Wasted Time**: Developers have to manually skim through hundreds of posts every day just to find the few opportunities that fit their specific niche.

## The Solution

AfriPersonal serves as an automated personal filter between noisy job channels and your private inbox:

- **Deterministic Matching**: Evaluates opportunities locally in under 1 millisecond using rule-based scoring and skill alias normalization (e.g., Node.js, React, Flutter, SQL, Python).
- **Repost Deduplication**: Uses cryptographic text hashing to recognize reposted announcements, ensuring you are never alerted for the same job twice.
- **Verbatim Delivery**: Delivers the exact, unedited original post text and direct application links straight to your private Telegram DM.
- **Zero AI Overhead**: Operates with zero monthly API bills, no external LLM dependencies, and zero network latency for evaluation.
- **Single-Owner Security**: Strict access controls ensure the bot only processes requests and delivers alerts to your verified Telegram user ID.

## Bot Commands

Available via Telegram's native **[ Menu ]** button:

- `/start` — Welcome dashboard with the mascot and quick-action menu
- `/fetch50` — Ingest and evaluate the 50 most recent channel posts on demand
- `/status` — View pipeline health, total messages, match rate, and last checkpoint
- `/profile` — View your current matching profile, keywords, and score thresholds
- `/clear` — Safely clear chat history while preserving the welcome banner
- `/pause` / `/resume` — Temporarily stop or resume notification delivery
- `/help` — Usage guide and command descriptions

## Tech Stack

- **Runtime**: Node.js 22 LTS (TypeScript, ESM)
- **Bot Framework**: [grammY](https://grammy.dev/)
- **Database**: SQLite with [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) and [Drizzle ORM](https://orm.drizzle.team/)
- **Testing**: [Vitest](https://vitest.dev/)

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   BOT_TOKEN=your_telegram_bot_token
   OWNER_CHAT_ID=your_telegram_user_id
   ```

3. **Run the bot:**
   ```bash
   npm run dev      # Development mode with hot-reloading
   npm run build    # Compile TypeScript to dist/
   npm start        # Production mode
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

## License

MIT
