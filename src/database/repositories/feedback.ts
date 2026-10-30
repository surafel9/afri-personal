import { eq } from 'drizzle-orm';
import type { Db } from '../client.js';
import { feedback } from '../schema.js';

export type NewFeedback = typeof feedback.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;

export type FeedbackRating = 'relevant' | 'not_relevant' | 'applied';

export function createFeedbackRepo(db: Db) {
  return {
    insert(notificationId: number, rating: FeedbackRating): Feedback {
      return db
        .insert(feedback)
        .values({
          notificationId,
          rating,
          createdAt: new Date().toISOString(),
        })
        .returning()
        .get();
    },

    findByNotificationId(notificationId: number): Feedback[] {
      return db
        .select()
        .from(feedback)
        .where(eq(feedback.notificationId, notificationId))
        .all();
    },

    findById(id: number): Feedback | undefined {
      return db.select().from(feedback).where(eq(feedback.id, id)).get();
    },
  };
}

export type FeedbackRepo = ReturnType<typeof createFeedbackRepo>;
