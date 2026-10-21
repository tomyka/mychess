import {
  canUseAssignment,
  deadlineSources,
  type AssignmentFacts,
} from '@mychess/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRepertoire } from '../src';
import { assignmentPlayers, assignments } from '../src/assignment-schema';
import {
  assignmentFacts,
  holdAssignment,
  liveRepertoire,
  playersReached,
  unreachedState,
} from '../src/assignments/reach';
import { loadRepertoireRows } from '../src/repertoires/repository';
import { accounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import {
  openTransaction,
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
  someoneWaitsForALock,
  T0,
} from './support/coaching';
import { graphOf } from './support/repertoires';
import { countStatements } from './support/statements';

const { db, client } = useTestDatabase();

const NOW = new Date('2026-10-20T09:00:00Z');
/** seedMember's T0 (2026-10-16T08:00Z), as a Vilnius day. */
const JOIN_DAY = '2026-10-16';
const PGN = '1. d4 { Treneris: tvirtas centras } d5 2. Bf4 Nf6 *';

let rep = '';
let g = '';

interface RowOptions {
  readonly deadline?: string | null;
  readonly assignedVersion?: number;
  readonly repertoireId?: string;
}

async function assignTo(
  target: { playerId: string } | { groupId: string },
  options: RowOptions = {},
): Promise<string> {
  const { deadline = null, assignedVersion = 1, repertoireId = rep } = options;
  const [row] = await db
    .insert(assignments)
    .values({
      coachId: 'c',
      repertoireId,
      deadline,
      assignedVersion,
      createdAt: NOW,
      ...target,
    })
    .returning({ id: assignments.id });
  if (row === undefined) throw new Error('assignTo: no row');
  return row.id;
}

async function setState(
  playerId: string,
  state: { pausedAt?: Date; seenVersion?: number; forkedAt?: Date },
): Promise<void> {
  await db
    .insert(assignmentPlayers)
    .values({ playerId, repertoireId: rep, ...state });
}

const newRepertoire = (name: string): Promise<string> =>
  createRepertoire(db, {
    ownerId: 'c',
    side: 'white',
    name,
    graph: graphOf(PGN),
    now: NOW,
  });

async function addToGroup(ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await seedPlayer(db, id, `${id}@example.lt`);
    await seedLink(db, 'c', id);
    await seedMember(db, 'c', g, id);
  }
}

/** The pairs of the records, in the order they came. */
const pairsOf = (facts: readonly AssignmentFacts[]) =>
  facts.map((f) => [f.playerId, f.repertoireId]);

/** Whether canUseAssignment lets the player use the record. */
const usable = (facts: AssignmentFacts | undefined): boolean =>
  canUseAssignment(facts).ok;

beforeEach(async () => {
  await seedCoach(db, 'c', 'c@example.lt');
  for (const id of ['p', 'q', 'n']) {
    await seedPlayer(db, id, `${id}@example.lt`);
    await seedLink(db, 'c', id);
  }
  g = await seedGroup(db, 'c', 'Šeštadienio grupė');
  await seedMember(db, 'c', g, 'p');
  await seedMember(db, 'c', g, 'q');
  rep = await newRepertoire('Londono sistema');
});

describe('countStatements (the statement counter)', () => {
  it('sees one statement for a select', async () => {
    expect(await countStatements(() => db.select().from(accounts))).toBe(1);
  });

  it('sees BEGIN and COMMIT around a transaction', async () => {
    expect(
      await countStatements(() =>
        db.transaction((tx) => tx.select().from(accounts)),
      ),
    ).toBe(3);
  });
});

describe('assignmentFacts for one player', () => {
  it('gives one record for a repertoire assigned individually and through a group, with both rows (R-16, R-134)', async () => {
    const viaGroup = await assignTo(
      { groupId: g },
      { deadline: '2026-10-30', assignedVersion: 1 },
    );
    const own = await assignTo(
      { playerId: 'p' },
      { deadline: '2026-11-01', assignedVersion: 3 },
    );
    const facts = await assignmentFacts(db, { playerIds: ['p'] });
    expect(facts).toEqual([
      {
        playerId: 'p',
        repertoireId: rep,
        coachId: 'c',
        reaches: [
          {
            assignmentId: own,
            deadline: '2026-11-01',
            assignedVersion: 3,
            joinedAt: null,
          },
          {
            assignmentId: viaGroup,
            deadline: '2026-10-30',
            assignedVersion: 1,
            joinedAt: T0,
          },
        ],
        pausedAt: null,
        seenVersion: null,
        forkedAt: null,
      },
    ]);
    expect(deadlineSources(facts[0]?.reaches ?? [])).toEqual({
      individual: { deadline: '2026-11-01' },
      groups: [{ deadline: '2026-10-30', joinedDay: JOIN_DAY }],
    });
  });

  it('keeps the assigned version and join time and has no individual source for a group-only assignment (R-136)', async () => {
    await assignTo({ groupId: g }, { assignedVersion: 4 });
    const [only] = await assignmentFacts(db, { playerIds: ['q'] });
    const sources = deadlineSources(only?.reaches ?? []);
    expect(sources).toEqual({
      groups: [{ deadline: null, joinedDay: JOIN_DAY }],
    });
    expect(sources).not.toHaveProperty('individual');
    expect(
      only?.reaches.map(({ assignedVersion, joinedAt }) => ({
        assignedVersion,
        joinedAt,
      })),
    ).toEqual([{ assignedVersion: 4, joinedAt: T0 }]);
  });

  it('carries an individual assignment without a deadline', async () => {
    await assignTo({ playerId: 'n' }, { assignedVersion: 2 });
    const [only] = await assignmentFacts(db, { playerIds: ['n'] });
    expect(deadlineSources(only?.reaches ?? [])).toEqual({
      individual: { deadline: null },
      groups: [],
    });
  });

  it('is empty for a linked player outside the group', async () => {
    await assignTo({ groupId: g });
    expect(await assignmentFacts(db, { playerIds: ['n'] })).toEqual([]);
  });

  it("carries the player's own state on it", async () => {
    await assignTo({ groupId: g });
    await setState('p', { pausedAt: NOW, seenVersion: 2 });
    await setState('q', { seenVersion: 5 });
    const [p] = await assignmentFacts(db, { playerIds: ['p'] });
    expect(p).toMatchObject({ pausedAt: NOW, seenVersion: 2, forkedAt: null });
  });

  it('keeps a forked record, which canUseAssignment refuses (R-128)', async () => {
    await assignTo({ groupId: g });
    await setState('p', { forkedAt: NOW });
    const [p] = await assignmentFacts(db, { playerIds: ['p'] });
    const [q] = await assignmentFacts(db, { playerIds: ['q'] });
    expect(p).toMatchObject({ repertoireId: rep, forkedAt: NOW });
    expect(usable(p)).toBe(false);
    expect(usable(q)).toBe(true);
  });
});

describe('assignmentFacts for a batch', () => {
  beforeEach(async () => {
    await assignTo({ groupId: g });
  });

  it('gives the reached players of a batch, by player', async () => {
    expect(
      pairsOf(await assignmentFacts(db, { playerIds: ['q', 'p', 'n'] })),
    ).toEqual([
      ['p', rep],
      ['q', rep],
    ]);
  });

  it("gives every player a coach's rows reach", async () => {
    expect(pairsOf(await assignmentFacts(db, { coachId: 'c' }))).toEqual([
      ['p', rep],
      ['q', rep],
    ]);
    expect(await assignmentFacts(db, { coachId: 'd' })).toEqual([]);
  });

  it("narrows to one of the coach's repertoires", async () => {
    const other = await newRepertoire('Karo-Kan');
    await assignTo({ playerId: 'n' }, { repertoireId: other });
    expect(
      pairsOf(await assignmentFacts(db, { coachId: 'c', repertoireId: other })),
    ).toEqual([['n', other]]);
    expect(
      pairsOf(
        await assignmentFacts(db, { playerIds: ['p', 'n'], repertoireId: rep }),
      ),
    ).toEqual([['p', rep]]);
  });

  it('orders the records by player, then repertoire, and the rows individual first', async () => {
    const other = await newRepertoire('Karo-Kan');
    await assignTo({ groupId: g }, { repertoireId: other });
    const own = await assignTo({ playerId: 'q' }, { repertoireId: other });
    const facts = await assignmentFacts(db, { playerIds: ['q', 'p'] });
    const [low, high] = [rep, other].sort();
    expect(pairsOf(facts)).toEqual([
      ['p', low],
      ['p', high],
      ['q', low],
      ['q', high],
    ]);
    const qOther = facts.find(
      (f) => f.playerId === 'q' && f.repertoireId === other,
    );
    expect(qOther?.reaches.map((r) => r.assignmentId)[0]).toBe(own);
    expect(qOther?.reaches).toHaveLength(2);
  });

  it('reads nothing for an empty batch', async () => {
    let facts: AssignmentFacts[] = [];
    expect(
      await countStatements(async () => {
        facts = await assignmentFacts(db, { playerIds: [] });
      }),
    ).toBe(0);
    expect(facts).toEqual([]);
  });

  it('reads nothing for a malformed repertoire id', async () => {
    let facts: AssignmentFacts[] = [];
    expect(
      await countStatements(async () => {
        facts = await assignmentFacts(db, {
          coachId: 'c',
          repertoireId: 'not-a-uuid',
        });
      }),
    ).toBe(0);
    expect(facts).toEqual([]);
  });

  it('sends as many statements for five players as for one', async () => {
    await addToGroup(['r', 's', 't']);
    await setState('p', { seenVersion: 1 });
    const one = await countStatements(() =>
      assignmentFacts(db, { playerIds: ['p'] }),
    );
    const five = await countStatements(() =>
      assignmentFacts(db, { playerIds: ['p', 'q', 'r', 's', 't'] }),
    );
    expect(one).toBeGreaterThan(0);
    expect(five).toBe(one);
  });
});

describe('holdAssignment', () => {
  beforeEach(async () => {
    await assignTo({ groupId: g });
  });

  it('gives the record of a player the assignment reaches', async () => {
    const held = await db.transaction((tx) =>
      holdAssignment(tx, { playerId: 'p', repertoireId: rep }),
    );
    expect(held).toEqual((await assignmentFacts(db, { playerIds: ['p'] }))[0]);
    expect(held).toMatchObject({ playerId: 'p', repertoireId: rep });
  });

  it('gives nothing for a player it does not reach', async () => {
    await setState('n', { seenVersion: 1 });
    expect(
      await db.transaction((tx) =>
        holdAssignment(tx, { playerId: 'n', repertoireId: rep }),
      ),
    ).toBeUndefined();
  });

  it('sends no statement for a malformed repertoire id', async () => {
    const result = await db.transaction(async (tx) => {
      let held: AssignmentFacts | undefined;
      const sent = await countStatements(async () => {
        held = await holdAssignment(tx, {
          playerId: 'p',
          repertoireId: 'not-a-uuid',
        });
      });
      return { sent, held };
    });
    expect(result).toEqual({ sent: 0, held: undefined });
  });

  it('holds the membership and the row until the transaction ends, and not the link', async () => {
    const held = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const holding = db.transaction(async (tx) => {
      await holdAssignment(tx, { playerId: 'p', repertoireId: rep });
      held.resolve(undefined);
      await release.promise;
    });
    await held.promise;
    // FOR UPDATE conflicts with KEY SHARE: the link check locked nothing.
    const linkLock = await openTransaction(client, [
      `select 1 from coach_links where coach_id = 'c' and player_id = 'p' for update nowait`,
    ]);
    await linkLock.finish();
    const leaving = client.query(
      `delete from group_members where player_id = 'p'`,
    );
    await someoneWaitsForALock(client);
    release.resolve(undefined);
    await holding;
    await leaving;
    expect(await assignmentFacts(db, { playerIds: ['p'] })).toEqual([]);
  });
});

describe('liveRepertoire (the query-level filter)', () => {
  it('selects a repertoire only for a player it reaches live', async () => {
    await assignTo({ groupId: g });
    await setState('q', { forkedAt: NOW });
    const loads = async (playerId: string) =>
      (await loadRepertoireRows(db, liveRepertoire(db, playerId, rep)))
        ?.repertoire.id;
    expect(await loads('p')).toBe(rep);
    expect(await loads('q')).toBeUndefined();
    expect(await loads('n')).toBeUndefined();
    await assignTo({ playerId: 'n' });
    expect(await loads('n')).toBe(rep);
  });
});

describe('unreachedState (the stale-state condition)', () => {
  it("selects the batch's states no row reaches, forked or not", async () => {
    const other = await newRepertoire('Karo-Kan');
    await assignTo({ groupId: g });
    await assignTo({ playerId: 'n' }, { repertoireId: other });
    await setState('p', { forkedAt: NOW });
    await setState('n', { seenVersion: 1 });
    await setState('q', { seenVersion: 1 });
    await db.insert(assignmentPlayers).values([
      { playerId: 'n', repertoireId: other, forkedAt: NOW },
      { playerId: 'p', repertoireId: other, seenVersion: 1 },
    ]);
    const stale = await db
      .select({
        playerId: assignmentPlayers.playerId,
        repertoireId: assignmentPlayers.repertoireId,
      })
      .from(assignmentPlayers)
      .where(unreachedState(['p', 'n']));
    expect(
      new Set(stale.map((s) => `${s.playerId}/${s.repertoireId}`)),
    ).toEqual(new Set([`n/${rep}`, `p/${other}`]));
    expect(stale).toHaveLength(2);
  });
});

describe('playersReached', () => {
  it("gives a player row's player and a group row's members", async () => {
    const reached = await db.transaction((tx) =>
      playersReached(tx, [
        { playerId: 'n', groupId: null },
        { playerId: null, groupId: g },
      ]),
    );
    expect(new Set(reached)).toEqual(new Set(['n', 'p', 'q']));
    expect(reached).toHaveLength(3);
  });

  it('reads nothing for player rows only', async () => {
    let reached: string[] = [];
    expect(
      await countStatements(async () => {
        reached = await db.transaction((tx) =>
          playersReached(tx, [{ playerId: 'n', groupId: null }]),
        );
      }),
    ).toBe(2);
    expect(reached).toEqual(['n']);
  });
});
