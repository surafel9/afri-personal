import { sqliteTable, text, integer, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// ── sources ──────────────────────────────────────────────────────────────────
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  displayName: text("displayName").notNull(),
  enabled: integer("enabled").notNull().default(1),
  ingestionMethod: text("ingestionMethod").notNull(), // 'manual' | 'fixture' | 'forwarded'
  lastSuccessAt: text("lastSuccessAt"), // ISO datetime, nullable
  lastErrorAt: text("lastErrorAt"),
  lastErrorMsg: text("lastErrorMsg"),
  createdAt: text("createdAt").notNull(),
});

// ── source_messages ───────────────────────────────────────────────────────────
export const sourceMessages = sqliteTable("source_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: text("sourceId")
    .notNull()
    .references(() => sources.id),
  externalId: text("externalId").notNull(),
  postedAt: text("postedAt"), // ISO datetime, nullable
  fetchedAt: text("fetchedAt").notNull(),
  originalText: text("originalText").notNull(),
  links: text("links").notNull().default("[]"), // JSON array
  hasMedia: integer("hasMedia").notNull().default(0),
  textHash: text("textHash").notNull(), // SHA-256 of normalized text
  processingStatus: text("processingStatus").notNull().default("pending"), // pending|processing|evaluated|failed|skipped
  processingError: text("processingError"),
  createdAt: text("createdAt").notNull(),
});

// ── profile ───────────────────────────────────────────────────────────────────
export const profile = sqliteTable("profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: integer("version").notNull().default(1),
  name: text("name").notNull().default("default"),
  targetTitles: text("targetTitles").notNull().default("[]"), // JSON
  targetRoleFamilies: text("targetRoleFamilies").notNull().default("[]"), // JSON
  requiredSkills: text("requiredSkills").notNull().default("[]"), // JSON
  preferredSkills: text("preferredSkills").notNull().default("[]"), // JSON
  seniorityLevels: text("seniorityLevels").notNull().default("[]"), // JSON e.g. ['mid', 'senior']
  employmentTypes: text("employmentTypes").notNull().default("[]"), // JSON e.g. ['fulltime', 'contract']
  workArrangements: text("workArrangements").notNull().default("[]"), // JSON e.g. ['remote', 'hybrid']
  preferredLocations: text("preferredLocations").notNull().default("[]"), // JSON
  exclusions: text("exclusions").notNull().default("[]"), // JSON keywords that trigger rejection
  dealBreakers: text("dealBreakers").notNull().default("[]"), // JSON
  minScoreThreshold: integer("minScoreThreshold").notNull().default(60),
  scoringWeights: text("scoringWeights").notNull().default("{}"), // JSON
  isActive: integer("isActive").notNull().default(1),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// ── evaluations ───────────────────────────────────────────────────────────────
export const evaluations = sqliteTable("evaluations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("messageId")
    .notNull()
    .references(() => sourceMessages.id),
  profileVersion: integer("profileVersion").notNull(),
  ruleEngineVersion: text("ruleEngineVersion").notNull(),
  isJobAnnouncement: integer("isJobAnnouncement").notNull().default(0),
  extractedTitle: text("extractedTitle"),
  extractedCompany: text("extractedCompany"),
  extractedLocation: text("extractedLocation"),
  extractedWorkMode: text("extractedWorkMode"),
  extractedEmploymentType: text("extractedEmploymentType"),
  extractedDeadline: text("extractedDeadline"),
  extractedApplyMethod: text("extractedApplyMethod"),
  matchedSkills: text("matchedSkills").notNull().default("[]"), // JSON
  matchedRoles: text("matchedRoles").notNull().default("[]"), // JSON
  missingInfo: text("missingInfo").notNull().default("[]"), // JSON
  triggeredExclusions: text("triggeredExclusions").notNull().default("[]"), // JSON
  score: integer("score").notNull().default(0),
  verdict: text("verdict").notNull(), // 'match' | 'no_match' | 'skipped' | 'excluded'
  matchReasons: text("matchReasons").notNull().default("[]"), // JSON array of human-readable strings
  evaluatedAt: text("evaluatedAt").notNull(),
});

// ── jobs ──────────────────────────────────────────────────────────────────────
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  primaryMessageId: integer("primaryMessageId")
    .notNull()
    .references(() => sourceMessages.id),
  // Self-referential FK: a job may be a duplicate of another job (nullable)
  duplicateOfJobId: integer("duplicateOfJobId").references(
    (): AnySQLiteColumn => jobs.id
  ),
  isDuplicateCertain: integer("isDuplicateCertain").notNull().default(0),
  createdAt: text("createdAt").notNull(),
});

// ── notifications ─────────────────────────────────────────────────────────────
export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  evaluationId: integer("evaluationId")
    .notNull()
    .references(() => evaluations.id),
  status: text("status").notNull().default("queued"), // queued|sending|delivered|failed|cancelled
  attemptCount: integer("attemptCount").notNull().default(0),
  nextRetryAt: text("nextRetryAt"),
  telegramMessageId: integer("telegramMessageId"), // set after successful delivery
  lastError: text("lastError"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// ── feedback ──────────────────────────────────────────────────────────────────
export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  notificationId: integer("notificationId")
    .notNull()
    .references(() => notifications.id),
  rating: text("rating").notNull(), // 'relevant' | 'not_relevant' | 'applied'
  createdAt: text("createdAt").notNull(),
});

// ── app_state ─────────────────────────────────────────────────────────────────
export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updatedAt").notNull(),
});
