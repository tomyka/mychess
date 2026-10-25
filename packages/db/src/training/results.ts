/**
 * Records the training results the browser queued (S6 decisions 2-6). The
 * domain decides each result (canRecord, acceptResult); this module loads
 * the facts, holds the touched Reviews FOR UPDATE, applies the results in
 * answer order and logs every one that is not a duplicate.
 */
import {
  grade,
  playerKeys,
  startReview,
  type Outcome,
  type ReviewState,
} from '@mychess/chess';
import {
  acceptResult,
  canRecord,
  clampAnsweredAt,
  type RecordFacts,
  type StoredFacts,
  type TrainingRefusal,
  type TrainingResult,
} from '@mychess/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor, Tx } from '../client';
import { reviewResults, reviews } from '../training-schema';
import { trainingEntries } from './entries';
import { lockReviews, reviewRow } from './reviews';

/** What became of one result of a batch. */
export type ResultAnswer =
  | {
      readonly resultId: string;
      readonly status: 'applied' | 'stale' | 'duplicate';
    }
  | {
      readonly resultId: string;
      readonly status: 'refused';
      readonly reason: TrainingRefusal['reason'];
    };

type Status = 'applied' | 'stale' | TrainingRefusal;

/** A training repertoire as recording needs it: active, and the keys it holds. */
interface Trained {
  readonly active: boolean;
  readonly keys: ReadonlySet<string>;
}

/** What one batch is recorded against, inside its transaction. */
interface Recording {
  readonly tx: Tx;
  readonly playerId: string;
  readonly now: Date;
  readonly trained: ReadonlyMap<string, Trained>;
  /** The locked Reviews, by key, updated as results apply. */
  readonly reviews: Map<string, ReviewState>;
}

/** What the domain decided for one result. */
type Decision =
  | { readonly kind: 'answer'; readonly status: Status }
  | { readonly kind: 'learn'; readonly at: Date }
  | {
      readonly kind: 'grade';
      readonly at: Date;
      readonly review: ReviewState;
      readonly outcome: Outcome;
    };

const answered = (status: Status): Decision => ({ kind: 'answer', status });

const factsOf = (
  trained: Trained | undefined,
  moveKey: string,
): RecordFacts => ({
  repertoire: trained && {
    active: trained.active,
    holds: trained.keys.has(moveKey),
  },
});

const storedOf = (review: ReviewState | undefined): StoredFacts =>
  review === undefined
    ? { exists: false }
    : { exists: true, lastReview: review.fsrs.last_review ?? null };

/** canRecord, then acceptResult against the Review as it stands. */
function decide(rec: Recording, result: TrainingResult): Decision {
  const { kind, moveKey, repertoireId, answeredAt } = result;
  const recordable = canRecord(
    kind,
    factsOf(rec.trained.get(repertoireId), moveKey),
  );
  if (!recordable.ok) return answered(recordable.refusal);
  const review = rec.reviews.get(moveKey);
  const accepted = acceptResult(kind, answeredAt, storedOf(review), rec.now);
  if (!accepted.ok) return answered(accepted.refusal);
  const { verdict, at } = accepted.value;
  if (verdict === 'stale') return answered('stale');
  // acceptResult refuses a graded result without a Review, so a result
  // that gets here without one is a learned move.
  if (kind === 'learned' || review === undefined) return { kind: 'learn', at };
  return { kind: 'grade', at, review, outcome: kind };
}

const insertedSchema = z.array(z.object({ moveKey: z.string() }));

/**
 * Starts the Review of a learned move. Another batch may have learned it
 * since the lock was taken (no row existed to lock); then this one is stale.
 */
async function learn(
  rec: Recording,
  moveKey: string,
  at: Date,
): Promise<Status> {
  const review = startReview(moveKey, at);
  const inserted = insertedSchema.parse(
    await rec.tx
      .insert(reviews)
      .values({
        playerId: rec.playerId,
        ...reviewRow(review),
        learnedAt: at,
        createdAt: rec.now,
        updatedAt: rec.now,
      })
      .onConflictDoNothing()
      .returning({ moveKey: reviews.moveKey }),
  );
  if (inserted.length === 0) return 'stale';
  rec.reviews.set(moveKey, review);
  return 'applied';
}

/** Grades a locked Review and stores its new card and lapse history. */
async function regrade(
  rec: Recording,
  decision: Extract<Decision, { kind: 'grade' }>,
): Promise<Status> {
  const review = grade(decision.review, decision.outcome, decision.at);
  await rec.tx
    .update(reviews)
    .set({ ...reviewRow(review), updatedAt: rec.now })
    .where(
      and(eq(reviews.playerId, rec.playerId), eq(reviews.moveKey, review.key)),
    );
  rec.reviews.set(review.key, review);
  return 'applied';
}

async function recordOne(
  rec: Recording,
  result: TrainingResult,
): Promise<Status> {
  const decision = decide(rec, result);
  switch (decision.kind) {
    case 'answer':
      return decision.status;
    case 'learn':
      return learn(rec, result.moveKey, decision.at);
    case 'grade':
      return regrade(rec, decision);
  }
}

const answerOf = (resultId: string, status: Status): ResultAnswer =>
  typeof status === 'string'
    ? { resultId, status }
    : { resultId, status: 'refused', reason: status.reason };

/** The batch's results in answer order (clamped), then batch order. */
const inAnswerOrder = (batch: readonly TrainingResult[], now: Date) =>
  batch
    .map((result, index) => ({
      result,
      index,
      at: clampAnsweredAt(result.answeredAt, now),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.index - b.index);

const idRowsSchema = z.array(z.object({ resultId: z.string() }));

/** The batch's result ids already in the log. */
async function loggedIds(
  tx: Tx,
  batch: readonly TrainingResult[],
): Promise<Set<string>> {
  const rows = idRowsSchema.parse(
    await tx
      .select({ resultId: reviewResults.resultId })
      .from(reviewResults)
      .where(
        inArray(
          reviewResults.resultId,
          batch.map((r) => r.resultId),
        ),
      ),
  );
  return new Set(rows.map((r) => r.resultId));
}

/** The player's training repertoires, by id: active, and the keys each holds. */
async function trainedBy(
  tx: Tx,
  playerId: string,
  now: Date,
): Promise<Map<string, Trained>> {
  const entries = await trainingEntries(tx, playerId, now);
  return new Map(
    entries.map(({ repertoire }) => [
      repertoire.id,
      { active: repertoire.active, keys: new Set(playerKeys(repertoire.graph)) },
    ]),
  );
}

/**
 * Records a parsed batch for `playerId` (the session account) at `now`, in
 * one transaction (S6 decisions 2-6). Returns one answer per result, in
 * the batch's order. Results apply in answer order, `answeredAt` clamped
 * to [now - 7 days, now]; a result id already recorded, or seen earlier in
 * the batch, is a duplicate and nothing is done for it. Every other result
 * is logged, applied or not.
 */
export function recordResults(
  db: Executor,
  playerId: string,
  batch: readonly TrainingResult[],
  now: Date,
): Promise<ResultAnswer[]> {
  if (batch.length === 0) return Promise.resolve([]);
  return db.transaction(async (tx) => {
    const rec: Recording = {
      tx,
      playerId,
      now,
      trained: await trainedBy(tx, playerId, now),
      reviews: await lockReviews(
        tx,
        playerId,
        [...new Set(batch.map((r) => r.moveKey))].sort(),
      ),
    };
    const seen = await loggedIds(tx, batch);
    const answers: { index: number; answer: ResultAnswer }[] = [];
    const log: (typeof reviewResults.$inferInsert)[] = [];
    for (const { result, index, at } of inAnswerOrder(batch, now)) {
      const { resultId } = result;
      if (seen.has(resultId)) {
        answers.push({ index, answer: { resultId, status: 'duplicate' } });
        continue;
      }
      seen.add(resultId);
      const status = await recordOne(rec, result);
      answers.push({ index, answer: answerOf(resultId, status) });
      log.push({
        resultId,
        playerId,
        moveKey: result.moveKey,
        repertoireId: result.repertoireId,
        kind: result.kind,
        answeredAt: at,
        applied: status === 'applied',
        receivedAt: now,
      });
    }
    if (log.length > 0) {
      await tx
        .insert(reviewResults)
        .values(log)
        .onConflictDoNothing({ target: reviewResults.resultId });
    }
    return answers.sort((a, b) => a.index - b.index).map((a) => a.answer);
  });
}
