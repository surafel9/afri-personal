export interface UserProfile {
  id: number;
  version: number;
  name: string;
  targetTitles: string[];
  targetRoleFamilies: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  seniorityLevels: string[];       // e.g. ['mid', 'senior']
  employmentTypes: string[];       // e.g. ['fulltime', 'contract', 'freelance']
  workArrangements: string[];      // e.g. ['remote', 'hybrid']
  preferredLocations: string[];
  exclusions: string[];
  dealBreakers: string[];
  minScoreThreshold: number;
  scoringWeights: ScoringWeights;
}

export interface ScoringWeights {
  requiredSkills?: number;   // default: 40
  preferredSkills?: number;  // default: 20
  workArrangement?: number;  // default: 20
  seniorityMatch?: number;   // default: 10
  employmentType?: number;   // default: 10
}

export interface ExtractedFields {
  title: string | null;
  company: string | null;
  location: string | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  employmentType: 'fulltime' | 'contract' | 'freelance' | 'internship' | 'parttime' | null;
  deadline: string | null;
  applyMethod: string | null;
  seniority: 'junior' | 'mid' | 'senior' | 'lead' | null;
}

export type Verdict = 'match' | 'no_match' | 'skipped' | 'excluded';

export interface EvaluationResult {
  isJobAnnouncement: boolean;
  extracted: ExtractedFields;
  matchedSkills: string[];
  matchedRoles: string[];
  missingInfo: string[];
  triggeredExclusions: string[];
  score: number;               // 0-100
  verdict: Verdict;
  matchReasons: string[];      // human-readable explanations
  ruleEngineVersion: string;   // semver string, e.g. "1.0.0"
  evaluatedAt: string;         // ISO datetime
}
