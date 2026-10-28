import type {
  GroupProgress,
  GroupProgressCell,
  PlayerProgress,
  ProgressRow,
  RepertoireProgressView,
} from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coachProgressData,
  groupProgressData,
  playerProgressData,
} from './coach-progress';

const PLAYER = 'rokas';
const REPERTOIRE = '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4';
const GROUP = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const DB = { name: 'the db' };
// 10:00 in Vilnius on 20 October.
const NOW = new Date('2026-10-20T07:00:00Z');
// 23:30 in Vilnius on 18 October, 20:30 UTC: two Vilnius days before NOW.
const TWO_DAYS_AGO = new Date('2026-10-18T20:30:00Z');

const server = vi.hoisted(() => ({
  coach: vi.fn<() => Promise<unknown>>(),
  player: vi.fn<(...args: unknown[]) => Promise<PlayerProgress | undefined>>(),
  repertoire:
    vi.fn<
      (...args: unknown[]) => Promise<RepertoireProgressView | undefined>
    >(),
  group: vi.fn<(...args: unknown[]) => Promise<GroupProgress | undefined>>(),
}));

vi.mock('@mychess/db', () => ({
  coachPlayerProgress: server.player,
  coachRepertoireProgress: server.repertoire,
  coachGroupProgress: server.group,
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

const ROW: ProgressRow = {
  repertoire: REF,
  source: 'assigned',
  badges: BADGES,
  view: { kind: 'granted', standing: { counts: COUNTS, mastered: false } },
};

const VIEW: RepertoireProgressView = {
  player: { id: PLAYER, displayName: 'Rokas' },
  repertoire: REF,
  badges: BADGES,
  progress: {
    counts: COUNTS,
    mastered: false,
    chapters: [
      {
        chapter: {
          id: 'ch1',
          rootKey: 'k',
          intro: null,
          nameSource: { kind: 'header', name: 'Advance' },
        },
        whiteFirst: true,
        counts: COUNTS,
        mastered: true,
        lines: [{ sans: ['e4'], counts: COUNTS, mastered: true }],
      },
    ],
  },
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.coach.mockReset().mockResolvedValue(JONAS);
  server.player.mockReset();
  server.repertoire.mockReset();
  server.group.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('playerProgressData', () => {
  // The caller's instant, a day after the clock: the read and the days
  // ago both use it.
  const LATER = new Date('2026-10-21T07:00:00Z');

  it('reads the caller’s coach’s view of the player at the caller’s now', async () => {
    server.player.mockResolvedValue({ rows: [ROW], lastTrained: TWO_DAYS_AGO });
    expect(await playerProgressData(JONAS, PLAYER, LATER)).toEqual({
      rows: [ROW],
      lastTrainedDays: 3,
    });
    expect(server.player).toHaveBeenCalledWith(DB, 'jonas', PLAYER, LATER);
    expect(server.coach).not.toHaveBeenCalled();
  });

  it('keeps never trained as null', async () => {
    server.player.mockResolvedValue({ rows: [], lastTrained: null });
    expect(await playerProgressData(JONAS, PLAYER, NOW)).toEqual({
      rows: [],
      lastTrainedDays: null,
    });
  });

  it('is 404 when the read refuses (the link went in between)', async () => {
    server.player.mockResolvedValue(undefined);
    await expect(playerProgressData(JONAS, PLAYER, NOW)).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });
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
});

describe('groupProgressData', () => {
  it('reads the session coach’s group and turns last trained into Vilnius days ago', async () => {
    const cell: GroupProgressCell = {
      badges: BADGES,
      view: { kind: 'forked' },
    };
    server.group.mockResolvedValue({
      columns: [REF],
      rows: [
        {
          player: { id: PLAYER, displayName: 'Rokas' },
          lastTrained: NOW,
          cells: [cell],
        },
        {
          player: { id: 'gabija', displayName: 'Gabija' },
          lastTrained: null,
          cells: [null],
        },
      ],
    });
    expect(await groupProgressData(GROUP)).toEqual({
      columns: [REF],
      rows: [
        {
          player: { id: PLAYER, displayName: 'Rokas' },
          lastTrainedDays: 0,
          cells: [cell],
        },
        {
          player: { id: 'gabija', displayName: 'Gabija' },
          lastTrainedDays: null,
          cells: [null],
        },
      ],
    });
    expect(server.group).toHaveBeenCalledWith(DB, 'jonas', GROUP, NOW);
  });

  it('is 404 for a malformed group id without reading', async () => {
    await expect(groupProgressData('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(server.group).not.toHaveBeenCalled();
  });

  it('is 404 for any group but the coach’s own', async () => {
    server.group.mockResolvedValue(undefined);
    await expect(groupProgressData(GROUP)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
