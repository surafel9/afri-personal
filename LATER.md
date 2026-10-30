# LATER.md — Deferred Features & Options Analysis

## Telegram Ingestion Options (Deferred)

The following ingestion methods were evaluated and deferred from v1. This document preserves the reasoning for future reference.

---

### Option 1: Userbot via MTProto (gramjs / telethon)

**What it is:** Log in as a real Telegram user account (phone number + auth code + optional 2FA) and programmatically read messages from any channel the account is a member of.

**Why it works technically:** MTProto is Telegram's native protocol. gramjs (JavaScript) and Telethon (Python) implement it fully. The account can join channels and stream incoming messages in real time.

**The risk — read carefully before using:**

> ⚠️ **Account Termination Risk**: Telegram's [Terms of Service](https://telegram.org/tos) and [API Terms of Service](https://core.telegram.org/api/terms) prohibit using the API for automated/mass data collection and for operating bots via user accounts (as opposed to the official Bot API). Telegram actively bans accounts detected doing automated scraping. If your personal phone number is associated with the account, you risk losing access to all your Telegram data and contacts permanently.
>
> ⚠️ **ToS Ambiguity**: The exact line between "personal automation" and "prohibited scraping" is not clearly defined in the ToS. Telegram enforces it at their discretion.
>
> ⚠️ **Dedicated account mitigation**: Some users run userbots on a throwaway SIM/account. This reduces personal risk but does not make the activity compliant.

**Status: DEFERRED** — Do not implement in v1. Revisit only if:

1. The channels you want to monitor are channels you own (admin access), OR
2. Telegram officially blesses userbot use for personal automation tools, OR
3. You are willing to use a dedicated disposable account with full understanding of the risk.

**Implementation notes for when/if this is revisited:**

- Use `gramjs` (npm package: `telegram`)
- Session string auth to avoid repeated login prompts
- Implement exponential backoff and flood-wait handling
- Store session strings encrypted at rest
- Never use your primary personal account

---

### Option 2: Bot-as-Channel-Admin

**What it is:** A Telegram channel admin adds the AfriPersonal bot as an administrator of the channel. The bot then receives all channel post updates via the Bot API.

**Compliance:** 100% compliant. This is exactly what the Bot API is designed for.

**Limitations:**

- Requires the **channel owner** to add the bot. For third-party channels (job boards you don't control), this requires their cooperation.
- Many Ethiopian job channels will not add unknown bots.
- Works perfectly for channels you own or have admin access to.

**Status: DEFERRED for third-party channels** — implement when targeting owned/administered channels.

**Implementation:** In grammY, simply register an `on("channel_post")` handler. No special configuration needed beyond the bot being an admin.

---

### Option 3: RSS / Telegram Preview Scraping

**What it is:** Telegram provides public previews of public channels at `t.me/s/<channel_name>`. These pages are scrapeable HTML.

**Why it's unreliable:**

- Telegram's preview pages are rate-limited and bot-protected (Cloudflare).
- Content is paginated and incomplete.
- Not an official API; can break at any time.
- Only works for public channels.

**Status: NOT PLANNED** — too fragile. Use one of the above options instead.

---

### Option 4: Official Bot API — Manual Import (v1 — CURRENT)

**What it is:** The user forwards job messages from any channel to the bot's private chat. The bot receives them as forwarded messages and processes them. Alternatively, the user pastes raw text using the `/import` command.

**Compliance:** 100% compliant. The user is the human actor forwarding messages; the bot just processes what it receives.

**Limitations:**

- Requires manual action from the user for each message.
- Not automated discovery — the user must actively forward.
- Suitable for low-volume, high-quality sourcing (user pre-filters by channel).

**Status: IMPLEMENTED in v1.**

---

## LLM Classification (Deferred)

v1 uses a deterministic rule engine for scoring. LLM classification is deferred to v2.

**Planned approach:**

- Use Groq API (Llama 3.1 or Gemma) for zero-shot classification
- Prompt: structured JSON output with `is_job_post`, `extracted_fields`, `match_reasoning`, `score`
- Gate: only call LLM if rule engine score is in the "uncertain" range (e.g., 30–70)
- Cost control: token budget per day, fallback to rule engine on budget exhaustion

**Why deferred:** Rule engine is sufficient for v1. LLM adds cost, latency, and non-determinism that complicates testing.

---

## Web Dashboard (Deferred)

A read-only dashboard to view recent evaluations, notification history, and update profile settings via a UI.

**Planned tech:** Simple HTML + HTMX served by a local Express server, or a TUI (terminal UI) using `ink`.

**Status: DEFERRED** — the bot itself will support profile viewing/editing via commands in v2.

---

## Multi-Source Support (Deferred)

v1 supports manual import and fixture sources. Future sources:

- **Bot-as-admin**: auto-ingest from channels where the bot is admin
- **Webhook**: external services POST job data to a local endpoint
- **File watcher**: watch a folder for `.txt` files containing job posts (useful for piping from other tools)
