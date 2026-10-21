import { moveKey } from '@mychess/chess';
import { forkOfferExpiry } from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  assign,
  assignedPlayerCount,
  coachAssignments,
  createRepertoire,
  loadRepertoire,
  setDeadline,
  unassign,
  unlink,
} from '../src';
import {
  assignmentPlayers,
  assignments,
  forkOffers,
} from '../src/assignment-schema';
import { changeAssignments } from '../src/assignments/change';
import { snapshotSchema } from '../src/assignments/snapshot';
import { groupMembers, personalNotes, repertoires } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { liveRepertoireIds, offersOf } from './support/assignments';
import { graphOf } from './support/repertoires';
import { countStatements } from './support/statements';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
/** R, with a coach comment on 1. d4. */
const PGN = '1. d4 { Treneris: tvirtas centras } d5 2. Bf4 Nf6 *';
const NOTE_KEY = moveKey(
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
  'd4',
);

const query = async (
  text: string,
  params: unknown[] = [],
): Promise<unknown[]> =>
  (await client.query<Record<string, unknown>>(text, params)).rows;

let rep = '';
let g = '';

async function assignTo(
  target: { playerId: string } | { groupId: string },
  deadline: string | null = null,
  assignedVersion = 1,
): Promise<void> {
  await db.insert(assignments).values({
    coachId: 'c',
    repertoireId: rep,
    deadline,
    assignedVersion,
    createdAt: NOW,
    ...target,
  });
}

async function setState(
  playerId: string,
  state: { pausedAt?: Date; seenVersion?: number; forkedAt?: Date },
): Promise<void> {
  await db
    .insert(assignmentPlayers)
    .values({ playerId, repertoireId: rep, ...state });
}

const removeFromGroup = (playerId: string, at: Date = NOW) =>
  db.transaction((tx) =>
    changeAssignments(
      tx,
      { coachId: 'c', playerIds: [playerId], reason: 'leftGroup', now: at },
      () =>
        tx
          .delete(groupMembers)
          .where(
            and(
              eq(groupMembers.groupId, g),
              eq(groupMembers.playerId, playerId),
            ),
          ),
    ),
  );

const addToGroup = (playerId: string, at: Date) =>
  db.transaction((tx) =>
    changeAssignments(
      tx,
      { coachId: 'c', playerIds: [playerId], reason: 'leftGroup', now: at },
      () =>
        tx
          .insert(groupMembers)
          .values({ groupId: g, coachId: 'c', playerId, joinedAt: at }),
    ),
  );

const offers = () =>
  db
    .select({
      playerId: forkOffers.playerId,
      repertoireId: forkOffers.repertoireId,
      closedAt: forkOffers.closedAt,
    })
    .from(forkOffers);

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  for (const id of ['p', 'q', 'n']) {
    await seedPlayer(db, id, `${id}@example.lt`);
    await seedLink(db, 'c', id);
  }
  g = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', g, 'p');
  await seedMember(db, 'c', g, 'q');
  rep = await createRepertoire(db, {
    ownerId: 'c',
    side: 'white',
    name: 'Londono sistema',
    graph: graphOf(PGN),
    now: NOW,
  });
});

describe('changeAssignments', () => {
  beforeEach(async () => {
    await assignTo({ groupId: g });
    await db.insert(personalNotes).values({
      playerAccountId: 'p',
      repertoireId: rep,
      moveKey: NOTE_KEY,
      text: 'Mano pastaba',
      updatedAt: NOW,
    });
  });

  it('offers a 30-day fork with a snapshot to a player who loses the assignment (R-45)', async () => {
    await removeFromGroup('p');
    const loaded = await loadRepertoire(db, rep, 'c');
    const rows = await db.select().from(forkOffers);
    expect(rows).toHaveLength(1);
    const [offer] = rows;
    expect(offer).toMatchObject({
      playerId: 'p',
      repertoireId: rep,
      coachName: 'Name c',
      name: 'Londono sistema',
      side: 'white',
      reason: 'leftGroup',
      createdAt: NOW,
      expiresAt: forkOfferExpiry(NOW),
      acceptedAt: null,
      declinedAt: null,
      closedAt: null,
      forkId: null,
    });
    const snapshot = snapshotSchema.parse(offer?.snapshot);
    expect(snapshot).toEqual({
      graph: loaded?.graph,
      personalNotes: [{ moveKey: NOTE_KEY, text: 'Mano pastaba' }],
    });
    expect(snapshot.graph.moves.find((m) => m.san === 'd4')?.comment).toBe(
      'Treneris: tvirtas centras',
    );
  });

  it("settles only the acting coach's repertoires, whatever another coach changes meanwhile", async () => {
    await seedCoach(db, 'd', 'd@example.lt');
    await seedLink(db, 'd', 'p');
    const theirs = await createRepertoire(db, {
      ownerId: 'd',
      side: 'white',
      name: 'Kito trenerio',
      graph: graphOf(PGN),
      now: NOW,
    });
    await db.insert(assignments).values({
      coachId: 'd',
      repertoireId: theirs,
      playerId: 'p',
      assignedVersion: 1,
      createdAt: NOW,
    });
    // Coach d's unassign lands between c's two reads (as if concurrent).
    await db.transaction((tx) =>
      changeAssignments(
        tx,
        { coachId: 'c', playerIds: ['p'], reason: 'leftGroup', now: NOW },
        async () => {
          await tx
            .delete(groupMembers)
            .where(
              and(eq(groupMembers.groupId, g), eq(groupMembers.playerId, 'p')),
            );
          await tx
            .delete(assignments)
            .where(eq(assignments.repertoireId, theirs));
        },
      ),
    );
    expect(await offers()).toEqual([
      { playerId: 'p', repertoireId: rep, closedAt: null },
    ]);
  });

  it('settles a player named twice once', async () => {
    await db.transaction((tx) =>
      changeAssignments(
        tx,
        { coachId: 'c', playerIds: ['p', 'p'], reason: 'leftGroup', now: NOW },
        () =>
          tx
            .delete(groupMembers)
            .where(
              and(eq(groupMembers.groupId, g), eq(groupMembers.playerId, 'p')),
            ),
      ),
    );
    expect(await offers()).toEqual([
      { playerId: 'p', repertoireId: rep, closedAt: null },
    ]);
  });

  it('refuses to lose a repertoire deleted inside the change: unassign it first', async () => {
    await expect(
      db.transaction((tx) =>
        changeAssignments(
          tx,
          { coachId: 'c', playerIds: ['p'], reason: 'deleted', now: NOW },
          () => tx.delete(repertoires).where(eq(repertoires.id, rep)),
        ),
      ),
    ).rejects.toThrow(/the repertoire is gone/);
    expect(await offers()).toEqual([]);
  });

  it('returns what the change returns', async () => {
    const result = await db.transaction((tx) =>
      changeAssignments(
        tx,
        { coachId: 'c', playerIds: ['p'], reason: 'unassigned', now: NOW },
        () => Promise.resolve(42),
      ),
    );
    expect(result).toBe(42);
    expect(await offers()).toEqual([]);
  });

  it('offers nothing to a player who still has it individually (R-16)', async () => {
    await assignTo({ playerId: 'p' });
    await removeFromGroup('p');
    expect(await offers()).toEqual([]);
  });

  it('offers nothing to a player who forked it (R-128)', async () => {
    await setState('p', { forkedAt: NOW });
    await removeFromGroup('p');
    expect(await offers()).toEqual([]);
  });

  it("drops the player's own state once no assignment reaches them, and only theirs", async () => {
    await setState('p', { pausedAt: NOW });
    await setState('q', { pausedAt: NOW });
    await removeFromGroup('p');
    expect(
      await query(
        'select player_id from assignment_players order by player_id',
      ),
    ).toEqual([{ player_id: 'q' }]);
  });

  it("drops a forked player's state too once no assignment reaches them", async () => {
    await setState('p', { forkedAt: NOW });
    await removeFromGroup('p');
    expect(await query('select player_id from assignment_players')).toEqual([]);
  });

  it("keeps the player's own state while an individual assignment still reaches them", async () => {
    await assignTo({ playerId: 'p' });
    await setState('p', { pausedAt: NOW });
    await removeFromGroup('p');
    expect(await query('select player_id from assignment_players')).toEqual([
      { player_id: 'p' },
    ]);
  });

  it('closes the open offer when the player gets the repertoire back (lead decision 4)', async () => {
    await removeFromGroup('p');
    await addToGroup('p', LATER);
    expect(await offers()).toEqual([
      { playerId: 'p', repertoireId: rep, closedAt: LATER },
    ]);
  });

  it('leaves answered and expired offers alone when the player gets it back', async () => {
    await removeFromGroup('p');
    await db.update(forkOffers).set({ declinedAt: NOW });
    await removeFromGroup('q', new Date('2026-09-01T09:00:00Z'));
    await addToGroup('p', LATER);
    await addToGroup('q', LATER);
    expect(
      await query(
        'select player_id, closed_at from fork_offers order by player_id',
      ),
    ).toEqual([
      { player_id: 'p', closed_at: null },
      { player_id: 'q', closed_at: null },
    ]);
  });

  it('closes an offer up to the moment it expires, not at it (forkOfferState)', async () => {
    await removeFromGroup('p');
    await removeFromGroup('q');
    const expiry = forkOfferExpiry(NOW);
    const justBefore = new Date(expiry.getTime() - 1);
    await addToGroup('p', expiry);
    await addToGroup('q', justBefore);
    expect(
      await query(
        'select player_id, closed_at from fork_offers order by player_id',
      ),
    ).toEqual([
      { player_id: 'p', closed_at: null },
      { player_id: 'q', closed_at: justBefore },
    ]);
  });

  it("closes only the player's offer for that repertoire", async () => {
    await removeFromGroup('p');
    await removeFromGroup('q');
    await addToGroup('p', LATER);
    expect(
      await query(
        'select player_id, closed_at from fork_offers order by player_id',
      ),
    ).toEqual([
      { player_id: 'p', closed_at: LATER },
      { player_id: 'q', closed_at: null },
    ]);
  });
});
const OK = { ok: true, value: undefined };
const refused = (reason: string) => ({ ok: false, refusal: { reason } });

const toPlayer = (playerId: string) => ({ kind: 'player', playerId }) as const;
const toGroup = (groupId: string) => ({ kind: 'group', groupId }) as const;

const assignRows = () =>
  query(
    `select coach_id, repertoire_id, player_id, group_id, deadline::text, assigned_version, created_at
     from assignments order by player_id nulls first`,
  );

async function assignmentId(
  target: { playerId: string } | { groupId: string },
): Promise<string> {
  const [row] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      'playerId' in target
        ? eq(assignments.playerId, target.playerId)
        : eq(assignments.groupId, target.groupId),
    );
  if (row === undefined) throw new Error('no such assignment');
  return row.id;
}

describe('assign', () => {
  it("assigns the coach's repertoire to a linked player at its current version", async () => {
    await db.update(repertoires).set({ version: 3 });
    expect(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: toPlayer('p'),
          deadline: '2026-11-30',
        },
        NOW,
      ),
    ).toEqual(OK);
    expect(await assignRows()).toEqual([
      {
        coach_id: 'c',
        repertoire_id: rep,
        player_id: 'p',
        group_id: null,
        deadline: '2026-11-30',
        assigned_version: 3,
        created_at: NOW,
      },
    ]);
  });

  it("assigns it to the coach's own group, without a deadline", async () => {
    expect(
      await assign(
        db,
        { coachId: 'c', repertoireId: rep, target: toGroup(g), deadline: null },
        NOW,
      ),
    ).toEqual(OK);
    expect(await assignRows()).toEqual([
      expect.objectContaining({ player_id: null, group_id: g, deadline: null }),
    ]);
    expect(await liveRepertoireIds(db, 'q')).toEqual(new Set([rep]));
  });

  it.each([
    ['with Coach mode off', 'notCoach'],
    ["another coach's repertoire", 'foreignRepertoire'],
    ['a missing repertoire', 'missing'],
    ['a malformed repertoire id', 'malformed'],
    ['an unlinked player', 'unlinked'],
    ["another coach's group", 'foreignGroup'],
    ['a malformed group id', 'malformedGroup'],
    ['the same target twice', 'twice'],
  ] as const)('refuses %s and writes nothing', async (_, kase) => {
    await seedCoach(db, 'd', 'd@example.lt');
    await seedLink(db, 'd', 'p');
    const foreignRep = await createRepertoire(db, {
      ownerId: 'd',
      side: 'white',
      name: 'Kito',
      graph: graphOf(PGN),
      now: NOW,
    });
    const foreignGroup = await seedGroup(db, 'd', 'Kita');
    await seedPlayer(db, 'x', 'x@example.lt');
    await assignTo({ playerId: 'p' });
    const cases = {
      notCoach: [rep, toPlayer('q'), 'assignment.notCoach'],
      foreignRepertoire: [foreignRep, toPlayer('q'), 'assignment.notFound'],
      missing: [
        '00000000-0000-4000-8000-000000000000',
        toPlayer('q'),
        'assignment.notFound',
      ],
      malformed: ['not-a-uuid', toPlayer('q'), 'assignment.notFound'],
      unlinked: [rep, toPlayer('x'), 'assignment.notLinked'],
      foreignGroup: [rep, toGroup(foreignGroup), 'assignment.groupNotFound'],
      malformedGroup: [rep, toGroup('not-a-uuid'), 'assignment.groupNotFound'],
      twice: [rep, toPlayer('p'), 'assignment.alreadyAssigned'],
    } as const;
    const [repertoireId, target, reason] = cases[kase];
    if (kase === 'notCoach')
      await query(`update accounts set coach_since = null where id = 'c'`);
    const before = await assignRows();
    expect(
      await assign(
        db,
        { coachId: 'c', repertoireId, target, deadline: null },
        NOW,
      ),
    ).toEqual(refused(reason));
    expect(await assignRows()).toEqual(before);
  });

  it('refuses assigning to oneself', async () => {
    expect(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: toPlayer('c'),
          deadline: null,
        },
        NOW,
      ),
    ).toEqual(refused('assignment.notLinked'));
    expect(await assignRows()).toEqual([]);
  });

  it("closes the player's open fork offer for it (C-M1-6)", async () => {
    await assignTo({ groupId: g });
    await removeFromGroup('p');
    expect(
      await assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: toPlayer('p'),
          deadline: null,
        },
        LATER,
      ),
    ).toEqual(OK);
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'p',
        repertoireId: rep,
        reason: 'leftGroup',
        closedAt: LATER,
      },
    ]);
  });

  it('gives a forked repertoire back live to every player the new row reaches (plan decision 8)', async () => {
    await assignTo({ playerId: 'p' });
    await setState('p', { forkedAt: NOW, pausedAt: NOW });
    expect(
      await assign(
        db,
        { coachId: 'c', repertoireId: rep, target: toGroup(g), deadline: null },
        LATER,
      ),
    ).toEqual(OK);
    expect(await liveRepertoireIds(db, 'p')).toEqual(new Set([rep]));
    expect(
      await query(
        'select player_id, forked_at, paused_at from assignment_players',
      ),
    ).toEqual([{ player_id: 'p', forked_at: null, paused_at: NOW }]);
    expect(await offersOf(db)).toEqual([]);
  });

  it('reaches a player who joins the group later (R-16)', async () => {
    await assign(
      db,
      { coachId: 'c', repertoireId: rep, target: toGroup(g), deadline: null },
      NOW,
    );
    expect(
      await addMember(db, { coachId: 'c', groupId: g, playerId: 'n' }, LATER),
    ).toEqual(OK);
    expect(await liveRepertoireIds(db, 'n')).toEqual(new Set([rep]));
  });
});

describe('unassign', () => {
  it('ends the assignment and offers a fork to each player who lost it (R-130)', async () => {
    await assignTo({ groupId: g });
    await assignTo({ playerId: 'p' });
    const id = await assignmentId({ groupId: g });
    expect(
      await unassign(db, { coachId: 'c', assignmentId: id }, LATER),
    ).toEqual(OK);
    expect(await assignRows()).toEqual([
      expect.objectContaining({ player_id: 'p' }),
    ]);
    // p still has it individually (R-16).
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'q',
        repertoireId: rep,
        reason: 'unassigned',
        closedAt: null,
      },
    ]);
  });

  it('ends an individual assignment', async () => {
    await assignTo({ playerId: 'n' });
    const id = await assignmentId({ playerId: 'n' });
    expect(
      await unassign(db, { coachId: 'c', assignmentId: id }, LATER),
    ).toEqual(OK);
    expect(await assignRows()).toEqual([]);
    expect(await offersOf(db)).toEqual([
      {
        playerId: 'n',
        repertoireId: rep,
        reason: 'unassigned',
        closedAt: null,
      },
    ]);
  });

  it.each([
    ["another coach's assignment", 'foreign'],
    ['a malformed id', 'malformed'],
  ] as const)('refuses %s and changes nothing', async (_, kase) => {
    await seedCoach(db, 'd', 'd@example.lt');
    await assignTo({ groupId: g });
    const id = await assignmentId({ groupId: g });
    const ref =
      kase === 'foreign'
        ? { coachId: 'd', assignmentId: id }
        : { coachId: 'c', assignmentId: 'not-a-uuid' };
    expect(await unassign(db, ref, LATER)).toEqual(
      refused('assignment.notFound'),
    );
    expect(await assignRows()).toHaveLength(1);
    expect(await offersOf(db)).toEqual([]);
  });

  it.each([
    ['with Coach mode off', 'c'],
    ['an unknown coach', 'nobody'],
  ] as const)(
    'refuses %s as not a coach and changes nothing (R-113)',
    async (_, coachId) => {
      await assignTo({ groupId: g });
      const id = await assignmentId({ groupId: g });
      await query(`update accounts set coach_since = null where id = 'c'`);
      expect(await unassign(db, { coachId, assignmentId: id }, LATER)).toEqual(
        refused('assignment.notCoach'),
      );
      expect(await assignRows()).toHaveLength(1);
      expect(await offersOf(db)).toEqual([]);
    },
  );

  it('refuses a malformed id with Coach mode off as not a coach', async () => {
    await query(`update accounts set coach_since = null where id = 'c'`);
    expect(
      await unassign(db, { coachId: 'c', assignmentId: 'not-a-uuid' }, LATER),
    ).toEqual(refused('assignment.notCoach'));
  });
});

describe('setDeadline', () => {
  it("extends or clears the coach's own assignment's deadline only (R-51)", async () => {
    await seedCoach(db, 'd', 'd@example.lt');
    await assignTo({ groupId: g }, '2026-11-01');
    const id = await assignmentId({ groupId: g });
    const deadline = async () =>
      (await query('select deadline::text from assignments'))[0];
    expect(
      await setDeadline(db, {
        coachId: 'c',
        assignmentId: id,
        deadline: '2026-11-30',
      }),
    ).toEqual(OK);
    expect(await deadline()).toEqual({ deadline: '2026-11-30' });
    expect(
      await setDeadline(db, { coachId: 'd', assignmentId: id, deadline: null }),
    ).toEqual(refused('assignment.notFound'));
    expect(
      await setDeadline(db, {
        coachId: 'c',
        assignmentId: 'not-a-uuid',
        deadline: null,
      }),
    ).toEqual(refused('assignment.notFound'));
    expect(await deadline()).toEqual({ deadline: '2026-11-30' });
    expect(
      await setDeadline(db, { coachId: 'c', assignmentId: id, deadline: null }),
    ).toEqual(OK);
    expect(await deadline()).toEqual({ deadline: null });
  });

  it('refuses with Coach mode off and leaves the deadline (R-113)', async () => {
    await assignTo({ playerId: 'p' }, '2026-11-01');
    const id = await assignmentId({ playerId: 'p' });
    await query(`update accounts set coach_since = null where id = 'c'`);
    expect(
      await setDeadline(db, {
        coachId: 'c',
        assignmentId: id,
        deadline: '2026-11-30',
      }),
    ).toEqual(refused('assignment.notCoach'));
    expect(await query('select deadline::text from assignments')).toEqual([
      { deadline: '2026-11-01' },
    ]);
  });

  it('refuses an unknown coach as not a coach', async () => {
    await assignTo({ playerId: 'p' });
    const id = await assignmentId({ playerId: 'p' });
    expect(
      await setDeadline(db, {
        coachId: 'nobody',
        assignmentId: id,
        deadline: null,
      }),
    ).toEqual(refused('assignment.notCoach'));
  });
});

describe('coachAssignments', () => {
  const player = (
    playerId: string,
    state: Partial<{
      deadline: string | null;
      paused: boolean;
      forked: boolean;
      overdue: boolean;
    }> = {},
  ) => ({
    playerId,
    displayName: `Name ${playerId}`,
    deadline: null,
    paused: false,
    forked: false,
    done: false,
    overdue: false,
    ...state,
  });

  it('lists each assignment row with the players it reaches and their own deadline and badges', async () => {
    await assignTo({ groupId: g }, '2026-10-19');
    await assignTo({ playerId: 'p' }, '2026-11-01');
    await assignTo({ playerId: 'n' }, '2026-10-19');
    await setState('p', { pausedAt: NOW });
    await setState('q', { forkedAt: NOW });
    const p = player('p', { deadline: '2026-11-01', paused: true });
    const listed = await coachAssignments(db, 'c', rep, NOW);
    expect(
      listed.toSorted((a, b) => a.target.name.localeCompare(b.target.name)),
    ).toEqual([
      {
        id: await assignmentId({ playerId: 'n' }),
        target: { kind: 'player', id: 'n', name: 'Name n' },
        deadline: '2026-10-19',
        players: [player('n', { deadline: '2026-10-19', overdue: true })],
      },
      {
        id: await assignmentId({ playerId: 'p' }),
        target: { kind: 'player', id: 'p', name: 'Name p' },
        deadline: '2026-11-01',
        players: [p],
      },
      {
        id: await assignmentId({ groupId: g }),
        target: { kind: 'group', id: g, name: 'Šeštadienio grupė' },
        deadline: '2026-10-19',
        players: [p, player('q', { deadline: '2026-10-19', forked: true })],
      },
    ]);
  });

  it("is empty for another coach's repertoire, or one not the coach's", async () => {
    await seedCoach(db, 'd', 'd@example.lt');
    await assignTo({ groupId: g });
    const own = await createRepertoire(db, {
      ownerId: 'd',
      side: 'white',
      name: 'Kita',
      graph: graphOf(PGN),
      now: NOW,
    });
    expect(await coachAssignments(db, 'd', rep, NOW)).toEqual([]);
    expect(await coachAssignments(db, 'c', own, NOW)).toEqual([]);
    expect(await coachAssignments(db, 'c', 'not-a-uuid', NOW)).toEqual([]);
    expect(await coachAssignments(db, 'p', rep, NOW)).toEqual([]);
  });

  it('lists only the players linked now', async () => {
    await assignTo({ groupId: g });
    await assignTo({ playerId: 'p' });
    expect(await unlink(db, 'c', 'p', NOW)).toEqual(OK);
    expect(await coachAssignments(db, 'c', rep, NOW)).toEqual([
      {
        id: await assignmentId({ groupId: g }),
        target: { kind: 'group', id: g, name: 'Šeštadienio grupė' },
        deadline: null,
        players: [player('q')],
      },
    ]);
  });

  it('lists a group with no members with no players', async () => {
    const empty = await seedGroup(db, 'c', 'Tuščia');
    await assignTo({ groupId: empty });
    expect(await coachAssignments(db, 'c', rep, NOW)).toMatchObject([
      { target: { kind: 'group', id: empty, name: 'Tuščia' }, players: [] },
    ]);
  });
});

describe('assignedPlayerCount', () => {
  it('counts the distinct players any row of the repertoire reaches (R-131)', async () => {
    expect(await assignedPlayerCount(db, 'c', rep)).toBe(0);
    await assignTo({ groupId: g });
    await assignTo({ playerId: 'p' });
    expect(await assignedPlayerCount(db, 'c', rep)).toBe(2);
    await assignTo({ playerId: 'n' });
    expect(await assignedPlayerCount(db, 'c', rep)).toBe(3);
  });

  it('leaves out a player who forked it: they get no offer when it is deleted', async () => {
    await assignTo({ groupId: g });
    await setState('q', { forkedAt: NOW });
    expect(await assignedPlayerCount(db, 'c', rep)).toBe(1);
  });

  it("is 0 for another coach's or a malformed repertoire id", async () => {
    await seedCoach(db, 'd', 'd@example.lt');
    await assignTo({ groupId: g });
    expect(await assignedPlayerCount(db, 'd', rep)).toBe(0);
    expect(await assignedPlayerCount(db, 'c', 'not-a-uuid')).toBe(0);
  });
});

/** A new group of `c` with `size` new linked players `<prefix>1`..; returns both. */
async function groupOf(
  prefix: string,
  size: number,
): Promise<{ groupId: string; members: string[] }> {
  const groupId = await seedGroup(db, 'c', `Grupė ${prefix}`);
  const members = Array.from(
    { length: size },
    (_, i) => prefix + String(i + 1),
  );
  for (const id of members) {
    await seedPlayer(db, id, `${id}@example.lt`);
    await seedLink(db, 'c', id);
    await seedMember(db, 'c', groupId, id);
  }
  return { groupId, members };
}

describe('changeAssignments over a batch', () => {
  /** The members join or leave the group in one change. */
  const moveMembers = (
    groupId: string,
    members: readonly string[],
    join: boolean,
    at: Date,
  ) =>
    db.transaction((tx) =>
      changeAssignments(
        tx,
        { coachId: 'c', playerIds: members, reason: 'leftGroup', now: at },
        () =>
          join
            ? tx.insert(groupMembers).values(
                members.map((playerId) => ({
                  groupId,
                  coachId: 'c',
                  playerId,
                  joinedAt: at,
                })),
              )
            : tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId)),
      ),
    );

  /** An open `unassigned` offer of `rep` to each player. */
  const seedOffers = (players: readonly string[]) =>
    db.insert(forkOffers).values(
      players.map((playerId) => ({
        playerId,
        repertoireId: rep,
        coachName: 'Name c',
        name: 'Londono sistema',
        side: 'white' as const,
        snapshot: {},
        reason: 'unassigned' as const,
        createdAt: NOW,
        expiresAt: forkOfferExpiry(NOW),
      })),
    );

  const closedAtOf = async (players: readonly string[]) =>
    (await offersOf(db))
      .filter((offer) => players.includes(offer.playerId))
      .map((offer) => offer.closedAt);

  it('closes the offers of a batch that gains, in as many statements for five players as for one', async () => {
    const one = await groupOf('a', 1);
    const five = await groupOf('b', 5);
    await assignTo({ groupId: one.groupId });
    await assignTo({ groupId: five.groupId });
    await moveMembers(one.groupId, one.members, false, NOW);
    await moveMembers(five.groupId, five.members, false, NOW);
    const forOne = await countStatements(() =>
      moveMembers(one.groupId, one.members, true, LATER),
    );
    const forFive = await countStatements(() =>
      moveMembers(five.groupId, five.members, true, LATER),
    );
    expect(forFive).toBe(forOne);
    expect(await closedAtOf([...one.members, ...five.members])).toEqual(
      Array.from({ length: 6 }, () => LATER),
    );
  });

  it('offers each member their own snapshot, in as many statements for five players as for one (R-130)', async () => {
    const one = await groupOf('a', 1);
    const five = await groupOf('b', 5);
    for (const playerId of [...one.members, ...five.members])
      await db.insert(personalNotes).values({
        playerAccountId: playerId,
        repertoireId: rep,
        moveKey: NOTE_KEY,
        text: `Pastaba ${playerId}`,
        updatedAt: NOW,
      });
    await assignTo({ groupId: one.groupId });
    await assignTo({ groupId: five.groupId });
    const idOne = await assignmentId({ groupId: one.groupId });
    const idFive = await assignmentId({ groupId: five.groupId });
    const forOne = await countStatements(() =>
      unassign(db, { coachId: 'c', assignmentId: idOne }, LATER),
    );
    const forFive = await countStatements(() =>
      unassign(db, { coachId: 'c', assignmentId: idFive }, LATER),
    );
    expect(forFive).toBe(forOne);
    const loaded = await loadRepertoire(db, rep, 'c');
    const rows = await db.select().from(forkOffers);
    expect(
      rows
        .map((offer) => ({
          playerId: offer.playerId,
          reason: offer.reason,
          snapshot: snapshotSchema.parse(offer.snapshot),
        }))
        .toSorted((a, b) => a.playerId.localeCompare(b.playerId)),
    ).toEqual(
      [...one.members, ...five.members].map((playerId) => ({
        playerId,
        reason: 'unassigned',
        snapshot: {
          graph: loaded?.graph,
          personalNotes: [{ moveKey: NOTE_KEY, text: `Pastaba ${playerId}` }],
        },
      })),
    );
  });

  it('gives a forked repertoire back to a whole group, in as many statements for five players as for one (R-128)', async () => {
    const one = await groupOf('a', 1);
    const five = await groupOf('b', 5);
    const everyone = [...one.members, ...five.members];
    for (const playerId of everyone)
      await setState(playerId, { forkedAt: NOW });
    await seedOffers(everyone);
    const assignGroup = (groupId: string) =>
      assign(
        db,
        {
          coachId: 'c',
          repertoireId: rep,
          target: toGroup(groupId),
          deadline: null,
        },
        LATER,
      );
    const forOne = await countStatements(() => assignGroup(one.groupId));
    const forFive = await countStatements(() => assignGroup(five.groupId));
    expect(forFive).toBe(forOne);
    expect(
      await query(
        'select player_id, forked_at from assignment_players order by player_id',
      ),
    ).toEqual(everyone.map((id) => ({ player_id: id, forked_at: null })));
    expect(await closedAtOf(everyone)).toEqual(everyone.map(() => LATER));
  });

  it('writes the offers by player in the order named, then by repertoire id', async () => {
    const other = await createRepertoire(db, {
      ownerId: 'c',
      side: 'white',
      name: 'Kita',
      graph: graphOf(PGN),
      now: NOW,
    });
    await assignTo({ groupId: g });
    await db.insert(assignments).values({
      coachId: 'c',
      repertoireId: other,
      groupId: g,
      assignedVersion: 1,
      createdAt: NOW,
    });
    await moveMembers(g, ['q', 'p'], false, LATER);
    const [low, high] = [rep, other].toSorted();
    expect(
      await query('select player_id, repertoire_id from fork_offers'),
    ).toEqual([
      { player_id: 'q', repertoire_id: low },
      { player_id: 'q', repertoire_id: high },
      { player_id: 'p', repertoire_id: low },
      { player_id: 'p', repertoire_id: high },
    ]);
  });
});

describe('the coach reads over a batch', () => {
  /** A repertoire of `c` assigned to a new group of `size`, its first and third members forked. */
  async function assignedGroup(prefix: string, size: number) {
    const group = await groupOf(prefix, size);
    const repertoireId = await createRepertoire(db, {
      ownerId: 'c',
      side: 'white',
      name: `Repertuaras ${prefix}`,
      graph: graphOf(PGN),
      now: NOW,
    });
    await db.insert(assignments).values({
      coachId: 'c',
      repertoireId,
      groupId: group.groupId,
      deadline: '2026-10-19',
      assignedVersion: 1,
      createdAt: NOW,
    });
    const forked = group.members.filter((_, i) => i % 2 === 0 && i > 0);
    for (const playerId of forked)
      await db
        .insert(assignmentPlayers)
        .values({ playerId, repertoireId, forkedAt: NOW });
    return { ...group, repertoireId, forked };
  }

  it('lists a group row of five players in as many statements as of one', async () => {
    const one = await assignedGroup('a', 1);
    const five = await assignedGroup('b', 5);
    const forOne = await countStatements(() =>
      coachAssignments(db, 'c', one.repertoireId, NOW),
    );
    const forFive = await countStatements(() =>
      coachAssignments(db, 'c', five.repertoireId, NOW),
    );
    expect(forFive).toBe(forOne);
    const listed = await coachAssignments(db, 'c', five.repertoireId, NOW);
    expect(listed).toEqual([
      {
        id: await assignmentId({ groupId: five.groupId }),
        target: { kind: 'group', id: five.groupId, name: 'Grupė b' },
        deadline: '2026-10-19',
        players: five.members.map((playerId) => ({
          playerId,
          displayName: `Name ${playerId}`,
          deadline: '2026-10-19',
          paused: false,
          done: false,
          ...(five.forked.includes(playerId)
            ? { forked: true, overdue: false }
            : { forked: false, overdue: true }),
        })),
      },
    ]);
  });

  it('counts the live players of five in as many statements as of one', async () => {
    const one = await assignedGroup('a', 1);
    const five = await assignedGroup('b', 5);
    let counts: number[] = [];
    const forOne = await countStatements(async () => {
      counts = [await assignedPlayerCount(db, 'c', one.repertoireId)];
    });
    const forFive = await countStatements(async () => {
      counts = [
        ...counts,
        await assignedPlayerCount(db, 'c', five.repertoireId),
      ];
    });
    expect(forFive).toBe(forOne);
    expect(counts).toEqual([1, 5 - five.forked.length]);
    expect(five.forked).toHaveLength(2);
  });
});
