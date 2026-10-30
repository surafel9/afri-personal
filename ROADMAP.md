# 🗺️ AfriPersonal: Automated Channel Ingestion & Free Deployment Plan

**Status:** Approved & Updated  
**Target Channel:** `https://t.me/freelance_ethio` (Afriwork / Freelance Ethiopia)  
**Deployment Target:** Oracle Cloud Always Free (Ubuntu Linux VM + systemd)  
**Primary Focus:** Automated public channel polling, **broad "Any Tech Work" matching**, and **100% verbatim post delivery** (no rewriting).

---

## 📋 Executive Summary

We are upgrading AfriPersonal to a set-and-forget job watcher with your exact preferences:

1. **Automated Channel Poller:** Reads public posts directly from `https://t.me/s/freelance_ethio` every **15 minutes** (configurable).
2. **First Run Backfill:** Ingests the **last 50 posts** immediately so you can test real output.
3. **Broad "Any Tech Work" Matching:**
   - Filters for **any technical role** (Fullstack, Frontend, Backend, Mobile, Data, DevOps, IT, Web, etc.).
   - Accepts **any employment type** (Full-time, Contract, Freelance, and Internships are all welcome).
   - Aggressively filters out non-tech clutter (sales reps, driving, farming, hotel, sewing, manual labor).
4. **Verbatim DM Delivery (No Editing):**
   - When a job matches, the bot forwards the **exact original post text without editing a single word**.
   - Includes the direct link to the original Telegram post.
5. **Deployment:** **Oracle Cloud Always Free VM** (24/7 uptime, never sleeps, permanent disk for SQLite, $0/month forever).

---

## 🏛️ System Flow

```
   ┌──────────────────────────────────────────────┐
   │   Public Telegram Channel                    │
   │   https://t.me/s/freelance_ethio             │
   └──────────────────────┬───────────────────────┘
                          │ Polled every 15 min (last 50 on startup)
                          ▼
   ┌──────────────────────────────────────────────┐
   │   TelegramWebChannelAdapter                  │
   │   • Extracts Message ID, Time, Text, Links   │
   │   • Preserves verbatim raw post text         │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │   Deduplication & Repost Check               │
   │   • SHA-256 hash checks                      │
   │   • Suppresses identical reposts             │
   └──────────────────────┬───────────────────────┘
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │   Broad Tech Classifier                      │
   │   • YES if Tech (Software, Data, Mobile,     │
   │     Web, IT, Internships, etc.)              │
   │   • NO if Non-Tech (Sales, Farming, etc.)    │
   └──────────────────────┬───────────────────────┘
                          │ If Tech Match
                          ▼
   ┌──────────────────────────────────────────────┐
   │   Your Private Telegram DM                   │
   │   • Exact unedited post text                 │
   │   • Direct link to original message          │
   └──────────────────────────────────────────────┘
```

---

## ☁️ Deployment: Oracle Cloud Always Free

We are targeting **Oracle Cloud Always Free VM**:
- **Operating System:** Ubuntu 22.04 / 24.04 LTS.
- **Cost:** $0.00 / month forever (free tier includes up to 24 GB RAM, 4 ARM cores, 200 GB permanent disk).
- **Process Management:** `systemd` service (`deployment/afripersonal.service`) that automatically starts on reboot and runs 24/7 without sleeping.
- **Storage:** Local SQLite database file on permanent disk.

---

## 🎯 Matching Strategy: Broad Tech Umbrella

Because tech is fast-moving and unpredictable, we do not restrict to a narrow list of 5 frameworks. We classify posts into two buckets:

### 1. What Qualifies (Tech Work):
- **Core Titles:** Developer, Engineer, Programmer, Coder, Architect, Analyst, Specialist, Tech Lead, IT Support, DevOps, Sysadmin, UI/UX Designer.
- **Broad Tech Fields:** Software, Web, Mobile, Cloud, Database, Data Science, AI/ML, Networking, Cybersecurity, Frontend, Backend, Fullstack.
- **Tech Stacks (Languages/Tools):** Any mention of JS/TS, Python, Java, C#, C++, Go, Rust, PHP, Flutter, React, Vue, SQL, Docker, AWS, etc.
- **Experience Levels:** Junior, Internships, Mid, Senior, Lead — all are accepted!

### 2. What Gets Discarded (Non-Tech Clutter):
- Non-tech professions: `sales representative`, `driver`, `farming`, `supervisor`, `sewing`, `receptionist`, `nurse`, `accountant`, `waiter`, `chef`, `barista`, `security guard`, `cashier`.

---

## 📅 Step-by-Step Implementation Roadmap

### Phase 1: Build the Public Channel Adapter
- [ ] Create `src/sources/telegram-web-adapter.ts`.
- [ ] Implement fetcher for `https://t.me/s/freelance_ethio` with backfill support (last 50 posts).
- [ ] Preserve the raw, unedited post text and original message links.
- [ ] Write unit tests with mock HTML fixtures.

### Phase 2: Broad Tech Classifier & Verbatim Delivery
- [ ] Update matching rules to catch **any tech job** (including internships) and reject non-tech spam.
- [ ] Update notification delivery to send the **exact original post text** without rewriting or artificial summaries.

### Phase 3: Connect to Poller & Live 50-Post Benchmark
- [ ] Wire the adapter into `PipelineCoordinator` with a 15-minute polling interval.
- [ ] Run the live test against 50 real posts from `@freelance_ethio`.
- [ ] Review how many tech jobs matched and verify the output.

### Phase 4: Oracle Cloud Deployment Guide
- [ ] Provide step-by-step setup commands for an Oracle Cloud Ubuntu VM (install Node 22, clone, systemd setup, start).
