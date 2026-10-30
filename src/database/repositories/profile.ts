import { eq, desc } from 'drizzle-orm';
import type { Db } from '../client.js';
import { profile } from '../schema.js';

export type NewProfile = typeof profile.$inferInsert;
export type Profile = typeof profile.$inferSelect;

// ── JSON helpers ─────────────────────────────────────────────────────────────

function toJson(value: string[]): string {
  return JSON.stringify(value);
}

function toJsonObj(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export interface ProfileInput {
  name?: string;
  targetTitles?: string[];
  targetRoleFamilies?: string[];
  requiredSkills?: string[];
  preferredSkills?: string[];
  seniorityLevels?: string[];
  employmentTypes?: string[];
  workArrangements?: string[];
  preferredLocations?: string[];
  exclusions?: string[];
  dealBreakers?: string[];
  minScoreThreshold?: number;
  scoringWeights?: Record<string, unknown>;
}

export function createProfileRepo(db: Db) {
  return {
    getActive(): Profile | undefined {
      return db
        .select()
        .from(profile)
        .where(eq(profile.isActive, 1))
        .orderBy(desc(profile.version))
        .get();
    },

    findById(id: number): Profile | undefined {
      return db.select().from(profile).where(eq(profile.id, id)).get();
    },

    create(input: ProfileInput): Profile {
      const now = new Date().toISOString();
      return db
        .insert(profile)
        .values({
          name: input.name ?? 'default',
          targetTitles: toJson(input.targetTitles ?? []),
          targetRoleFamilies: toJson(input.targetRoleFamilies ?? []),
          requiredSkills: toJson(input.requiredSkills ?? []),
          preferredSkills: toJson(input.preferredSkills ?? []),
          seniorityLevels: toJson(input.seniorityLevels ?? []),
          employmentTypes: toJson(input.employmentTypes ?? []),
          workArrangements: toJson(input.workArrangements ?? []),
          preferredLocations: toJson(input.preferredLocations ?? []),
          exclusions: toJson(input.exclusions ?? []),
          dealBreakers: toJson(input.dealBreakers ?? []),
          minScoreThreshold: input.minScoreThreshold ?? 60,
          scoringWeights: toJsonObj(input.scoringWeights ?? {}),
          isActive: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    },

    update(id: number, input: Partial<ProfileInput>): Profile {
      const now = new Date().toISOString();
      const setValues: Partial<NewProfile> = { updatedAt: now };

      if (input.name !== undefined) setValues.name = input.name;
      if (input.targetTitles !== undefined)
        setValues.targetTitles = toJson(input.targetTitles);
      if (input.targetRoleFamilies !== undefined)
        setValues.targetRoleFamilies = toJson(input.targetRoleFamilies);
      if (input.requiredSkills !== undefined)
        setValues.requiredSkills = toJson(input.requiredSkills);
      if (input.preferredSkills !== undefined)
        setValues.preferredSkills = toJson(input.preferredSkills);
      if (input.seniorityLevels !== undefined)
        setValues.seniorityLevels = toJson(input.seniorityLevels);
      if (input.employmentTypes !== undefined)
        setValues.employmentTypes = toJson(input.employmentTypes);
      if (input.workArrangements !== undefined)
        setValues.workArrangements = toJson(input.workArrangements);
      if (input.preferredLocations !== undefined)
        setValues.preferredLocations = toJson(input.preferredLocations);
      if (input.exclusions !== undefined)
        setValues.exclusions = toJson(input.exclusions);
      if (input.dealBreakers !== undefined)
        setValues.dealBreakers = toJson(input.dealBreakers);
      if (input.minScoreThreshold !== undefined)
        setValues.minScoreThreshold = input.minScoreThreshold;
      if (input.scoringWeights !== undefined)
        setValues.scoringWeights = toJsonObj(input.scoringWeights);

      return db
        .update(profile)
        .set(setValues)
        .where(eq(profile.id, id))
        .returning()
        .get();
    },

    setActive(id: number): void {
      // Deactivate all, then activate the specified one
      db.update(profile).set({ isActive: 0 }).run();
      db.update(profile)
        .set({ isActive: 1, updatedAt: new Date().toISOString() })
        .where(eq(profile.id, id))
        .run();
    },

    list(): Profile[] {
      return db.select().from(profile).orderBy(desc(profile.version)).all();
    },
  };
}

export type ProfileRepo = ReturnType<typeof createProfileRepo>;
