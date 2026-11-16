/**
 * The FIDE ID search's long-lived parts, one set per server process (#316):
 * the background runner, whose single queue is what keeps this process to
 * one download at a time, the in-memory caches of what Lichess publishes,
 * the community broadcasts with the one paced way to the Lichess broadcast
 * API (#349), and the secret the search tokens are signed with.
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
 * queue; the new process's runner, created here once, releases the month
 * left processing without spending its attempt before its first claim
 * (#355), and a later search or poll hands it to that runner.
 */
import { broadcastTourStatuses, queueBroadcastTour } from '@mychess/db';
import type { Fetch, LichessApi } from '@mychess/integrations';
import {
  createCommunityBroadcasts,
  type CommunityBroadcasts,
} from './broadcast-community';
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
import { broadcastTourIndexOn } from './broadcast-tour-job';
import { getDb } from './db';
import { readWebEnv } from './env';
import {
  createLichessPacer,
  LICHESS_PACE,
  sleep,
  type LichessLane,
} from './lichess-pace';

export interface FideServices {
  readonly runner: BroadcastRunner;
  readonly sources: BroadcastSources;
  /**
   * The community broadcasts (#349); null without a Lichess token, so
   * the organiser listing and pasted links are off.
   */
  readonly community: CommunityBroadcasts | null;
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
  const lane = lichessLanes(lichess, env.LICHESS_TOKEN);
  const db = getDb();
  const runner = createBroadcastRunner({
    index: broadcastIndexOn(db),
    fetch: lichess,
    clock,
    tours:
      lane === null
        ? null
        : {
            index: broadcastTourIndexOn(db),
            api: lane('night'),
            downloadApi: (onTurn) => lane('download', onTurn),
          },
  });
  return {
    runner,
    sources: createBroadcastSources({ fetch: lichess, clock }),
    community:
      lane === null
        ? null
        : createCommunityBroadcasts({
            api: lane('night'),
            pasteApi: lane('paste'),
            runner,
            queue: (tour) => queueBroadcastTour(db, tour),
            statuses: (window) => broadcastTourStatuses(db, window),
          }),
    secret: env.BETTER_AUTH_SECRET,
  };
}

/**
 * The Lichess broadcast API with `token` in each lane of one pacer
 * (lichess-pace.ts), so every call of this process keeps to its pace;
 * null without a token.
 */
function lichessLanes(
  fetch: Fetch,
  token: string | undefined,
): ((lane: LichessLane, onTurn?: () => void) => LichessApi) | null {
  if (token === undefined) return null;
  const pacer = createLichessPacer(fetch, {
    ...LICHESS_PACE,
    sleep,
    clock: () => Date.now(),
  });
  return (lane, onTurn) => ({ fetch: pacer.fetch(lane, onTurn), token });
}
