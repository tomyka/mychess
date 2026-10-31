import { randomUUID } from 'node:crypto';
import { grade, startReview, type ReviewState } from '@mychess/chess';
import type {
  ResultAnswer,
  ResultKind,
  TrainingRefusal,
  TrainingResult,
} from '@mychess/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assign, pauseAssignment, recordResults, reviewsOf } from '../src';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedLink,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';
import { graphOf, newRepertoire } from './support/repertoires';
import { statementsOf } from './support/statements';
import { keysOf, writeReview } from './support/training';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-23T12:00:00Z');
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

const QUEENS = graphOf('1. d4 d5 2. Bf4 Nf6 *');
const KINGS = graphOf('1. e4 e5 2. Nf3 Nc6 *');
const [D4 = '', BF4 = ''] = keysOf(QUEENS);
const [E4 = ''] = keysOf(KINGS);

let own = '';

/** One result for p, answered `hours` before NOW, on p's own repertoire by default. */
const result = (
  kind: ResultKind,
  moveKey: string,
  hours = 1,
  repertoireId = own,
): TrainingResult => ({
  resultId: randomUUID(),
  kind,
  moveKey,
  repertoireId,
  answeredAt: hoursAgo(hours),
});

const answer = (
  { resultId }: TrainingResult,
  status: 'applied' | 'stale' | 'duplicate',
): ResultAnswer => ({ resultId, status });

const refused = (
  { resultId }: TrainingResult,
  reason: TrainingRefusal['reason'],
): ResultAnswer => ({ resultId, status: 'refused', reason });

const record = (batch: TrainingResult[], now = NOW) =>
  recordResults(db, 'p', batch, now);

/** p's stored Review of `key`, if any. */
const reviewOf = async (key: string): Promise<ReviewState | undefined> =>
  (await reviewsOf(db, 'p')).get(key)?.review;

const rowSchema = z.array(z.object({ reps: z.number(), updated_at: z.date() }));
const rowOf = async (key: string) =>
  rowSchema.parse(
    (
      await client.query(
        'select reps, updated_at from reviews where player_id = $1 and move_key = $2',
        ['p', key],
      )
    ).rows,
  );

const logSchema = z.array(
  z.object({
    result_id: z.string(),
    player_id: z.string(),
    move_key: z.string(),
    kind: z.string(),
    answered_at: z.date(),
    applied: z.boolean(),
    received_at: z.date(),
  }),
);
const logOf = async () =>
  logSchema.parse(
    (
      await client.query(
        `select result_id, player_id, move_key, kind, answered_at, applied, received_at
         from review_results order by answered_at, result_id`,
      )
    ).rows,
  );

/** A Review of `key` for p, learned `hours` before NOW. */
async function learned(key: string, hours = 48): Promise<ReviewState> {
  const review = startReview(key, hoursAgo(hours));
  await writeReview(db, 'p', review, { learnedAt: hoursAgo(hours) });
  return review;
}

describe('recordResults', () => {
  beforeEach(async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    own = await newRepertoire(db, {
      ownerId: 'p',
      side: 'white',
      name: 'Mano',
      graph: QUEENS,
      now: NOW,
    });
  });

  it('answers an empty batch with nothing, without a query', async () => {
    let answers: ResultAnswer[] = [answer(result('pass', D4), 'stale')];
    const statements = await statementsOf(async () => {
      answers = await record([]);
    });
    expect(answers).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('records a learned move:a review due a day after it, learned then, and a log row', async () => {
    const learn = result('learned', D4, 2);
    expect(await record([learn])).toEqual([answer(learn, 'applied')]);
    const stored = (await reviewsOf(db, 'p')).get(D4);
    expect(stored).toEqual({
      review: startReview(D4, hoursAgo(2)),
      learnedAt: hoursAgo(2),
      skippedAt: null,
    });
    expect(stored?.review.fsrs.due).toEqual(
      new Date(hoursAgo(2).getTime() + DAY_MS),
    );
    expect(await logOf()).toEqual([
      {
        result_id: learn.resultId,
        player_id: 'p',
        move_key: D4,
        kind: 'learned',
        answered_at: hoursAgo(2),
        applied: true,
        received_at: NOW,
      },
    ]);
  });

  it('answers a batch posted again as duplicates, and leaves the review as it was', async () => {
    await learned(D4);
    const batch = [result('pass', D4, 2)];
    expect(await record(batch)).toEqual(batch.map((r) => answer(r, 'applied')));
    const before = await rowOf(D4);
    const later = new Date(NOW.getTime() + HOUR_MS);
    expect(await record(batch, later)).toEqual(
      batch.map((r) => answer(r, 'duplicate')),
    );
    expect(await rowOf(D4)).toEqual(before);
    expect(await logOf()).toHaveLength(1);
  });

  it('answers a result id seen earlier in the same batch as a duplicate', async () => {
    await learned(D4);
    const pass = result('pass', D4, 2);
    expect(await record([pass, pass])).toEqual([
      answer(pass, 'applied'),
      answer(pass, 'duplicate'),
    ]);
    expect(await rowOf(D4)).toMatchObject([{ reps: 2 }]);
  });

  it('refuses a graded result for a move not learned, and logs it unapplied', async () => {
    const pass = result('pass', D4);
    expect(await record([pass])).toEqual([
      refused(pass, 'training.notLearned'),
    ]);
    expect(await reviewOf(D4)).toBeUndefined();
    expect(await logOf()).toMatchObject([
      { result_id: pass.resultId, applied: false },
    ]);
  });

  it('refuses, unlogged, a key the repertoire does not hold and a repertoire the player does not train', async () => {
    await seedPlayer(db, 'q', 'q@example.lt');
    const theirs = await newRepertoire(db, {
      ownerId: 'q',
      side: 'white',
      name: 'Kito',
      graph: QUEENS,
      now: NOW,
    });
    const unheld = result('learned', E4);
    const foreign = result('learned', D4, 1, theirs);
    const unknown = result('learned', D4, 1, randomUUID());
    expect(await record([unheld, foreign, unknown])).toEqual([
      refused(unheld, 'training.notHeld'),
      refused(foreign, 'training.notHeld'),
      refused(unknown, 'training.notHeld'),
    ]);
    expect(await reviewsOf(db, 'p')).toEqual(new Map());
    expect(await logOf()).toEqual([]);
  });

  it('logs no row for a result that names nothing the player holds, so resending it is refused again', async () => {
    const unheld = result('learned', E4);
    expect(await record([unheld])).toEqual([
      refused(unheld, 'training.notHeld'),
    ]);
    expect(await record([unheld])).toEqual([
      refused(unheld, 'training.notHeld'),
    ]);
    expect(await logOf()).toEqual([]);
  });

  it('refuses learning on a paused assignment, yet applies an answer on it (S6 decision 6)', async () => {
    const kings = await newRepertoire(db, {
      ownerId: 'c',
      side: 'white',
      name: 'Trenerio',
      graph: KINGS,
      now: NOW,
    });
    const assigned = await assign(
      db,
      {
        coachId: 'c',
        repertoireId: kings,
        target: { kind: 'player', playerId: 'p' },
        deadline: null,
      },
      NOW,
    );
    expect(assigned.ok).toBe(true);
    const paused = await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: kings, paused: true },
      NOW,
    );
    expect(paused.ok).toBe(true);
    const [, nf3 = ''] = keysOf(KINGS);
    await learned(nf3);
    const learn = result('learned', E4, 1, kings);
    const pass = result('pass', nf3, 1, kings);
    expect(await record([learn, pass])).toEqual([
      refused(learn, 'training.paused'),
      answer(pass, 'applied'),
    ]);
    expect((await logOf()).map((r) => [r.result_id, r.applied])).toEqual(
      expect.arrayContaining([
        [learn.resultId, false],
        [pass.resultId, true],
      ]),
    );
    expect(await logOf()).toHaveLength(2);
  });

  it('applies a batch in answer order, and keeps a later-sent earlier answer as stale', async () => {
    const start = await learned(D4, 48);
    const pass = result('pass', D4, 1);
    const lapse = result('lapse', D4, 2);
    expect(await record([pass, lapse])).toEqual([
      answer(pass, 'applied'),
      answer(lapse, 'applied'),
    ]);
    const expected = grade(
      grade(start, 'lapse', hoursAgo(2)),
      'pass',
      hoursAgo(1),
    );
    expect(await reviewOf(D4)).toEqual(expected);

    const late = result('lapse', D4, 1.5);
    expect(await record([late])).toEqual([answer(late, 'stale')]);
    expect(await reviewOf(D4)).toEqual(expected);
    expect((await logOf()).map((r) => [r.result_id, r.applied])).toEqual([
      [lapse.resultId, true],
      [late.resultId, false],
      [pass.resultId, true],
    ]);
  });

  it('keeps a learned move learned again as stale', async () => {
    const start = await learned(D4);
    const again = result('learned', D4);
    expect(await record([again])).toEqual([answer(again, 'stale')]);
    expect(await reviewOf(D4)).toEqual(start);
  });

  it('records a lapse in the lapse history, due again the same day (R-56, R-78)', async () => {
    await learned(D4);
    const lapse = result('lapse', D4, 3);
    await record([lapse]);
    const review = await reviewOf(D4);
    expect(review?.lapses).toEqual([hoursAgo(3)]);
    const due = review?.fsrs.due.getTime() ?? Infinity;
    expect(due - hoursAgo(3).getTime()).toBeLessThan(DAY_MS);
    expect(due).toBeGreaterThan(hoursAgo(3).getTime());
  });

  it('grades and logs an answer dated thirty days back at seven days back', async () => {
    const learn = result('learned', D4, 30 * 24);
    expect(await record([learn])).toEqual([answer(learn, 'applied')]);
    const weekAgo = hoursAgo(7 * 24);
    expect((await reviewOf(D4))?.fsrs.last_review).toEqual(weekAgo);
    expect(await logOf()).toMatchObject([{ answered_at: weekAgo }]);
  });

  it('lets two batches on the same key run together, and counts both', async () => {
    await learned(D4);
    const lock = await openTransaction(client, [
      `select 1 from reviews where player_id = 'p' and move_key = '${D4}' for update`,
    ]);
    const first = record([result('pass', D4, 1)]);
    const second = record([result('pass', D4, 1)]);
    await someoneWaitsForALock(client, 2);
    await lock.finish();
    expect((await Promise.all([first, second])).flat()).toMatchObject([
      { status: 'applied' },
      { status: 'applied' },
    ]);
    expect(await rowOf(D4)).toMatchObject([{ reps: 3 }]);
  });

  it('keeps a move another batch learned meanwhile as stale', async () => {
    const other = await openTransaction(client, [
      `insert into reviews (player_id, move_key, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
         learned_at, created_at, updated_at)
       values ('p', '${D4}', now(), 1, 5, 0, 1, 0, 1, 0, 2, now(), now(), now())`,
    ]);
    const learn = result('learned', D4);
    const recorded = record([learn]);
    await someoneWaitsForALock(client);
    await other.finish();
    expect(await recorded).toEqual([answer(learn, 'stale')]);
    expect(await logOf()).toMatchObject([{ applied: false }]);
  });

  it("applies and logs a result whose id another player logged, and answers this player's own repeat as a duplicate", async () => {
    await seedPlayer(db, 'q', 'q@example.lt');
    const theirs = await newRepertoire(db, {
      ownerId: 'q',
      side: 'white',
      name: 'Kito',
      graph: QUEENS,
      now: NOW,
    });
    const learn = result('learned', D4);
    expect(
      await recordResults(db, 'q', [{ ...learn, repertoireId: theirs }], NOW),
    ).toEqual([answer(learn, 'applied')]);
    expect(await record([learn])).toEqual([answer(learn, 'applied')]);
    expect(await reviewOf(D4)).toBeDefined();
    expect(
      (await logOf()).map((r) => [r.result_id, r.player_id, r.applied]).sort(),
    ).toEqual([
      [learn.resultId, 'p', true],
      [learn.resultId, 'q', true],
    ]);
    expect(await record([learn])).toEqual([answer(learn, 'duplicate')]);
    expect(await logOf()).toHaveLength(2);
  });

  it('serialises two batches learning the same new moves in opposite order, without a deadlock', async () => {
    // Holding inserts into reviews back lines both batches up at their
    // first insert, so without serialising they would cross.
    const hold = await openTransaction(client, [
      'lock table reviews in share mode',
    ]);
    const first = record([result('learned', D4, 2), result('learned', BF4, 1)]);
    const second = record([
      result('learned', BF4, 2),
      result('learned', D4, 1),
    ]);
    await someoneWaitsForALock(client, 2);
    await hold.finish();
    const statuses = (await Promise.all([first, second]))
      .flat()
      .map((a) => a.status)
      .sort();
    expect(statuses).toEqual(['applied', 'applied', 'stale', 'stale']);
    expect(await reviewOf(D4)).toBeDefined();
    expect(await reviewOf(BF4)).toBeDefined();
  });

  it('locks every touched review in one statement and logs the batch in one insert', async () => {
    await learned(D4);
    await learned(BF4);
    const batch = [
      result('pass', D4),
      result('lapse', BF4),
      ...Array.from({ length: 48 }, (_, i) =>
        result('learned', `k${String(i)}x`),
      ),
    ];
    let answers: ResultAnswer[] = [];
    const statements = await statementsOf(async () => {
      answers = await record(batch);
    });
    expect(answers.filter((a) => a.status === 'applied')).toHaveLength(2);
    expect(statements.filter((s) => /for update/i.test(s))).toHaveLength(1);
    expect(
      statements.filter((s) => /insert into "review_results"/i.test(s)),
    ).toHaveLength(1);
  });
});
