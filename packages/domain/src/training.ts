/**
 * Training rules outside the chess core: the player's limits (R-62, R-146),
 * the result batch the browser sends and when a result applies (S6
 * decisions 2-6), and the order new moves are taught in (R-145).
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';

/** Message-catalogue keys for the settings form's issues; the UI translates them. */
export const TRAINING_ISSUES = {
  sessionSize: 'training.settings.sessionSize',
  newPerDay: 'training.settings.newPerDay',
} as const;

/** A whole number from `min` to `max`, coerced from a form string. */
const wholeNumber = (min: number, max: number, error: string) =>
  z.coerce
    .number({ error })
    .int({ error })
    .min(min, { error })
    .max(max, { error });

/** R-62: moves in a session; R-146: new moves a day. */
export const trainingSettingsSchema = z.object({
  sessionSize: wholeNumber(10, 100, TRAINING_ISSUES.sessionSize),
  newPerDay: wholeNumber(0, 50, TRAINING_ISSUES.newPerDay),
});
export type TrainingSettings = z.infer<typeof trainingSettingsSchema>;
export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = {
  sessionSize: 20,
  newPerDay: 10,
};

/** Estimated time per Due Move on home (spec "Today" block); tunable. */
export const SECONDS_PER_REVIEW = 8;

export const RESULT_KINDS = ['learned', 'pass', 'lapse', 'hint'] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** One answer the browser queued (S6 decision 1). */
export const trainingResultSchema = z.object({
  resultId: z.uuid(),
  kind: z.enum(RESULT_KINDS),
  moveKey: z.string().min(3).max(200),
  repertoireId: z.uuid(),
  answeredAt: z.coerce.date(),
});
export type TrainingResult = z.infer<typeof trainingResultSchema>;
export const MAX_RESULT_BATCH = 200;
export const resultBatchSchema = z
  .array(trainingResultSchema)
  .min(1)
  .max(MAX_RESULT_BATCH);

/** How far back a queued result may be dated (S6 decision 2). */
export const RESULT_MAX_AGE_MS = 7 * 86_400_000;

/** `answeredAt` inside [now - 7 days, now]. */
export const clampAnsweredAt = (at: Date, now: Date): Date =>
  new Date(
    Math.min(
      now.getTime(),
      Math.max(at.getTime(), now.getTime() - RESULT_MAX_AGE_MS),
    ),
  );

/** Message-catalogue keys for training refusals; the UI translates them. */
export const TRAINING_REFUSALS = {
  notHeld: 'training.notHeld',
  paused: 'training.paused',
  notLearned: 'training.notLearned',
} as const;

export interface TrainingRefusal {
  readonly reason: (typeof TRAINING_REFUSALS)[keyof typeof TRAINING_REFUSALS];
}

/** The repertoire a result names, as the player trains it now. */
export interface RecordFacts {
  /** Undefined when the player does not train that repertoire now. */
  readonly repertoire:
    { readonly active: boolean; readonly holds: boolean } | undefined;
}

/**
 * S6 decision 6: may this result be recorded at all? Only for a repertoire
 * the player trains now that holds the move; a paused one takes no new
 * learning, but an answer already given is kept.
 */
export function canRecord(
  kind: ResultKind,
  facts: RecordFacts,
): Result<undefined, TrainingRefusal> {
  const { repertoire } = facts;
  if (!repertoire?.holds) {
    return refuse(TRAINING_REFUSALS.notHeld);
  }
  if (kind === 'learned' && !repertoire.active) {
    return refuse(TRAINING_REFUSALS.paused);
  }
  return ok();
}

/** The stored Review a result meets: none, or its last graded time. */
export type StoredFacts =
  | { readonly exists: false }
  | { readonly exists: true; readonly lastReview: Date };

/**
 * S6 decisions 2-3: apply, or keep only as a stale log entry. A move is
 * learned once; a graded result earlier than the last review is stale,
 * as FSRS cannot replay out of order.
 */
export function acceptResult(
  kind: ResultKind,
  at: Date,
  stored: StoredFacts,
): Result<'apply' | 'stale', TrainingRefusal> {
  if (kind === 'learned') return ok(stored.exists ? 'stale' : 'apply');
  if (!stored.exists) return refuse(TRAINING_REFUSALS.notLearned);
  return ok(at.getTime() < stored.lastReview.getTime() ? 'stale' : 'apply');
}

/** A repertoire as the learn order sees it (R-145). */
export interface TrainingEntry {
  readonly kind: 'own' | 'assigned';
  /** effectiveDeadline, `YYYY-MM-DD`, or null. */
  readonly deadline: string | null;
  /** Its place in trainingRepertoires: own oldest first, then assigned. */
  readonly position: number;
}

const rank = (entry: TrainingEntry): number => {
  if (entry.kind === 'own') return 2;
  return entry.deadline === null ? 1 : 0;
};

/** R-145: deadline assignments earliest first, other assignments, own repertoires. */
export function learnOrder<T extends TrainingEntry>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.deadline ?? '').localeCompare(b.deadline ?? '') ||
      a.position - b.position,
  );
}
