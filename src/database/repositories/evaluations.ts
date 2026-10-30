import { eq, desc } from 'drizzle-orm';
import type { Db } from '../client.js';
import { evaluations } from '../schema.js';

export type NewEvaluation = typeof evaluations.$inferInsert;
export type Evaluation = typeof evaluations.$inferSelect;

export type Verdict = 'match' | 'no_match' | 'skipped' | 'excluded';

export interface EvaluationInput {
  messageId: number;
  profileVersion: number;
  ruleEngineVersion: string;
  isJobAnnouncement: boolean;
  extractedTitle?: string | null;
  extractedCompany?: string | null;
  extractedLocation?: string | null;
  extractedWorkMode?: string | null;
  extractedEmploymentType?: string | null;
  extractedDeadline?: string | null;
  extractedApplyMethod?: string | null;
  matchedSkills: string[];
  matchedRoles: string[];
  missingInfo: string[];
  triggeredExclusions: string[];
  score: number;
  verdict: Verdict;
  matchReasons: string[];
}

export function createEvaluationsRepo(db: Db) {
  return {
    insert(input: EvaluationInput): Evaluation {
      return db
        .insert(evaluations)
        .values({
          messageId: input.messageId,
          profileVersion: input.profileVersion,
          ruleEngineVersion: input.ruleEngineVersion,
          isJobAnnouncement: input.isJobAnnouncement ? 1 : 0,
          extractedTitle: input.extractedTitle ?? null,
          extractedCompany: input.extractedCompany ?? null,
          extractedLocation: input.extractedLocation ?? null,
          extractedWorkMode: input.extractedWorkMode ?? null,
          extractedEmploymentType: input.extractedEmploymentType ?? null,
          extractedDeadline: input.extractedDeadline ?? null,
          extractedApplyMethod: input.extractedApplyMethod ?? null,
          matchedSkills: JSON.stringify(input.matchedSkills),
          matchedRoles: JSON.stringify(input.matchedRoles),
          missingInfo: JSON.stringify(input.missingInfo),
          triggeredExclusions: JSON.stringify(input.triggeredExclusions),
          score: input.score,
          verdict: input.verdict,
          matchReasons: JSON.stringify(input.matchReasons),
          evaluatedAt: new Date().toISOString(),
        })
        .returning()
        .get();
    },

    findById(id: number): Evaluation | undefined {
      return db.select().from(evaluations).where(eq(evaluations.id, id)).get();
    },

    findByMessageId(messageId: number): Evaluation | undefined {
      return db
        .select()
        .from(evaluations)
        .where(eq(evaluations.messageId, messageId))
        .get();
    },

    getRecent(limit = 20): Evaluation[] {
      return db
        .select()
        .from(evaluations)
        .orderBy(desc(evaluations.evaluatedAt))
        .limit(limit)
        .all();
    },

    getMatches(limit = 20): Evaluation[] {
      return db
        .select()
        .from(evaluations)
        .where(eq(evaluations.verdict, 'match'))
        .orderBy(desc(evaluations.evaluatedAt))
        .limit(limit)
        .all();
    },
  };
}

export type EvaluationsRepo = ReturnType<typeof createEvaluationsRepo>;
