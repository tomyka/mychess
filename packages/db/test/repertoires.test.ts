import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  deleteAccount,
  deleteRepertoire,
  listRepertoires,
  loadRepertoire,
  renameRepertoire,
} from '../src';
import { forkOffers } from '../src/assignment-schema';
import { snapshotSchema } from '../src/assignments/snapshot';
import { useTestDatabase } from '../src/testing';
import { offersOf, seedAssignment } from './support/assignments';
import {
  seedCoach,
  seedGroup,
  seedLink,
  seedMember,
  seedPlayer,
} from './support/coaching';
import { seedAccount } from './support/accounts';
import { canonical, graphOf, LONDON, T0, T1 } from './support/repertoires';

const { db, client } = useTestDatabase();

async function london(owner = 'rokas'): Promise<string> {
  return createRepertoire(db, {
    ownerId: owner,
    side: 'white',
    name: 'Londono sistema',
    graph: graphOf(LONDON),
    now: T0,
  });
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

describe('createRepertoire and loadRepertoire', () => {
  it('stores a graph and loads it back the same, comments, marks and order included', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const loaded = await loadRepertoire(db, id, 'rokas');
    expect(loaded?.repertoire).toMatchObject({
      id,
      ownerId: 'rokas',
      side: 'white',
      name: 'Londono sistema',
      version: 1,
    });
    expect(canonical(loaded?.graph ?? graphOf('1. e4 *'))).toEqual(
      canonical(graphOf(LONDON)),
    );
  });

  it('loads nothing for another account (the query filters by owner)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    expect(await loadRepertoire(db, id, 'rimantas')).toBeUndefined();
  });
});

describe('listRepertoires, renameRepertoire, deleteRepertoire', () => {
  it("lists only the owner's repertoires with chapter and move counts", async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    await london('rimantas');
    expect(await listRepertoires(db, 'rokas')).toEqual([
      {
        id,
        side: 'white',
        name: 'Londono sistema',
        chapters: 2,
        moves: graphOf(LONDON).moves.length,
        updatedAt: T0,
      },
    ]);
  });

  it('renames and deletes only for the owner', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    const notFound = { ok: false, refusal: { reason: 'repertoire.notFound' } };
    expect(
      await renameRepertoire(db, {
        id,
        ownerId: 'rimantas',
        name: 'x',
        now: T1,
      }),
    ).toEqual(notFound);
    expect(await deleteRepertoire(db, id, 'rimantas', T1)).toEqual(notFound);
    expect(
      await renameRepertoire(db, {
        id,
        ownerId: 'rokas',
        name: 'London',
        now: T1,
      }),
    ).toEqual({ ok: true, value: undefined });
    expect((await loadRepertoire(db, id, 'rokas'))?.repertoire).toMatchObject({
      name: 'London',
      version: 1,
    });
    expect(await deleteRepertoire(db, id, 'rokas', T1)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await deleteRepertoire(db, id, 'rokas', T1)).toEqual(notFound);
    expect(await deleteRepertoire(db, 'not-a-uuid', 'rokas', T1)).toEqual(
      notFound,
    );
    expect(
      await client.query('select count(*)::int as n from repertoire_moves'),
    ).toMatchObject({ rows: [{ n: 0 }] });
  });

  it('leaves no repertoire row when the account is deleted (S1 hard delete)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await london();
    await deleteAccount(db, 'rokas');
    const { rows } = await client.query(`select
      (select count(*) from repertoires)::int + (select count(*) from chapters)::int +
      (select count(*) from repertoire_moves)::int + (select count(*) from move_chapters)::int as n`);
    expect(rows).toEqual([{ n: 0 }]);
  });
});

describe('deleteRepertoire of an assigned repertoire (R-131)', () => {
  it('unassigns it from everyone first, each with a fork offer that keeps its snapshot', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    for (const id of ['p', 'q']) {
      await seedPlayer(db, id, `${id}@example.lt`);
      await seedLink(db, 'c', id);
    }
    const groupId = await seedGroup(db, 'c', 'Mano');
    await seedMember(db, 'c', groupId, 'q');
    const id = await london('c');
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: id,
      target: { playerId: 'p' },
      now: T0,
    });
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: id,
      target: { groupId },
      now: T0,
    });
    const graph = must(await loadRepertoire(db, id, 'c')).graph;
    expect(await deleteRepertoire(db, id, 'p', T1)).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.notFound' },
    });
    expect(await offersOf(db)).toEqual([]);
    expect(await deleteRepertoire(db, id, 'c', T1)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await offersOf(db)).toEqual([
      { playerId: 'p', repertoireId: null, reason: 'deleted', closedAt: null },
      { playerId: 'q', repertoireId: null, reason: 'deleted', closedAt: null },
    ]);
    const snapshots = await db
      .select({
        snapshot: forkOffers.snapshot,
        createdAt: forkOffers.createdAt,
      })
      .from(forkOffers);
    for (const { snapshot, createdAt } of snapshots) {
      expect(snapshotSchema.parse(snapshot).graph).toEqual(graph);
      expect(createdAt).toEqual(T1);
    }
    expect(await loadRepertoire(db, id, 'c')).toBeUndefined();
  });

  it('still unassigns and deletes it with Coach mode off', async () => {
    await seedCoach(db, 'c', 'c@example.lt');
    await seedPlayer(db, 'p', 'p@example.lt');
    await seedLink(db, 'c', 'p');
    const id = await london('c');
    await seedAssignment(db, {
      coachId: 'c',
      repertoireId: id,
      target: { playerId: 'p' },
      now: T0,
    });
    await client.query(`update accounts set coach_since = null where id = 'c'`);
    expect(await deleteRepertoire(db, id, 'c', T1)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await offersOf(db)).toEqual([
      { playerId: 'p', repertoireId: null, reason: 'deleted', closedAt: null },
    ]);
    expect(await loadRepertoire(db, id, 'c')).toBeUndefined();
  });
});
