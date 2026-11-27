import { playerKeys, standingOf, startReview } from '@mychess/chess';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  coachAssigneeCounts,
  coachRepertoireProgress,
  forkAssignment,
  pauseAssignment,
  repertoireAssignees,
  unlink,
} from '../src';
import { graphRows } from '../src/repertoires/repository';
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
const WEEK_AGO = new Date(NOW.getTime() - 7 * 86_400_000);

let karoKan = ''; // the coach's, assigned to p individually
let group = '';
let groupRep = ''; // the coach's, assigned to the group of p and q

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
  await seedLink(db, 'c', 'p');
  await seedLink(db, 'c', 'q');
  karoKan = await seedRepertoire(db, 'c', NOW);
  groupRep = await seedRepertoire(db, 'c', NOW);
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

/** The one read of `repertoireId`, as coach `coachId`. */
const read = (repertoireId: string, coachId = 'c') =>
  repertoireAssignees(db, { coachId, repertoireId }, NOW);

/**
 * What the progress page's read shows of one player, as a standing and
 * status, or null: the standings must agree with it (Q26, R-155).
 */
async function perPlayer(repertoireId: string, playerId: string) {
  const view = await coachRepertoireProgress(
    db,
    { coachId: 'c', playerId, repertoireId },
    NOW,
  );
  return view === undefined
    ? null
    : { standing: standingOf(view.progress), status: view.status };
}

/** The progress page's read of each of `playerIds`, as the standings map. */
async function perPlayerOf(repertoireId: string, playerIds: readonly string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof perPlayer>>>();
  for (const id of playerIds) out.set(id, await perPlayer(repertoireId, id));
  return out;
}

const NONE = {
  assignments: [],
  standings: new Map(),
  livePlayers: 0,
  assignees: 0,
};

describe('repertoireAssignees: the standings', () => {
  it('gives a reached player with progress the progress page’s standing and status', async () => {
    const own = await learnAll('p', karoKan);
    const { standings } = await read(karoKan);
    expect(standings).toEqual(await perPlayerOf(karoKan, ['p']));
    expect(standings.get('p')).toEqual({
      standing: {
        counts: { notStarted: 0, skipped: 0, due: own, learned: 0 },
        mastered: false,
      },
      // Done once every own move is tracked (R-129).
      status: {
        deadline: null,
        overdue: false,
        paused: false,
        done: true,
        forked: false,
      },
    });
  });

  it('gives each player the status their row in the list carries: one decision', async () => {
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'q', repertoireId: groupRep, paused: true },
        NOW,
      ),
    );
    await learnAll('p', groupRep);
    const { assignments, standings } = await read(groupRep);
    const listed = assignments.flatMap((row) => row.players);
    expect(listed).toHaveLength(2);
    for (const player of listed)
      expect(standings.get(player.playerId)?.status).toEqual(player.status);
    expect(standings).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
  });

  it('says overdue past the deadline and paused while paused', async () => {
    const late = await seedRepertoire(db, 'c', NOW);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: late,
      target: { groupId: group },
      now: NOW,
      deadline: '2026-10-20',
    });
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'q', repertoireId: late, paused: true },
        NOW,
      ),
    );
    const { standings } = await read(late);
    expect(standings).toEqual(await perPlayerOf(late, ['p', 'q']));
    const still = { done: false, forked: false, deadline: '2026-10-20' };
    expect(standings.get('p')?.status).toEqual({
      ...still,
      overdue: true,
      paused: false,
    });
    expect(standings.get('q')?.status).toEqual({
      ...still,
      overdue: true,
      paused: true,
    });
  });

  it('gives every player a group assignment reaches their own standing', async () => {
    const own = await learnAll('q', groupRep);
    const { standings } = await read(groupRep);
    expect(standings).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
    expect(standings.get('p')?.standing.counts).toMatchObject({
      notStarted: own,
      due: 0,
    });
    expect(standings.get('q')?.standing.counts).toMatchObject({
      notStarted: 0,
      due: own,
    });
  });

  it('gives a forked assignment no standing (R-155)', async () => {
    await learnAll('q', groupRep);
    succeeded(
      await forkAssignment(db, { playerId: 'q', repertoireId: groupRep }, NOW),
    );
    const { standings } = await read(groupRep);
    expect(standings).toEqual(await perPlayerOf(groupRep, ['p', 'q']));
    expect(standings.get('q')).toBeNull();
    expect(standings.get('p')).not.toBeNull();
  });

  it('lists and shows nothing of a player once unlinked', async () => {
    await learnAll('p', groupRep);
    succeeded(await unlink(db, 'c', 'p', NOW));
    const { assignments, standings } = await read(groupRep);
    expect(assignments.flatMap((row) => row.players)).toMatchObject([
      { playerId: 'q' },
    ]);
    expect(standings).toEqual(await perPlayerOf(groupRep, ['q']));
    expect(standings.has('p')).toBe(false);
  });
});

describe('repertoireAssignees: the counts', () => {
  it('counts every reached player as an assignee and the live ones apart (R-131, R-225)', async () => {
    await seedPlayer(db, 'n', 'n@example.lt');
    await seedLink(db, 'c', 'n');
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: groupRep,
      target: { playerId: 'p' },
      now: NOW,
    });
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: groupRep,
      target: { playerId: 'n' },
      now: NOW,
    });
    succeeded(
      await forkAssignment(db, { playerId: 'q', repertoireId: groupRep }, NOW),
    );
    const { assignees, livePlayers } = await read(groupRep);
    // p twice (own row and group), q forked, n: three reached, two live.
    expect(assignees).toBe(3);
    expect(livePlayers).toBe(2);
  });

  it('counts a paused player as live: they still have it', async () => {
    succeeded(
      await pauseAssignment(
        db,
        { playerId: 'q', repertoireId: groupRep, paused: true },
        NOW,
      ),
    );
    expect(await read(groupRep)).toMatchObject({
      assignees: 2,
      livePlayers: 2,
    });
  });

  it('counts an empty group’s row as reaching no one', async () => {
    const empty = await seedGroup(db, 'c', 'Tuščia');
    const alone = await seedRepertoire(db, 'c', NOW);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: alone,
      target: { groupId: empty },
      now: NOW,
    });
    const { assignments, ...rest } = await read(alone);
    expect(assignments).toMatchObject([{ players: [] }]);
    expect(rest).toEqual({
      standings: new Map(),
      livePlayers: 0,
      assignees: 0,
    });
  });
});

describe('repertoireAssignees: access', () => {
  it("is empty for another coach's repertoire, even one linked to the player", async () => {
    await seedLink(db, 'other', 'p');
    await learnAll('p', karoKan);
    expect(await read(karoKan, 'other')).toEqual(NONE);
  });

  it('is empty for a player’s own repertoire and for the player as coach', async () => {
    const theirs = await seedRepertoire(db, 'p', NOW);
    expect(await read(theirs)).toEqual(NONE);
    expect(await read(karoKan, 'p')).toEqual(NONE);
  });

  it('reads nothing for a malformed repertoire id', async () => {
    expect(await countStatements(() => read('nope'))).toBe(0);
    expect(await read('nope')).toEqual(NONE);
  });
});

describe('repertoireAssignees: the statement budget', () => {
  it('reads in one transaction', async () => {
    const statements = await statementsOf(() => read(groupRep));
    expect(statements.filter((s) => /^begin/i.test(s))).toHaveLength(1);
  });

  it('sends 18 statements, BEGIN and COMMIT included, for one player or three', async () => {
    // BEGIN; the repertoire (4); its rows; the reach facts (3); the names;
    // the Reviews; the access step (coachProgressFacts 5, the link again 1);
    // COMMIT. The graph is not loaded again for the standings.
    expect(await countStatements(() => read(karoKan))).toBe(18);
    await seedPlayer(db, 'r', 'r@example.lt');
    await seedLink(db, 'c', 'r');
    await seedMember(db, 'c', group, 'r');
    expect(await countStatements(() => read(groupRep))).toBe(18);
  });
});

describe('coachAssigneeCounts', () => {
  it('counts the distinct players each of the coach’s repertoires reaches, forked ones included (R-225)', async () => {
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: groupRep,
      target: { playerId: 'p' },
      now: NOW,
    });
    succeeded(
      await forkAssignment(db, { playerId: 'q', repertoireId: groupRep }, NOW),
    );
    expect(await coachAssigneeCounts(db, 'c')).toEqual(
      new Map([
        [karoKan, 1],
        [groupRep, 2],
      ]),
    );
  });

  it('counts only the players linked now', async () => {
    succeeded(await unlink(db, 'c', 'q', NOW));
    expect((await coachAssigneeCounts(db, 'c')).get(groupRep)).toBe(1);
  });

  it('has no entry for a repertoire whose rows reach no one, nor for another coach', async () => {
    const empty = await seedGroup(db, 'c', 'Tuščia');
    const alone = await seedRepertoire(db, 'c', NOW);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: alone,
      target: { groupId: empty },
      now: NOW,
    });
    expect((await coachAssigneeCounts(db, 'c')).has(alone)).toBe(false);
    expect(await coachAssigneeCounts(db, 'other')).toEqual(new Map());
  });

  it('reads every repertoire in one statement', async () => {
    const more = await seedRepertoire(db, 'c', NOW);
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: more,
      target: { groupId: group },
      now: NOW,
    });
    expect(await countStatements(() => coachAssigneeCounts(db, 'c'))).toBe(1);
  });
});
