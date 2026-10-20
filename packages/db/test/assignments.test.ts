import { moveKey } from '@mychess/chess';
import { forkOfferExpiry } from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepertoire, loadRepertoire } from '../src';
import {
  assignmentPlayers,
  assignments,
  forkOffers,
} from '../src/assignment-schema';
import { changeAssignments } from '../src/assignments/change';
import {
  effectiveAssignments,
  liveRepertoireIds,
} from '../src/assignments/effective';
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
import { graphOf } from './support/repertoires';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
const LATER = new Date('2026-10-21T09:00:00Z');
/** seedMember's T0 (2026-10-16T08:00Z), as a Vilnius day. */
const JOIN_DAY = '2026-10-16';
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
      { playerIds: [playerId], reason: 'leftGroup', now: at },
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
      { playerIds: [playerId], reason: 'leftGroup', now: at },
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

describe('effectiveAssignments', () => {
  it('lists a repertoire assigned individually and through a group once, with both deadlines (R-16, R-134)', async () => {
    await assignTo({ groupId: g }, '2026-10-30', 1);
    await assignTo({ playerId: 'p' }, '2026-11-01', 3);
    expect(await effectiveAssignments(db, 'p')).toEqual([
      {
        repertoireId: rep,
        coachId: 'c',
        sources: {
          individual: { deadline: '2026-11-01' },
          groups: [{ deadline: '2026-10-30', joinedDay: JOIN_DAY }],
        },
        assignedVersion: 1,
        pausedAt: null,
        seenVersion: null,
        forkedAt: null,
      },
    ]);
  });

  it('keeps the lowest assigned version and has no individual source for a group-only assignment', async () => {
    await assignTo({ groupId: g }, null, 4);
    const [only] = await effectiveAssignments(db, 'q');
    expect(only?.sources).toEqual({
      groups: [{ deadline: null, joinedDay: JOIN_DAY }],
    });
    expect(only?.sources).not.toHaveProperty('individual');
    expect(only?.assignedVersion).toBe(4);
  });

  it('carries an individual assignment without a deadline', async () => {
    await assignTo({ playerId: 'n' }, null, 2);
    const [only] = await effectiveAssignments(db, 'n');
    expect(only?.sources).toEqual({
      individual: { deadline: null },
      groups: [],
    });
  });

  it('is empty for a linked player outside the group', async () => {
    await assignTo({ groupId: g });
    expect(await effectiveAssignments(db, 'n')).toEqual([]);
    expect(await liveRepertoireIds(db, 'n')).toEqual(new Set());
  });

  it("carries the player's own state on it", async () => {
    await assignTo({ groupId: g });
    await setState('p', { pausedAt: NOW, seenVersion: 2 });
    await setState('q', { seenVersion: 5 });
    const [p] = await effectiveAssignments(db, 'p');
    expect(p).toMatchObject({ pausedAt: NOW, seenVersion: 2, forkedAt: null });
  });

  it('drops a forked one unless asked for it (R-128)', async () => {
    await assignTo({ groupId: g });
    await setState('p', { forkedAt: NOW });
    expect(await liveRepertoireIds(db, 'p')).toEqual(new Set());
    expect(await effectiveAssignments(db, 'p')).toEqual([]);
    expect(
      await effectiveAssignments(db, 'p', { withForked: true }),
    ).toMatchObject([{ repertoireId: rep, forkedAt: NOW }]);
    expect(await liveRepertoireIds(db, 'q')).toEqual(new Set([rep]));
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

  it('settles a player named twice once', async () => {
    await db.transaction((tx) =>
      changeAssignments(
        tx,
        { playerIds: ['p', 'p'], reason: 'leftGroup', now: NOW },
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
          { playerIds: ['p'], reason: 'deleted', now: NOW },
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
        { playerIds: ['p'], reason: 'unassigned', now: NOW },
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
