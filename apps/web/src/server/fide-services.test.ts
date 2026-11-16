import { BROADCAST_LIST_URL, broadcastDumpUrl } from '@mychess/integrations';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAKE_LICHESS_TOKEN,
  fakeLichessApi,
  toursPageJson,
} from '../../test/fixtures/lichess-broadcast-api';
import type { BroadcastIndex, BroadcastRunnerDeps } from './broadcast-runner';
import type { BroadcastTourIndex } from './broadcast-tour-job';
import { composeFideServices, fideServices } from './fide-services';
import type { FideStore } from './fide-store';
import { readSearchToken } from './fide-search-token';

const SECRET = 'the-auth-secret-of-at-least-32-characters';
const NOW = new Date('2026-11-16T03:00:00Z');

const { server, recorded } = vi.hoisted(() => {
  const state: {
    env: Record<string, unknown>;
    runners: BroadcastRunnerDeps[];
    db: Record<string, unknown[][]>;
  } = { env: {}, runners: [], db: {} };
  /** A repository function of @mychess/db that records the calls it gets. */
  const record =
    (name: string, answer: unknown) =>
    (...args: unknown[]): Promise<unknown> => {
      (state.db[name] ??= []).push(args);
      return Promise.resolve(answer);
    };
  return { server: state, recorded: record };
});

vi.mock('./db', () => ({ getDb: () => ({ name: 'the db' }) }));
// The repositories have their own tests; here only that each use case
// reaches them on the services' database. Mocking them also keeps the
// database driver out of this file's module graph, so a reload stays light.
vi.mock('@mychess/db', () => ({
  countRateLimited: recorded('countRateLimited', { ok: true }),
  broadcastMonthStatuses: (_db: unknown, months: readonly string[]) =>
    recorded('broadcastMonthStatuses', [])(_db, months).then(() =>
      months.map((month) => ({
        month,
        status: { state: 'done', attempts: 1, since: new Date(0) },
      })),
    ),
  gamesForFideId: recorded('gamesForFideId', { games: [], truncated: false }),
  queueBroadcastTour: recorded('queueBroadcastTour', true),
  broadcastTourStatuses: recorded('broadcastTourStatuses', []),
}));
vi.mock('./broadcast-tour-job', () => ({
  broadcastTourIndexOn: () => ({ name: 'the tour index' }),
}));
vi.mock('./env', () => ({ readWebEnv: () => server.env }));
// The runner has its own tests; here only what it is built with matters.
vi.mock('./broadcast-runner', () => ({
  broadcastIndexOn: () => ({ name: 'the index' }),
  createBroadcastRunner: (deps: BroadcastRunnerDeps) => {
    server.runners.push(deps);
    return {
      need: () => undefined,
      needTours: () => undefined,
      settled: () => Promise.resolve(),
    };
  },
}));

const network = vi.fn<typeof fetch>(() =>
  Promise.reject(new Error('the network is not used in this test')),
);

const LOCAL = {
  BETTER_AUTH_SECRET: SECRET,
  MYCHESS_ENV: 'local',
  MYCHESS_TEST_SIGNIN: false,
};

beforeEach(() => {
  globalThis.mychessFideServices = undefined;
  server.env = LOCAL;
  server.runners = [];
  server.db = {};
  network.mockClear();
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The fetch the one runner built so far was given. */
function runnerFetch(): BroadcastRunnerDeps['fetch'] {
  const [deps] = server.runners;
  if (deps === undefined) throw new Error('no runner was built');
  return deps.fetch;
}

/** A store whose every repository records that it was called. */
function fakeStore(): { store: FideStore; used: string[] } {
  const used: string[] = [];
  const answering =
    <T>(name: string, answer: T) =>
    (): Promise<T> => {
      used.push(name);
      return Promise.resolve(answer);
    };
  // The runner is mocked here: its indexes are only handed over.
  const monthIndex = {
    claim: vi.fn<BroadcastIndex['claim']>(),
    write: vi.fn<BroadcastIndex['write']>(),
    fail: vi.fn<BroadcastIndex['fail']>(),
    release: vi.fn<BroadcastIndex['release']>(),
  };
  const tourIndex = {
    claim: vi.fn<BroadcastTourIndex['claim']>(),
    write: vi.fn<BroadcastTourIndex['write']>(),
    fail: vi.fn<BroadcastTourIndex['fail']>(),
    release: vi.fn<BroadcastTourIndex['release']>(),
  };
  return {
    used,
    store: {
      count: answering('count', { ok: true, value: undefined } as const),
      monthStatuses: (months) => {
        used.push('monthStatuses');
        return Promise.resolve(
          months.map((month) => ({
            month,
            status: { state: 'done', attempts: 1, since: NOW },
          })),
        );
      },
      games: answering('games', { games: [], truncated: false }),
      queueTour: answering('queueTour', true),
      tourStatuses: answering('tourStatuses', []),
      prune: answering('prune', { months: 0, tours: 0 }),
      monthIndex,
      tourIndex,
    },
  };
}

/** Lichess: the month list, and the broadcast API with the token. */
function lichess() {
  const api = fakeLichessApi({
    'by/vakarinis?page=1': [{ json: toursPageJson([], null) }],
    'by/kesnor7?page=1': [{ json: toursPageJson([], null) }],
    'by/paulauskas?page=1': [{ json: toursPageJson([], null) }],
  });
  const lists = { read: 0 };
  const fetch: typeof api.fetch = (url, init) => {
    if (url !== BROADCAST_LIST_URL) return api.fetch(url, init);
    lists.read += 1;
    return Promise.resolve(new Response(`${broadcastDumpUrl('2026-10')}\n`));
  };
  return { fetch, requested: api.requested, lists };
}

describe('the FIDE search services, one set per process', () => {
  // A second, fresh copy of the module, as a dev hot reload loads it. Its
  // import re-evaluates the module and its own imports, which takes seconds
  // under coverage in the full gate; hence the explicit timeout.
  it('are one set, even across a reload of the module', async () => {
    const first = fideServices();
    vi.resetModules();
    const reloaded = await import('./fide-services');
    expect(reloaded.fideServices).not.toBe(fideServices);
    expect(reloaded.fideServices()).toBe(first);
    expect(server.runners).toHaveLength(1);
  }, 30_000);

  it('read Lichess over the network by default', async () => {
    fideServices();
    await expect(runnerFetch()(BROADCAST_LIST_URL, {})).rejects.toThrow();
    expect(network.mock.calls[0]?.[0]).toBe(BROADCAST_LIST_URL);
  });

  it('read the fixture directory locally with the test sign-in on (arch F4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fide-services-'));
    const list = `${broadcastDumpUrl('2026-10')}\n`;
    writeFileSync(join(dir, 'list.txt'), list);
    server.env = {
      ...LOCAL,
      MYCHESS_TEST_SIGNIN: true,
      FIDE_DUMP_FIXTURE_DIR: dir,
    };
    fideServices();
    expect(await (await runnerFetch()(BROADCAST_LIST_URL, {})).text()).toBe(
      list,
    );
    expect(network).not.toHaveBeenCalled();
  });

  it('take the Lichess token and the auth secret from the environment', async () => {
    server.env = { ...LOCAL, LICHESS_TOKEN: 'lip_fromEnv' };
    fideServices();
    expect(server.runners[0]?.tours).not.toBeNull();
    const started = await fideServices().search.start('rokas', '1', NOW);
    // The month list comes from the network, which is not there.
    expect(started).toEqual({
      kind: 'refused',
      refusal: 'fide.searchUnavailable',
    });
  });
});

describe('the services composed (#349, arch C3)', () => {
  it('start a search on their store, signed with the secret', async () => {
    const { fetch } = lichess();
    const { store, used } = fakeStore();
    const { services } = composeFideServices({
      store,
      fetch,
      token: undefined,
      secret: SECRET,
      clock: () => NOW,
    });
    const started = await services.search.start('rokas', '13400002', NOW);
    if (started.kind !== 'started') throw new Error(JSON.stringify(started));
    expect(readSearchToken(SECRET, started.search.token, 'rokas', NOW).ok).toBe(
      true,
    );
    expect(used).toEqual(['count', 'monthStatuses', 'games']);
  });

  it('run the nightly upkeep on a month list read in its own run, not one a search cached (#344)', async () => {
    const { fetch, lists } = lichess();
    const { store, used } = fakeStore();
    const { services } = composeFideServices({
      store,
      fetch,
      token: undefined,
      secret: SECRET,
      clock: () => NOW,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await services.search.start('rokas', '13400002', NOW);
    expect(lists.read).toBe(1);
    await services.preindex(NOW);
    expect(lists.read).toBe(2);
    // A search after it uses the list the upkeep read.
    await services.search.start('rokas', '13400002', NOW);
    expect(lists.read).toBe(2);
    expect(used).toContain('monthStatuses');
  });

  it('without a Lichess token: no tournaments for the runner, no community night', async () => {
    const { fetch, requested } = lichess();
    const { store, used } = fakeStore();
    const composed = composeFideServices({
      store,
      fetch,
      token: undefined,
      secret: SECRET,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(composed.community).toBeNull();
    expect(server.runners[0]?.tours).toBeNull();
    expect(server.runners[0]?.index).toBe(store.monthIndex);
    expect(await composed.services.preindex(NOW)).toMatchObject({
      community: 'off',
    });
    expect(used).toEqual(['monthStatuses']);
    expect(requested).toEqual([]);
  });

  it('with a token: the night asks Lichess with it, and the runner gets the same gateway', async () => {
    const { fetch, requested } = lichess();
    const { store, used } = fakeStore();
    const composed = composeFideServices({
      store,
      fetch,
      token: FAKE_LICHESS_TOKEN,
      secret: SECRET,
    });
    expect(server.runners[0]?.tours?.index).toBe(store.tourIndex);
    expect(await composed.services.preindex(NOW)).toMatchObject({
      community: 'started',
    });
    await composed.community?.settled();
    // The fake answers 401 to any other token.
    expect(requested).toEqual([
      'https://lichess.org/api/broadcast/by/vakarinis?page=1',
      'https://lichess.org/api/broadcast/by/kesnor7?page=1',
      'https://lichess.org/api/broadcast/by/paulauskas?page=1',
    ]);
    expect(used).toContain('tourStatuses');
  }, 10_000);
});
