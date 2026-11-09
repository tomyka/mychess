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

const account = (locale: 'lt' | 'en'): Account => ({
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  locale,
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: NOW,
  coachSince: null,
  createdAt: NOW,
});

const ADVANCE = '1. e4 c6 2. d4 d5 3. e5 Bf5 4. Nf3 e6 *';
const CLASSICAL = '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 *';
const TWO_KNIGHTS = '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *';
/** B10, which English names "Caro-Kann Defense" as it does the Advance's B12. */
const ACCELERATED = '1. e4 c6 2. c4 d5 *';

/** The preview of `text`, or a thrown error with the refusal's reason. */
async function preview(
  locale: 'lt' | 'en',
  text: string,
  into?: string,
): Promise<ImportPreview> {
  const outcome: PreviewOutcome = await previewImport(
    account(locale),
    { text, side: 'black', into },
    NOW,
  );
  if (!outcome.ok) throw new Error(outcome.refusal.reason);
  return outcome.preview;
}

/** The chapter titles a preview of `text` shows. */
const titles = async (
  locale: 'lt' | 'en',
  text: string,
  into?: string,
): Promise<readonly string[]> => (await preview(locale, text, into)).chapters;

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
    const shared = [ADVANCE, CLASSICAL, ACCELERATED].join('\n\n');
    expect(await titles('en', shared)).toEqual([
      'Caro-Kann Defense (B12, 3.\u00A0e5)',
      'Caro-Kann Defense: Classical Variation',
      'Caro-Kann Defense (B10, 2.\u00A0c4)',
    ]);
  });

  it.each(['lt', 'en'] as const)(
    'keeps them plain where the served language names them apart (a %s account, R-180)',
    async (locale) => {
      expect(await titles(locale, upload)).toEqual([
        'Caro-Kann Defense',
        'Caro-Kann Defense: Classical Variation',
        'Caro-Kann Defense: Two Knights Attack, Mindeno Variation',
      ]);
    },
  );

  it('titles a merge’s new chapters as the merged repertoire names them', async () => {
    ownsRepertoireOf(ADVANCE);
    // Alone, the Accelerated would be plain; beside the repertoire's
    // Advance it is told apart.
    expect(await titles('en', ACCELERATED)).toEqual(['Caro-Kann Defense']);
    expect(await titles('en', ACCELERATED, INTO)).toEqual([
      'Caro-Kann Defense (B10, 2.\u00A0c4)',
    ]);
  });
});

describe('previewImport renamed chapters (R-159)', () => {
  /** The Advance, told apart at `move` from the Accelerated it gains. */
  const advanceRenamed = (move: string) => ({
    from: 'Caro-Kann Defense',
    to: `Caro-Kann Defense (B12, ${move})`,
  });

  it('lists an existing chapter a merge gives a namesake, old title and new', async () => {
    ownsRepertoireOf(ADVANCE);
    expect((await preview('en', ACCELERATED, INTO)).renamed).toEqual([
      advanceRenamed('2.\u00A0d4'),
    ]);
  });

  it('leaves out the existing chapters whose title stays', async () => {
    // The Classical keeps its own name; the Advance's move is where it
    // parts from every other chapter, the Classical's 3. Nc3 included.
    ownsRepertoireOf([CLASSICAL, ADVANCE].join('\n\n'));
    expect((await preview('en', ACCELERATED, INTO)).renamed).toEqual([
      advanceRenamed('3.\u00A0e5'),
    ]);
  });

  it('lists none when the language already names them apart', async () => {
    ownsRepertoireOf(ADVANCE);
    expect((await preview('en', TWO_KNIGHTS, INTO)).renamed).toEqual([]);
  });

  it('lists none for a new repertoire', async () => {
    const upload = [ADVANCE, TWO_KNIGHTS].join('\n\n');
    expect((await preview('lt', upload)).renamed).toEqual([]);
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
      await previewImport(account('lt'), { text: ADVANCE, side: 'black' }, NOW),
    ).toEqual(atLimit);
    expect(server.mayAdd).toHaveBeenCalledWith(DB, account('lt'));
  });

  // A 5,000-move file takes seconds to generate and import.
  it(
    'refuses a new repertoire of more than 5,000 moves',
    { timeout: 30_000 },
    async () => {
      expect(
        await previewImport(
          account('lt'),
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
    { timeout: 30_000 },
    async () => {
      const outcome = await previewImport(
        account('lt'),
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
    const p = await preview('en', ANNOTATED_ADVANCE, INTO);
    expect(p.refusal).toBeNull();
    expect(p.chapters).toEqual([]);
    expect(p.target?.added).toEqual({ chapters: 0, moves: 0, annotated: 3 });
    expect(p.annotations).toEqual([
      { move: '3. e5', comment: 'Space' },
      { move: '3... Bf5 ⩲', comment: null },
      { move: '4. Nf3', comment: 'Quiet' },
    ]);
  });

  it('lists none when the repertoire already has them, and refuses the file (R-115)', async () => {
    ownsRepertoireOf(ANNOTATED_ADVANCE);
    const p = await preview('en', ANNOTATED_ADVANCE, INTO);
    expect(p.refusal).toBe('pgn.nothingToAdd');
    expect(p.annotations).toEqual([]);
    expect(p.target?.added).toEqual({ chapters: 0, moves: 0, annotated: 0 });
  });

  it('lists none for a new repertoire: its comments come with its moves', async () => {
    expect((await preview('en', ANNOTATED_ADVANCE)).annotations).toEqual([]);
  });
});
