import { randomUUID } from 'node:crypto';
import {
  grade,
  isPlayerMove,
  lines,
  moveKey,
  startReview,
  type RepertoireGraph,
} from '@mychess/chess';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assign,
  createRepertoire,
  knowCount,
  learnAgain,
  learnedBetween,
  markKnown,
  pauseAssignment,
  reviewsOf,
  type KnowScope,
} from '../src';
import { reviewRow } from '../src/training/reviews';
import { reviews } from '../src/training-schema';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedLink,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';
import { graphOf, LONDON } from './support/repertoires';
import { keysOf, writeReview } from './support/training';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-23T12:00:00Z');
const DAY_MS = 86_400_000;
const EARLIER = new Date(NOW.getTime() - 2 * DAY_MS);
const LATER = new Date(NOW.getTime() + 2 * DAY_MS);

/** Three player moves (d4, Bf4, e3) in one chapter. */
const QUEENS = graphOf('1. d4 d5 2. Bf4 Nf6 3. e3 *');
const [D4 = '', BF4 = '', E3 = ''] = keysOf(QUEENS);
const LONDON_GRAPH = graphOf(LONDON);

let own = '';

const chapterOf = (graph: RepertoireGraph): string => {
  const [chapter] = graph.chapters;
  if (chapter === undefined) throw new Error('expected a chapter');
  return chapter.id;
};

const chapter = (repertoireId = own, graph = QUEENS): KnowScope => ({
  kind: 'chapter',
  repertoireId,
  chapterId: chapterOf(graph),
});

const keysIn = async (playerId = 'p'): Promise<string[]> =>
  [...(await reviewsOf(db, playerId)).keys()].sort();

/** p learned `key` two days before NOW. */
const learned = (key: string, playerId = 'p') =>
  writeReview(db, playerId, startReview(key, EARLIER), {
    learnedAt: EARLIER,
  });

/** p's stored Review of `key` graded pass at `at`. */
async function graded(key: string, at: Date): Promise<void> {
  const stored = (await reviewsOf(db, 'p')).get(key);
  if (stored === undefined) throw new Error('expected a review');
  await db
    .update(reviews)
    .set(reviewRow(grade(stored.review, 'pass', at)))
    .where(and(eq(reviews.playerId, 'p'), eq(reviews.moveKey, key)));
}

/** A repertoire of c's with QUEENS, assigned to p. */
async function assignedToP(): Promise<string> {
  const repertoireId = await createRepertoire(db, {
    ownerId: 'c',
    side: 'white',
    name: 'Trenerio',
    graph: QUEENS,
    now: NOW,
  });
  const done = await assign(
    db,
    {
      coachId: 'c',
      repertoireId,
      target: { kind: 'player', playerId: 'p' },
      deadline: null,
    },
    NOW,
  );
  expect(done.ok).toBe(true);
  return repertoireId;
}

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedPlayer(db, 'p', 'p@example.lt');
  await seedPlayer(db, 'q', 'q@example.lt');
  await seedLink(db, 'c', 'p');
  own = await createRepertoire(db, {
    ownerId: 'p',
    side: 'white',
    name: 'Mano',
    graph: QUEENS,
    now: NOW,
  });
});

describe('markKnown (R-58)', () => {
  it('adds the chapter moves not yet in review as skipped, first due the next day', async () => {
    await learned(BF4);
    expect(await markKnown(db, 'p', chapter(), NOW)).toBe(2);
    const stored = await reviewsOf(db, 'p');
    for (const key of [D4, E3]) {
      expect(stored.get(key)).toEqual({
        review: startReview(key, NOW),
        learnedAt: null,
        skippedAt: NOW,
      });
      expect(stored.get(key)?.review.fsrs.due).toEqual(
        new Date(NOW.getTime() + DAY_MS),
      );
    }
    expect(stored.get(BF4)).toEqual({
      review: startReview(BF4, EARLIER),
      learnedAt: EARLIER,
      skippedAt: null,
    });
  });

  it('adds nothing the second time', async () => {
    expect(await markKnown(db, 'p', chapter(), NOW)).toBe(3);
    expect(await markKnown(db, 'p', chapter(), LATER)).toBe(0);
    expect((await reviewsOf(db, 'p')).get(D4)?.skippedAt).toEqual(NOW);
  });

  it('marks one player move, and refuses an opponent move or a move not in the repertoire', async () => {
    const move = (key: string): KnowScope => ({
      kind: 'move',
      repertoireId: own,
      moveKey: key,
    });
    const opponent = QUEENS.moves.find((m) => !isPlayerMove(QUEENS, m));
    if (opponent === undefined) throw new Error('expected an opponent move');
    const d5 = moveKey(opponent.from, opponent.san);
    expect(await markKnown(db, 'p', move(d5), NOW)).toBeUndefined();
    expect(await knowCount(db, 'p', move(d5), 'know')).toBeUndefined();
    expect(await learnAgain(db, 'p', move(d5))).toBeUndefined();
    const [e4 = ''] = keysOf(graphOf('1. e4 *'));
    expect(await markKnown(db, 'p', move(e4), NOW)).toBeUndefined();
    expect(await keysIn()).toEqual([]);
    expect(await markKnown(db, 'p', move(BF4), NOW)).toBe(1);
    expect(await keysIn()).toEqual([BF4]);
  });

  it('marks one line of a chapter, and refuses a line or chapter the repertoire lacks', async () => {
    const london = await createRepertoire(db, {
      ownerId: 'p',
      side: 'white',
      name: 'Londonas',
      graph: LONDON_GRAPH,
      now: NOW,
    });
    const chapterId = chapterOf(LONDON_GRAPH);
    const line = (lineIndex: number, id = chapterId): KnowScope => ({
      kind: 'line',
      repertoireId: london,
      chapterId: id,
      lineIndex,
    });
    const second = lines(LONDON_GRAPH, chapterId)[1] ?? [];
    const expected = second
      .filter((m) => isPlayerMove(LONDON_GRAPH, m))
      .map((m) => moveKey(m.from, m.san));
    expect(expected).toHaveLength(4);
    expect(await knowCount(db, 'p', line(1), 'know')).toBe(4);
    expect(await markKnown(db, 'p', line(1), NOW)).toBe(4);
    expect(await keysIn()).toEqual([...expected].sort());
    for (const scope of [
      line(9),
      line(-1),
      line(0, randomUUID()),
      { kind: 'chapter', repertoireId: london, chapterId: randomUUID() },
    ] as const)
      expect(await markKnown(db, 'p', scope, NOW)).toBeUndefined();
    expect(await keysIn()).toEqual([...expected].sort());
  });

  it("refuses a repertoire the player does not train, or another player's", async () => {
    const theirs = await createRepertoire(db, {
      ownerId: 'q',
      side: 'white',
      name: 'Kito',
      graph: QUEENS,
      now: NOW,
    });
    for (const id of [theirs, randomUUID(), 'not-an-id']) {
      expect(await markKnown(db, 'p', chapter(id), NOW)).toBeUndefined();
      expect(await knowCount(db, 'p', chapter(id), 'again')).toBeUndefined();
      expect(await learnAgain(db, 'p', chapter(id))).toBeUndefined();
    }
    expect(await keysIn('p')).toEqual([]);
    expect(await keysIn('q')).toEqual([]);
  });

  it('marks an assigned repertoire, and refuses it while paused (R-46)', async () => {
    const assigned = await assignedToP();
    expect(await markKnown(db, 'p', chapter(assigned), NOW)).toBe(3);
    const paused = await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: assigned, paused: true },
      NOW,
    );
    expect(paused.ok).toBe(true);
    expect(await markKnown(db, 'p', chapter(assigned), NOW)).toBeUndefined();
    expect(
      await knowCount(db, 'p', chapter(assigned), 'again'),
    ).toBeUndefined();
    expect(await learnAgain(db, 'p', chapter(assigned))).toBeUndefined();
    expect(await keysIn()).toEqual([D4, BF4, E3].sort());
  });

  it('does not count skipped moves as learned (R-147)', async () => {
    await learned(BF4);
    await markKnown(db, 'p', chapter(), NOW);
    expect(await learnedBetween(db, 'p', EARLIER, LATER)).toBe(1);
  });
});

describe('knowCount (R-147)', () => {
  it('counts the moves each action would change, without writing', async () => {
    await learned(BF4);
    expect(await knowCount(db, 'p', chapter(), 'know')).toBe(2);
    expect(await knowCount(db, 'p', chapter(), 'again')).toBe(0);
    expect(await keysIn()).toEqual([BF4]);
    await markKnown(db, 'p', chapter(), NOW);
    expect(await knowCount(db, 'p', chapter(), 'know')).toBe(0);
    expect(await knowCount(db, 'p', chapter(), 'again')).toBe(2);
  });
});

describe('learnAgain (R-147)', () => {
  it('removes the skipped moves never drilled, and keeps a drilled or learned one', async () => {
    await learned(BF4);
    await markKnown(db, 'p', chapter(), NOW);
    await graded(D4, LATER);
    expect(await learnAgain(db, 'p', chapter())).toBe(1);
    expect(await keysIn()).toEqual([D4, BF4].sort());
    expect(await learnAgain(db, 'p', chapter())).toBe(0);
  });

  it("leaves another player's skipped moves alone", async () => {
    await writeReview(db, 'q', startReview(D4, NOW), { skippedAt: NOW });
    await markKnown(db, 'p', chapter(), NOW);
    expect(await learnAgain(db, 'p', chapter())).toBe(3);
    expect(await keysIn('p')).toEqual([]);
    expect(await keysIn('q')).toEqual([D4]);
  });

  it('waits for a review being graded, then keeps it', async () => {
    await markKnown(db, 'p', chapter(), NOW);
    const grading = await openTransaction(client, [
      `select 1 from reviews where player_id = 'p' and move_key = '${D4}' for update`,
    ]);
    const again = learnAgain(db, 'p', chapter());
    await someoneWaitsForALock(client);
    await grading.finish(
      `update reviews set reps = 2 where player_id = 'p' and move_key = '${D4}'`,
    );
    expect(await again).toBe(2);
    expect(await keysIn()).toEqual([D4]);
  });
});
