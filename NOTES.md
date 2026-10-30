# AfriPersonal — Architecture & Decision Notes

## Historical Notes

> The following was extracted from the original README.md before it was rewritten. It captures the initial vision and learning goals.

- Original vision: read 1,000+ daily messages from Telegram job channels using a Telegram **userbot** (MTProto via `gramjs`), filter with keyword bouncers, then classify with an external LLM (Groq/Llama3), and forward matching jobs to a personal Telegram DM.
- Original tech stack: `gramjs` (MTProto), Groq API (LLM), PostgreSQL, Prisma ORM, Express.js REST API, a frontend HTML/TailwindCSS dashboard.
- Original DB model: a single `Watcher` table holding channel targets, keywords, and a custom AI prompt per watcher.
- Learning goals stated: System Architecture, Telegram MTProto, Prompt Engineering, Database Design (Prisma), Node.js/Express.

These goals are still valid. The implementation evolved in response to ToS compliance constraints (see Ingestion section) and a desire to ship a reliable v1 faster.

---

## Architecture Decisions

### Why a single-user private bot?

AfriPersonal is intentionally **not** a SaaS product. It is a personal productivity tool for a single developer. This removes the complexity of multi-tenancy, auth, billing, and rate limiting — allowing the focus to be on matching quality.

### Why no LLM in v1?

**Cost predictability**: LLM APIs charge per token. A noisy Telegram channel can generate thousands of messages per day. Even at low per-token costs, unexpected spikes would occur.

**Latency**: An LLM round-trip (even to a fast inference provider like Groq) adds hundreds of milliseconds. A rule-based engine scores a message in microseconds.

**Controllability**: With a rule engine, you can inspect every scoring decision deterministically. With an LLM, you get probabilities and occasional hallucinations.

**The v1 rule engine is sufficient**: Keyword matching on title, skills, work arrangement, and seniority — combined with configurable weights and deal-breaker exclusions — gives precise enough filtering for a personal tool.

LLM classification is documented in `LATER.md` as the next step after the rule engine is proven.

### Why SQLite over PostgreSQL?

- **Zero infrastructure**: no server to run, no credentials to manage, no backups to configure beyond copying a single file.
- **Single user, low write concurrency**: the bot processes one message at a time; WAL mode handles any concurrent reads.
- **Simpler testing**: in-memory `:memory:` databases make tests fast and hermetic.
- **Portability**: the entire state of the application is a single `.db` file you can copy, inspect with any SQLite browser, and version-control as a snapshot.

PostgreSQL is appropriate for the multi-user SaaS evolution. For a personal tool running on one machine, SQLite is the right tradeoff.

### Why grammY over Telegraf?

- **TypeScript-first**: grammY was designed with TypeScript from day one; Telegraf's TypeScript support is retrofitted.
- **ESM compatible**: grammY ships proper ESM exports with no CommonJS hacks needed.
- **Active maintenance**: as of 2024–2025, grammY has more frequent releases and a better documented plugin ecosystem.
- **Middleware model**: grammY's context-aware middleware makes adding features (sessions, conversations, menus) cleaner.

### Why Vitest over Jest?

- Native ESM support with zero configuration.
- Faster startup (no Babel transform needed).
- Compatible with the `NodeNext` module resolution used throughout the project.

---

## Ingestion Constraints Decision

See `LATER.md` for the full options analysis. The short version:

- **Userbot (MTProto)**: technically works, but carries real Telegram ToS risk and account termination exposure. Deferred.
- **Bot-as-channel-admin**: only works if the channel owner adds our bot. Viable for channels you own. Limited for third-party channels.
- **v1 selected**: **ManualImport** — the user forwards job posts to the bot's private chat or uses the `/import` command to paste raw text. 100% compliant with Telegram's Bot API ToS.
