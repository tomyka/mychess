/**
 * The FIDE ID search's long-lived parts, one set per server process (#316):
 * the background runner, whose single queue is what keeps this process to
 * one month at a time, the in-memory caches of what Lichess publishes, and
 * the secret the search tokens are signed with.
 *
 * This is the only way to the runner: nothing else may create one, or the
 * process would download two months at once (arch F3). The set is kept on
 * `globalThis` (mychessFideServices), not in a module variable, so a
 * module loaded twice (dev hot reload, or two server bundles) still shares
 * the one runner.
 *
 * Opened on first use, as the database pool is (db.ts). The runner lives
 * as long as the Node server (`next start`, the standalone image): a month
 * it processes outlives the request that needed it. A restart drops the
 * queue; the month left processing goes stale and a later search or poll
 * hands it to the new process's runner (spec decision 2).
 */
import type { Fetch } from '@mychess/integrations';
import { broadcastFetch } from './broadcast-fixture-fetch';
import {
  broadcastIndexOn,
  createBroadcastRunner,
  type BroadcastRunner,
} from './broadcast-runner';
import {
  createBroadcastSources,
  type BroadcastSources,
} from './broadcast-sources';
import { getDb } from './db';
import { readWebEnv } from './env';

export interface FideServices {
  readonly runner: BroadcastRunner;
  readonly sources: BroadcastSources;
  /** Signs the search tokens; HKDF derives their key from it. */
  readonly secret: string;
}

declare global {
  /** This process's FIDE search services; only fideServices() sets it. */
  var mychessFideServices: FideServices | undefined;
}

/** The real network: the clients build every URL from a constant. */
const network: Fetch = (url, init) => fetch(url, init);

const clock = (): Date => new Date();

/** This process's FIDE search services. */
export function fideServices(): FideServices {
  globalThis.mychessFideServices ??= createServices();
  return globalThis.mychessFideServices;
}

function createServices(): FideServices {
  const env = readWebEnv();
  const lichess = broadcastFetch(env, network);
  return {
    runner: createBroadcastRunner({
      index: broadcastIndexOn(getDb()),
      fetch: lichess,
      clock,
    }),
    sources: createBroadcastSources({ fetch: lichess, clock }),
    secret: env.BETTER_AUTH_SECRET,
  };
}
