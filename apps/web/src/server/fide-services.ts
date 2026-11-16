/**
 * The composition root of Opponent's games (#316, #349): the one place
 * that builds the FIDE search's long-lived parts and hands each use case
 * its dependencies. Server actions and the cron route call the use cases
 * through fideServices(); nothing else builds them.
 *
 * - the background runner, whose single queue keeps this process to one
 *   download at a time; nothing else may create one, or the process would
 *   download two at once (arch F3);
 * - the Lichess broadcast gateway (lichess-broadcasts.ts), one per process,
 *   so every call keeps to the one pace; only with a Lichess token;
 * - the community broadcasts (the night and the queue of pasted
 *   tournaments), only with a token;
 * - the in-memory caches of what Lichess publishes;
 * - the use cases: start and poll a search, add a pasted link, and the
 *   nightly upkeep.
 *
 * The set is kept on `globalThis` (mychessFideServices), not in a module
 * variable, so a module loaded twice (dev hot reload, or two server
 * bundles) still shares the one runner. Opened on first use, as the
 * database pool is (db.ts). The runner lives as long as the Node server: a
 * month it processes outlives the request that needed it. A restart drops
 * the queue; the new process's runner releases what was left processing
 * without spending its attempt before its first claim (#355).
 */
import type { Fetch } from '@mychess/integrations';
import {
  createCommunityBroadcasts,
  type CommunityBroadcasts,
} from './broadcast-community';
import { broadcastFetch } from './broadcast-fixture-fetch';
import {
  createAddBroadcastLink,
  type AddBroadcastLink,
} from './broadcast-link';
import { createPreindex, type Preindex } from './broadcast-preindex';
import {
  createBroadcastRunner,
  type BroadcastRunner,
} from './broadcast-runner';
import { createBroadcastSources } from './broadcast-sources';
import { getDb } from './db';
import { readWebEnv } from './env';
import { createFideSearch, type FideSearch } from './fide-search';
import { fideStoreOn, type FideStore } from './fide-store';
import { createLichessBroadcasts } from './lichess-broadcasts';

/** The use cases of Opponent's games. */
export interface FideServices {
  readonly search: FideSearch;
  readonly addBroadcastLink: AddBroadcastLink;
  readonly preindex: Preindex;
}

/** What the services are built on. */
export interface FideServicesDeps {
  /** The repositories, on this process's database (fideStoreOn). */
  readonly store: FideStore;
  /** How Lichess is reached: the network, or local E2E fixtures. */
  readonly fetch: Fetch;
  /** The owner's Lichess token (R-199); none turns the community part off. */
  readonly token: string | undefined;
  /** Signs the search tokens; HKDF derives their key from it. */
  readonly secret: string;
  readonly clock?: () => Date;
}

/**
 * The services and the long-lived parts behind them, for a test to wait
 * on (the runner's queue, the community night).
 */
export interface ComposedFideServices {
  readonly services: FideServices;
  readonly runner: BroadcastRunner;
  readonly community: CommunityBroadcasts | null;
}

declare global {
  /** This process's FIDE search services; only fideServices() sets it. */
  var mychessFideServices: FideServices | undefined;
}

/** The real network: the clients build every URL from a constant. */
const network: Fetch = (url, init) => fetch(url, init);

/** This process's FIDE search services. */
export function fideServices(): FideServices {
  globalThis.mychessFideServices ??= processServices();
  return globalThis.mychessFideServices;
}

function processServices(): FideServices {
  const env = readWebEnv();
  return composeFideServices({
    store: fideStoreOn(getDb()),
    fetch: broadcastFetch(env, network),
    token: env.LICHESS_TOKEN,
    secret: env.BETTER_AUTH_SECRET,
  }).services;
}

/** Builds the services and their parts on `deps`. */
export function composeFideServices(
  deps: FideServicesDeps,
): ComposedFideServices {
  const { store, fetch } = deps;
  const clock = deps.clock ?? (() => new Date());
  const broadcasts =
    deps.token === undefined
      ? null
      : createLichessBroadcasts({ fetch, token: deps.token });
  const runner = createBroadcastRunner({
    index: store.monthIndex,
    fetch,
    clock,
    tours: broadcasts === null ? null : { index: store.tourIndex, broadcasts },
  });
  const community =
    broadcasts === null
      ? null
      : createCommunityBroadcasts({
          broadcasts,
          runner,
          queue: store.queueTour,
          statuses: store.tourStatuses,
        });
  const sources = createBroadcastSources({ fetch, clock });
  const months = () => sources.months();
  const services: FideServices = {
    search: createFideSearch({ store, runner, sources, secret: deps.secret }),
    addBroadcastLink: createAddBroadcastLink({
      count: store.count,
      months,
      paste:
        broadcasts === null || community === null
          ? null
          : { broadcasts, add: (tour) => community.add(tour) },
    }),
    preindex: createPreindex({
      months,
      monthStatuses: store.monthStatuses,
      runner,
      community,
    }),
  };
  return { services, runner, community };
}
