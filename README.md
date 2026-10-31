<img src="assets/AfriPersonal.png" align="right" width="220" alt="AfriPersonal Mascot" />

# AfriPersonal

A private, single-user Telegram personal assistant that continuously scans and filters Ethiopian freelance and tech job channels, delivering matching engineering and software opportunities straight to your private chat.

Powered by a fast, deterministic matching engine operating locally with **sub-millisecond evaluation**, zero external API costs, and cryptographic deduplication.

---

## 📡 Monitored Channels

AfriPersonal automatically aggregates and monitors 4 premier Ethiopian job channels:

1. **`@freelance_ethio`** — Freelance Ethiopia (Tech, Development & Remote contracts)
2. **`@DagmawiBabiJobs`** — Dagmawi Babi Tech Jobs (Dedicated software engineering, frontend, backend, mobile)
3. **`@ethiojobsofficial`** — Ethio Jobs Official (National and regional opportunities)
4. **`@qena_jobs`** — Qena Jobs (Tech & professional vacancies)

---

## ⚡ Key Capabilities

* **Strict Technical Filter**: Matches genuine tech job titles only (`Software Engineer`, `Frontend Developer`, `Backend Developer`, `Fullstack`, `Mobile Developer`, `DevOps`, `UI/UX Designer`, `Data Engineer`, `QA Engineer`, etc.). Aggressively suppresses non-tech clutter (sales, accounting, driving, marketing, clerical work).
* **Verbatim Delivery**: Forwards the exact original post text, formatting, and direct links back to Telegram without altering a word.
* **Source Indicator**: Every job card clearly indicates its channel origin:
  ```text
  📡 Source: @DagmawiBabiJobs
  
  Senior Full-Stack Developer (Node.js & React)
  ...
  🔗 View original Telegram post
  👉 Apply / Link
  [ 👍 Relevant ] [ 👎 Not relevant ] [ 💼 Applied ]
  ```
* **Cryptographic Deduplication**: SHA-256 normalized text hashing prevents repeat alerts for the same reposted job across channels or days.
* **Interactive On-Demand Screening (`/fetch`)**:
  - **Step 1**: Select channel (`🌐 All Channels`, `@freelance_ethio`, `@DagmawiBabiJobs`, `@ethiojobsofficial`, `@qena_jobs`).
  - **Step 2**: Select quantity (`50`, `100`, `150`, or `200` recent posts).
  - Screens instantly and provides a complete per-channel breakdown.
* **15-Minute Scan Reports (`/reports`)**:
  - Automatically summarizes every 15-minute polling cycle across all 4 channels (`Total Scanned = Relevant + Rejected`).
  - Toggle ON/OFF anytime. When OFF, silent mode activates: you only receive alerts when a relevant tech job is found.
* **Pristine Chat Cleaner (`/clear`)**:
  - Wipes all job alerts, reports, and command clutter down to the original first welcome card.
  - Leaves the initial interactive welcome menu intact so you can access all controls immediately.
* **Single-Owner Security**: Strict whitelist middleware enforces that only your Telegram `OWNER_CHAT_ID` can interact with the bot.

---

## 🤖 Bot Commands

| Command | Description |
| :--- | :--- |
| `/start` | Launch the bot, view welcome menu, and access quick buttons. |
| `/fetch` | Screen 50, 100, 150, or 200 posts from a specific channel or all channels. |
| `/reports` | Toggle 15-minute scan report summaries (ON / OFF). |
| `/status` | View operational health, channels monitored, today's activity (EAT), and feedback stats. |
| `/sources` | Inspect configured sources, ingestion method, and health. |
| `/profile` | View your active career profile, target titles, skills, and scoring weights. |
| `/clear` | Clear all chat messages and clutter down to the first welcome card. |
| `/help` | Detailed instructions and command guide. |

---

## 🛠️ Architecture & Tech Stack

* **Runtime**: Node.js 22 LTS (ESM, TypeScript)
* **Telegram Framework**: [grammY](https://grammy.dev/)
* **Database**: SQLite with `better-sqlite3` and [Drizzle ORM](https://orm.drizzle.team/) (WAL mode + foreign key enforcement)
* **Matching Engine**: Deterministic rule-based scorer (sub-1ms execution, title taxonomy matching, skill normalization)
* **Test Suite**: [Vitest](https://vitest.dev/) (153 unit & integration tests)

---

## 🚀 Environment Configuration

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `BOT_TOKEN` | **Yes** | — | Telegram Bot API token from [@BotFather](https://t.me/BotFather). |
| `OWNER_CHAT_ID` | **Yes** | — | Your numeric Telegram user ID. |
| `TELEGRAM_CHANNELS` | No | `freelance_ethio,DagmawiBabiJobs,ethiojobsofficial,qena_jobs` | Comma-separated list of Telegram channel handles to monitor. |
| `POLLING_INTERVAL_MS` | No | `900000` (15m) | Background polling frequency in milliseconds. |
| `DB_PATH` | No | `data/afripersonal.db` | Local SQLite database file path. |
| `LOG_LEVEL` | No | `info` | Logging verbosity (`trace`, `debug`, `info`, `warn`, `error`). |
| `NOTIFICATION_THRESHOLD` | No | `60` | Minimum score threshold for notifications. |
| `DATA_RETENTION_DAYS` | No | `90` | Prunes evaluated entries older than N days. |

---

## 📦 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript
npm run build

# 3. Run all tests
npm test

# 4. Start locally
npm start
```

---

## 📄 License

MIT
