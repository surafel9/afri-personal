/**
 * scorer.ts
 * Core scoring engine for the matching engine.
 */

import type { UserProfile, ExtractedFields, Verdict } from './types.js';
import { normalizeText, resolveSkillAlias, extractSkillMentions } from './normalizer.js';

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
  requiredSkills: 40,
  preferredSkills: 20,
  workArrangement: 20,
  seniorityMatch: 10,
  employmentType: 10,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Check if a term appears in text using word-boundary-style matching. */
function containsTerm(normalizedText: string, term: string): boolean {
  const escaped = escapeRegex(term.toLowerCase());
  const pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
  return pattern.test(normalizedText);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function scoreMessage(
  normalizedText: string,
  extracted: ExtractedFields,
  profile: UserProfile,
): {
  score: number;
  matchedSkills: string[];
  matchedRoles: string[];
  triggeredExclusions: string[];
  matchReasons: string[];
  verdict: Verdict;
  missingInfo: string[];
} {
  const weights = {
    requiredSkills: profile.scoringWeights.requiredSkills ?? DEFAULT_WEIGHTS.requiredSkills,
    preferredSkills: profile.scoringWeights.preferredSkills ?? DEFAULT_WEIGHTS.preferredSkills,
    workArrangement: profile.scoringWeights.workArrangement ?? DEFAULT_WEIGHTS.workArrangement,
    seniorityMatch: profile.scoringWeights.seniorityMatch ?? DEFAULT_WEIGHTS.seniorityMatch,
    employmentType: profile.scoringWeights.employmentType ?? DEFAULT_WEIGHTS.employmentType,
  };

  const matchReasons: string[] = [];
  const triggeredExclusions: string[] = [];

  // ── Hard gate 1: Deal-breakers ─────────────────────────────────────────────
  for (const db of profile.dealBreakers) {
    const normalized = normalizeText(db);
    if (containsTerm(normalizedText, normalized)) {
      triggeredExclusions.push(db);
    }
  }
  if (triggeredExclusions.length > 0) {
    matchReasons.push(`Excluded: triggered deal-breaker '${triggeredExclusions.join("', '")}'`);
    return {
      score: 0,
      matchedSkills: [],
      matchedRoles: [],
      triggeredExclusions,
      matchReasons,
      verdict: 'excluded',
      missingInfo: [],
    };
  }

  // ── Hard gate 2: Exclusion keywords ───────────────────────────────────────
  for (const excl of profile.exclusions) {
    const normalized = normalizeText(excl);
    if (normalizedText.includes(normalized)) {
      triggeredExclusions.push(excl);
    }
  }
  if (triggeredExclusions.length > 0) {
    matchReasons.push(`Excluded: triggered exclusion keyword '${triggeredExclusions.join("', '")}'`);
    return {
      score: 0,
      matchedSkills: [],
      matchedRoles: [],
      triggeredExclusions,
      matchReasons,
      verdict: 'excluded',
      missingInfo: [],
    };
  }

  // ── Skill matching ────────────────────────────────────────────────────────

  // Normalize profile skills (they should already be canonical, but be safe)
  const canonicalRequired = profile.requiredSkills.map(resolveSkillAlias);
  const canonicalPreferred = profile.preferredSkills.map(resolveSkillAlias);

  // All known skills = union of required + preferred (for extractSkillMentions)
  const allKnownSkills = Array.from(new Set([...canonicalRequired, ...canonicalPreferred]));

  const mentionedSkills = extractSkillMentions(normalizedText, allKnownSkills);

  const matchedRequired = canonicalRequired.filter((s) => mentionedSkills.includes(s));
  const matchedPreferred = canonicalPreferred.filter((s) => mentionedSkills.includes(s));
  const matchedSkills = Array.from(new Set([...matchedRequired, ...matchedPreferred]));

  // ── Required skills score ─────────────────────────────────────────────────
  let requiredScore = 0;
  let noRequiredSkillsCap = false;

  if (canonicalRequired.length > 0) {
    const ratio = matchedRequired.length / canonicalRequired.length;
    requiredScore = ratio * weights.requiredSkills;
    if (matchedRequired.length === 0) {
      noRequiredSkillsCap = true; // cap total at 50 later
    }
  } else {
    // No required skills in profile → full points
    requiredScore = weights.requiredSkills;
  }

  if (matchedRequired.length > 0) {
    matchReasons.push(`Matched required skills: ${matchedRequired.join(', ')}`);
  }

  // ── Preferred skills score ────────────────────────────────────────────────
  let preferredScore = 0;
  if (canonicalPreferred.length > 0 && matchedPreferred.length > 0) {
    const ratio = Math.min(matchedPreferred.length / canonicalPreferred.length, 1);
    preferredScore = ratio * weights.preferredSkills;
    matchReasons.push(`Matched preferred skills: ${matchedPreferred.join(', ')}`);
  }

  // ── Work arrangement score ────────────────────────────────────────────────
  let workScore = 0;
  if (extracted.workMode === null) {
    workScore = weights.workArrangement / 2; // unknown → assume possible
  } else if (profile.workArrangements.includes(extracted.workMode)) {
    workScore = weights.workArrangement;
    matchReasons.push(`Work arrangement: ${extracted.workMode} (matches your preference)`);
  }
  // else mismatched → 0

  // ── Seniority score ───────────────────────────────────────────────────────
  let seniorityScore = 0;
  if (extracted.seniority === null) {
    seniorityScore = weights.seniorityMatch / 2;
  } else if (profile.seniorityLevels.includes(extracted.seniority)) {
    seniorityScore = weights.seniorityMatch;
    matchReasons.push(`Seniority level: ${extracted.seniority} (matches your preference)`);
  }

  // ── Employment type score ─────────────────────────────────────────────────
  let employmentScore = 0;
  if (extracted.employmentType === null) {
    employmentScore = weights.employmentType / 2;
  } else if (profile.employmentTypes.includes(extracted.employmentType)) {
    employmentScore = weights.employmentType;
    matchReasons.push(`Employment type: ${extracted.employmentType} (matches your preference)`);
  }

  // ── Role/title bonus ──────────────────────────────────────────────────────
  const matchedRoles: string[] = [];
  let roleBonus = 0;

  if (extracted.title) {
    const extractedTitleLower = extracted.title.toLowerCase();
    for (const targetTitle of profile.targetTitles) {
      const words = targetTitle.toLowerCase().split(/\s+/);
      const matchCount = words.filter((w) => extractedTitleLower.includes(w)).length;
      if (matchCount >= Math.ceil(words.length * 0.5)) {
        matchedRoles.push(extracted.title);
        roleBonus = 10;
        matchReasons.push(`Role title match: ${extracted.title}`);
        break;
      }
    }
  }

  // Also check role families against text
  for (const family of profile.targetRoleFamilies) {
    if (normalizedText.includes(family.toLowerCase())) {
      if (!matchedRoles.includes(family)) matchedRoles.push(family);
    }
  }

  // ── Total score ───────────────────────────────────────────────────────────
  let score = requiredScore + preferredScore + workScore + seniorityScore + employmentScore + roleBonus;

  // Cap at 50 if no required skills matched
  if (noRequiredSkillsCap) {
    score = Math.min(score, 50);
  }

  // Clamp 0–100
  score = Math.round(Math.min(100, Math.max(0, score)));

  // ── Missing info ──────────────────────────────────────────────────────────
  const missingInfo: string[] = [];
  if (!extracted.title) missingInfo.push('Job title not specified');
  if (!extracted.company) missingInfo.push('Company not identified');
  if (!extracted.deadline) missingInfo.push('Application deadline not mentioned');
  if (!extracted.applyMethod) missingInfo.push('No application method found');
  if (!extracted.workMode) missingInfo.push('Work arrangement not specified');
  if (!extracted.employmentType) missingInfo.push('Employment type not specified');

  // ── Verdict ───────────────────────────────────────────────────────────────
  const verdict: Verdict = score >= profile.minScoreThreshold ? 'match' : 'no_match';

  return {
    score,
    matchedSkills,
    matchedRoles,
    triggeredExclusions,
    matchReasons,
    verdict,
    missingInfo,
  };
}
