import { playerKeys, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachGroupPage,
  coachHomePlayers,
  coachPlayerProgress,
  coachRepertoireProgress,
  forkAssignment,
  pauseAssignment,
  shareRepertoire,
  removeMember,
  unlink,
  unshareRepertoire,
} from '../src';
import { graphRows } from '../src/repertoires/repository';
import { reviewResults } from '../src/training-schema';
import { useTestDatabase } from '../src/testing';
import { seedAssignment, seedRepertoire } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
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

let karoKan = ''; // the coach's, assigned to p individually
let group = '';
let groupRep = ''; // the coach's, assigned to the group
let shared = ''; // p's own, shared with c
let privateRep = ''; // p's own, not shared

/** A read the test expects to find something. */
function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

/** How many transactions `run` opens. */
async function transactionsOf(run: () => Promise<unknown>): Promise<number> {
  const statements = await statementsOf(run);
  return statements.filter((s) => /^begin/i.test(s)).length;
}

/** A setup step that must not be refused. */
function succeeded(
  done: { ok: true } | { ok: false; refusal: { reason: string } },
): void {
  if (!done.ok) throw new Error(done.refusal.reason);
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
  groupRep = await seedRepertoire(db, 'c', NOW);
  shared = await seedRepertoire(db, 'p', NOW);
  privateRep = await seedRepertoire(db, 'p', NOW);
  group = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', group, 'p');
  await seedMember(db, 'c', group, 'q');
  await seedAssignment(db, {
    coachId: 'c',
    repertoireId: karoKan,
    target: { playerId: 'p' },
    now: NOW,
  });
  await seedAssignment(db, {
    coachId: 'c',
    repertoireId: groupRep,
    target: { groupId: group },
    now: NOW,
  });
  succeeded(
    await shareRepertoire(db, {
      ownerId: 'p',
      repertoireId: shared,
      coachId: 'c',
      now: NOW,
    }),
  );
});

/** `playerId` learned every player move of `repertoireId` a week ago; all due now. */
async function learnAll(
  playerId: string,
  repertoireId: string,
): Promise<number> {
  const keys = playerKeys(await graphRows(db, repertoireId, 'white'));
  for (const key of keys)
    await writeReview(db, playerId, startReview(key, WEEK_AGO), {
      learnedAt: WEEK_AGO,
    });
  return keys.length;
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

describe('coachPlayerProgress', () => {
  it('lists assigned then shared repertoires with their standings, never private ones', async () => {
    const own = await learnAll('p', karoKan);
    const rows = present(await coachPlayerProgress(db, 'c', 'p', NOW)).rows;
    const ids = rows.map((row) => row.repertoire.id);
    expect(ids).toHaveLength(3);
    expect(ids.slice(0, 2).sort()).toEqual([karoKan, groupRep].sort());
    expect(ids.at(-1)).toBe(shared);
    expect(ids).not.toContain(privateRep);
    expect(rows.find((r) => r.repertoire.id === karoKan)).toMatchObject({
      repertoire: { id: karoKan, name: 'Londono sistema', side: 'white' },
      source: 'assigned',
      badges: { overdue: false, paused: false, forked: false, updated: false },
      view: { kind: 'granted', standing: { counts: { due: own } } },
    });
    // The same moves, trained through karoKan, count here too (R-156).
    expect(rows.at(-1)).toMatchObject({
      source: 'shared',
      badges: null,
      view: {
        kind: 'granted',
        standing: { counts: { notStarted: 0, due: own } },
      },
    });
  });

  it('says when the player last trained on a visible repertoire', async () => {
    await result('p', karoKan, new Date(NOW.getTime() - 2 * HOUR_MS));
    await result('p', privateRep, new Date(NOW.getTime() - HOUR_MS));
    expect((await coachPlayerProgress(db, 'c', 'p', NOW))?.lastTrained).toEqual(
      new Date(NOW.getTime() - 2 * HOUR_MS),
    );
    expect((await coachPlayerProgress(db, 'c', 'q', NOW))?.lastTrained).toBe(
      null,
    );
  });

  it('shows a paused assignment with its badge and its states', async () => {
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'p', repertoireId: karoKan, paused: true },
        NOW,
      ),
    );
    const row = (await coachPlayerProgress(db, 'c', 'p', NOW))?.rows.find(
      (r) => r.repertoire.id === karoKan,
    );
    expect(row?.badges?.paused).toBe(true);
    expect(row?.view.kind).toBe('granted');
  });

  it('shows a forked assignment with its badge only (R-155)', async () => {
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW),
    );
    const row = (await coachPlayerProgress(db, 'c', 'p', NOW))?.rows.find(
      (r) => r.repertoire.id === karoKan,
    );
    expect(row?.badges?.forked).toBe(true);
    expect(row?.view).toEqual({ kind: 'forked' });
  });

  it('reads the linked player with the coach’s own groups only', async () => {
    const theirs = await seedGroup(db, 'other', 'Kita grupė');
    await seedLink(db, 'other', 'p');
    await seedMember(db, 'other', theirs, 'p');
    const read = present(await coachPlayerProgress(db, 'c', 'p', NOW));
    const { linkedAt, ...player } = read.player;
    expect(player).toEqual({
      id: 'p',
      displayName: 'Name p',
      groups: [{ id: group, name: 'Šeštadienio grupė' }],
    });
    expect(linkedAt).toBeInstanceOf(Date);
  });

  it('reads the player and their progress in one transaction', async () => {
    expect(
      await transactionsOf(() => coachPlayerProgress(db, 'c', 'p', NOW)),
    ).toBe(1);
  });

  it('is undefined for a player not linked to the coach', async () => {
    expect(await coachPlayerProgress(db, 'c', 'stranger', NOW)).toBeUndefined();
    expect(await coachPlayerProgress(db, 'other', 'p', NOW)).toBeUndefined();
  });

  it('is undefined for the coach’s own id', async () => {
    expect(await coachPlayerProgress(db, 'c', 'c', NOW)).toBeUndefined();
  });
});

describe('coachRepertoireProgress', () => {
  it('drills an assignment down to chapters and lines', async () => {
    const own = await learnAll('p', karoKan);
    const view = await coachRepertoireProgress(
      db,
      { coachId: 'c', playerId: 'p', repertoireId: karoKan },
      NOW,
    );
    expect(view?.player).toEqual({ id: 'p', displayName: 'Name p' });
    expect(view?.repertoire.id).toBe(karoKan);
    expect(view?.graph).toEqual(await graphRows(db, karoKan, 'white'));
    expect(view?.badges?.forked).toBe(false);
    expect(view?.progress.counts.due).toBe(own);
    expect(view?.progress.chapters.length).toBeGreaterThan(0);
    expect(view?.progress.chapters[0]?.lines.length).toBeGreaterThan(0);
  });

  it('shows a shared repertoire without badges', async () => {
    const view = await coachRepertoireProgress(
      db,
      { coachId: 'c', playerId: 'p', repertoireId: shared },
      NOW,
    );
    expect(view?.repertoire.id).toBe(shared);
    expect(view?.badges).toBeNull();
  });

  it('is undefined for a private, forked, another coach’s or malformed one', async () => {
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: privateRep },
        NOW,
      ),
    ).toBeUndefined();
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'other', playerId: 'p', repertoireId: karoKan },
        NOW,
      ),
    ).toBeUndefined();
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: 'nope' },
        NOW,
      ),
    ).toBeUndefined();
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW),
    );
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: karoKan },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('is undefined once the player unshares it', async () => {
    // unshareRepertoire returns nothing; the share is gone once it resolves.
    await unshareRepertoire(db, {
      ownerId: 'p',
      repertoireId: shared,
      coachId: 'c',
    });
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: shared },
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe('coachGroupPage (R-153)', () => {
  it('has one column per group repertoire and one row per member', async () => {
    const own = await learnAll('q', groupRep);
    await result('q', groupRep, WEEK_AGO);
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    expect(grid.columns).toEqual([
      { id: groupRep, name: 'Londono sistema', side: 'white' },
    ]);
    expect(grid.rows).toMatchObject([
      {
        player: { id: 'p', displayName: 'Name p' },
        lastTrained: null,
        cells: [
          {
            view: {
              kind: 'granted',
              standing: { counts: { notStarted: own } },
            },
          },
        ],
      },
      {
        player: { id: 'q', displayName: 'Name q' },
        lastTrained: WEEK_AGO,
        cells: [
          {
            view: {
              kind: 'granted',
              standing: { counts: { notStarted: 0, due: own } },
            },
          },
        ],
      },
    ]);
  });

  it('shows a member’s forked cell with its badge only, Reviews or not (R-155)', async () => {
    const own = await learnAll('q', groupRep);
    succeeded(
      await forkAssignment(db, { playerId: 'q', repertoireId: groupRep }, NOW),
    );
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    expect(grid.rows).toMatchObject([
      {
        player: { id: 'p' },
        cells: [
          {
            badges: { forked: false },
            view: {
              kind: 'granted',
              standing: { counts: { notStarted: own } },
            },
          },
        ],
      },
      {
        player: { id: 'q' },
        cells: [{ badges: { forked: true }, view: { kind: 'forked' } }],
      },
    ]);
  });

  it('gives a member who joins after the group assignments a cell for each (inherited, Q31)', async () => {
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: karoKan,
      target: { groupId: group },
      now: NOW,
    });
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedMember(db, 'c', group, 'r');
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    expect(grid.columns.map((c) => c.id).sort()).toEqual(
      [groupRep, karoKan].sort(),
    );
    const joined = present(grid.rows.find((row) => row.player.id === 'r'));
    const notStarted = await Promise.all(
      grid.columns.map(
        async (c) => playerKeys(await graphRows(db, c.id, 'white')).length,
      ),
    );
    expect(joined.cells).toEqual(
      notStarted.map((n) => ({
        badges: {
          overdue: false,
          paused: false,
          forked: false,
          updated: false,
        },
        view: {
          kind: 'granted',
          standing: {
            counts: { notStarted: n, skipped: 0, due: 0, learned: 0 },
            mastered: false,
          },
        },
      })),
    );
  });

  it('has no row for a player once unlinked', async () => {
    succeeded(await unlink(db, 'c', 'p', NOW));
    const grid = await coachGroupPage(db, 'c', group, NOW);
    expect(grid?.grid.rows.map((r) => r.player.id)).toEqual(['q']);
  });

  it('is undefined for another coach’s group', async () => {
    expect(await coachGroupPage(db, 'other', group, NOW)).toBeUndefined();
  });

  it('reads the group with its members, and to add the coach’s other linked players only', async () => {
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedLink(db, 'other', 'stranger');
    const page = present(await coachGroupPage(db, 'c', group, NOW));
    expect(page.group).toMatchObject({
      id: group,
      name: 'Šeštadienio grupė',
      members: [
        { id: 'p', displayName: 'Name p' },
        { id: 'q', displayName: 'Name q' },
      ],
    });
    expect(page.addable).toEqual([{ id: 'r', displayName: 'Name r' }]);
  });

  it('offers no one to add once every linked player is a member', async () => {
    expect(present(await coachGroupPage(db, 'c', group, NOW)).addable).toEqual(
      [],
    );
  });

  it('reads the group, who to add and the grid in one transaction', async () => {
    expect(
      await transactionsOf(() => coachGroupPage(db, 'c', group, NOW)),
    ).toBe(1);
  });

  it('reads in a number of statements that does not grow with members', async () => {
    const two = await countStatements(() =>
      coachGroupPage(db, 'c', group, NOW),
    );
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedMember(db, 'c', group, 'r');
    const three = await countStatements(() =>
      coachGroupPage(db, 'c', group, NOW),
    );
    expect(three).toBe(two);
  });

  it('reads each column with one repertoire load: its row and 3 graph statements', async () => {
    const one = await countStatements(() =>
      coachGroupPage(db, 'c', group, NOW),
    );
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: karoKan,
      target: { groupId: group },
      now: NOW,
    });
    const two = await countStatements(() =>
      coachGroupPage(db, 'c', group, NOW),
    );
    expect(two - one).toBe(4);
  });
});

describe('access ends with the membership or the link', () => {
  it('drops the group repertoire of a member removed from the group, still linked', async () => {
    succeeded(
      await removeMember(
        db,
        { coachId: 'c', groupId: group, playerId: 'p' },
        NOW,
      ),
    );
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    expect(grid.rows.map((r) => r.player.id)).toEqual(['q']);
    const rows = present(await coachPlayerProgress(db, 'c', 'p', NOW)).rows;
    expect(rows.map((r) => r.repertoire.id)).toEqual([karoKan, shared]);
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: groupRep },
        NOW,
      ),
    ).toBeUndefined();
  });

  it('shows nothing of a player unlinked after visible training', async () => {
    await result('p', karoKan, new Date(NOW.getTime() - HOUR_MS));
    expect(await trainedOf('c')).toContainEqual([
      'p',
      new Date(NOW.getTime() - HOUR_MS),
    ]);
    succeeded(await unlink(db, 'c', 'p', NOW));
    expect((await trainedOf('c')).map(([id]) => id)).toEqual(['q']);
    expect(await coachPlayerProgress(db, 'c', 'p', NOW)).toBeUndefined();
    expect(
      await coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId: karoKan },
        NOW,
      ),
    ).toBeUndefined();
  });
});

/** Each of the coach's players on their home, with when they last trained. */
async function trainedOf(coachId: string): Promise<[string, Date | null][]> {
  return (await coachHomePlayers(db, coachId)).map((player) => [
    player.id,
    player.lastTrained,
  ]);
}

describe('coachHomePlayers', () => {
  it('lists the linked players by name with their groups', async () => {
    const players = await coachHomePlayers(db, 'c');
    expect(
      players.map(({ id, displayName, groups }) => ({
        id,
        displayName,
        groups,
      })),
    ).toEqual([
      {
        id: 'p',
        displayName: 'Name p',
        groups: [{ id: group, name: 'Šeštadienio grupė' }],
      },
      {
        id: 'q',
        displayName: 'Name q',
        groups: [{ id: group, name: 'Šeštadienio grupė' }],
      },
    ]);
    expect(players.every((p) => p.linkedAt instanceof Date)).toBe(true);
  });

  it('says when each last trained, from visible results only (R-154)', async () => {
    expect(await trainedOf('c')).toEqual([
      ['p', null],
      ['q', null],
    ]);
    await result('p', shared, new Date(NOW.getTime() - HOUR_MS));
    await result('q', privateRep, NOW);
    expect(await trainedOf('c')).toEqual([
      ['p', new Date(NOW.getTime() - HOUR_MS)],
      ['q', null],
    ]);
  });

  it('never lists a player not linked to the coach', async () => {
    await seedLink(db, 'other', 'stranger');
    const theirs = await seedRepertoire(db, 'stranger', NOW);
    succeeded(
      await shareRepertoire(db, {
        ownerId: 'stranger',
        repertoireId: theirs,
        coachId: 'other',
        now: NOW,
      }),
    );
    await result('stranger', theirs, NOW);
    expect((await trainedOf('c')).map(([id]) => id)).toEqual(['p', 'q']);
    expect(await trainedOf('other')).toEqual([['stranger', NOW]]);
  });

  it('is empty for a coach without players', async () => {
    expect(await coachHomePlayers(db, 'stranger')).toEqual([]);
  });

  it('reads in one transaction, in a number of statements that does not grow with players', async () => {
    await result('p', shared, NOW);
    expect(await transactionsOf(() => coachHomePlayers(db, 'c'))).toBe(1);
    const two = await countStatements(() => coachHomePlayers(db, 'c'));
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    const three = await countStatements(() => coachHomePlayers(db, 'c'));
    expect(three).toBe(two);
  });
});
