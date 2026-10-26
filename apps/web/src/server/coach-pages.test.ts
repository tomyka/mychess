import type { LinkedAccount } from '@mychess/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coachHomeData, coachPlayerData } from './coach-pages';
import type { PlayerProgressSection } from './coach-progress';

// The loaders' reads against a real database, and their access checks,
// are covered by the feature suite; this covers what S7 adds to them.
const DB = { name: 'the db' };
// 10:00 in Vilnius on 20 October.
const NOW = new Date('2026-10-20T07:00:00Z');
const JONAS = { id: 'jonas', locale: 'lt' };

const server = vi.hoisted(() => ({
  coach: vi.fn<() => Promise<unknown>>(),
  assert: vi.fn<(...args: unknown[]) => Promise<void>>(),
  players: vi.fn<(...args: unknown[]) => Promise<LinkedAccount[]>>(),
  groups: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  invites: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  lastTrained: vi.fn<(...args: unknown[]) => Promise<Map<string, Date>>>(),
  player: vi.fn<(...args: unknown[]) => Promise<LinkedAccount | undefined>>(),
  shared: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
  progress: vi.fn<(...args: unknown[]) => Promise<PlayerProgressSection>>(),
}));

vi.mock('@mychess/db', () => ({
  coachPlayers: server.players,
  coachGroups: server.groups,
  coachInvites: server.invites,
  coachLastTrained: server.lastTrained,
  coachPlayer: server.player,
  sharedWithCoach: server.shared,
}));
vi.mock('./coaching', () => ({
  requireCoach: server.coach,
  assertCoachMaySee: server.assert,
}));
vi.mock('./coach-progress', () => ({ playerProgressData: server.progress }));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const account = (id: string, displayName: string): LinkedAccount => ({
  id,
  displayName,
  linkedAt: NOW,
  groups: [],
});
const ROKAS = account('rokas', 'Rokas');
const GABIJA = account('gabija', 'Gabija');
const SECTION: PlayerProgressSection = { rows: [], lastTrainedDays: 3 };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.coach.mockReset().mockResolvedValue(JONAS);
  server.assert.mockReset().mockResolvedValue(undefined);
  server.players.mockReset().mockResolvedValue([ROKAS, GABIJA]);
  server.groups.mockReset().mockResolvedValue([]);
  server.invites.mockReset().mockResolvedValue([]);
  server.lastTrained.mockReset();
  server.player.mockReset().mockResolvedValue(ROKAS);
  server.shared.mockReset().mockResolvedValue([]);
  server.progress.mockReset().mockResolvedValue(SECTION);
  return () => {
    vi.useRealTimers();
  };
});

describe('coachHomeData', () => {
  it('gives each player the Vilnius days since they last trained, in one read', async () => {
    // 23:30 in Vilnius on 19 October: yesterday.
    server.lastTrained.mockResolvedValue(
      new Map([['rokas', new Date('2026-10-19T20:30:00Z')]]),
    );
    const home = await coachHomeData();
    expect(home.players).toEqual([
      { ...ROKAS, lastTrainedDays: 1 },
      { ...GABIJA, lastTrainedDays: null },
    ]);
    expect(server.lastTrained).toHaveBeenCalledExactlyOnceWith(DB, 'jonas', [
      'rokas',
      'gabija',
    ]);
  });
});

describe('coachPlayerData', () => {
  it('adds the progress section, read only after the access check', async () => {
    const page = await coachPlayerData('rokas');
    expect(page).toEqual({ ...ROKAS, repertoires: [], progress: SECTION });
    // The loader's own coach, parsed id and clock: no second session read.
    expect(server.progress).toHaveBeenCalledExactlyOnceWith(
      JONAS,
      'rokas',
      NOW,
    );
    expect(server.coach).toHaveBeenCalledOnce();
    expect(server.assert).toHaveBeenCalledWith(JONAS, 'rokas', {
      kind: 'profile',
    });
    expect(server.assert).toHaveBeenCalledBefore(server.progress);
  });

  it('reads no progress when the access check refuses', async () => {
    server.assert.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(coachPlayerData('rokas')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(server.progress).not.toHaveBeenCalled();
  });
});
