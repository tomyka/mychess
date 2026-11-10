import type { BroadcastMonthEntry, FoundGames } from '@mychess/db';
import {
  broadcastMonthSchema,
  fideIdSchema,
  type BroadcastMonth,
  type BroadcastMonthStatus,
} from '@mychess/domain';
import type { FidePlayer } from '@mychess/integrations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pollFideSearch, startFideSearch } from './fide-search';
import { readSearchToken, signSearchToken } from './fide-search-token';

const DB = { name: 'the db' };
const NOW = new Date('2026-11-10T10:00:00Z');
const SECRET = 'a-test-secret-of-at-least-32-characters!';
const ID = 13_400_002;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const month = (text: string): BroadcastMonth =>
  broadcastMonthSchema.parse(text);

/** The 14 months Lichess lists: 2025-09 to 2026-10, newest first. */
const LISTED = Array.from({ length: 14 }, (_, n) => {
  const d = new Date(Date.UTC(2026, 9 - n, 1));
  return month(d.toISOString().slice(0, 7));
});
const SEARCHED = LISTED.slice(0, 12);

const PLAYER: FidePlayer = {
  name: 'Jonaitis, Rokas',
  federation: 'LTU',
  title: null,
  standardRating: 2312,
};

const FOUND: FoundGames = {
  games: [
    {
      url: 'https://lichess.org/broadcast/x/round-1/abc/game1',
      month: month('2026-10'),
      date: '2026-10-14',
      event: 'Synthetic Open',
      eco: 'B12',
      opening: 'Caro-Kann Defense',
      colour: 'white',
      opponent: {
        name: 'Testas, Jonas',
        fideId: fideIdSchema.parse(90_000_002),
      },
      outcome: 'win',
    },
  ],
  truncated: false,
};

const server = vi.hoisted(() => ({
  counted:
    vi.fn<
      (db: unknown, key: string, rule: unknown, now: Date) => Promise<unknown>
    >(),
  statuses:
    vi.fn<(db: unknown, months: readonly string[]) => Promise<unknown>>(),
  games:
    vi.fn<
      (db: unknown, id: number, months: readonly string[]) => Promise<unknown>
    >(),
  need: vi.fn<(months: readonly string[]) => void>(),
  months: vi.fn<() => Promise<readonly string[]>>(),
  player: vi.fn<(id: number) => Promise<unknown>>(),
}));

vi.mock('@mychess/db', () => ({
  countRateLimited: server.counted,
  broadcastMonthStatuses: server.statuses,
  gamesForFideId: server.games,
}));
vi.mock('./db', () => ({ getDb: () => DB }));
vi.mock('./fide-services', () => ({
  fideServices: () => ({
    runner: { need: server.need, settled: () => Promise.resolve() },
    sources: { months: server.months, player: server.player },
    secret: 'a-test-secret-of-at-least-32-characters!',
  }),
}));

/** The months' entries with `statuses` by month, pending otherwise. */
function entries(
  statuses: Readonly<Record<string, BroadcastMonthStatus>>,
): (db: unknown, months: readonly string[]) => Promise<BroadcastMonthEntry[]> {
  return (_db, months) =>
    Promise.resolve(
      months.map((m) => ({
        month: month(m),
        status: statuses[m] ?? {
          state: 'pending',
          attempts: 0,
          lastFailedAt: null,
        },
      })),
    );
}

const DONE: BroadcastMonthStatus = {
  state: 'done',
  attempts: 1,
  since: ago(DAY),
};

const allDone = Object.fromEntries(SEARCHED.map((m) => [m, DONE]));

const form = (raw: string) => {
  const data = new FormData();
  data.set('fideId', raw);
  return data.get('fideId');
};

const logs = {
  error: vi.spyOn(console, 'error'),
  warn: vi.spyOn(console, 'warn'),
  log: vi.spyOn(console, 'log'),
  info: vi.spyOn(console, 'info'),
};

beforeEach(() => {
  server.counted.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.statuses.mockReset().mockImplementation(entries(allDone));
  server.games.mockReset().mockResolvedValue(FOUND);
  server.need.mockReset();
  server.months.mockReset().mockResolvedValue(LISTED);
  server.player.mockReset().mockResolvedValue(PLAYER);
  for (const spy of Object.values(logs)) spy.mockClear();
});

async function started(raw = String(ID)) {
  const state = await startFideSearch('rokas', form(raw), NOW);
  if (state.kind !== 'started')
    throw new Error(`refused: ${JSON.stringify(state)}`);
  return state.search;
}

describe('starting a FIDE ID search', () => {
  it.each([
    ['', 'fide.idBlank'],
    ['12a', 'fide.idInvalid'],
    ['0123', 'fide.idInvalid'],
    ['1234567890', 'fide.idTooLong'],
  ])(
    'refuses %j with %s, counting and fetching nothing',
    async (raw, refusal) => {
      expect(await startFideSearch('rokas', form(raw), NOW)).toEqual({
        kind: 'refused',
        refusal,
      });
      expect(server.counted).not.toHaveBeenCalled();
      expect(server.months).not.toHaveBeenCalled();
      expect(server.player).not.toHaveBeenCalled();
      expect(server.statuses).not.toHaveBeenCalled();
    },
  );

  it('reads a missing field as blank', async () => {
    expect(await startFideSearch('rokas', null, NOW)).toEqual({
      kind: 'refused',
      refusal: 'fide.idBlank',
    });
  });

  it('counts the search against the account, never the ID', async () => {
    await started();
    expect(server.counted).toHaveBeenCalledExactlyOnceWith(
      DB,
      'fide-search:rokas',
      { windowMs: 60_000, max: 10, reason: 'fide.tooManySearches' },
      NOW,
    );
  });

  it('refuses past the limit before any lookup or download', async () => {
    server.counted.mockResolvedValue({
      ok: false,
      refusal: { reason: 'fide.tooManySearches', limit: 10 },
    });
    expect(await startFideSearch('rokas', form(String(ID)), NOW)).toEqual({
      kind: 'refused',
      refusal: 'fide.tooManySearches',
      limit: 10,
    });
    expect(server.months).not.toHaveBeenCalled();
    expect(server.player).not.toHaveBeenCalled();
    expect(server.statuses).not.toHaveBeenCalled();
    expect(server.need).not.toHaveBeenCalled();
  });

  it('is refused as unavailable when the month list cannot be read', async () => {
    server.months.mockRejectedValue(new Error('offline'));
    expect(await startFideSearch('rokas', form(String(ID)), NOW)).toEqual({
      kind: 'refused',
      refusal: 'fide.searchUnavailable',
    });
  });

  it('covers the 12 newest months and shows the player and games of ready ones', async () => {
    const search = await started(` ${String(ID)} `);
    expect(server.statuses).toHaveBeenCalledExactlyOnceWith(DB, SEARCHED);
    expect(server.games).toHaveBeenCalledExactlyOnceWith(DB, ID, SEARCHED);
    expect(server.player).toHaveBeenCalledExactlyOnceWith(ID);
    const { token, ...shown } = search;
    expect(readSearchToken(SECRET, token, 'rokas', NOW)).toEqual({
      ok: true,
      value: { fideId: ID, months: SEARCHED },
    });
    expect(shown).toEqual({
      fideId: ID,
      player: PLAYER,
      snapshot: {
        progress: { total: 12, ready: 12, waiting: 0, unavailable: 0 },
        games: FOUND.games,
        truncated: false,
      },
    });
    expect(server.need).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('goes on without the header when the player is not known', async () => {
    server.player.mockResolvedValue(null);
    expect((await started()).player).toBeNull();
  });

  it('judges each month by its next action, not its stored state', async () => {
    const [m0, m1, m2, m3, m4, m5, m6] = SEARCHED.map(String);
    server.statuses.mockImplementation(
      entries({
        ...allDone,
        [m0 ?? '']: { state: 'pending', attempts: 0, lastFailedAt: null },
        [m1 ?? '']: { state: 'processing', attempts: 1, since: ago(MINUTE) },
        // A processing month left over 15 minutes: its process crashed,
        // and the 10-minute pause after that failure is over (R-188).
        [m2 ?? '']: {
          state: 'processing',
          attempts: 1,
          since: ago(26 * MINUTE),
        },
        [m3 ?? '']: { state: 'failed', attempts: 3, since: ago(DAY - MINUTE) },
        [m4 ?? '']: { state: 'failed', attempts: 3, since: ago(DAY) },
        [m5 ?? '']: { state: 'done', attempts: 2, since: ago(MINUTE) },
        // Failed a minute ago: waits, and is not handed to the runner yet.
        [m6 ?? '']: {
          state: 'pending',
          attempts: 1,
          lastFailedAt: ago(MINUTE),
        },
      }),
    );
    const search = await started();
    expect(search.snapshot.progress).toEqual({
      total: 12,
      ready: 6,
      waiting: 5,
      unavailable: 1,
    });
    expect(server.need).toHaveBeenCalledExactlyOnceWith([m0, m2, m4]);
    expect(server.games.mock.lastCall?.[2]).toEqual([
      SEARCHED[5],
      ...SEARCHED.slice(7),
    ]);
  });

  it('counts only the months Lichess lists, when fewer than 12', async () => {
    server.months.mockResolvedValue(LISTED.slice(0, 3));
    expect((await started()).snapshot.progress.total).toBe(3);
  });

  it('carries the truncated flag of the games', async () => {
    server.games.mockResolvedValue({ ...FOUND, truncated: true });
    expect((await started()).snapshot.truncated).toBe(true);
  });
});

describe('polling a started search', () => {
  it('answers with the progress of the search the token names', async () => {
    const { token } = await started();
    server.statuses.mockClear();
    server.counted.mockClear();
    server.months.mockClear();
    server.statuses.mockImplementation(
      entries({
        ...allDone,
        [String(SEARCHED[0])]: {
          state: 'pending',
          attempts: 1,
          lastFailedAt: ago(11 * MINUTE),
        },
      }),
    );
    expect(await pollFideSearch('rokas', token, NOW)).toEqual({
      kind: 'progress',
      snapshot: {
        progress: { total: 12, ready: 11, waiting: 1, unavailable: 0 },
        games: FOUND.games,
        truncated: false,
      },
    });
    expect(server.statuses).toHaveBeenCalledExactlyOnceWith(DB, SEARCHED);
    expect(server.need).toHaveBeenLastCalledWith([SEARCHED[0]]);
    expect(server.counted).not.toHaveBeenCalled();
    expect(server.months).not.toHaveBeenCalled();
  });

  it('is expired for another account’s token, reading nothing', async () => {
    const { token } = await started();
    server.statuses.mockClear();
    expect(await pollFideSearch('gabija', token, NOW)).toEqual({
      kind: 'expired',
    });
    expect(server.statuses).not.toHaveBeenCalled();
  });

  it('is expired for a forged or old token', async () => {
    const old = signSearchToken(
      SECRET,
      { accountId: 'rokas', fideId: fideIdSchema.parse(ID), months: SEARCHED },
      ago(2 * 60 * MINUTE),
    );
    expect(await pollFideSearch('rokas', old, NOW)).toEqual({
      kind: 'expired',
    });
    expect(await pollFideSearch('rokas', 'x.y', NOW)).toEqual({
      kind: 'expired',
    });
    expect(server.statuses).not.toHaveBeenCalled();
  });
});

describe('logging', () => {
  it('writes no line holding the searched ID, whatever happens', async () => {
    const { token } = await started();
    await pollFideSearch('rokas', token, NOW);
    server.months.mockRejectedValue(new Error('offline'));
    await startFideSearch('rokas', form(String(ID)), NOW);
    const lines = Object.values(logs).flatMap((spy) =>
      spy.mock.calls.map((call) => JSON.stringify(call)),
    );
    expect(lines.filter((line) => line.includes(String(ID)))).toEqual([]);
  });
});

describe('a failing database (security M1)', () => {
  /** An error as a failed query reports it: its parameters, the ID among them. */
  const leaky = () =>
    new Error(`Failed query: select ... params: ${String(ID)}`);

  const logged = () =>
    Object.values(logs).flatMap((spy) =>
      spy.mock.calls.map((call) => JSON.stringify(call)),
    );

  it('answers a start whose game search fails as unavailable, logging a fixed line', async () => {
    server.games.mockRejectedValue(leaky());
    expect(await startFideSearch('rokas', form(String(ID)), NOW)).toEqual({
      kind: 'refused',
      refusal: 'fide.searchUnavailable',
    });
    expect(logged()).toEqual([JSON.stringify(['fide: search failed'])]);
  });

  it('answers a start whose count or month states fail as unavailable', async () => {
    server.counted.mockRejectedValue(leaky());
    expect(await startFideSearch('rokas', form(String(ID)), NOW)).toEqual({
      kind: 'refused',
      refusal: 'fide.searchUnavailable',
    });
    server.counted.mockResolvedValue({ ok: true, value: undefined });
    server.statuses.mockRejectedValue(leaky());
    expect((await startFideSearch('rokas', form(String(ID)), NOW)).kind).toBe(
      'refused',
    );
    expect(logged().filter((line) => line.includes(String(ID)))).toEqual([]);
  });

  it('answers a poll that fails as failed, for the page to try again', async () => {
    const { token } = await started();
    server.games.mockRejectedValue(leaky());
    expect(await pollFideSearch('rokas', token, NOW)).toEqual({
      kind: 'failed',
    });
    expect(logged()).toEqual([JSON.stringify(['fide: search failed'])]);
  });
});
