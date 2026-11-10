import { BROADCAST_LIST_URL, broadcastDumpUrl } from '@mychess/integrations';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BroadcastRunnerDeps } from './broadcast-runner';
import { fideServices } from './fide-services';

const SECRET = 'the-auth-secret-of-at-least-32-characters';

const server: {
  env: Record<string, unknown>;
  runners: BroadcastRunnerDeps[];
} = vi.hoisted(() => ({ env: {}, runners: [] }));

vi.mock('./db', () => ({ getDb: () => ({ name: 'the db' }) }));
vi.mock('./env', () => ({ readWebEnv: () => server.env }));
// The runner has its own tests; here only what it is built with matters.
// Mocking it also keeps @mychess/db out of this file's module graph, so a
// reload of fide-services stays light.
vi.mock('./broadcast-runner', () => ({
  broadcastIndexOn: () => ({ name: 'the index' }),
  createBroadcastRunner: (deps: BroadcastRunnerDeps) => {
    server.runners.push(deps);
    return { need: () => undefined, settled: () => Promise.resolve() };
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

describe('the FIDE search services', () => {
  // A second, fresh copy of the module, as a dev hot reload loads it. Its
  // import re-evaluates the module and its own imports, which takes seconds
  // under coverage in the full gate; hence the explicit timeout.
  it('are one set per process, even across a reload of the module', async () => {
    const first = fideServices();
    vi.resetModules();
    const reloaded = await import('./fide-services');
    expect(reloaded.fideServices).not.toBe(fideServices);
    expect(reloaded.fideServices()).toBe(first);
    expect(reloaded.fideServices().runner).toBe(first.runner);
    expect(server.runners).toHaveLength(1);
  }, 30_000);

  it('sign search tokens with the auth secret', () => {
    expect(fideServices().secret).toBe(SECRET);
  });

  it('read Lichess over the network by default, the runner too', async () => {
    const { sources } = fideServices();
    await expect(sources.months()).rejects.toThrow();
    expect(network.mock.calls[0]?.[0]).toBe(BROADCAST_LIST_URL);
    await expect(runnerFetch()(BROADCAST_LIST_URL, {})).rejects.toThrow();
    expect(network).toHaveBeenCalledTimes(2);
  });

  it('read the fixture directory locally with the test sign-in on, the runner too (arch F4)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fide-services-'));
    const list = `${broadcastDumpUrl('2026-10')}\n`;
    writeFileSync(join(dir, 'list.txt'), list);
    server.env = {
      ...LOCAL,
      MYCHESS_TEST_SIGNIN: true,
      FIDE_DUMP_FIXTURE_DIR: dir,
    };
    const { sources } = fideServices();
    expect(await sources.months()).toEqual(['2026-10']);
    expect(await (await runnerFetch()(BROADCAST_LIST_URL, {})).text()).toBe(
      list,
    );
    expect(network).not.toHaveBeenCalled();
  });
});
