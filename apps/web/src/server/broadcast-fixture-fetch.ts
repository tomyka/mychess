/**
 * Where the FIDE search reads Lichess from (#316, arch F4): the network, or,
 * for local E2E journeys only, a directory of fixture files.
 *
 * The fixtures are used when the environment is local, the test sign-in is
 * switched on (the domain's personaSignInAvailable, the gate the persona
 * sign-in uses; production refuses it at start-up) and
 * FIDE_DUMP_FIXTURE_DIR names a directory (production refuses that too).
 * The clients still build every URL from their constants; the fixture fetch
 * maps only those exact URLs to files: the month list to `list.txt`, a
 * month's dump to `lichess_db_broadcast_<YYYY-MM>.pgn.zst`, and the
 * Lichess broadcast API's answers (#349) to `by-<account>-<page>.json`,
 * `tour-<tourId>.json`, `round-<roundId>.json` and `tour-<tourId>.pgn`.
 * An API request without a bearer token answers 401, as Lichess's would
 * for the study:read calls; anything else, the FIDE player endpoint
 * included, answers 404.
 */
import { broadcastMonthSchema, personaSignInAvailable } from '@mychess/domain';
import {
  BROADCAST_LIST_URL,
  broadcastDumpUrl,
  type Fetch,
} from '@mychess/integrations';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** What decides between the network and the fixtures. */
export interface BroadcastFetchEnv {
  readonly MYCHESS_ENV: string;
  readonly MYCHESS_TEST_SIGNIN: boolean;
  readonly FIDE_DUMP_FIXTURE_DIR?: string | undefined;
}

/** A dump's file name, its month captured; checked again against the URL. */
const DUMP_FILE = /^lichess_db_broadcast_([0-9]{4}-[0-9]{2})\.pgn\.zst$/;

/** The Lichess broadcast API, as the clients build its URLs. */
const BROADCAST_API = 'https://lichess.org/api/broadcast/';

/**
 * The API paths the clients request, after BROADCAST_API, each with the
 * file it maps to, named from its captured ids: an account's page, a
 * round's tournament, a tournament's PGN and a tournament.
 */
const API_FILES: readonly (readonly [RegExp, string, string])[] = [
  [/^by\/([A-Za-z0-9_-]{2,30})\?page=([1-9][0-9]?)$/, 'by-', '.json'],
  [/^-\/-\/([A-Za-z0-9]{8})$/, 'round-', '.json'],
  [/^([A-Za-z0-9]{8})\.pgn\?clocks=false&comments=false$/, 'tour-', '.pgn'],
  [/^([A-Za-z0-9]{8})$/, 'tour-', '.json'],
];

/** The fetch the FIDE search uses under `env`: `network` but locally. */
export function broadcastFetch(env: BroadcastFetchEnv, network: Fetch): Fetch {
  const dir = env.FIDE_DUMP_FIXTURE_DIR;
  const fixtures = personaSignInAvailable({
    local: env.MYCHESS_ENV === 'local',
    switchedOn: env.MYCHESS_TEST_SIGNIN,
  });
  return fixtures && dir !== undefined ? fixtureFetch(dir) : network;
}

function fixtureFetch(dir: string): Fetch {
  return async (url, init) => {
    const api = url.startsWith(BROADCAST_API);
    if (api && !hasBearer(init)) return status(401);
    const file = api ? apiFile(url.slice(BROADCAST_API.length)) : dumpFile(url);
    if (file === undefined) return status(404);
    try {
      // A directory named at run time, never part of the build: the hints
      // keep Turbopack from tracing the whole project into the image.
      const path = join(/*turbopackIgnore: true*/ dir, file);
      return new Response(await readFile(/*turbopackIgnore: true*/ path));
    } catch {
      return status(404);
    }
  };
}

function hasBearer(init: RequestInit): boolean {
  const auth = new Headers(init.headers).get('authorization');
  return auth?.startsWith('Bearer ') === true;
}

/** The file of an exact dump URL the clients build. */
function dumpFile(url: string): string | undefined {
  if (url === BROADCAST_LIST_URL) return 'list.txt';
  const name = url.slice(url.lastIndexOf('/') + 1);
  const month = broadcastMonthSchema.safeParse(DUMP_FILE.exec(name)?.[1]);
  return month.success && broadcastDumpUrl(month.data) === url
    ? name
    : undefined;
}

/** The file of an API path, its captured ids joined by `-`. */
function apiFile(path: string): string | undefined {
  for (const [pattern, prefix, suffix] of API_FILES) {
    const match = pattern.exec(path);
    if (match !== null) return `${prefix}${match.slice(1).join('-')}${suffix}`;
  }
  return undefined;
}

function status(code: number): Response {
  return new Response(null, { status: code });
}
