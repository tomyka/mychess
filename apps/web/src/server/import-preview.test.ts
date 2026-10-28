import { importPgn, type RepertoireGraph } from '@mychess/chess';
import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  previewImport,
  type ImportPreview,
  type PreviewOutcome,
} from './import-preview';

const NOW = new Date('2026-10-28T09:00:00Z');
const INTO = '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4';

const server = vi.hoisted(() => ({
  own: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  countRateLimited: () => Promise.resolve({ ok: true }),
  createRepertoire: vi.fn(),
  editRepertoire: vi.fn(),
}));
vi.mock('./db', () => ({ getDb: () => ({}) }));
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
});

describe('previewImport chapter titles (R-158)', () => {
  const upload = [ADVANCE, CLASSICAL, TWO_KNIGHTS].join('\n\n');

  it('tells apart the chapters a file brings that share a name', async () => {
    expect(await titles('lt', upload)).toEqual([
      'Karo-Kano gynyba (B12, 3.\u00A0e5)',
      'Karo-Kano gynyba, Klasikinis variantas',
      'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    ]);
  });

  it('keeps them plain where the language names them apart', async () => {
    expect(await titles('en', upload)).toEqual([
      'Caro-Kann Defense',
      'Caro-Kann Defense: Classical Variation',
      'Caro-Kann Defense: Two Knights Attack, Mindeno Variation',
    ]);
  });

  it('titles a merge’s new chapters as the merged repertoire names them', async () => {
    ownsRepertoireOf(ADVANCE);
    // Alone, the Two Knights would be plain; beside the repertoire's
    // Advance it is told apart.
    expect(await titles('lt', TWO_KNIGHTS)).toEqual(['Karo-Kano gynyba']);
    expect(await titles('lt', TWO_KNIGHTS, INTO)).toEqual([
      'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    ]);
  });
});

describe('previewImport renamed chapters (R-159)', () => {
  /** The Advance, told apart at `move` from the Two Knights it gains. */
  const advanceRenamed = (move: string) => ({
    from: 'Karo-Kano gynyba',
    to: `Karo-Kano gynyba (B12, ${move})`,
  });

  it('lists an existing chapter a merge gives a namesake, old title and new', async () => {
    ownsRepertoireOf(ADVANCE);
    expect((await preview('lt', TWO_KNIGHTS, INTO)).renamed).toEqual([
      advanceRenamed('2.\u00A0d4'),
    ]);
  });

  it('leaves out the existing chapters whose title stays', async () => {
    // The Classical keeps its own name; the Advance's move is where it
    // parts from every other chapter, the Classical's 3. Nc3 included.
    ownsRepertoireOf([CLASSICAL, ADVANCE].join('\n\n'));
    expect((await preview('lt', TWO_KNIGHTS, INTO)).renamed).toEqual([
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
