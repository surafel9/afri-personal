# 🌍 AfriPersonal: The Smart Telegram Job Matcher

A **private, single-user** Telegram bot that ingests job opportunities and notifies you only about the ones that match your exact career profile — using an explainable deterministic rule engine, official Telegram Bot API, and zero external LLMs or cloud subscriptions.

---

## 📑 Table of Contents

1. [Product Overview](#-product-overview)
2. [What It Does NOT Do](#-what-it-does-not-do)
3. [Architecture & Pipeline](#-architecture--pipeline)
4. [Quick Setup](#-quick-setup)
5. [Configuration Reference](#-configuration-reference)
6. [Telegram Bot Commands](#-telegram-bot-commands)
7. [Job Ingestion Guide](#-job-ingestion-guide)
8. [Database Schema & Backup](#-database-schema--backup)
9. [Production Deployment (systemd)](#-production-deployment-systemd)
10. [Testing & Quality Assurance](#-testing--quality-assurance)
11. [Project Structure](#-project-structure)

---

## 💡 Product Overview

Job channels in Telegram (like Afriwork / Freelance Ethiopia) post dozens or hundreds of messages daily: a mix of relevant roles, irrelevant positions, duplicated announcements, commercial ads, and uninformative snippets.

**AfriPersonal** filters the noise for you:
1. **Ingests** job announcements via official, ToS-compliant channels (direct forwarding or `/import`).
2. **Deduplicates** reposted announcements using cryptographic hashes and job relation tracking.
3. **Normalizes** tech skills, aliases (e.g. `NodeJS` ➔ `node.js`, `postgres` ➔ `postgresql`), work modes, and seniority.
4. **Evaluates** posts against your profile deterministically with explainable scoring.
5. **Notifies** your private Telegram chat with complete details, matched reasons, and missing info flags.
6. **Collects feedback** (`👍 Relevant`, `👎 Not relevant`, `💼 Applied`) via inline buttons for future profile tuning.

---

## 🚫 What It Does NOT Do

- **No web UI or SaaS dashboard in v1** — Telegram is the full command & control interface.
- **No external LLM calls** — 100% deterministic, explainable rules. Zero API bills, zero data leaks, microsecond execution.
- **No auto-applying or messaging recruiters** — you maintain full agency.
- **No automated scraping of third-party channels via user accounts** — avoids Telegram ToS violations and account ban risk (see [LATER.md](file:///home/sinux/Projects/personal/afri-personal/LATER.md)).
- **No complex multi-service infrastructure** — single Node.js 22 LTS process with embedded SQLite (WAL mode).

---

## 🏗️ Architecture & Pipeline

```
  ┌────────────────────────────────────────────────────────┐
  │                 Telegram Ingestion                     │
  │  • User forwards channel posts to bot                  │
  │  • User pastes text via /import command                │
  │  • FixtureAdapter for testing & replay                 │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │            Deduplication & Persistence                 │
  │  • Unique constraint on (sourceId, externalId)         │
  │  • SHA-256 normalized textHash comparison              │
  │  • Links duplicates in SQLite `jobs` table             │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │         Deterministic Rule Matching Engine             │
  │  1. Text Normalization & Skill Alias Mapping           │
  │  2. Job vs Promo vs News Detection                     │
  │  3. Field Extraction (Title, Company, Mode, Deadlines) │
  │  4. Hard Exclusion & Deal-Breaker Gates                │
  │  5. Weighted Scoring (0–100) & Reasons Explanation     │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │           Durable Notification Queue                   │
  │  • Suppresses alerts for known duplicate jobs          │
  │  • Rate-limit aware (respects 429 & retry_after)       │
  │  • Bounded exponential backoff with jitter             │
  │  • Crash recovery of pending / sending states          │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │         Telegram Bot DM (Owner Chat Only)              │
  │  • HTML-formatted notification with links              │
  │  • Inline feedback: [👍 Relevant] [👎 Not] [💼 Applied]│
  └────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Setup

### Prerequisites
- Node.js 22 LTS (`>= 22.0.0`)
- A Telegram account and a bot token from [@BotFather](https://t.me/BotFather)

```bash
# 1. Clone the repository
git clone <repo-url> afri-personal
cd afri-personal

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrSTUvwxYZ
OWNER_CHAT_ID=123456789
```

> **How to get your `OWNER_CHAT_ID`:** Open Telegram and send `/start` to [@userinfobot](https://t.me/userinfobot). It will reply with your numeric ID.

```bash
# 4. Run database migrations
npm run db:migrate

# 5. Seed example profile & sources
npm run db:seed

# 6. Build and start
npm run build
npm start
```

For development with hot-reload:
```bash
npm run dev
```

---

## ⚙️ Configuration Reference

All settings are validated at boot with **Zod**:

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | ✅ Yes | — | Telegram Bot API token from [@BotFather](https://t.me/BotFather) |
| `OWNER_CHAT_ID` | ✅ Yes | — | Numeric Telegram user ID of the bot owner (access control) |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |
| `DB_PATH` | No | `data/afripersonal.db` | Local SQLite database file path |
| `NOTIFICATION_THRESHOLD` | No | `60` | Minimum score (0–100) to trigger a Telegram alert |
| `DATA_RETENTION_DAYS` | No | `90` | Automatic retention cleanup period for old evaluated items |

---

## 🤖 Telegram Bot Commands

AfriPersonal enforces **strict single-owner verification**. Commands or callback interactions from unauthorized users are immediately rejected and logged.

| Command | Description |
|---|---|
| `/start` | Welcome message, system overview, and command cheat sheet |
| `/help` | Detailed instructions on job forwarding, commands, and rules |
| `/status` | Operational status: paused state, queue depths, source health, and errors |
| `/sources` | Lists configured source adapters, ingestion methods, and last sync time |
| `/profile` | Displays the active career preferences, required/preferred skills, and threshold |
| `/matches` | Shows up to 5 recent qualified job opportunities and their top matching reasons |
| `/stats` | Aggregated metrics: total messages processed, evaluated, skipped, and alerts queued |
| `/pause` | Temporarily pauses job evaluation and notification delivery |
| `/resume` | Resumes normal processing and notification delivery |
| `/import <text>` | Manually imports and evaluates a job post immediately |

---

## 📥 Job Ingestion Guide

In v1, job announcements enter AfriPersonal through two ToS-compliant methods:

### Method 1: Forward from Any Channel (Recommended)
1. In Telegram, browse any public or private channel you belong to (e.g. [@freelance_ethio](https://t.me/freelance_ethio)).
2. Forward the post directly to your private AfriPersonal bot.
3. The bot preserves post timestamps, extracts links, evaluates the opportunity, and responds immediately with the evaluation result.

### Method 2: Direct Text / `/import`
1. Copy any job listing text from email, Telegram, or web.
2. Send: `/import <paste job listing text here>`
3. Or simply paste the raw text directly into the bot chat.

---

## 🗄️ Database Schema & Backup

AfriPersonal uses **better-sqlite3** with WAL mode enabled.

### Key Tables
- `sources`: Source configurations and last sync health.
- `source_messages`: Raw messages with `textHash` (SHA-256) and unique `(sourceId, externalId)` constraint.
- `profile`: Career profile versions (titles, skills, exclusions, weights).
- `evaluations`: Deterministic matching results, scores, explanations, and extracted fields.
- `jobs`: Canonical jobs with self-referencing duplicate tracking (`duplicateOfJobId`).
- `notifications`: Delivery queue with status, attempt counters, and Telegram message IDs.
- `feedback`: User ratings (`relevant`, `not_relevant`, `applied`).
- `app_state`: Key-value store for checkpoints and runtime flags (e.g. `paused`).

### Safe Backup & Restore Procedure

SQLite's WAL mode allows safe live backups using the SQLite CLI:

```bash
# Safe live backup without stopping the service:
sqlite3 data/afripersonal.db ".backup 'data/backup-$(date +%Y%m%d%H%M).db'"

# Restore from backup:
# 1. Stop the bot service:
sudo systemctl stop afripersonal

# 2. Replace the database:
cp data/backup-202610291200.db data/afripersonal.db

# 3. Restart the service:
sudo systemctl start afripersonal
```

---

## 🐧 Production Deployment (systemd)

AfriPersonal is designed as a single long-running Linux service.

### 1. Build the Application
```bash
npm run build
```

### 2. Configure systemd Service
A production systemd unit is provided at `deployment/afripersonal.service`.

Edit the file to match your username and directory paths:
```ini
[Unit]
Description=AfriPersonal Telegram Job Matcher Service
After=network.target

[Service]
Type=simple
User=sinux
WorkingDirectory=/home/sinux/Projects/personal/afri-personal
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=10s

EnvironmentFile=/home/sinux/Projects/personal/afri-personal/.env
Environment=NODE_ENV=production

KillSignal=SIGTERM
TimeoutStopSec=30s

StandardOutput=journal
StandardError=journal
SyslogIdentifier=afripersonal

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/home/sinux/Projects/personal/afri-personal/data

[Install]
WantedBy=multi-user.target
```

### 3. Enable and Start
```bash
sudo cp deployment/afripersonal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now afripersonal

# Check status:
sudo systemctl status afripersonal

# View live operational logs:
journalctl -u afripersonal -f
```

---

## 🧪 Testing & Quality Assurance

AfriPersonal includes a test suite covering the engine, database, parser, queue, and bot security:

```bash
# Run all tests
npm test

# Run type-checking
npm run typecheck
```

### Test Suite Summary
- **Normalizer & Aliases**: Tests canonical resolution for technology variations (`nodejs`, `react.js`, `ts`, `k8s`).
- **Job Detector**: Tests detection heuristics against advertisements, Amharic-only announcements, and spam.
- **Field Extractor**: Tests extraction of job titles, companies, locations, work modes, and deadlines.
- **Scorer & Gate Rules**: Tests required skills presence, deal-breakers (`PHP`, `onsite only`), and score thresholds.
- **Regression Suite**: Automated regression tests over 12 diverse benchmark listings.
- **Ingestion & Deduplication**: Tests idempotent message insertion, duplicate suppression, and checkpoints.
- **Notification Delivery**: Tests Telegram 429 rate limits, exponential backoff, retry caps, and HTML escaping.
- **Bot Security**: Tests owner-only authorization and callback handling.

---

## 📁 Project Structure

```
afri-personal/
├── deployment/
│   └── afripersonal.service       # Production systemd service unit
├── src/
│   ├── main.ts                    # Main entry point & lifecycle management
│   ├── config/
│   │   └── index.ts               # Zod-validated environment config
│   ├── observability/
│   │   └── logger.ts              # Pino structured logger with secret redaction
│   ├── database/
│   │   ├── schema.ts              # Relational schema (Drizzle ORM)
│   │   ├── client.ts              # SQLite client (better-sqlite3 + WAL)
│   │   ├── migrate.ts             # Migration runner
│   │   ├── seed.ts                # Idempotent seed script
│   │   └── repositories/          # Type-safe repository layer
│   │       ├── sources.ts
│   │       ├── messages.ts
│   │       ├── profile.ts
│   │       ├── evaluations.ts
│   │       ├── jobs.ts
│   │       ├── notifications.ts
│   │       ├── feedback.ts
│   │       └── app-state.ts
│   ├── matching/
│   │   ├── types.ts               # Core domain models
│   │   ├── normalizer.ts          # Normalization & canonical aliases
│   │   ├── job-detector.ts        # Announcement vs promo heuristics
│   │   ├── field-extractor.ts     # Deterministic regex field parser
│   │   ├── scorer.ts              # Explainable rule-based scoring engine
│   │   ├── engine.ts              # Evaluator facade
│   │   └── fixtures/
│   │       └── regression-dataset.ts
│   ├── sources/
│   │   ├── types.ts               # RawMessage & SourceAdapter contracts
│   │   ├── manual-adapter.ts      # Manual / forwarded message adapter
│   │   └── fixture-adapter.ts     # Realistic test data stream
│   ├── pipeline/
│   │   ├── ingestion.ts           # Ingestion pipeline & hash deduplication
│   │   ├── coordinator.ts         # Crash recovery & orchestration
│   │   └── retention.ts           # Automatic data pruning
│   ├── notifications/
│   │   ├── formatter.ts           # Safe HTML formatting & inline keyboards
│   │   └── delivery.ts            # Reliable delivery with backoff & 429 handling
│   └── bot/
│       └── bot.ts                 # grammY bot with single-owner security
├── NOTES.md                       # Architectural decisions & lessons learned
├── LATER.md                       # Deferred capabilities (userbot risk analysis)
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```
