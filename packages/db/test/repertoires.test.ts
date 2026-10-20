import {
  addChapter,
  addMove,
  editComment,
  moveKey,
  removeMove,
  START_KEY,
  type RepertoireGraph,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  deleteAccount,
  deleteRepertoire,
  listRepertoires,
  loadRepertoire,
  renameRepertoire,
  saveRepertoireEdit,
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

/** Rokas's repertoire `id`, as it is stored now. */
async function rokasGraph(id: string): Promise<RepertoireGraph> {
  return must(await loadRepertoire(db, id, 'rokas')).graph;
}

/** Every repertoire row with its transaction id: a row an edit did not write keeps its xmin. */
async function rowVersions(): Promise<Map<string, string>> {
  const { rows } = await client.query<{ row: string; v: string }>(`
    select 'move ' || from_key || '|' || san as row, xmin::text as v from repertoire_moves
    union all select 'chapter ' || chapter_id, xmin::text from chapters
    union all select 'link ' || move_id || ' ' || chapter_id, xmin::text from move_chapters`);
  return new Map(rows.map((r) => [r.row, r.v]));
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

describe('saveRepertoireEdit', () => {
  it('writes only the rows that changed, and bumps the version', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = await rokasGraph(id);
    const d4 = before.moves.find((m) => m.san === 'd4');
    const key = moveKey(must(d4).from, 'd4');
    const edited = editComment(before, key, 'Best');
    if (!edited.ok) throw new Error(edited.refusal.reason);
    const versions = await rowVersions();
    const saved = await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: edited.value,
      now: T1,
    });
    expect(saved).toEqual({ ok: true, value: { version: 2 } });
    const after = await rowVersions();
    const changed = [...after]
      .filter(([row, v]) => versions.get(row) !== v)
      .map(([row]) => row);
    expect(changed).toEqual([`move ${key}`]);
  });

  it('adds and removes moves and links', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = await rokasGraph(id);
    const bf4 = must(
      before.moves.find((m) => m.san === 'Bf4' && m.chapters.includes('c1')),
    );
    let after = removeMove(before, 'c1', bf4.from, 'Bf4');
    if (!after.ok) throw new Error(after.refusal.reason);
    after = addMove(after.value, 'c1', bf4.from, 'c4');
    if (!after.ok) throw new Error(after.refusal.reason);
    await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: after.value,
      now: T1,
    });
    expect(canonical(await rokasGraph(id))).toEqual(canonical(after.value));
  });

  it('saves the first chapter with its first move in one edit (R-111)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const empty: RepertoireGraph = { side: 'white', chapters: [], moves: [] };
    const id = await createRepertoire(db, {
      ownerId: 'rokas',
      side: 'white',
      name: 'Nauja',
      graph: empty,
      now: T0,
    });
    const opened = addChapter(empty, START_KEY);
    const played = addMove(opened.graph, opened.chapterId, START_KEY, 'e4');
    if (!played.ok) throw new Error(played.refusal.reason);
    const saved = await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: played.value,
      now: T1,
    });
    expect(saved).toEqual({ ok: true, value: { version: 2 } });
    expect(await rokasGraph(id)).toEqual(played.value);
  });

  it('diffs against the stored graph, so a wrong graph from the caller cannot corrupt it', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const stored = await rokasGraph(id);
    const kid = stored.moves.find(
      (m) => m.san === 'Nf6' && m.chapters.includes('c2'),
    );
    const after = removeMove(stored, 'c2', must(kid).from, 'Nf6');
    if (!after.ok) throw new Error(after.refusal.reason);
    // A caller still sending a 'before' (here: claiming nothing changed) is ignored.
    const edit = {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      before: after.value,
      after: after.value,
      now: T1,
    };
    const saved = await saveRepertoireEdit(db, edit);
    expect(saved).toEqual({ ok: true, value: { version: 2 } });
    expect(canonical(await rokasGraph(id))).toEqual(canonical(after.value));
  });

  it('refuses a stale version and changes nothing', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await london();
    const before = await rokasGraph(id);
    const edited = editComment(
      before,
      moveKey(before.moves[0]?.from ?? '', 'd4'),
      'x',
    );
    if (!edited.ok) throw new Error('edit');
    await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: edited.value,
      now: T1,
    });
    const again = await saveRepertoireEdit(db, {
      id,
      ownerId: 'rokas',
      expectedVersion: 1,
      after: before,
      now: T1,
    });
    expect(again).toEqual({
      ok: false,
      refusal: { reason: 'repertoire.stale' },
    });
    expect((await loadRepertoire(db, id, 'rokas'))?.repertoire.version).toBe(2);
  });

  it("refuses another account's repertoire as stale and writes nothing", async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const id = await london();
    const before = await rokasGraph(id);
    const saved = await saveRepertoireEdit(db, {
      id,
      ownerId: 'rimantas',
      expectedVersion: 1,
      after: { ...before, moves: [] },
      now: T1,
    });
    expect(saved.ok).toBe(false);
    expect((await loadRepertoire(db, id, 'rokas'))?.graph.moves).toHaveLength(
      before.moves.length,
    );
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
});
