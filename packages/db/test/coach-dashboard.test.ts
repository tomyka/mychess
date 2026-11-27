import { playerKeys, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachDashboard,
  coachPlayerProgress,
  forkAssignment,
  shareRepertoire,
  unlink,
  type DashboardPlayer,
} from '../src';
import { graphRows } from '../src/repertoires/repository';
import { reviewResults } from '../src/training-schema';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedLinks,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { countStatements, statementsOf } from './support/statements';
import { writeReview } from './support/training';

const { db } = useTestDatabase();
const NOW = new Date('2026-10-26T09:00:00Z');
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY_MS);

let karoKan = ''; // the coach's, assigned to p with a deadline
let group = '';
let shared = ''; // q's own, shared with c
let privateRep = ''; // q's own, not shared

/** A read the test expects to find something. */
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** A setup step that must not be refused. */
function succeeded(
  done: { ok: true } | { ok: false; refusal: { reason: string } },
): void {
  if (!done.ok) throw new Error(done.refusal.reason);
}

/** `playerId` learned every player move of `repertoireId` a week ago; all due now. */
async function learnAll(playerId: string, repertoireId: string): Promise<void> {
  const keys = playerKeys(await graphRows(db, repertoireId, 'white'));
  for (const key of keys)
    await writeReview(db, playerId, startReview(key, WEEK_AGO), {
      learnedAt: WEEK_AGO,
    });
}

/** A training result of `playerId` on `repertoireId`, answered at `answeredAt`. */
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

/** What the player page reads of `playerId`, in the dashboard's shape. */
async function playerPageOf(playerId: string): Promise<DashboardPlayer> {
  const page = present(await coachPlayerProgress(db, 'c', playerId, NOW));
  return { ...page.player, lastTrained: page.lastTrained, rows: page.rows };
}

/** The ids of the players on the coach's dashboard, in its order. */
const idsOn = async (coachId: string): Promise<string[]> =>
  (await coachDashboard(db, coachId, NOW)).map((player) => player.id);

/** The repertoire ids of `playerId`'s rows on the coach's dashboard. */
async function rowIdsOf(playerId: string): Promise<string[]> {
  const players = await coachDashboard(db, 'c', NOW);
  const player = present(players.find((one) => one.id === playerId));
  return player.rows.map((row) => row.repertoire.id);
}

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  await seedCoach(db, 'other', 'other@example.lt');
  await seedPlayer(db, 'p', 'p@example.lt');
  await seedPlayer(db, 'q', 'q@example.lt');
  await seedPlayer(db, 'stranger', 's@example.lt');
  await seedLink(db, 'c', 'p');
  await seedLink(db, 'c', 'q');
  karoKan = await seedRepertoire(db, 'c', NOW);
  shared = await seedRepertoire(db, 'q', NOW);
  privateRep = await seedRepertoire(db, 'q', NOW);
  group = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', group, 'p');
  await seedAssignment(db, {
    coachId: 'c',
    repertoireId: karoKan,
    target: { playerId: 'p' },
    now: NOW,
    deadline: '2026-10-20',
  });
  succeeded(
    await shareRepertoire(db, {
      ownerId: 'q',
      repertoireId: shared,
      coachId: 'c',
      now: NOW,
    }),
  );
});

describe('coachDashboard (R-229)', () => {
  it('gives every linked player, by name, what their player page shows', async () => {
    await learnAll('p', karoKan);
    await learnAll('q', shared);
    await result('q', shared, new Date(NOW.getTime() - HOUR_MS));
    const players = await coachDashboard(db, 'c', NOW);
    expect(players).toEqual([await playerPageOf('p'), await playerPageOf('q')]);
    expect(players.map((one) => one.rows.map((row) => row.source))).toEqual([
      ['assigned'],
      ['shared'],
    ]);
    expect(players[0]).toMatchObject({
      displayName: 'Name p',
      groups: [{ id: group, name: 'Šeštadienio grupė' }],
      lastTrained: null,
      rows: [{ status: { deadline: '2026-10-20', done: true } }],
    });
    expect(players[1]?.lastTrained).toEqual(new Date(NOW.getTime() - HOUR_MS));
    expect(players.every((one) => one.linkedAt instanceof Date)).toBe(true);
  });

  it('says when each last trained, from visible results only (R-154)', async () => {
    await result('p', karoKan, new Date(NOW.getTime() - 2 * HOUR_MS));
    await result('q', privateRep, NOW);
    const players = await coachDashboard(db, 'c', NOW);
    expect(players.map((one) => [one.id, one.lastTrained])).toEqual([
      ['p', new Date(NOW.getTime() - 2 * HOUR_MS)],
      ['q', null],
    ]);
  });

  it('leaves out a player who unlinked after visible training', async () => {
    await result('p', karoKan, new Date(NOW.getTime() - HOUR_MS));
    expect((await coachDashboard(db, 'c', NOW))[0]).toMatchObject({
      id: 'p',
      lastTrained: new Date(NOW.getTime() - HOUR_MS),
    });
    succeeded(await unlink(db, 'c', 'p', NOW));
    expect(await idsOn('c')).toEqual(['q']);
  });

  it('never lists a player linked to another coach only', async () => {
    await seedLink(db, 'other', 'stranger');
    expect(await idsOn('c')).toEqual(['p', 'q']);
    expect(await idsOn('other')).toEqual(['stranger']);
  });

  it('never shows a repertoire the player shares with another coach (Q26)', async () => {
    await seedLink(db, 'other', 'q');
    succeeded(
      await shareRepertoire(db, {
        ownerId: 'q',
        repertoireId: privateRep,
        coachId: 'other',
        now: NOW,
      }),
    );
    expect(await rowIdsOf('q')).toEqual([shared]);
  });

  it('gives each player only their own share, one read for both (Q26)', async () => {
    const pShare = await seedRepertoire(db, 'p', NOW);
    succeeded(
      await shareRepertoire(db, {
        ownerId: 'p',
        repertoireId: pShare,
        coachId: 'c',
        now: NOW,
      }),
    );
    const players = await coachDashboard(db, 'c', NOW);
    const sharedOf = (id: string) =>
      players
        .find((one) => one.id === id)
        ?.rows.filter((row) => row.source === 'shared')
        .map((row) => row.repertoire.id);
    expect(sharedOf('p')).toEqual([pShare]);
    expect(sharedOf('q')).toEqual([shared]);
  });

  it('never shows another coach’s assignment of the player', async () => {
    await seedLink(db, 'other', 'p');
    const theirs = await seedRepertoire(db, 'other', NOW);
    await seedAssignment(db, {
      coachId: 'other',
      repertoireId: theirs,
      target: { playerId: 'p' },
      now: NOW,
    });
    expect(await rowIdsOf('p')).toEqual([karoKan]);
  });

  it('shows a forked assignment forked, with no standing (R-155)', async () => {
    await learnAll('p', karoKan);
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW),
    );
    const [p] = await coachDashboard(db, 'c', NOW);
    expect(p?.rows).toHaveLength(1);
    expect(p?.rows[0]?.view).toEqual({ kind: 'forked', sharedForkId: null });
    expect(p?.rows[0]?.status?.forked).toBe(true);
    expect(p).toEqual(await playerPageOf('p'));
  });

  it('gives a player with nothing the coach may see no rows', async () => {
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    const players = await coachDashboard(db, 'c', NOW);
    expect(players.find((one) => one.id === 'r')?.rows).toEqual([]);
  });

  it('is empty for a coach without players', async () => {
    expect(await coachDashboard(db, 'stranger', NOW)).toEqual([]);
  });

  it('reads in one transaction', async () => {
    const statements = await statementsOf(() => coachDashboard(db, 'c', NOW));
    expect(statements.filter((s) => /^begin/i.test(s))).toHaveLength(1);
  });
});

describe('coachDashboard statements', () => {
  /** `coachId`'s repertoire assigned to each of `playerIds` individually. */
  async function assignEach(
    coachId: string,
    repertoireId: string,
    playerIds: readonly string[],
  ): Promise<void> {
    for (const playerId of playerIds)
      await seedAssignment(db, {
        coachId,
        repertoireId,
        target: { playerId },
        now: NOW,
      });
  }

  it('reads as many statements for five players on one repertoire as for one', async () => {
    await seedCoach(db, 'solo', 'solo@example.lt');
    await seedCoach(db, 'many', 'many@example.lt');
    await seedLinks(db, 'solo', 1);
    await seedLinks(db, 'many', 5);
    const soloRep = await seedRepertoire(db, 'solo', NOW);
    const manyRep = await seedRepertoire(db, 'many', NOW);
    await assignEach('solo', soloRep, ['solo-p-1']);
    const many = ['1', '2', '3', '4', '5'].map((n) => `many-p-${n}`);
    await assignEach('many', manyRep, many);
    for (const playerId of [...many, 'solo-p-1'])
      await result(playerId, playerId === 'solo-p-1' ? soloRep : manyRep, NOW);
    const one = await countStatements(() => coachDashboard(db, 'solo', NOW));
    const five = await countStatements(() => coachDashboard(db, 'many', NOW));
    expect(five).toBe(one);
    expect(
      (await coachDashboard(db, 'many', NOW)).map((p) => p.rows.length),
    ).toEqual([1, 1, 1, 1, 1]);
  });

  it('loads another repertoire with 4 statements: its row and 3 of its graph', async () => {
    const before = await countStatements(() => coachDashboard(db, 'c', NOW));
    const second = await seedRepertoire(db, 'c', NOW);
    await assignEach('c', second, ['p', 'q']);
    const after = await countStatements(() => coachDashboard(db, 'c', NOW));
    expect(after - before).toBe(4);
  });
});
