import { grade, startReview, type ReviewState } from '@mychess/chess';
import { DEFAULT_TRAINING_SETTINGS } from '@mychess/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  assign,
  createRepertoire,
  learnedBetween,
  learnedKeys,
  pauseAssignment,
  reviewsOf,
  setTrainingSettings,
  trainingEntries,
  trainingSettings,
} from '../src';
import { assignmentPlayers } from '../src/assignment-schema';
import { useTestDatabase } from '../src/testing';
import { seedCoach, seedLink, seedPlayer } from './support/coaching';
import { graphOf } from './support/repertoires';
import { writeReview } from './support/training';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
const DAY_MS = 86_400_000;

const accountRow = async (id: string): Promise<unknown> =>
  (await client.query('select updated_at from accounts where id = $1', [id]))
    .rows[0];

describe('trainingSettings', () => {
  beforeEach(async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
  });

  it('gives a fresh account the defaults (R-62, R-146)', async () => {
    expect(await trainingSettings(db, 'p')).toEqual(DEFAULT_TRAINING_SETTINGS);
  });

  it('gives the defaults for an account that does not exist', async () => {
    expect(await trainingSettings(db, 'nobody')).toEqual(
      DEFAULT_TRAINING_SETTINGS,
    );
  });

  it('reads back what setTrainingSettings wrote, and stamps the account', async () => {
    await setTrainingSettings(db, 'p', { sessionSize: 40, newPerDay: 0 }, NOW);
    expect(await trainingSettings(db, 'p')).toEqual({
      sessionSize: 40,
      newPerDay: 0,
    });
    expect(await accountRow('p')).toEqual({ updated_at: NOW });
  });

  it("writes only the player's own settings", async () => {
    await seedPlayer(db, 'q', 'q@example.lt');
    await setTrainingSettings(db, 'p', { sessionSize: 40, newPerDay: 0 }, NOW);
    expect(await trainingSettings(db, 'q')).toEqual(DEFAULT_TRAINING_SETTINGS);
  });
});

/** A Review learned at NOW, lapsed twice and passed once after. */
function drilled(key: string): ReviewState {
  const first = grade(startReview(key, NOW), 'lapse', LATER);
  const second = grade(first, 'lapse', new Date(LATER.getTime() + DAY_MS));
  return grade(second, 'pass', new Date(LATER.getTime() + 3 * DAY_MS));
}

describe('reviewsOf', () => {
  beforeEach(async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
  });

  it('reads a Review back equal to the one written, lapses in order', async () => {
    const review = drilled('k1');
    expect(review.lapses).toHaveLength(2);
    await writeReview(db, 'p', review, { learnedAt: NOW });
    expect(await reviewsOf(db, 'p')).toEqual(
      new Map([['k1', { review, learnedAt: NOW, skippedAt: null }]]),
    );
  });

  it("reads only the player's own Reviews, skipped ones too", async () => {
    const skipped = startReview('k2', NOW);
    await writeReview(db, 'p', skipped, { skippedAt: NOW });
    await writeReview(db, 'q', startReview('k3', NOW), { learnedAt: NOW });
    expect(await reviewsOf(db, 'p')).toEqual(
      new Map([['k2', { review: skipped, learnedAt: null, skippedAt: NOW }]]),
    );
  });
});

describe('learnedKeys (R-129)', () => {
  beforeEach(async () => {
    for (const id of ['p', 'q', 'r']) {
      await seedPlayer(db, id, `${id}@example.lt`);
    }
  });

  it('gives each player their learned and skipped keys, and only theirs', async () => {
    await writeReview(db, 'p', startReview('a', NOW), { learnedAt: NOW });
    await writeReview(db, 'p', startReview('b', NOW), { skippedAt: NOW });
    await writeReview(db, 'q', startReview('c', NOW), { learnedAt: NOW });
    await writeReview(db, 'r', startReview('d', NOW), { learnedAt: NOW });
    expect(await learnedKeys(db, ['p', 'q', 'n'])).toEqual(
      new Map([
        ['p', new Set(['a', 'b'])],
        ['q', new Set(['c'])],
        ['n', new Set()],
      ]),
    );
  });

  it('reads nothing for no players', async () => {
    await writeReview(db, 'p', startReview('a', NOW), { learnedAt: NOW });
    expect(await learnedKeys(db, [])).toEqual(new Map());
  });
});

describe('learnedBetween (R-147)', () => {
  const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

  beforeEach(async () => {
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedPlayer(db, 'q', 'q@example.lt');
  });

  it('counts the moves learned in [from, to): not skipped, not the end, not another player', async () => {
    await writeReview(db, 'p', startReview('before', NOW), {
      learnedAt: at(-1),
    });
    await writeReview(db, 'p', startReview('start', NOW), { learnedAt: at(0) });
    await writeReview(db, 'p', startReview('inside', NOW), {
      learnedAt: at(5),
    });
    await writeReview(db, 'p', startReview('skipped', NOW), {
      skippedAt: at(5),
    });
    await writeReview(db, 'p', startReview('end', NOW), { learnedAt: at(24) });
    await writeReview(db, 'q', startReview('other', NOW), { learnedAt: at(5) });
    expect(await learnedBetween(db, 'p', at(0), at(24))).toBe(2);
  });
});

describe('trainingEntries (R-145)', () => {
  const PGN = '1. d4 d5 2. Bf4 Nf6 *';

  const repertoireOf = (ownerId: string, name: string, now = NOW) =>
    createRepertoire(db, {
      ownerId,
      side: 'white',
      name,
      graph: graphOf(PGN),
      now,
    });

  async function assignToP(
    repertoireId: string,
    deadline: string | null,
  ): Promise<void> {
    const done = await assign(
      db,
      {
        coachId: 'c',
        repertoireId,
        target: { kind: 'player', playerId: 'p' },
        deadline,
      },
      NOW,
    );
    expect(done.ok).toBe(true);
  }

  beforeEach(async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
  });

  it('orders deadline assignments, then other assignments, then own repertoires', async () => {
    const own = await repertoireOf('p', 'Mano');
    const open = await repertoireOf('c', 'Be termino');
    const due = await repertoireOf('c', 'Su terminu');
    await assignToP(open, null);
    await assignToP(due, '2026-11-01');
    expect(await trainingEntries(db, 'p', NOW)).toMatchObject([
      {
        kind: 'assigned',
        deadline: '2026-11-01',
        name: 'Su terminu',
        side: 'white',
        repertoire: { id: due, active: true },
      },
      {
        kind: 'assigned',
        deadline: null,
        name: 'Be termino',
        repertoire: { id: open, active: true },
      },
      {
        kind: 'own',
        deadline: null,
        name: 'Mano',
        side: 'white',
        repertoire: { id: own, active: true },
      },
    ]);
  });

  it('carries each repertoire with its graph and its place in trainingRepertoires', async () => {
    const older = await repertoireOf('p', 'Senas', NOW);
    const newer = await repertoireOf('p', 'Naujas', LATER);
    const assigned = await repertoireOf('c', 'Trenerio');
    await assignToP(assigned, null);
    const entries = await trainingEntries(db, 'p', NOW);
    expect(entries.map((e) => [e.repertoire.id, e.kind, e.position])).toEqual([
      [assigned, 'assigned', 2],
      [older, 'own', 0],
      [newer, 'own', 1],
    ]);
    expect(entries[0]?.repertoire.graph).toEqual(graphOf(PGN));
  });

  it('keeps a paused assignment, inactive (R-46)', async () => {
    const paused = await repertoireOf('c', 'Pristabdytas');
    await assignToP(paused, null);
    const done = await pauseAssignment(
      db,
      { playerId: 'p', repertoireId: paused, paused: true },
      NOW,
    );
    expect(done.ok).toBe(true);
    expect(await trainingEntries(db, 'p', NOW)).toMatchObject([
      { kind: 'assigned', repertoire: { id: paused, active: false } },
    ]);
  });

  it('leaves out a forked assignment (R-128)', async () => {
    const forked = await repertoireOf('c', 'Atšakotas');
    await assignToP(forked, null);
    await db
      .insert(assignmentPlayers)
      .values({ playerId: 'p', repertoireId: forked, forkedAt: NOW });
    expect(await trainingEntries(db, 'p', NOW)).toEqual([]);
  });

  it("leaves out another player's repertoires", async () => {
    await seedPlayer(db, 'q', 'q@example.lt');
    await repertoireOf('q', 'Kito');
    expect(await trainingEntries(db, 'p', NOW)).toEqual([]);
  });
});
