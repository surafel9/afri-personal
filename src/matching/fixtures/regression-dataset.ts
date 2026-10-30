/**
 * regression-dataset.ts
 * Regression dataset for the matching engine.
 * Each entry has a message text, expected verdict, and notes.
 */

import type { Verdict } from '../types.js';

export interface RegressionEntry {
  id: string;
  messageText: string;
  expectedVerdict: Verdict;
  notes: string;
}

export const regressionDataset: RegressionEntry[] = [
  // ── 4 clear matches ─────────────────────────────────────────────────────────
  {
    id: 'reg-001',
    messageText: `Senior Node.js Backend Developer — Remote

Company: AfroTech Solutions
Location: 100% Remote
Type: Full-time

We are hiring a senior backend developer to work on our payment infrastructure.

Requirements:
- 5+ years Node.js experience
- TypeScript mandatory
- PostgreSQL and Redis
- REST API design
- Docker and AWS

Apply: https://afrotech.io/jobs/senior-nodejs
Deadline: November 30, 2026`,
    expectedVerdict: 'match',
    notes: 'Clear Node.js + TypeScript senior remote full-time match',
  },
  {
    id: 'reg-002',
    messageText: `Full-Stack Engineer (Contract)

Role: Mid-Level Full-Stack Developer
Stack: Node.js + TypeScript + React
Employment: Contract (3 months)
Location: Remote (Africa timezone preferred)

We are building a B2B SaaS platform for African SMEs.

Tech requirements:
- Node.js with Express
- TypeScript
- React 18+
- PostgreSQL
- REST APIs

Contact: @fullstack_recruiter on Telegram
Apply by: Oct 31, 2026`,
    expectedVerdict: 'match',
    notes: 'Mid-level full-stack contract remote — all required skills present',
  },
  {
    id: 'reg-003',
    messageText: `Backend Developer — Freelance Project

We are looking for a freelance backend developer for a 2-month project.

Skills:
- Node.js + TypeScript
- REST API development
- MongoDB or PostgreSQL
- Good communication

Rate: Negotiable
Location: Fully remote
Contact: jobs@startup.io or DM @startup_jobs`,
    expectedVerdict: 'match',
    notes: 'Freelance Node.js+TypeScript remote — required skills match',
  },
  {
    id: 'reg-004',
    messageText: `🚀 We are hiring a Node.js Developer!

Company: Habesha Tech
Type: Full-time
Location: Remote

Requirements:
- Strong JavaScript and TypeScript skills
- Node.js backend development
- Express framework experience
- REST API design
- PostgreSQL

Salary: Competitive USD
Apply: https://habeshatech.com/jobs
Deadline: December 1, 2026`,
    expectedVerdict: 'match',
    notes: 'All required skills (JS, TS, Node.js) + remote full-time',
  },

  // ── 3 clear non-matches (wrong skills) ────────────────────────────────────
  {
    id: 'reg-005',
    messageText: `Senior Java Developer — Full-time Remote

We are seeking a senior Java developer to join our backend team.

Requirements:
- 5+ years Java experience
- Spring Boot framework
- Hibernate ORM
- MySQL or PostgreSQL
- Docker deployment

Apply: careers@javacompany.io
Deadline: November 15, 2026`,
    expectedVerdict: 'no_match',
    notes: 'Java-only stack, no required skills (JS/TS/Node.js)',
  },
  {
    id: 'reg-006',
    messageText: `Python Data Scientist — Remote

Company: DataAfrica Ltd
Location: Remote
Type: Full-time

We are hiring a data scientist to work on ML models.

Requirements:
- Python (pandas, numpy, scikit-learn)
- SQL (PostgreSQL or BigQuery)
- Jupyter notebooks
- Statistics background

Apply: data@dataafrica.com`,
    expectedVerdict: 'no_match',
    notes: 'Python/ML role — no JavaScript/TypeScript/Node.js',
  },
  {
    id: 'reg-007',
    messageText: `iOS Developer Needed — Full-time

We are hiring an iOS developer to build our mobile app.

Requirements:
- Swift / SwiftUI
- Xcode proficiency
- REST API integration
- App Store deployment experience

Location: Hybrid, Nairobi
Apply: ios@mobileapp.co`,
    expectedVerdict: 'no_match',
    notes: 'Swift/iOS role — no matching required skills, hybrid but wrong stack',
  },

  // ── 2 excluded (deal-breakers) ─────────────────────────────────────────────
  {
    id: 'reg-008',
    messageText: `PHP Developer — Full-time Remote

We need an experienced PHP developer for our backend team.

Requirements:
- PHP 8+
- Laravel framework
- MySQL
- REST API

Location: Remote (East Africa)
Apply: hr@phpcompany.com`,
    expectedVerdict: 'excluded',
    notes: 'PHP deal-breaker triggered — excluded despite remote + fulltime',
  },
  {
    id: 'reg-009',
    messageText: `WordPress Developer — Contract

We are looking for a WordPress developer to build our company website.

Requirements:
- WordPress theme/plugin development
- PHP knowledge
- JavaScript basics
- Elementor experience

Remote-friendly
Contact: webmaster@company.et`,
    expectedVerdict: 'excluded',
    notes: 'WordPress deal-breaker triggered',
  },

  // ── 2 skipped (not job posts) ──────────────────────────────────────────────
  {
    id: 'reg-010',
    messageText: `🎉 New iPhone 15 Cases Now Available!

Protection + Style for your iPhone 15 Pro Max.
- Silicone cases: 250 ETB
- Leather cases: 450 ETB
- Rugged armor: 600 ETB

Order via: @iphone_accessories_et
Delivery across Addis Ababa`,
    expectedVerdict: 'skipped',
    notes: 'Phone accessories promo — not a job post',
  },
  {
    id: 'reg-011',
    messageText: `ሰላም ደህና ናችሁ? ዛሬ ምን አዲስ ነገር አለ? ቢሮ ሰዓት ሲደርስ ዘጋ ብለው ይምጡ። ሁሉም ሰው ዝግጁ ይሁን። ምስጋና ለሁሉም።`,
    expectedVerdict: 'skipped',
    notes: 'Amharic-only social message — not a job post',
  },

  // ── 1 ambiguous (partial info, borderline score) ───────────────────────────
  {
    id: 'reg-012',
    messageText: `Developer needed

Looking for a JavaScript developer for a short project.
Node.js experience helpful.
Contact @dev_recruiter`,
    expectedVerdict: 'no_match',
    notes: 'Has JS + Node.js mentions but missing TypeScript (required), minimal info — borderline score below threshold',
  },
];
