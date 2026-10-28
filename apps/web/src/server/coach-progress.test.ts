import { importPgn, type Chapter, type RepertoireGraph } from '@mychess/chess';
import type { RepertoireProgressView } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachProgressData } from './coach-progress';

const PLAYER = 'rokas';
const REPERTOIRE = '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4';
const DB = { name: 'the db' };
// 10:00 in Vilnius on 20 October.
const NOW = new Date('2026-10-20T07:00:00Z');

const server = vi.hoisted(() => ({
  coach: vi.fn<() => Promise<unknown>>(),
  repertoire:
    vi.fn<
      (...args: unknown[]) => Promise<RepertoireProgressView | undefined>
    >(),
}));

vi.mock('@mychess/db', () => ({
  coachRepertoireProgress: server.repertoire,
}));
vi.mock('./coaching', () => ({ requireCoach: server.coach }));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const JONAS = { id: 'jonas', locale: 'lt' };
const COUNTS = { notStarted: 1, skipped: 2, due: 3, learned: 4 };
const REF = { id: REPERTOIRE, name: 'Karo-Kan', side: 'black' } as const;
const BADGES = { overdue: true, paused: false, forked: false, updated: false };

const ADVANCE: Chapter = {
  id: 'ch1',
  rootKey: 'k',
  intro: null,
  nameSource: { kind: 'header', name: 'Advance' },
};

const VIEW: RepertoireProgressView = {
  player: { id: PLAYER, displayName: 'Rokas' },
  repertoire: REF,
  graph: { side: 'black', chapters: [ADVANCE], moves: [] },
  badges: BADGES,
  progress: {
    counts: COUNTS,
    mastered: false,
    chapters: [
      {
        chapter: ADVANCE,
        whiteFirst: true,
        counts: COUNTS,
        mastered: true,
        lines: [{ sans: ['e4'], counts: COUNTS, mastered: true }],
      },
    ],
  },
};

/**
 * Three Caro-Kann chapters, each named after its opening on import; the
 * Advance (B12) and the Two Knights (B11) share their Lithuanian name.
 */
function caroKann(): RepertoireGraph {
  const imported = importPgn(
    [
      '1. e4 c6 2. d4 d5 3. e5 Bf5 *',
      '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 *',
      '1. e4 c6 2. Nc3 d5 3. Nf3 Bg4 *',
    ].join('\n\n'),
    'black',
  );
  if (!imported.ok) throw new Error(imported.refusal.reason);
  return imported.value.graph;
}

/** `VIEW` over `graph`: each chapter with `VIEW`'s counts and no lines. */
const viewOf = (graph: RepertoireGraph): RepertoireProgressView => ({
  ...VIEW,
  graph,
  progress: {
    ...VIEW.progress,
    chapters: graph.chapters.map((chapter) => ({
      chapter,
      whiteFirst: true,
      counts: COUNTS,
      mastered: false,
      lines: [],
    })),
  },
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.coach.mockReset().mockResolvedValue(JONAS);
  server.repertoire.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('coachProgressData', () => {
  it('asks for the session coach’s view, never a client’s coach', async () => {
    server.repertoire.mockResolvedValue(VIEW);
    await coachProgressData(PLAYER, REPERTOIRE);
    expect(server.coach).toHaveBeenCalledOnce();
    expect(server.repertoire).toHaveBeenCalledWith(
      DB,
      { coachId: 'jonas', playerId: PLAYER, repertoireId: REPERTOIRE },
      NOW,
    );
  });

  it('is 404 for a malformed repertoire id without reading', async () => {
    await expect(coachProgressData(PLAYER, 'nope')).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(server.repertoire).not.toHaveBeenCalled();
  });

  it('is 404 for a malformed player id without reading', async () => {
    await expect(coachProgressData('', REPERTOIRE)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(server.repertoire).not.toHaveBeenCalled();
  });

  it('is 404 when the read refuses (unlinked, private, forked)', async () => {
    server.repertoire.mockResolvedValue(undefined);
    await expect(coachProgressData(PLAYER, REPERTOIRE)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('gives the standing and names each chapter in the coach’s locale', async () => {
    server.repertoire.mockResolvedValue(VIEW);
    expect(await coachProgressData(PLAYER, REPERTOIRE)).toEqual({
      player: { id: PLAYER, displayName: 'Rokas' },
      repertoire: REF,
      badges: BADGES,
      standing: { counts: COUNTS, mastered: false },
      chapters: [
        {
          id: 'ch1',
          title: 'Advance',
          whiteFirst: true,
          counts: COUNTS,
          mastered: true,
          lines: [{ sans: ['e4'], counts: COUNTS, mastered: true }],
        },
      ],
    });
  });

  it('tells apart chapters named after the same opening (R-158)', async () => {
    server.repertoire.mockResolvedValue(viewOf(caroKann()));
    const page = await coachProgressData(PLAYER, REPERTOIRE);
    expect(page.chapters.map((chapter) => chapter.title)).toEqual([
      'Karo-Kano gynyba (B12, 3.\u00A0e5)',
      'Karo-Kano gynyba, Klasikinis variantas',
      'Karo-Kano gynyba (B11, 2.\u00A0Nc3)',
    ]);
  });

  it('keeps titles plain where the coach’s language names them apart', async () => {
    server.coach.mockResolvedValue({ ...JONAS, locale: 'en' });
    server.repertoire.mockResolvedValue(viewOf(caroKann()));
    const page = await coachProgressData(PLAYER, REPERTOIRE);
    expect(page.chapters.map((chapter) => chapter.title)).toEqual([
      'Caro-Kann Defense',
      'Caro-Kann Defense: Classical Variation',
      'Caro-Kann Defense: Two Knights Attack, Mindeno Variation',
    ]);
  });
});
