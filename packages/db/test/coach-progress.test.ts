import { playerKeys, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachGroupPage,
  coachPlayerProgress,
  coachRepertoireProgress,
  forkAssignment,
  pauseAssignment,
  shareRepertoire,
  sharedRepertoireSnapshot,
  removeMember,
  unlink,
  unshareRepertoire,
} from '../src';
import { eq } from 'drizzle-orm';
import { assignments } from '../src/assignment-schema';
import { repertoires } from '../src/schema/repertoires';
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
      status: { overdue: false, paused: false, forked: false },
      view: { kind: 'granted', standing: { counts: { due: own } } },
    });
    // The same moves, trained through karoKan, count here too (R-156).
    expect(rows.at(-1)).toMatchObject({
      source: 'shared',
      status: null,
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

  it('shows a paused assignment with its status and its states', async () => {
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
    expect(row?.status?.paused).toBe(true);
    expect(row?.view.kind).toBe('granted');
  });

  it('shows a forked assignment with its status only (R-155)', async () => {
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW),
    );
    const row = (await coachPlayerProgress(db, 'c', 'p', NOW))?.rows.find(
      (r) => r.repertoire.id === karoKan,
    );
    expect(row?.status?.forked).toBe(true);
    expect(row?.view).toEqual({ kind: 'forked', sharedForkId: null });
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

/** Sets the deadline of every assignment of `repertoireId`. */
const setDeadline = (repertoireId: string, deadline: string) =>
  db
    .update(assignments)
    .set({ deadline })
    .where(eq(assignments.repertoireId, repertoireId));

/** The row of `repertoireId` on the player page of `playerId`. */
async function rowOn(playerId: string, repertoireId: string) {
  const rows = present(await coachPlayerProgress(db, 'c', playerId, NOW)).rows;
  return present(rows.find((row) => row.repertoire.id === repertoireId));
}

describe('the assignment status on each progress row (#381)', () => {
  it('gives an assigned row its deadline and status, and a shared row none', async () => {
    await setDeadline(karoKan, '2026-11-02');
    expect((await rowOn('p', karoKan)).status).toEqual({
      deadline: '2026-11-02',
      overdue: false,
      paused: false,
      done: false,
      forked: false,
    });
    expect((await rowOn('p', shared)).status).toBeNull();
  });

  it('says overdue past the deadline and paused while paused', async () => {
    await setDeadline(karoKan, '2026-10-20');
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'p', repertoireId: karoKan, paused: true },
        NOW,
      ),
    );
    expect((await rowOn('p', karoKan)).status).toEqual({
      deadline: '2026-10-20',
      overdue: true,
      paused: true,
      done: false,
      forked: false,
    });
  });

  it('is done once every player move of the assignment has a Review (R-129)', async () => {
    await setDeadline(karoKan, '2026-10-20');
    await learnAll('p', karoKan);
    expect((await rowOn('p', karoKan)).status).toEqual({
      deadline: '2026-10-20',
      overdue: false,
      paused: false,
      done: true,
      forked: false,
    });
  });

  it('says forked for a forked assignment, whose view stays forked (R-155)', async () => {
    await setDeadline(karoKan, '2026-10-20');
    succeeded(
      await forkAssignment(db, { playerId: 'p', repertoireId: karoKan }, NOW),
    );
    const row = await rowOn('p', karoKan);
    expect(row.status).toEqual({
      deadline: '2026-10-20',
      overdue: false,
      paused: false,
      done: false,
      forked: true,
    });
    expect(row.view).toEqual({ kind: 'forked', sharedForkId: null });
  });

  it('gives each group grid cell the status of the member’s player-page row', async () => {
    await setDeadline(groupRep, '2026-10-20');
    await learnAll('q', groupRep);
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    const statuses = grid.rows.map((row) => row.cells[0]?.status);
    expect(statuses).toEqual([
      (await rowOn('p', groupRep)).status,
      (await rowOn('q', groupRep)).status,
    ]);
    expect(statuses.map((one) => [one?.overdue, one?.done])).toEqual([
      [true, false],
      [false, true],
    ]);
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
    expect(view?.status?.forked).toBe(false);
    expect(view?.progress.counts.due).toBe(own);
    expect(view?.progress.chapters.length).toBeGreaterThan(0);
    expect(view?.progress.chapters[0]?.lines.length).toBeGreaterThan(0);
  });

  it('shows a shared repertoire without a status', async () => {
    const view = await coachRepertoireProgress(
      db,
      { coachId: 'c', playerId: 'p', repertoireId: shared },
      NOW,
    );
    expect(view?.repertoire.id).toBe(shared);
    expect(view?.status).toBeNull();
  });

  it('gives an assignment its source and status, and a shared one none (#381)', async () => {
    await setDeadline(karoKan, '2026-11-02');
    const progressOf = (repertoireId: string) =>
      coachRepertoireProgress(
        db,
        { coachId: 'c', playerId: 'p', repertoireId },
        NOW,
      );
    expect(present(await progressOf(karoKan))).toMatchObject({
      source: 'assigned',
      forkOf: null,
      status: {
        deadline: '2026-11-02',
        overdue: false,
        paused: false,
        done: false,
        forked: false,
      },
    });
    expect(present(await progressOf(shared))).toMatchObject({
      source: 'shared',
      forkOf: null,
      status: null,
    });
  });

  /** p's fork of the coach's karoKan, shared with `coaches`. */
  async function sharedForkWith(...coaches: string[]): Promise<string> {
    const forked = await forkAssignment(
      db,
      { playerId: 'p', repertoireId: karoKan },
      NOW,
    );
    if (!forked.ok) throw new Error(forked.refusal.reason);
    const { forkId } = forked.value;
    for (const coachId of coaches)
      succeeded(
        await shareRepertoire(db, {
          ownerId: 'p',
          repertoireId: forkId,
          coachId,
          now: NOW,
        }),
      );
    return forkId;
  }

  const forkProgress = (coachId: string, repertoireId: string) =>
    coachRepertoireProgress(db, { coachId, playerId: 'p', repertoireId }, NOW);

  it('names the coach’s repertoire a shared one is the player’s fork of (R-155, #328)', async () => {
    const forkId = await sharedForkWith('c');
    expect(present(await forkProgress('c', forkId))).toMatchObject({
      repertoire: { id: forkId, name: 'Londono sistema' },
      source: 'shared',
      forkOf: karoKan,
      status: null,
    });
  });

  it('names no fork to another coach, whose repertoire it is not a fork of (R-39, R-43)', async () => {
    await seedLink(db, 'other', 'p');
    const forkId = await sharedForkWith('c', 'other');
    expect(present(await forkProgress('other', forkId))).toMatchObject({
      source: 'shared',
      forkOf: null,
    });
  });

  it('says in the shared-repertoire snapshot whose own copy a shared fork is, to this coach only (R-155)', async () => {
    await seedLink(db, 'other', 'p');
    const forkId = await sharedForkWith('c', 'other');
    const snapshot = (coachId: string, repertoireId: string) =>
      sharedRepertoireSnapshot(db, coachId, 'p', repertoireId);
    expect((await snapshot('c', forkId)).forkOf).toBe(karoKan);
    // Not a fork of the other coach's repertoire, and a plain share is none.
    expect((await snapshot('other', forkId)).forkOf).toBeNull();
    expect((await snapshot('c', shared)).forkOf).toBeNull();
    // Nothing shared, nothing named.
    expect((await snapshot('c', privateRep)).forkOf).toBeNull();
  });

  it('shows nothing of a fork shared with another coach only', async () => {
    await seedLink(db, 'other', 'p');
    const forkId = await sharedForkWith('other');
    expect(await forkProgress('c', forkId)).toBeUndefined();
    expect(present(await forkProgress('other', forkId)).forkOf).toBeNull();
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
      {
        id: groupRep,
        name: 'Londono sistema',
        side: 'white',
        deadline: null,
        // q learned every move: done; p has not started.
        done: 1,
        count: 2,
      },
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

  it('shows a member’s forked cell as forked only, Reviews or not, and leaves it out of the column’s holders (R-155)', async () => {
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
            view: {
              kind: 'granted',
              standing: { counts: { notStarted: own } },
            },
          },
        ],
      },
      {
        player: { id: 'q' },
        cells: [{ view: { kind: 'forked', sharedForkId: null } }],
      },
    ]);
    expect(grid.columns).toMatchObject([{ done: 0, count: 1 }]);
  });

  it('gives each column its deadline and how many of its live holders are done', async () => {
    await setDeadline(groupRep, '2026-10-20');
    await learnAll('q', groupRep);
    const grid = present(await coachGroupPage(db, 'c', group, NOW)).grid;
    expect(grid.columns).toMatchObject([
      { id: groupRep, deadline: '2026-10-20', done: 1, count: 2 },
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
        status: {
          deadline: null,
          overdue: false,
          paused: false,
          done: false,
          forked: false,
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

  it('gives the coach’s assignments to this group alone, with their deadlines (R-232)', async () => {
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: karoKan,
      target: { groupId: group },
      now: NOW,
      deadline: '2026-11-30',
    });
    const otherGroup = await seedGroup(db, 'c', 'Kita grupė');
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: karoKan,
      target: { groupId: otherGroup },
      now: NOW,
    });
    // Distinct names, so the order by name is the order asserted.
    await db
      .update(repertoires)
      .set({ name: 'Karo-Kan gynyba' })
      .where(eq(repertoires.id, karoKan));
    await db
      .update(repertoires)
      .set({ name: 'Slavų gynyba' })
      .where(eq(repertoires.id, groupRep));
    expect(
      present(await coachGroupPage(db, 'c', group, NOW)).assignments,
    ).toEqual([
      {
        repertoireId: karoKan,
        repertoireName: 'Karo-Kan gynyba',
        deadline: '2026-11-30',
      },
      {
        repertoireId: groupRep,
        repertoireName: 'Slavų gynyba',
        deadline: null,
      },
    ]);
    expect(
      present(await coachGroupPage(db, 'c', otherGroup, NOW)).assignments,
    ).toEqual([
      {
        repertoireId: karoKan,
        repertoireName: 'Karo-Kan gynyba',
        deadline: null,
      },
    ]);
  });

  it('gives a group with nothing assigned no assignments', async () => {
    const empty = await seedGroup(db, 'c', 'Tuščia grupė');
    expect(
      present(await coachGroupPage(db, 'c', empty, NOW)).assignments,
    ).toEqual([]);
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
    expect((await coachPlayerProgress(db, 'c', 'p', NOW))?.lastTrained).toEqual(
      new Date(NOW.getTime() - HOUR_MS),
    );
    succeeded(await unlink(db, 'c', 'p', NOW));
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
