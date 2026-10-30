# AfriPersonal

A private, single-user Telegram bot that filters job channel posts and delivers matching opportunities directly to your Telegram DMs using a deterministic rule engine.

## Features

- Zero AI Costs: Fast, explainable rule engine (<1ms evaluation) with no external LLMs or monthly API bills.
- Smart Tech Normalization: Automatically recognizes skill and role variations (NodeJS, React.js, Flutter, SQL, TypeScript).
- Duplicate Suppression: Detects reposted announcements using cryptographic hashes to prevent duplicate alerts.
- Private and Secure: Single-owner verification ensures only your configured Telegram account can interact with the bot.
- Interactive Alerts: Delivers matching jobs directly to your chat with apply links and feedback buttons (Relevant, Not relevant, Applied).

## Tech Stack

- Runtime: Node.js 22 LTS (TypeScript, ESM)
- Bot Framework: grammY
- Database: SQLite via better-sqlite3 and Drizzle ORM
- Testing: Vitest (136 automated tests)

## Bot Commands

- `/start` — Welcome message and instructions
- `/status` — System health and queue status
- `/profile` — View active matching preferences
- `/matches` — View recent matched jobs
- `/pause` / `/resume` — Pause or resume alert delivery
- `/stats` — Processing volume and match statistics
- `/import <text>` — Evaluate a job post manually

## Development and Testing

```bash
npm test          # Run all 136 tests
npm run typecheck # Strict TypeScript check
npm run dev       # Hot-reload development mode
```

## License

MIT
