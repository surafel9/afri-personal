/**
 * engine.ts
 * Public API for the matching engine. Ties together normalizer, job-detector,
 * field-extractor, and scorer.
 */

import type { EvaluationResult, UserProfile } from './types.js';
import type { Profile } from '../database/repositories/profile.js';
import { normalizeText } from './normalizer.js';
import { isJobAnnouncement } from './job-detector.js';
import { extractFields } from './field-extractor.js';
import { scoreMessage } from './scorer.js';

export const RULE_ENGINE_VERSION = '1.0.0';

/**
 * Evaluate a raw message text against a user profile.
 */
export function evaluate(rawText: string, profile: UserProfile): EvaluationResult {
  const evaluatedAt = new Date().toISOString();
  const normalizedText = normalizeText(rawText);

  // Step 1: Is it a job announcement?
  const jobAnnouncement = isJobAnnouncement(normalizedText);

  if (!jobAnnouncement) {
    return {
      isJobAnnouncement: false,
      extracted: {
        title: null,
        company: null,
        location: null,
        workMode: null,
        employmentType: null,
        deadline: null,
        applyMethod: null,
        seniority: null,
      },
      matchedSkills: [],
      matchedRoles: [],
      missingInfo: [],
      triggeredExclusions: [],
      score: 0,
      verdict: 'skipped',
      matchReasons: ['Not a job announcement — skipped'],
      ruleEngineVersion: RULE_ENGINE_VERSION,
      evaluatedAt,
    };
  }

  // Step 2: Extract structured fields (use original text for extraction, not lowercased)
  const extracted = extractFields(rawText);

  // Step 3: Score
  const result = scoreMessage(normalizedText, extracted, profile);

  return {
    isJobAnnouncement: true,
    extracted,
    matchedSkills: result.matchedSkills,
    matchedRoles: result.matchedRoles,
    missingInfo: result.missingInfo,
    triggeredExclusions: result.triggeredExclusions,
    score: result.score,
    verdict: result.verdict,
    matchReasons: result.matchReasons,
    ruleEngineVersion: RULE_ENGINE_VERSION,
    evaluatedAt,
  };
}

/**
 * Convert a database Profile row into a UserProfile.
 * Parses JSON fields stored as strings.
 */
export function profileFromDb(dbRow: Profile): UserProfile {
  function parseJson(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseWeights(json: string): UserProfile['scoringWeights'] {
    try {
      const parsed = JSON.parse(json);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  return {
    id: dbRow.id,
    version: dbRow.version,
    name: dbRow.name,
    targetTitles: parseJson(dbRow.targetTitles),
    targetRoleFamilies: parseJson(dbRow.targetRoleFamilies),
    requiredSkills: parseJson(dbRow.requiredSkills),
    preferredSkills: parseJson(dbRow.preferredSkills),
    seniorityLevels: parseJson(dbRow.seniorityLevels),
    employmentTypes: parseJson(dbRow.employmentTypes),
    workArrangements: parseJson(dbRow.workArrangements),
    preferredLocations: parseJson(dbRow.preferredLocations),
    exclusions: parseJson(dbRow.exclusions),
    dealBreakers: parseJson(dbRow.dealBreakers),
    minScoreThreshold: dbRow.minScoreThreshold,
    scoringWeights: parseWeights(dbRow.scoringWeights),
  };
}
