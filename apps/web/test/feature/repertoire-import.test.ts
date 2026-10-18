import { mergeInto, summarize, importPgn } from '@mychess/chess';
import { loadRepertoire } from '@mychess/db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  confirmImportAction,
  previewImportAction,
} from '../../src/app/repertuarai/importuoti/actions';
import { actAs, person, type Person } from './support/coaching';
import { useRequestHarness } from './support/harness';
import { outcomeOf, testDb } from './support/request';
import { graphOf } from '../fixtures/repertoires';
import { LONDON, seedRepertoire, TAIMANOV } from './support/repertoires';

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

const game = (movetext: string): string => `[Event "?"]\n\n${movetext}\n`;

/**
 * Six Black Sicilian games, two of which transpose into the others, and a
 * seventh with an illegal move (R-64).
 */
const SICILIANS_WITH_BROKEN = [
  game('1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 *'),
  game('1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 *'),
  game('1. e4 c5 2. Nf3 e6 3. c3 d5 *'),
  game('1. e4 c5 2. Nc3 e6 3. Nf3 Nc6 *'),
  game('1. e4 c5 2. Nf3 e6 3. Nc3 Nc6 4. d4 cxd4 5. Nxd4 Qc7 *'),
  game('1. e4 c5 2. d4 cxd4 3. c3 Nf6 *'),
  game('1. e4 c5 2. Nf3 Nxe4 *'),
].join('\n');

/** One game Gabija's Taimanov answers differently (5...a6), one it lacks. */
const INTO_TAIMANOV = [
  game('1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 a6 *'),
  game('1. e4 c5 2. Nf3 e6 3. c3 d5 *'),
].join('\n');

/** White games Gabija's London (1. d4) answers differently on move 1. */
const NOT_LONDON = [game('1. e4 e5 *'), game('1. c4 e5 *')].join('\n');

interface Cast {
  readonly gabija: Person;
  /** Gabija's Taimanov (Black, one chapter). */
  readonly taimanov: string;
  /** Gabija's London (White). */
  readonly london: string;
  /** Rokas's Taimanov (Black). */
  readonly foreign: string;
}

async function cast(): Promise<Cast> {
  const gabija = await person(sql, 'gabija@example.lt', 'Gabija');
  await person(sql, 'rokas@example.lt', 'Rokas');
  const taimanov = await seedRepertoire(testDb(), 'gabija@example.lt', {
    pgn: TAIMANOV,
    side: 'black',
    name: 'Taimanovas',
  });
  const london = await seedRepertoire(testDb(), 'gabija@example.lt', {
    pgn: LONDON,
    side: 'white',
    name: 'Londonas',
  });
  const foreign = await seedRepertoire(testDb(), 'rokas@example.lt', {
    pgn: TAIMANOV,
    side: 'black',
    name: 'Roko Taimanovas',
  });
  return { gabija, taimanov, london, foreign };
}

const repertoireCount = async (): Promise<number> =>
  (await sql.rows('select id from repertoires')).length;

async function stored(id: string, owner: Person) {
  const loaded = await loadRepertoire(testDb(), id, owner.id);
  if (loaded === undefined) throw new Error('no repertoire');
  return loaded;
}

const previewSchema = z.object({
  ok: z.literal(true),
  preview: z.object({
    summary: z.object({
      chapters: z.number(),
      lines: z.number(),
      positions: z.number(),
      transpositions: z.number(),
      moves: z.number(),
    }),
    chapters: z.array(z.unknown()),
    skipped: z.array(z.unknown()),
    target: z.unknown(),
    refusal: z.string().nullable(),
  }),
});

describe('previewImportAction', () => {
  it('summarises a new import and lists the skipped game', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    const outcome = previewSchema.parse(
      await previewImportAction({ text: SICILIANS_WITH_BROKEN, side: 'black' }),
    );
    const { preview } = outcome;
    expect(preview.summary).toEqual(
      summarize(graphOf(SICILIANS_WITH_BROKEN, 'black')),
    );
    expect(preview.summary.chapters).toBe(6);
    expect(preview.summary.lines).toBe(6);
    expect(preview.summary.transpositions).toBeGreaterThanOrEqual(1);
    expect(preview.chapters).toHaveLength(6);
    expect(
      preview.chapters.map((name) =>
        z.object({ kind: z.literal('text'), text: z.string() }).parse(name),
      ),
    ).toHaveLength(6);
    expect(preview.skipped).toEqual([
      { game: 7, reason: 'pgn.illegalMove', san: 'Nxe4' },
    ]);
    expect(preview.target).toBeNull();
    expect(await repertoireCount()).toBe(3);
  });

  it('previews the merge into an existing repertoire of the side', async () => {
    const { gabija, taimanov } = await cast();
    actAs(gabija);
    const outcome = previewSchema.parse(
      await previewImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        into: taimanov,
      }),
    );
    const imported = importPgn(INTO_TAIMANOV, 'black');
    if (!imported.ok) throw new Error('fixture does not import');
    const merged = mergeInto(graphOf(TAIMANOV, 'black'), imported.value);
    if (!merged.ok) throw new Error('fixture does not merge');
    expect(outcome.preview.summary).toEqual(summarize(merged.value.graph));
    // Game 1 adds no new move, so it adds no chapter (R-117).
    expect(outcome.preview.chapters).toHaveLength(1);
    expect(outcome.preview.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'a6', move: 5 },
    ]);
    expect(outcome.preview.target).toEqual({
      id: taimanov,
      name: 'Taimanovas',
      version: 1,
      added: { chapters: 1, moves: 2 },
    });
    expect(outcome.preview.refusal).toBeNull();
    expect((await stored(taimanov, gabija)).repertoire.version).toBe(1);
  });

  it('shows the merge but refuses it when nothing in the file can be added (R-115)', async () => {
    const { gabija, london } = await cast();
    actAs(gabija);
    const outcome = previewSchema.parse(
      await previewImportAction({
        text: NOT_LONDON,
        side: 'white',
        into: london,
      }),
    );
    expect(outcome.preview.refusal).toBe('pgn.nothingToAdd');
    expect(outcome.preview.chapters).toEqual([]);
    expect(outcome.preview.skipped).toEqual([
      { game: 1, reason: 'pgn.secondAnswer', san: 'e4', move: 1 },
      { game: 2, reason: 'pgn.secondAnswer', san: 'c4', move: 1 },
    ]);
    expect(outcome.preview.target).toEqual({
      id: london,
      name: 'Londonas',
      version: 1,
      added: { chapters: 0, moves: 0 },
    });
  });

  it('lets a new repertoire take a file nothing of which fits an existing one', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    const outcome = previewSchema.parse(
      await previewImportAction({ text: NOT_LONDON, side: 'white' }),
    );
    expect(outcome.preview.refusal).toBeNull();
    // 1. c4 is a second answer to 1. e4 within the file itself (R-54).
    expect(outcome.preview.chapters).toHaveLength(1);
  });

  it('refuses a repertoire of the other side and one that is not hers', async () => {
    const { gabija, london, foreign } = await cast();
    actAs(gabija);
    expect(
      await previewImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        into: london,
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.sideMismatch' });
    expect(
      await previewImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        into: foreign,
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    expect(
      await previewImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        into: 'not-a-uuid',
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
  });

  it.each([
    [
      'a file over 2 MB',
      'a'.repeat(2 * 1024 * 1024 + 1),
      { refusal: 'pgn.tooLarge', limit: 2097152 },
    ],
    [
      'more than 200 games',
      game('1. e4 *').repeat(201),
      { refusal: 'pgn.tooManyGames', limit: 200 },
    ],
    [
      'variations nested deeper than 64',
      `1. e4 ${'(1. d4 '.repeat(65)}${')'.repeat(65)} *`,
      { refusal: 'pgn.tooDeep', limit: 64 },
    ],
    [
      'a file with no valid game',
      game('1. e4 e5 2. Ke3 *'),
      { refusal: 'pgn.noValidGames' },
    ],
  ])('refuses %s, naming the limit', async (_, text, refused) => {
    actAs(await person(sql, 'gabija@example.lt', 'Gabija'));
    expect(await previewImportAction({ text, side: 'white' })).toEqual({
      ok: false,
      ...refused,
    });
  });

  it('refuses a malformed request', async () => {
    actAs(await person(sql, 'gabija@example.lt', 'Gabija'));
    expect(await previewImportAction({ text: TAIMANOV, side: 'red' })).toEqual({
      ok: false,
      refusal: 'repertoire.sideInvalid',
    });
    expect(await previewImportAction({ side: 'white' })).toEqual({
      ok: false,
      refusal: 'pgn.unreadable',
    });
  });

  it('sends a signed-out visitor to sign-in', async () => {
    expect(
      await outcomeOf(previewImportAction({ text: TAIMANOV, side: 'black' })),
    ).toEqual({ redirectedTo: '/prisijungti' });
  });
});

describe('confirmImportAction', () => {
  it('creates a new repertoire with the imported graph and opens it', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    const outcome = await outcomeOf(
      confirmImportAction({
        text: SICILIANS_WITH_BROKEN,
        side: 'black',
        target: { kind: 'new', name: ' Sicilietiška ' },
      }),
    );
    const rows = await sql.rows(
      `select id from repertoires where name = 'Sicilietiška'`,
    );
    const { id } = z.object({ id: z.uuid() }).parse(rows[0]);
    expect(outcome).toEqual({ redirectedTo: `/repertuarai/${id}?chapter=c1` });
    const loaded = await stored(id, gabija);
    expect(loaded.repertoire.side).toBe('black');
    expect(loaded.graph).toEqual(graphOf(SICILIANS_WITH_BROKEN, 'black'));
  });

  it('refuses a blank name and creates nothing', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    expect(
      await confirmImportAction({
        text: SICILIANS_WITH_BROKEN,
        side: 'black',
        target: { kind: 'new', name: '   ' },
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.nameBlank' });
    expect(await repertoireCount()).toBe(3);
  });

  it('refuses a file over the limits and creates nothing', async () => {
    const { gabija } = await cast();
    actAs(gabija);
    expect(
      await confirmImportAction({
        text: game('1. e4 *').repeat(201),
        side: 'black',
        target: { kind: 'new', name: 'Per daug' },
      }),
    ).toEqual({ ok: false, refusal: 'pgn.tooManyGames', limit: 200 });
    expect(await repertoireCount()).toBe(3);
  });

  it('adds the games to an existing repertoire after its chapters', async () => {
    const { gabija, taimanov } = await cast();
    actAs(gabija);
    const outcome = await outcomeOf(
      confirmImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        target: { kind: 'existing', id: taimanov, version: 1 },
      }),
    );
    // It opens on the first chapter the import added (screen note).
    expect(outcome).toEqual({
      redirectedTo: `/repertuarai/${taimanov}?chapter=c2`,
    });
    const loaded = await stored(taimanov, gabija);
    expect(loaded.repertoire.version).toBe(2);
    expect(loaded.graph.chapters.map((c) => c.id)).toEqual(['c1', 'c2']);
    const before = graphOf(TAIMANOV, 'black');
    expect(loaded.graph.moves).toHaveLength(before.moves.length + 2);
    expect(await repertoireCount()).toBe(3);
  });

  it('refuses a file nothing of which can be added and writes nothing (R-115)', async () => {
    const { gabija, london } = await cast();
    actAs(gabija);
    const before = await stored(london, gabija);
    expect(
      await confirmImportAction({
        text: NOT_LONDON,
        side: 'white',
        target: { kind: 'existing', id: london, version: 1 },
      }),
    ).toEqual({ ok: false, refusal: 'pgn.nothingToAdd' });
    expect(await stored(london, gabija)).toEqual(before);
  });

  it('refuses a stale version and writes nothing', async () => {
    const { gabija, taimanov } = await cast();
    actAs(gabija);
    await outcomeOf(
      confirmImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        target: { kind: 'existing', id: taimanov, version: 1 },
      }),
    );
    const after = await stored(taimanov, gabija);
    expect(
      await confirmImportAction({
        text: SICILIANS_WITH_BROKEN,
        side: 'black',
        target: { kind: 'existing', id: taimanov, version: 1 },
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.stale' });
    expect(await stored(taimanov, gabija)).toEqual(after);
  });

  it('refuses another account’s repertoire and one of the other side', async () => {
    const { gabija, london, foreign } = await cast();
    actAs(gabija);
    expect(
      await confirmImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        target: { kind: 'existing', id: foreign, version: 1 },
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.notFound' });
    expect(
      await confirmImportAction({
        text: INTO_TAIMANOV,
        side: 'black',
        target: { kind: 'existing', id: london, version: 1 },
      }),
    ).toEqual({ ok: false, refusal: 'repertoire.sideMismatch' });
    expect(
      (await sql.rows('select version from repertoires order by 1')).map(
        (row) => z.object({ version: z.number() }).parse(row).version,
      ),
    ).toEqual([1, 1, 1]);
  });

  it('sends a signed-out visitor to sign-in and creates nothing', async () => {
    expect(
      await outcomeOf(
        confirmImportAction({
          text: TAIMANOV,
          side: 'black',
          target: { kind: 'new', name: 'Taimanovas' },
        }),
      ),
    ).toEqual({ redirectedTo: '/prisijungti' });
    expect(await repertoireCount()).toBe(0);
  });
});
