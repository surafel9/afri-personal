-- AfriPersonal: Initial schema migration
-- Migration: 0001_initial.sql

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  displayName TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ingestionMethod TEXT NOT NULL,
  lastSuccessAt TEXT,
  lastErrorAt TEXT,
  lastErrorMsg TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sourceId TEXT NOT NULL REFERENCES sources(id),
  externalId TEXT NOT NULL,
  postedAt TEXT,
  fetchedAt TEXT NOT NULL,
  originalText TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  hasMedia INTEGER NOT NULL DEFAULT 0,
  textHash TEXT NOT NULL,
  processingStatus TEXT NOT NULL DEFAULT 'pending',
  processingError TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE(sourceId, externalId)
);

CREATE INDEX IF NOT EXISTS idx_source_messages_source_id ON source_messages(sourceId);
CREATE INDEX IF NOT EXISTS idx_source_messages_text_hash ON source_messages(textHash);
CREATE INDEX IF NOT EXISTS idx_source_messages_processing_status ON source_messages(processingStatus);

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL DEFAULT 'default',
  targetTitles TEXT NOT NULL DEFAULT '[]',
  targetRoleFamilies TEXT NOT NULL DEFAULT '[]',
  requiredSkills TEXT NOT NULL DEFAULT '[]',
  preferredSkills TEXT NOT NULL DEFAULT '[]',
  seniorityLevels TEXT NOT NULL DEFAULT '[]',
  employmentTypes TEXT NOT NULL DEFAULT '[]',
  workArrangements TEXT NOT NULL DEFAULT '[]',
  preferredLocations TEXT NOT NULL DEFAULT '[]',
  exclusions TEXT NOT NULL DEFAULT '[]',
  dealBreakers TEXT NOT NULL DEFAULT '[]',
  minScoreThreshold INTEGER NOT NULL DEFAULT 60,
  scoringWeights TEXT NOT NULL DEFAULT '{}',
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messageId INTEGER NOT NULL REFERENCES source_messages(id),
  profileVersion INTEGER NOT NULL,
  ruleEngineVersion TEXT NOT NULL,
  isJobAnnouncement INTEGER NOT NULL DEFAULT 0,
  extractedTitle TEXT,
  extractedCompany TEXT,
  extractedLocation TEXT,
  extractedWorkMode TEXT,
  extractedEmploymentType TEXT,
  extractedDeadline TEXT,
  extractedApplyMethod TEXT,
  matchedSkills TEXT NOT NULL DEFAULT '[]',
  matchedRoles TEXT NOT NULL DEFAULT '[]',
  missingInfo TEXT NOT NULL DEFAULT '[]',
  triggeredExclusions TEXT NOT NULL DEFAULT '[]',
  score INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL,
  matchReasons TEXT NOT NULL DEFAULT '[]',
  evaluatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evaluations_message_id ON evaluations(messageId);
CREATE INDEX IF NOT EXISTS idx_evaluations_verdict ON evaluations(verdict);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primaryMessageId INTEGER NOT NULL REFERENCES source_messages(id),
  duplicateOfJobId INTEGER REFERENCES jobs(id),
  isDuplicateCertain INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluationId INTEGER NOT NULL REFERENCES evaluations(id),
  status TEXT NOT NULL DEFAULT 'queued',
  attemptCount INTEGER NOT NULL DEFAULT 0,
  nextRetryAt TEXT,
  telegramMessageId INTEGER,
  lastError TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notificationId INTEGER NOT NULL REFERENCES notifications(id),
  rating TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

