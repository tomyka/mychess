import {
  addChapter,
  addMove,
  chapterChildren,
  moveKey,
  START_KEY,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { deleteRepertoire, loadRepertoire } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import { editRepertoireAction } from '../../src/app/repertuarai/[id]/actions';
import { chapterNamesOf } from '../../src/server/chapter-names';
import { actAs, person, type Person } from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, request, testDb } from './support/request';
import { LONDON, seedRepertoire } from './support/repertoires';

vi.mock('next/headers', async () =>
  (await import('./support/request')).nextHeaders(),
);
vi.mock('next/navigation', async () =>
  (await import('./support/request')).nextNavigation(),
);
vi.mock('next/cache', async () =>
  (await import('./support/request')).nextCache(),
);
vi.mock('../../src/server/db', async () =>
  (await import('./support/request')).serverDb(),
);
vi.mock('../../src/server/auth', async (original) =>
  (await import('./support/request')).serverAuth(original),
);

const { sql } = useRequestHarness();

interface Cast {
  readonly rokas: Person;
  readonly rimantas: Person;
  /** Rokas's London (two chapters). */
  readonly london: string;
  /** Rokas's empty repertoire, without chapters. */
  readonly empty: string;
}

async function cast(): Promise<Cast> {
  const rokas = await person(sql, 'rokas@example.lt', 'Rokas');
  const rimantas = await person(sql, 'rimantas@example.lt', 'Rimantas');
  const london = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londono sistema',
  });
  const empty = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: null,
    side: 'white',
    name: 'Naujas',
  });
  return { rokas, rimantas, london, empty };
}

/** The repertoire as stored now: its graph and version. */
async function stored(
  id: string,
  owner: Person,
): Promise<{ graph: RepertoireGraph; version: number }> {
  const loaded = await loadRepertoire(testDb(), id, owner.id);
  if (loaded === undefined) throw new Error('no repertoire');
  return { graph: loaded.graph, version: loaded.repertoire.version };
}

/** The chapter's move `san` reached by playing `sans` from the start. */
function moveAt(
  graph: RepertoireGraph,
  chapterId: string,
  sans: readonly string[],
): RepertoireMove {
  const children = chapterChildren(graph)(chapterId);
  let key = START_KEY;
  let found: RepertoireMove | undefined;
  for (const san of sans) {
    found = children(key).find((m) => m.san === san);
    if (found === undefined) throw new Error(`no ${san}`);
    key = found.to;
  }
  if (found === undefined) throw new Error('no moves');
  return found;
}

const sansIn = (graph: RepertoireGraph, chapterId: string): string[] =>
  graph.moves.filter((m) => m.chapters.includes(chapterId)).map((m) => m.san);

const edit = (repertoireId: string, version: number, op: unknown) =>
  editRepertoireAction({ repertoireId, version, op });

describe('editRepertoireAction: moves', () => {
  it('starts the first chapter with the first move, in one save (R-111)', async () => {
    const { rokas, empty } = await cast();
    actAs(rokas);
    const outcome = await edit(empty, 1, {
      kind: 'addMove',
      chapterId: null,
      from: START_KEY,
      san: 'd4',
    });
    const started = addChapter(
      { side: 'white', chapters: [], moves: [] },
      START_KEY,
    );
    const expected = addMove(started.graph, 'c1', START_KEY, 'd4');
    if (!expected.ok) throw new Error('refused');
    expect(outcome).toEqual({
      ok: true,
      version: 2,
      graph: expected.value,
      names: chapterNamesOf(expected.value, 'lt'),
    });
    const now = await stored(empty, rokas);
    expect(now.version).toBe(2);
    expect(now.graph.chapters.map((c) => c.id)).toEqual(['c1']);
    expect(sansIn(now.graph, 'c1')).toEqual(['d4']);
  });

  it('adds the next chapter to a repertoire that has chapters', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const outcome = await edit(london, 1, { kind: 'addChapter' });
    expect(outcome).toMatchObject({ ok: true, version: 2 });
    const now = await stored(london, rokas);
    expect(now.graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(now.graph.chapters[2]).toMatchObject({
      rootKey: START_KEY,
      nameSource: { kind: 'index', number: 3 },
    });
  });

  it('refuses a first move without a chapter where chapters exist', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'addMove',
        chapterId: null,
        from: START_KEY,
        san: 'e4',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.unknownChapter' });
    expect((await stored(london, rokas)).version).toBe(1);
  });

  it('refuses an illegal move and keeps the version', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'addMove',
        chapterId: 'c1',
        from: START_KEY,
        san: 'Ke2',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.illegalMove' });
    expect((await stored(london, rokas)).version).toBe(1);
  });

  it('refuses a second answer', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'addMove',
        chapterId: 'c1',
        from: START_KEY,
        san: 'e4',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.secondAnswer' });
  });

  it('removes Bf4 and what only it reached, keeping the KID chapter’s Bf4', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const before = await stored(london, rokas);
    const bf4 = moveAt(before.graph, 'c1', ['d4', 'd5', 'Bf4']);
    const kidBf4 = moveAt(before.graph, 'c2', ['d4', 'Nf6', 'Bf4']);
    expect(
      await edit(london, 1, {
        kind: 'removeMove',
        chapterId: 'c1',
        from: bf4.from,
        san: 'Bf4',
      }),
    ).toMatchObject({ ok: true, version: 2 });
    const now = await stored(london, rokas);
    expect(sansIn(now.graph, 'c1')).toEqual(['d4', 'd5']);
    expect(
      now.graph.moves.some((m) => m.from === bf4.from && m.san === 'Bf4'),
    ).toBe(false);
    expect(
      now.graph.moves.find((m) => m.from === kidBf4.from && m.san === 'Bf4')
        ?.chapters,
    ).toEqual(['c2']);
  });
});

describe('editRepertoireAction: marks, comments and chapters', () => {
  it('stores marks and the normalised comment', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    const marks = {
      arrows: [{ from: 'c1', to: 'f4', color: 'R' }],
      circles: [{ square: 'd4', color: 'B' }],
    };
    expect(
      await edit(london, 1, {
        kind: 'setMarks',
        chapterId: 'c1',
        from: START_KEY,
        san: 'd4',
        marks,
      }),
    ).toMatchObject({ ok: true, version: 2 });
    expect(
      await edit(london, 2, {
        kind: 'editComment',
        moveKey: moveKey(START_KEY, 'd4'),
        comment: '  Tvirtas\n\nėjimas ',
      }),
    ).toMatchObject({ ok: true, version: 3 });
    const d4 = moveAt((await stored(london, rokas)).graph, 'c1', ['d4']);
    expect(d4).toMatchObject({
      arrows: marks.arrows,
      circles: marks.circles,
      comment: 'Tvirtas ėjimas',
    });
  });

  it('refuses a comment of 2,001 characters', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'editComment',
        moveKey: moveKey(START_KEY, 'd4'),
        comment: 'a'.repeat(2001),
      }),
    ).toEqual({ ok: false, refusal: 'comment.tooLong' });
    expect((await stored(london, rokas)).version).toBe(1);
  });

  it('renames a chapter and removes one with the moves only it used', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'renameChapter',
        chapterId: 'c2',
        name: ' Prieš KID ',
      }),
    ).toMatchObject({ ok: true, version: 2 });
    expect((await stored(london, rokas)).graph.chapters[1]?.nameSource).toEqual(
      { kind: 'custom', name: 'Prieš KID' },
    );
    expect(
      await edit(london, 2, { kind: 'removeChapter', chapterId: 'c1' }),
    ).toMatchObject({ ok: true, version: 3 });
    const now = await stored(london, rokas);
    expect(now.graph.chapters.map((c) => c.id)).toEqual(['c2']);
    expect(now.graph.moves.map((m) => m.san).sort()).toEqual(
      sansIn(now.graph, 'c2').sort(),
    );
    expect(now.graph.moves.some((m) => m.san === 'd5')).toBe(false);
  });

  it('refuses a blank chapter name with its catalogue key', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(
      await edit(london, 1, {
        kind: 'renameChapter',
        chapterId: 'c1',
        name: '  ',
      }),
    ).toEqual({ ok: false, refusal: 'chapter.nameBlank' });
  });
});

describe('editRepertoireAction: refusals that change nothing', () => {
  it('refuses a version older than the last save', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    await edit(london, 1, { kind: 'addChapter' });
    expect(
      await edit(london, 1, { kind: 'removeChapter', chapterId: 'c1' }),
    ).toEqual({ ok: false, refusal: 'repertoire.stale' });
    const now = await stored(london, rokas);
    expect(now.version).toBe(2);
    expect(now.graph.chapters).toHaveLength(3);
  });

  it('refuses another account, as not found, and changes nothing', async () => {
    const { rokas, rimantas, london } = await cast();
    actAs(rimantas);
    expect(
      await edit(london, 1, { kind: 'removeChapter', chapterId: 'c1' }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    const now = await stored(london, rokas);
    expect(now.version).toBe(1);
    expect(now.graph.chapters).toHaveLength(2);
  });

  it('refuses a repertoire deleted since the client loaded it as not found, not stale (#276)', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    await deleteRepertoire(testDb(), london, rokas.id, new Date());
    expect(await edit(london, 1, { kind: 'addChapter' })).toEqual({
      ok: false,
      refusal: 'repertoire.notFound',
    });
    expect(await sql.count('repertoires')).toBe(1);
    expect(await sql.count('repertoire_changes')).toBe(0);
  });

  it('refuses a malformed request without touching the database', async () => {
    const { rokas, london } = await cast();
    actAs(rokas);
    expect(await edit(london, 1, { kind: 'dropTable' })).toEqual({
      ok: false,
      refusal: 'repertoire.invalidEdit',
    });
    expect(await editRepertoireAction(null)).toEqual({
      ok: false,
      refusal: 'repertoire.invalidEdit',
    });
    expect((await stored(london, rokas)).version).toBe(1);
  });

  it('sends a signed-out visitor to sign-in', async () => {
    const { rokas, london } = await cast();
    request.cookie = '';
    expect(await outcomeOf(edit(london, 1, { kind: 'addChapter' }))).toEqual({
      redirectedTo: '/prisijungti',
    });
    expect((await stored(london, rokas)).version).toBe(1);
  });
});
