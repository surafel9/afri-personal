import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { jobs } from '../schema.js';

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export function createJobsRepo(db: Db) {
  return {
    insert(
      primaryMessageId: number,
      duplicateOfJobId: number | null = null,
      isDuplicateCertain = false,
    ): Job {
      const now = new Date().toISOString();
      return db
        .insert(jobs)
        .values({
          primaryMessageId,
          duplicateOfJobId: duplicateOfJobId ?? null,
          isDuplicateCertain: isDuplicateCertain ? 1 : 0,
          createdAt: now,
        })
        .returning()
        .get();
    },

    findById(id: number): Job | undefined {
      return db.select().from(jobs).where(eq(jobs.id, id)).get();
    },

    findByMessageId(messageId: number): Job | undefined {
      return db
        .select()
        .from(jobs)
        .where(eq(jobs.primaryMessageId, messageId))
        .get();
    },

    findDuplicatesOf(jobId: number): Job[] {
      return db
        .select()
        .from(jobs)
        .where(eq(jobs.duplicateOfJobId, jobId))
        .all();
    },
  };
}

export type JobsRepo = ReturnType<typeof createJobsRepo>;

