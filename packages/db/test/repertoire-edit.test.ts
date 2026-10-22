import { randomUUID } from 'node:crypto';
import {
  applyEdit,
  emptyGraph,
  importPgn,
  moveKey,
  nothingChanged,
  playerMoveChanges,
  START_KEY,
  type EditOp,
  type ImportedRepertoire,
  type RepertoireChange,
  type RepertoireGraph,
  type Side,
} from '@mychess/chess';
import { describe, expect, it } from 'vitest';
import {
  createRepertoire,
  editRepertoire,
  loadRepertoire,
  shareRepertoire,
} from '../src';
import { accounts } from '../src/schema';
import { useTestDatabase } from '../src/testing';
import { seedAccount } from './support/accounts';
import { seedAssignment } from './support/assignments';
import {
  openTransaction,
  seedCoach,
  seedLink,
  seedPlayer,
  someoneWaitsForALock,
} from './support/coaching';
import { canonical, graphOf, LONDON, T0, T1 } from './support/repertoires';
import { statementsOf } from './support/statements';

const { db, client } = useTestDatabase();

const D4 = moveKey(START_KEY, 'd4');
const BLACK_SICILIAN = '1. e4 c5 2. Nf3 d6 *';
/** Two Black games the Sicilian does not have: chapters c2 and c3 when merged. */
const BLACK_NEW_GAMES = '1. d4 Nf6 2. c4 e6 *\n\n1. c4 e5 2. Nc3 Nf6 *';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
}

/** The repertoire `text` imports to, stored for `owner` at T0; returns its id. */
async function stored(
  text: string,
  side: Side = 'white',
  owner = 'rokas',
): Promise<string> {
  return createRepertoire(db, {
    ownerId: owner,
    side,
    name: 'Repertuaras',
    graph: graphOf(text, side),
    now: T0,
  });
}

/** Rokas, and his London stored at version 1. */
async function rokasLondon(): Promise<string> {
  await seedAccount(db, 'rokas', 'rokas@example.lt');
  return stored(LONDON);
}

function imported(text: string, side: Side): ImportedRepertoire {
  const r = importPgn(text, side);
  if (!r.ok) throw new Error(r.refusal.reason);
  return r.value;
}

const builder = (op: EditOp) => ({ kind: 'edit', op }) as const;
const importOf = (text: string, side: Side) =>
  ({ kind: 'import', imported: imported(text, side) }) as const;
const comment = (text: string) =>
  builder({ kind: 'editComment', moveKey: D4, comment: text });

/** `viewer` saves `change` to repertoire `id`, computed from `version`, at T1. */
const edit = <C extends RepertoireChange>(
  id: string,
  viewer: string,
  version: number,
  change: C,
) =>
  editRepertoire(db, {
    id,
    viewer: { id: viewer },
    expectedVersion: version,
    change,
    now: T1,
  });

async function ownerGraph(
  id: string,
  owner = 'rokas',
): Promise<RepertoireGraph> {
  return must(await loadRepertoire(db, id, owner)).graph;
}

/** Every repertoire row with its transaction id: a row an edit did not write keeps its xmin. */
async function rowVersions(): Promise<Map<string, string>> {
  const { rows } = await client.query<{ row: string; v: string }>(`
    select 'move ' || from_key || '|' || san as row, xmin::text as v from repertoire_moves
    union all select 'chapter ' || chapter_id, xmin::text from chapters
    union all select 'link ' || move_id || ' ' || chapter_id, xmin::text from move_chapters`);
  return new Map(rows.map((r) => [r.row, r.v]));
}

/** Every repertoire_changes row, in version order. */
async function changeRows(): Promise<unknown[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    'select repertoire_id, version, changes, created_at from repertoire_changes order by version',
  );
  return rows;
}

/** What a refusal must leave as it was: the version, the graph and the change rows. */
async function state(id: string, owner = 'rokas'): Promise<unknown> {
  const { rows } = await client.query<{ version: number }>(
    'select version from repertoires where id = $1',
    [id],
  );
  return {
    version: rows[0]?.version,
    graph: canonical(await ownerGraph(id, owner)),
    changes: await changeRows(),
  };
}

const refused = (reason: string) => ({ ok: false, refusal: { reason } });

describe('statementsOf', () => {
  it('sees the begin, the statement and the commit of a transaction', async () => {
    const texts = await statementsOf(() =>
      db.transaction((tx) => tx.select().from(accounts)),
    );
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/^begin/i);
    expect(texts[1]).toMatch(/from "accounts"/);
    expect(texts[2]).toMatch(/^commit/i);
  });
});

describe('editRepertoire saves an edit (#276)', () => {
  it('writes only the row a comment edit changed, bumps the version and returns the saved graph', async () => {
    const id = await rokasLondon();
    const versions = await rowVersions();
    const saved = await edit(id, 'rokas', 1, comment('Best'));
    const stored = await ownerGraph(id);
    const { graph, ...rest } = unwrap(saved);
    expect(rest).toEqual({
      version: 2,
      changes: { added: [], removed: [], commentsChanged: 1 },
      firstChapterId: null,
    });
    expect(canonical(graph)).toEqual(canonical(stored));
    expect(must(graph.moves.find((m) => m.san === 'd4')).comment).toBe('Best');
    const after = await rowVersions();
    const changed = [...after]
      .filter(([row, v]) => versions.get(row) !== v)
      .map(([row]) => row);
    expect(changed).toEqual([`move ${D4}`]);
    expect(
      must(await loadRepertoire(db, id, 'rokas')).repertoire,
    ).toMatchObject({ version: 2, updatedAt: T1 });
  });

  it('records a comment edit as one move whose comment changed (R-133)', async () => {
    const id = await rokasLondon();
    await edit(id, 'rokas', 1, comment('Geriausias'));
    expect(await changeRows()).toEqual([
      {
        repertoire_id: id,
        version: 2,
        changes: { added: [], removed: [], commentsChanged: 1 },
        created_at: T1,
      },
    ]);
  });

  it('adds and removes moves and links', async () => {
    const id = await rokasLondon();
    const start = await ownerGraph(id);
    const bf4 = must(
      start.moves.find((m) => m.san === 'Bf4' && m.chapters.includes('c1')),
    );
    const remove: EditOp = {
      kind: 'removeMove',
      chapterId: 'c1',
      from: bf4.from,
      san: 'Bf4',
    };
    const add: EditOp = {
      kind: 'addMove',
      chapterId: 'c1',
      from: bf4.from,
      san: 'c4',
    };
    expect(await edit(id, 'rokas', 1, builder(remove))).toMatchObject({
      ok: true,
      value: { version: 2 },
    });
    expect(await edit(id, 'rokas', 2, builder(add))).toMatchObject({
      ok: true,
      value: { version: 3 },
    });
    const expected = unwrap(applyEdit(unwrap(applyEdit(start, remove)), add));
    expect(canonical(await ownerGraph(id))).toEqual(canonical(expected));
  });

  it('saves the first chapter with its first move in one edit (R-111)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const empty = emptyGraph('white');
    const id = await createRepertoire(db, {
      ownerId: 'rokas',
      side: 'white',
      name: 'Nauja',
      graph: empty,
      now: T0,
    });
    const first: EditOp = {
      kind: 'addMove',
      chapterId: null,
      from: START_KEY,
      san: 'e4',
    };
    const expected = unwrap(applyEdit(empty, first));
    const { version, graph } = unwrap(
      await edit(id, 'rokas', 1, builder(first)),
    );
    expect(version).toBe(2);
    expect(graph).toEqual(expected);
    expect(expected.chapters.map((c) => c.id)).toEqual(['c1']);
    expect(await ownerGraph(id)).toEqual(expected);
  });

  it('adds an imported file as chapters after the existing ones and returns the first one added (R-101)', async () => {
    await seedAccount(db, 'rokas', 'rokas@example.lt');
    const id = await stored(BLACK_SICILIAN, 'black');
    const saved = await edit(
      id,
      'rokas',
      1,
      importOf(BLACK_NEW_GAMES, 'black'),
    );
    expect(saved).toMatchObject({
      ok: true,
      value: { version: 2, firstChapterId: 'c2' },
    });
    expect((await ownerGraph(id)).chapters.map((c) => c.id)).toEqual([
      'c1',
      'c2',
      'c3',
    ]);
  });

  it('returns the player move changes it recorded, an opponent move recording nothing (R-121, R-133)', async () => {
    const id = await rokasLondon();
    const start = await ownerGraph(id);
    // 4... Bd6 (the opponent's) and 5. Bd3 (the player's) after 4. Nf3.
    const nf3 = must(
      start.moves.find((m) => m.san === 'Nf3' && m.chapters.includes('c1')),
    );
    const reply = unwrap(
      await edit(
        id,
        'rokas',
        1,
        builder({ kind: 'addMove', chapterId: 'c1', from: nf3.to, san: 'Bd6' }),
      ),
    );
    expect(nothingChanged(reply.changes)).toBe(true);
    const bd6 = must(reply.graph.moves.find((m) => m.san === 'Bd6'));
    const answer = unwrap(
      await edit(
        id,
        'rokas',
        2,
        builder({ kind: 'addMove', chapterId: 'c1', from: bd6.to, san: 'Bd3' }),
      ),
    );
    const changes = playerMoveChanges(reply.graph, answer.graph);
    expect(changes.added).toHaveLength(1);
    expect(answer.changes).toEqual(changes);
    expect(await changeRows()).toEqual([
      { repertoire_id: id, version: 3, changes, created_at: T1 },
    ]);
  });

  it('records nothing for a chapter rename, and still bumps the version', async () => {
    const id = await rokasLondon();
    const saved = unwrap(
      await edit(
        id,
        'rokas',
        1,
        builder({ kind: 'renameChapter', chapterId: 'c1', name: 'Pagrindai' }),
      ),
    );
    expect(saved.version).toBe(2);
    expect(nothingChanged(saved.changes)).toBe(true);
    expect(await changeRows()).toEqual([]);
  });

  it('bumps the version of an edit that changes nothing, and records nothing', async () => {
    const id = await rokasLondon();
    const before = canonical(await ownerGraph(id));
    const saved = await edit(
      id,
      'rokas',
      1,
      builder({ kind: 'addMove', chapterId: 'c1', from: START_KEY, san: 'd4' }),
    );
    expect(saved).toMatchObject({ ok: true, value: { version: 2 } });
    expect(canonical(await ownerGraph(id))).toEqual(before);
    expect(await changeRows()).toEqual([]);
  });
});

describe('editRepertoire refuses and writes nothing (#276 decision 3)', () => {
  it('refuses a stale version', async () => {
    const id = await rokasLondon();
    await edit(id, 'rokas', 1, comment('Pirmas'));
    const before = await state(id);
    expect(await edit(id, 'rokas', 1, comment('Antras'))).toEqual(
      refused('repertoire.stale'),
    );
    expect(await state(id)).toEqual(before);
  });

  it("refuses another account's repertoire as not found, at the right version", async () => {
    const id = await rokasLondon();
    await seedAccount(db, 'rimantas', 'rimantas@example.lt');
    const before = await state(id);
    expect(await edit(id, 'rimantas', 1, comment('Svetimas'))).toEqual(
      refused('repertoire.notFound'),
    );
    expect(await state(id)).toEqual(before);
  });

  it('refuses a missing repertoire as not found', async () => {
    const id = await rokasLondon();
    const before = await state(id);
    expect(await edit(randomUUID(), 'rokas', 1, comment('Niekur'))).toEqual(
      refused('repertoire.notFound'),
    );
    expect(await state(id)).toEqual(before);
  });

  it('refuses an id that is no uuid as not found, without a statement', async () => {
    await rokasLondon();
    let result: unknown;
    const texts = await statementsOf(async () => {
      result = await edit('not-a-uuid', 'rokas', 1, comment('Niekur'));
    });
    expect(result).toEqual(refused('repertoire.notFound'));
    expect(texts).toEqual([]);
  });

  it('refuses a coach it is shared with and a player it is assigned to as not found (R-42, R-16)', async () => {
    await seedCoach(db, 'rimantas', 'rimantas@example.lt');
    for (const player of ['rokas', 'gabija'])
      await seedPlayer(db, player, `${player}@example.lt`);
    for (const player of ['rokas', 'gabija'])
      await seedLink(db, 'rimantas', player);
    const shared = await stored(LONDON);
    expect(
      await shareRepertoire(db, {
        ownerId: 'rokas',
        repertoireId: shared,
        coachId: 'rimantas',
        now: T0,
      }),
    ).toMatchObject({ ok: true });
    const assigned = await stored(LONDON, 'white', 'rimantas');
    await seedAssignment(db, {
      coachId: 'rimantas',
      repertoireId: assigned,
      target: { playerId: 'gabija' },
      now: T0,
    });
    for (const [id, owner, viewer] of [
      [shared, 'rokas', 'rimantas'],
      [assigned, 'rimantas', 'gabija'],
    ] as const) {
      const before = await state(id, owner);
      expect(await edit(id, viewer, 1, comment('Ne savo'))).toEqual(
        refused('repertoire.notFound'),
      );
      expect(await state(id, owner)).toEqual(before);
    }
  });

  it('refuses an edit chess refuses', async () => {
    const id = await rokasLondon();
    const before = await state(id);
    expect(
      await edit(
        id,
        'rokas',
        1,
        builder({
          kind: 'addMove',
          chapterId: 'c1',
          from: START_KEY,
          san: 'e5',
        }),
      ),
    ).toEqual(refused('repertoire.illegalMove'));
    expect(await state(id)).toEqual(before);
  });

  it('refuses an import of the other side', async () => {
    const id = await rokasLondon();
    const before = await state(id);
    expect(
      await edit(id, 'rokas', 1, importOf(BLACK_NEW_GAMES, 'black')),
    ).toEqual(refused('repertoire.sideMismatch'));
    expect(await state(id)).toEqual(before);
  });

  it('refuses an import that adds nothing (R-115)', async () => {
    const id = await rokasLondon();
    const before = await state(id);
    expect(await edit(id, 'rokas', 1, importOf(LONDON, 'white'))).toEqual(
      refused('pgn.nothingToAdd'),
    );
    expect(await state(id)).toEqual(before);
  });

  it('decides against the stored graph, not the one the client held', async () => {
    const id = await rokasLondon();
    const held = await ownerGraph(id);
    expect(held.moves.some((m) => moveKey(m.from, m.san) === D4)).toBe(true);
    for (const [chapterId, version] of [
      ['c1', 1],
      ['c2', 2],
    ] as const)
      expect(
        await edit(
          id,
          'rokas',
          version,
          builder({
            kind: 'removeMove',
            chapterId,
            from: START_KEY,
            san: 'd4',
          }),
        ),
      ).toMatchObject({ ok: true });
    const before = await state(id);
    expect(await edit(id, 'rokas', 3, comment('Dingo'))).toEqual(
      refused('repertoire.unknownMove'),
    );
    expect(await state(id)).toEqual(before);
  });
});

describe('editRepertoire locks the row FOR NO KEY UPDATE (#276 decision 2)', () => {
  it('waits for another edit in progress, then is refused stale and writes nothing', async () => {
    const id = await rokasLondon();
    const other = await openTransaction(client, [
      `update repertoires set version = version + 1 where id = '${id}'`,
    ]);
    const editing = edit(id, 'rokas', 1, comment('Vėlus'));
    await someoneWaitsForALock(client);
    await other.finish();
    expect(await editing).toEqual(refused('repertoire.stale'));
    expect(
      must((await ownerGraph(id)).moves.find((m) => m.san === 'd4')).comment,
    ).toBe('Solid');
    expect(await changeRows()).toEqual([]);
  });

  it('waits for a repertoire delete in progress, then is refused not found', async () => {
    const id = await rokasLondon();
    const deleting = await openTransaction(client, [
      `delete from repertoires where id = '${id}'`,
    ]);
    const editing = edit(id, 'rokas', 1, comment('Vėlus'));
    await someoneWaitsForALock(client);
    await deleting.finish();
    expect(await editing).toEqual(refused('repertoire.notFound'));
    expect(await changeRows()).toEqual([]);
  });

  it("waits for a fork's FOR SHARE read in progress", async () => {
    const id = await rokasLondon();
    const forking = await openTransaction(client, [
      `select 1 from repertoires where id = '${id}' for share`,
    ]);
    const editing = edit(id, 'rokas', 1, comment('Po kopijos'));
    await someoneWaitsForALock(client);
    await forking.finish();
    expect(await editing).toMatchObject({ ok: true, value: { version: 2 } });
  });

  it('does not wait for a FOR KEY SHARE hold (an assign or a personal note in progress)', async () => {
    const id = await rokasLondon();
    const assigning = await openTransaction(client, [
      `select 1 from repertoires where id = '${id}' for key share`,
    ]);
    try {
      expect(await edit(id, 'rokas', 1, comment('Šalia'))).toMatchObject({
        ok: true,
        value: { version: 2 },
      });
    } finally {
      await assigning.finish();
    }
  });
});

describe('editRepertoire reads the graph once, and only when the row allows the edit', () => {
  const matching = (texts: readonly string[], pattern: RegExp) =>
    texts.filter((text) => pattern.test(text));

  it('sends one transaction and one read of the links for a saved edit', async () => {
    const id = await rokasLondon();
    const texts = await statementsOf(() => edit(id, 'rokas', 1, comment('x')));
    expect(matching(texts, /^begin/i)).toHaveLength(1);
    expect(matching(texts, /from "move_chapters"/)).toHaveLength(1);
  });

  it('reads no moves for a stale or a not-found edit', async () => {
    const id = await rokasLondon();
    await edit(id, 'rokas', 1, comment('x'));
    for (const [viewer, version] of [
      ['rokas', 1],
      ['rimantas', 2],
    ] as const) {
      const texts = await statementsOf(() =>
        edit(id, viewer, version, comment('y')),
      );
      expect(matching(texts, /^begin/i)).toHaveLength(1);
      expect(matching(texts, /from "repertoire_moves"/)).toEqual([]);
    }
  });
});
