import { importPgn, type RepertoireGraph } from '@mychess/chess';
import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  previewImport,
  type ImportPreview,
  type PreviewOutcome,
} from './import-preview';
import { pgnWithMoves } from '../../test/fixtures/repertoires';

const NOW = new Date('2026-10-28T09:00:00Z');
const INTO = '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4';

const DB = { name: 'the db' };

const server = vi.hoisted(() => ({
  own: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  mayAdd: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  countRateLimited: () => Promise.resolve({ ok: true }),
  createRepertoire: vi.fn(),
  editRepertoire: vi.fn(),
  mayAddRepertoire: server.mayAdd,
}));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('./repertoires', () => ({ ownRepertoire: server.own }));

const ACCOUNT: Account = {
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: NOW,
  coachSince: null,
  createdAt: NOW,
};

const ADVANCE = '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 *';
const CLASSICAL = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 *';
const TWO_KNIGHTS = '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *';
/**
 * B12 by a move no named line follows, so English names it by the family's
 * line, "Caro-Kann Defense" (R-216), as it does WING's B10.
 */
const BISHOP = '1. e4 c6 2. d4 d5 3. Bd3 dxe4 4. Bxe4 Nf6 *';
/** B10, which English names "Caro-Kann Defense" as it does BISHOP's B12. */
const WING = '1. e4 c6 2. a3 d5 *';

/** The preview of `text`, or a thrown error with the refusal's reason. */
async function preview(text: string, into?: string): Promise<ImportPreview> {
  const outcome: PreviewOutcome = await previewImport(
    ACCOUNT,
    { text, side: 'black', into },
    NOW,
  );
  if (!outcome.ok) throw new Error(outcome.refusal.reason);
  return outcome.preview;
}

/** The chapter titles a preview of `text` shows. */
const titles = async (
  text: string,
  into?: string,
): Promise<readonly string[]> => (await preview(text, into)).chapters;

const graphOf = (text: string): RepertoireGraph => {
  const imported = importPgn(text, 'black');
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
};

/** The account's repertoire INTO holds the games of `text`. */
function ownsRepertoireOf(text: string): void {
  server.own.mockResolvedValue({
    ok: true,
    value: {
      repertoire: {
        id: INTO,
        ownerId: 'rokas',
        side: 'black',
        name: 'Karo-Kan',
        version: 3,
        createdAt: NOW,
        updatedAt: NOW,
      },
      graph: graphOf(text),
    },
  });
}

beforeEach(() => {
  server.own.mockReset();
  server.mayAdd.mockReset().mockResolvedValue({ ok: true, value: undefined });
});

describe('previewImport chapter titles (R-158)', () => {
  const upload = [ADVANCE, CLASSICAL, TWO_KNIGHTS].join('\n\n');

  it('tells apart the chapters a file brings that share a name', async () => {
    const shared = [BISHOP, CLASSICAL, WING].join('\n\n');
    expect(await titles(shared)).toEqual([
      'Caro-Kann Defense (B12, 3.\u00A0Bd3)',
      'Caro-Kann Defense: Classical Variation',
      'Caro-Kann Defense (B10, 2.\u00A0a3)',
    ]);
  });

  it('keeps them plain where their names tell them apart', async () => {
    expect(await titles(upload)).toEqual([
      'Caro-Kann Defense: Advance Variation, Short Variation',
      'Caro-Kann Defense: Classical Variation',
      'Caro-Kann Defense: Two Knights Attack, Mindeno Variation',
    ]);
  });

  it('titles a merge’s new chapters as the merged repertoire names them', async () => {
    ownsRepertoireOf(BISHOP);
    // Alone, the 2. a3 line would be plain; beside the repertoire's
    // 3. Bd3 line it is told apart.
    expect(await titles(WING)).toEqual(['Caro-Kann Defense']);
    expect(await titles(WING, INTO)).toEqual([
      'Caro-Kann Defense (B10, 2.\u00A0a3)',
    ]);
  });
});

describe('previewImport what the file holds', () => {
  it('counts the file alone when merging, not the merged repertoire', async () => {
    ownsRepertoireOf([CLASSICAL, BISHOP].join('\n\n'));
    const merged = await preview(ADVANCE, INTO);
    expect(merged.summary).toEqual((await preview(ADVANCE)).summary);
    expect(merged.summary.chapters).toBe(1);
  });

  it('counts the file even when nothing in it can be added (R-115)', async () => {
    ownsRepertoireOf([ADVANCE, CLASSICAL].join('\n\n'));
    const merged = await preview(ADVANCE, INTO);
    expect(merged.refusal).toBe('pgn.nothingToAdd');
    expect(merged.summary).toMatchObject({ chapters: 1, moves: 8 });
  });

  it('suggests the name from the Event every game shares, for a merge too', async () => {
    const shared = [ADVANCE, CLASSICAL]
      .map((game) => `[Event "Karo-Kan"]\n\n${game}`)
      .join('\n\n');
    expect((await preview(shared)).suggestedName).toBe('Karo-Kan');
    ownsRepertoireOf(BISHOP);
    expect((await preview(shared, INTO)).suggestedName).toBe('Karo-Kan');
  });

  it('suggests the file name without its extension, cut to the name limit', async () => {
    const named = async (fileName: unknown): Promise<string> => {
      const outcome = await previewImport(
        ACCOUNT,
        { text: ADVANCE, side: 'black', fileName },
        NOW,
      );
      if (!outcome.ok) throw new Error(outcome.refusal.reason);
      return outcome.preview.suggestedName;
    };
    expect(await named('karo-kan.pgn')).toBe('karo-kan');
    expect(await named(`${'k'.repeat(100)}.pgn`)).toBe('k'.repeat(80));
    // Pasted text, or a file name that is not text: nothing to suggest.
    expect(await named(undefined)).toBe('');
    expect(await named(42)).toBe('');
  });
});

describe('previewImport renamed chapters (R-159)', () => {
  /** The 3. Bd3 line, told apart at `move` from the 2. a3 line it gains. */
  const bishopRenamed = (move: string) => ({
    from: 'Caro-Kann Defense',
    to: `Caro-Kann Defense (B12, ${move})`,
  });

  it('lists an existing chapter a merge gives a namesake, old title and new', async () => {
    ownsRepertoireOf(BISHOP);
    expect((await preview(WING, INTO)).renamed).toEqual([
      bishopRenamed('2.\u00A0d4'),
    ]);
  });

  it('leaves out the existing chapters whose title stays', async () => {
    // The Classical keeps its own name; the 3. Bd3 line's move is where it
    // parts from every other chapter, the Classical's 3. Nc3 included.
    ownsRepertoireOf([CLASSICAL, BISHOP].join('\n\n'));
    expect((await preview(WING, INTO)).renamed).toEqual([
      bishopRenamed('3.\u00A0Bd3'),
    ]);
  });

  it('lists none when their names already tell them apart', async () => {
    ownsRepertoireOf(ADVANCE);
    expect((await preview(TWO_KNIGHTS, INTO)).renamed).toEqual([]);
  });

  it('lists none for a new repertoire', async () => {
    const upload = [ADVANCE, TWO_KNIGHTS].join('\n\n');
    expect((await preview(upload)).renamed).toEqual([]);
  });
});

describe('previewImport within the repertoire limits (R-162)', () => {
  it('refuses a new repertoire when the account holds 50, before showing it', async () => {
    const atLimit = {
      ok: false,
      refusal: { reason: 'repertoire.limit', limit: 50 },
    };
    server.mayAdd.mockResolvedValue(atLimit);
    expect(
      await previewImport(ACCOUNT, { text: ADVANCE, side: 'black' }, NOW),
    ).toEqual(atLimit);
    expect(server.mayAdd).toHaveBeenCalledWith(DB, ACCOUNT);
  });

  // A 5,000-move file takes seconds to generate and import, longer with the
  // gate's projects in parallel (R-211).
  it(
    'refuses a new repertoire of more than 5,000 moves',
    { timeout: 120_000 },
    async () => {
      expect(
        await previewImport(
          ACCOUNT,
          { text: pgnWithMoves(5001), side: 'white' },
          NOW,
        ),
      ).toEqual({
        ok: false,
        refusal: { reason: 'repertoire.tooManyMoves', limit: 5000 },
      });
    },
  );

  it(
    'shows a new repertoire of exactly 5,000 moves',
    { timeout: 120_000 },
    async () => {
      const outcome = await previewImport(
        ACCOUNT,
        { text: pgnWithMoves(5000), side: 'white' },
        NOW,
      );
      expect(outcome.ok && outcome.preview.summary.moves).toBe(5000);
    },
  );
});

describe('previewImport added comments and NAGs (R-175, R-176)', () => {
  const ANNOTATED_ADVANCE =
    '1. e4 c6 2. d4 d5 3. e5 { Space } Bf5 $14 4. Nf3 { Quiet } e6 *';

  it('lists the comments and NAGs a file adds to the moves already there, and takes it', async () => {
    ownsRepertoireOf(ADVANCE);
    const p = await preview(ANNOTATED_ADVANCE, INTO);
    expect(p.refusal).toBeNull();
    expect(p.chapters).toEqual([]);
    expect(p.target?.added).toEqual({ chapters: 0, moves: 0, annotated: 3 });
    expect(p.annotations).toEqual([
      { move: '3. e5', comment: 'Space' },
      { move: '3... Bf5 ⩲', comment: null },
      { move: '4. Nf3', comment: 'Quiet' },
    ]);
  });

  it('leaves out a move that gains only a NAG with no glyph, yet takes the file (R-175, #335)', async () => {
    ownsRepertoireOf(ADVANCE);
    const p = await preview(
      '1. e4 c6 2. d4 d5 3. e5 $146 Bf5 $14 4. Nf3 e6 *',
      INTO,
    );
    // $146 ("novelty") has no glyph: listing 3. e5 would show nothing new.
    expect(p.annotations).toEqual([{ move: '3... Bf5 ⩲', comment: null }]);
    // The count says what the list shows.
    expect(p.target?.added).toEqual({ chapters: 0, moves: 0, annotated: 1 });
    expect(p.refusal).toBeNull();
    const only = await preview('1. e4 c6 2. d4 d5 3. e5 $146 *', INTO);
    expect(only.annotations).toEqual([]);
    expect(only.target?.added.annotated).toBe(0);
    // Still something to add: Import stays enabled (R-115).
    expect(only.refusal).toBeNull();
  });

  it('lists none when the repertoire already has them, and refuses the file (R-115)', async () => {
    ownsRepertoireOf(ANNOTATED_ADVANCE);
    const p = await preview(ANNOTATED_ADVANCE, INTO);
    expect(p.refusal).toBe('pgn.nothingToAdd');
    expect(p.annotations).toEqual([]);
    expect(p.target?.added).toEqual({ chapters: 0, moves: 0, annotated: 0 });
  });

  it('lists none for a new repertoire: its comments come with its moves', async () => {
    expect((await preview(ANNOTATED_ADVANCE)).annotations).toEqual([]);
  });
});

describe('previewImport side check (#364, R-214)', () => {
  /** Black's one answer to each of White's first moves. */
  const BLACK_FILE = ['1. e4 c5 *', '1. d4 Nf6 *', '1. c4 e5 *']
    .map((moves) => `[Event "?"]\n\n${moves}\n`)
    .join('\n');

  const suggestedFor = async (side: 'white' | 'black', into?: string) => {
    const outcome = await previewImport(
      ACCOUNT,
      { text: BLACK_FILE, side, into },
      NOW,
    );
    if (!outcome.ok) throw new Error(outcome.refusal.reason);
    return outcome.preview.suggestedSide;
  };

  it('suggests Black for a Black repertoire previewed as White', async () => {
    expect(await suggestedFor('white')).toBe('black');
  });

  it('suggests nothing when the side fits', async () => {
    expect(await suggestedFor('black')).toBeNull();
  });

  it('checks the file alone when merging into a repertoire', async () => {
    ownsRepertoireOf(ADVANCE);
    expect(await suggestedFor('black', INTO)).toBeNull();
  });
});
