import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  knowCountAction,
  learnAgainAction,
  markKnownAction,
} from './know-actions';

const DB = { name: 'the db' };
const NOW = new Date('2026-10-26T08:00:00Z');
const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const KEY = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -|d4';

const server = vi.hoisted(() => ({
  counts:
    vi.fn<
      (
        db: unknown,
        playerId: string,
        scope: unknown,
      ) => Promise<{ know: number; again: number } | undefined>
    >(),
  mark: vi.fn<(...args: unknown[]) => Promise<number | undefined>>(),
  again: vi.fn<(...args: unknown[]) => Promise<number | undefined>>(),
  refresh: vi.fn(),
}));

vi.mock('@mychess/db', () => ({
  knowCounts: server.counts,
  markKnown: server.mark,
  learnAgain: server.again,
}));
vi.mock('next/cache', () => ({ refresh: server.refresh }));
vi.mock('../../server/db', () => ({ getDb: () => DB }));
vi.mock('../../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas' }),
}));

/** A form with `fields`, as the menu posts it. */
function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

const MOVE = { kind: 'move', repertoireId: ID, moveKey: KEY } as const;
const LINE = {
  kind: 'line',
  repertoireId: ID,
  chapterId: 'c1',
  lineIndex: '2',
} as const;
const CHAPTER = { kind: 'chapter', repertoireId: ID, chapterId: 'c1' } as const;

const NOT_TRAINED = { ok: false, refusal: 'training.notTrained' };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.counts.mockReset().mockResolvedValue({ know: 5, again: 2 });
  server.mark.mockReset().mockResolvedValue(5);
  server.again.mockReset().mockResolvedValue(2);
  server.refresh.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('knowCountAction (R-147)', () => {
  it('counts both actions for the session player, the line parsed', async () => {
    expect(await knowCountAction(formOf(LINE))).toEqual({
      ok: true,
      know: 5,
      again: 2,
    });
    const scope = {
      kind: 'line',
      repertoireId: ID,
      chapterId: 'c1',
      lineIndex: 2,
    };
    expect(server.counts).toHaveBeenCalledTimes(1);
    expect(server.counts).toHaveBeenCalledWith(DB, 'rokas', scope);
  });

  it('ignores a player id sent with the form', async () => {
    await knowCountAction(formOf({ ...CHAPTER, playerId: 'gabija' }));
    expect(server.counts).toHaveBeenCalledWith(DB, 'rokas', {
      kind: 'chapter',
      repertoireId: ID,
      chapterId: 'c1',
    });
  });

  it('refuses a repertoire the player does not train', async () => {
    server.counts.mockResolvedValue(undefined);
    expect(await knowCountAction(formOf(MOVE))).toEqual(NOT_TRAINED);
  });
});

describe('markKnownAction (R-58)', () => {
  it('marks the move for the session player now, then refreshes', async () => {
    expect(await markKnownAction(formOf(MOVE))).toEqual({
      ok: true,
      changed: 5,
    });
    expect(server.mark).toHaveBeenCalledExactlyOnceWith(
      DB,
      'rokas',
      { kind: 'move', repertoireId: ID, moveKey: KEY },
      NOW,
    );
    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('refuses a foreign or paused repertoire and refreshes nothing', async () => {
    server.mark.mockResolvedValue(undefined);
    expect(await markKnownAction(formOf(CHAPTER))).toEqual(NOT_TRAINED);
    expect(server.refresh).not.toHaveBeenCalled();
  });
});

describe('learnAgainAction (R-147)', () => {
  it('returns the skipped moves for the session player', async () => {
    expect(await learnAgainAction(formOf(LINE))).toEqual({
      ok: true,
      changed: 2,
    });
    expect(server.again).toHaveBeenCalledExactlyOnceWith(DB, 'rokas', {
      kind: 'line',
      repertoireId: ID,
      chapterId: 'c1',
      lineIndex: 2,
    });
    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it('refuses a repertoire the player does not train', async () => {
    server.again.mockResolvedValue(undefined);
    expect(await learnAgainAction(formOf(MOVE))).toEqual(NOT_TRAINED);
  });
});

describe('the scope a form names', () => {
  it.each([
    ['an unknown kind', { ...CHAPTER, kind: 'repertoire' }],
    ['a repertoire id that is not a uuid', { ...CHAPTER, repertoireId: 'r1' }],
    ['a negative line', { ...LINE, lineIndex: '-1' }],
    ['a fractional line', { ...LINE, lineIndex: '1.5' }],
    ['an empty line', { ...LINE, lineIndex: '' }],
    ['a line without a chapter', { ...LINE, chapterId: '' }],
    ['a move without a key', { kind: 'move', repertoireId: ID }],
  ])('refuses %s without reading or writing', async (_name, fields) => {
    const form = formOf(fields);
    expect(await knowCountAction(form)).toEqual(NOT_TRAINED);
    expect(await markKnownAction(form)).toEqual(NOT_TRAINED);
    expect(await learnAgainAction(form)).toEqual(NOT_TRAINED);
    expect(server.counts).not.toHaveBeenCalled();
    expect(server.mark).not.toHaveBeenCalled();
    expect(server.again).not.toHaveBeenCalled();
  });
});
