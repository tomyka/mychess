import { startReview, type ReviewState } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assign,
  createRepertoire,
  pauseAssignment,
  setTrainingSettings,
  trainingSnapshot,
  unassign,
} from '../src';
import { useTestDatabase } from '../src/testing';
import { seedCoach, seedLink, seedPlayer } from './support/coaching';
import { graphOf } from './support/repertoires';
import { countStatements } from './support/statements';
import { keysOf, writeReview } from './support/training';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-23T08:00:00Z');
const HOUR_MS = 3_600_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

const QUEENS = graphOf('1. d4 d5 2. Bf4 Nf6 *');
const KINGS = graphOf('1. e4 e5 2. Nf3 Nc6 *');
const [D4 = '', BF4 = ''] = keysOf(QUEENS);
const [E4 = '', NF3 = ''] = keysOf(KINGS);
const ALL = { kind: 'all' } as const;

const repertoireOf = (ownerId: string, name: string, pgn = QUEENS) =>
  createRepertoire(db, { ownerId, side: 'white', name, graph: pgn, now: NOW });

async function assignToP(repertoireId: string): Promise<void> {
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
}

async function unassignFromP(repertoireId: string): Promise<void> {
  const { rows } = await client.query(
    'select id from assignments where repertoire_id = $1',
    [repertoireId],
  );
  const [row] = z.array(z.object({ id: z.string() })).parse(rows);
  const done = await unassign(
    db,
    { coachId: 'c', assignmentId: row?.id ?? '' },
    NOW,
  );
  expect(done.ok).toBe(true);
}

/** A Review of `key` for p, learned `hours` before NOW. */
async function learned(key: string, hours = 48): Promise<ReviewState> {
  const review = startReview(key, hoursAgo(hours));
  await writeReview(db, 'p', review, { learnedAt: hoursAgo(hours) });
  return review;
}

const snapshotKeys = async (scope: Parameters<typeof trainingSnapshot>[2]) => {
  const snapshot = await trainingSnapshot(db, 'p', scope, NOW);
  return snapshot && [...snapshot.reviews.keys()].sort();
};

describe('trainingSnapshot', () => {
  beforeEach(async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
  });

  it('carries the entries, held reviews, learned set and settings', async () => {
    const own = await repertoireOf('p', 'Mano');
    const d4 = await learned(D4);
    await writeReview(db, 'p', startReview(BF4, hoursAgo(30)), {
      skippedAt: hoursAgo(30),
    });
    await setTrainingSettings(db, 'p', { sessionSize: 30, newPerDay: 5 }, NOW);
    const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
    expect(snapshot).toMatchObject({
      entries: [{ kind: 'own', name: 'Mano', repertoire: { id: own } }],
      learned: new Set([D4, BF4]),
      learnedToday: 0,
      settings: { sessionSize: 30, newPerDay: 5 },
    });
    expect(snapshot?.reviews.get(D4)).toEqual(d4);
  });

  it('carries no others for every repertoire: the entries hold them all', async () => {
    await repertoireOf('p', 'Mano');
    await assignToP(await repertoireOf('c', 'Trenerio', KINGS));
    const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
    expect(snapshot?.entries).toHaveLength(2);
    expect(snapshot?.others).toEqual([]);
  });

  it('leaves out the reviews of a key no training repertoire holds: dormant (R-44)', async () => {
    await repertoireOf('p', 'Mano');
    await learned(D4);
    await learned(E4);
    expect(await snapshotKeys(ALL)).toEqual([D4]);
    const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
    expect(snapshot?.learned).toEqual(new Set([D4]));
  });

  it('brings dormant reviews back when the repertoire is assigned again', async () => {
    const kings = await repertoireOf('c', 'Trenerio', KINGS);
    await assignToP(kings);
    await learned(E4);
    await unassignFromP(kings);
    expect(await snapshotKeys(ALL)).toEqual([]);
    await assignToP(kings);
    expect(await snapshotKeys(ALL)).toEqual([E4]);
  });

  it('keeps a paused assignment, inactive, and its reviews (R-46)', async () => {
    const kings = await repertoireOf('c', 'Trenerio', KINGS);
    await assignToP(kings);
    await learned(E4);
    const paused = await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: kings, paused: true },
      NOW,
    );
    expect(paused.ok).toBe(true);
    const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
    expect(snapshot?.entries).toMatchObject([
      { repertoire: { id: kings, active: false } },
    ]);
    expect([...(snapshot?.reviews.keys() ?? [])]).toEqual([E4]);
  });

  it('carries no reviews or learned keys before the player learns a move', async () => {
    await repertoireOf('p', 'Mano');
    const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
    expect(snapshot?.reviews).toEqual(new Map());
    expect(snapshot?.learned).toEqual(new Set());
  });

  describe('scoped to one repertoire', () => {
    it('carries only that entry, yet every held review (no shared move goes dormant)', async () => {
      const own = await repertoireOf('p', 'Mano');
      const kings = await repertoireOf('c', 'Trenerio', KINGS);
      await assignToP(kings);
      const d4 = await learned(D4, 10);
      const nf3 = await learned(NF3, 60);
      const snapshot = await trainingSnapshot(
        db,
        'p',
        { kind: 'repertoire', repertoireId: own },
        NOW,
      );
      expect(snapshot?.entries.map((e) => e.repertoire.id)).toEqual([own]);
      expect([...(snapshot?.reviews.keys() ?? [])].sort()).toEqual(
        [D4, NF3].sort(),
      );
      expect(snapshot?.reviews.get(D4)).toEqual(d4);
      expect(snapshot?.reviews.get(NF3)).toEqual(nf3);
    });

    it('carries every other training repertoire, paused included, for the two answers notice (S6 decision 6)', async () => {
      const own = await repertoireOf('p', 'Mano');
      const kings = await repertoireOf('c', 'Trenerio', KINGS);
      const london = await repertoireOf('c', 'Londonas', QUEENS);
      await assignToP(kings);
      await assignToP(london);
      const paused = await pauseAssignment(
        db,
        { playerId: 'p', repertoireId: kings, paused: true },
        NOW,
      );
      expect(paused.ok).toBe(true);
      const snapshot = await trainingSnapshot(
        db,
        'p',
        { kind: 'repertoire', repertoireId: own },
        NOW,
      );
      expect(
        snapshot?.others.toSorted((a, b) => a.name.localeCompare(b.name)),
      ).toEqual([
        { id: london, name: 'Londonas', side: 'white', graph: QUEENS },
        { id: kings, name: 'Trenerio', side: 'white', graph: KINGS },
      ]);
    });

    it("gives undefined for another player's repertoire", async () => {
      await seedPlayer(db, 'q', 'q@example.lt');
      const theirs = await repertoireOf('q', 'Kito');
      await repertoireOf('p', 'Mano');
      expect(
        await trainingSnapshot(
          db,
          'p',
          { kind: 'repertoire', repertoireId: theirs },
          NOW,
        ),
      ).toBeUndefined();
    });

    it('gives undefined for an id that is not a uuid, without a query', async () => {
      let snapshot: unknown = 'unset';
      const statements = await countStatements(async () => {
        snapshot = await trainingSnapshot(
          db,
          'p',
          { kind: 'repertoire', repertoireId: 'not-a-uuid' },
          NOW,
        );
      });
      expect(snapshot).toBeUndefined();
      expect(statements).toBe(0);
    });
  });

  describe('learnedToday (R-147)', () => {
    it("counts the player's Vilnius day: 21:30Z the evening before is today, 20:59Z is not", async () => {
      await repertoireOf('p', 'Mano');
      await writeReview(db, 'p', startReview(D4, NOW), {
        learnedAt: new Date('2026-10-22T21:30:00Z'),
      });
      await writeReview(db, 'p', startReview(BF4, NOW), {
        learnedAt: new Date('2026-10-22T20:59:00Z'),
      });
      const snapshot = await trainingSnapshot(db, 'p', ALL, NOW);
      expect(snapshot?.learnedToday).toBe(1);
    });
  });
});
