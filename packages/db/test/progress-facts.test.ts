import { startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import { forkAssignment, shareRepertoire } from '../src';
import { coachProgressFacts, lastTrained } from '../src/progress/facts';
import { sharedPairs } from '../src/share-scope';
import { trackedReviews } from '../src/training/reviews';
import { reviewResults } from '../src/training-schema';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import { seedCoach, seedLink, seedPlayer } from './support/coaching';
import { countStatements } from './support/statements';
import { writeReview } from './support/training';

const { db } = useTestDatabase();
const NOW = new Date('2026-10-26T09:00:00Z');
const HOUR = 3_600_000;

async function result(
  playerId: string,
  repertoireId: string,
  answeredAt: Date,
): Promise<void> {
  await db.insert(reviewResults).values({
    resultId: crypto.randomUUID(),
    playerId,
    moveKey: 'k',
    repertoireId,
    kind: 'pass',
    answeredAt,
    applied: true,
    receivedAt: answeredAt,
  });
}

/** A setup step that must not be refused. */
function succeeded(
  done: { ok: true } | { ok: false; refusal: { reason: string } },
): void {
  if (!done.ok) throw new Error(done.refusal.reason);
}

describe('trackedReviews', () => {
  beforeEach(async () => {
    await seedPlayer(db, 'p1', 'p1@example.lt');
    await seedPlayer(db, 'p2', 'p2@example.lt');
  });

  it('reads the asked keys of every asked player, marking skipped ones', async () => {
    const learned = startReview('a', NOW);
    await writeReview(db, 'p1', learned, { learnedAt: NOW });
    await writeReview(db, 'p2', startReview('a', NOW), { skippedAt: NOW });
    await writeReview(db, 'p2', startReview('b', NOW), { learnedAt: NOW });
    const read = await trackedReviews(db, ['p1', 'p2', 'p3'], ['a']);
    expect(read.get('p1')?.get('a')).toEqual({
      review: learned,
      skipped: false,
    });
    expect(read.get('p2')?.get('a')?.skipped).toBe(true);
    expect(read.get('p2')?.has('b')).toBe(false);
    expect(read.get('p3')?.size).toBe(0);
    expect([...read.keys()]).toEqual(['p1', 'p2', 'p3']);
  });

  it('is one statement whatever the number of players', async () => {
    expect(
      await countStatements(() => trackedReviews(db, ['p1', 'p2'], ['a'])),
    ).toBe(1);
  });

  it('sends nothing for no players or no keys', async () => {
    expect(await countStatements(() => trackedReviews(db, [], ['a']))).toBe(0);
    expect(await countStatements(() => trackedReviews(db, ['p1'], []))).toBe(0);
    expect((await trackedReviews(db, ['p1'], [])).get('p1')?.size).toBe(0);
  });
});

describe('coachProgressFacts and lastTrained', () => {
  let assigned = '';
  let forked = '';
  let shared = '';
  let privateRep = '';

  beforeEach(async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedCoach(db, 'c2', 'c2@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
    await seedLink(db, 'c', 'p');
    await seedLink(db, 'c2', 'p');
    assigned = await seedRepertoire(db, 'c', NOW);
    forked = await seedRepertoire(db, 'c', NOW);
    shared = await seedRepertoire(db, 'p', NOW);
    privateRep = await seedRepertoire(db, 'p', NOW);
    for (const id of [assigned, forked])
      await seedAssignment(db, {
        coachId: 'c',
        repertoireId: id,
        target: { playerId: 'p' },
        now: NOW,
      });
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: forked }, NOW),
    );
    succeeded(
      await shareRepertoire(db, {
        ownerId: 'p',
        repertoireId: shared,
        coachId: 'c',
        now: NOW,
      }),
    );
  });

  it('reads the link, the shares and this coach’s assignments per player', async () => {
    const facts = await coachProgressFacts(db, 'c', ['p', 'q']);
    const p = facts.get('p');
    expect(p?.linked).toBe(true);
    expect([...(p?.sharedRepertoireIds ?? [])]).toEqual([shared]);
    expect(p?.assignments.map((a) => a.repertoireId).sort()).toEqual(
      [assigned, forked].sort(),
    );
    expect(p?.assignments.every((a) => a.playerId === 'p')).toBe(true);
    const q = facts.get('q');
    expect(q?.linked).toBe(false);
    expect(q?.sharedRepertoireIds.size).toBe(0);
    expect(q?.assignments).toEqual([]);
  });

  it('reads no facts for no players, in no statement', async () => {
    expect(await countStatements(() => coachProgressFacts(db, 'c', []))).toBe(
      0,
    );
    expect((await coachProgressFacts(db, 'c', [])).size).toBe(0);
  });

  it('reads the shares to this coach only', async () => {
    expect(await sharedPairs(db, 'c', ['p', 'q'])).toEqual([
      { playerId: 'p', repertoireId: shared },
    ]);
  });

  it('never reads another coach’s shares', async () => {
    expect(await sharedPairs(db, 'c2', ['p'])).toEqual([]);
  });

  it('reads no shares for no players, in no statement', async () => {
    expect(await countStatements(() => sharedPairs(db, 'c', []))).toBe(0);
  });

  it('counts only results on repertoires the coach may see (R-154)', async () => {
    await result('p', assigned, new Date(NOW.getTime() - 3 * HOUR));
    await result('p', shared, new Date(NOW.getTime() - 2 * HOUR));
    await result('p', privateRep, new Date(NOW.getTime() - HOUR));
    await result('p', forked, new Date(NOW.getTime() - HOUR));
    const facts = await coachProgressFacts(db, 'c', ['p']);
    expect((await lastTrained(db, 'c', facts)).get('p')).toEqual(
      new Date(NOW.getTime() - 2 * HOUR),
    );
  });

  it('has no entry for a player with no visible results', async () => {
    await result('p', privateRep, NOW);
    const facts = await coachProgressFacts(db, 'c', ['p']);
    expect((await lastTrained(db, 'c', facts)).has('p')).toBe(false);
  });

  it('checks the link again in SQL, whatever the facts say', async () => {
    await result('q', privateRep, NOW);
    const forged = new Map([
      [
        'q',
        {
          linked: true,
          sharedRepertoireIds: new Set([privateRep]),
          assignments: [],
        },
      ],
    ]);
    expect((await lastTrained(db, 'c', forged)).has('q')).toBe(false);
  });

  it('sends nothing when the coach may see no repertoire', async () => {
    await result('q', privateRep, NOW);
    const facts = await coachProgressFacts(db, 'c', ['q']);
    expect(await countStatements(() => lastTrained(db, 'c', facts))).toBe(0);
    expect((await lastTrained(db, 'c', facts)).size).toBe(0);
  });

  it('reads facts in a fixed number of statements', async () => {
    const one = await countStatements(() => coachProgressFacts(db, 'c', ['p']));
    const two = await countStatements(() =>
      coachProgressFacts(db, 'c', ['p', 'q']),
    );
    expect(two).toBe(one);
  });
});
