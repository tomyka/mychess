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
 * month's dump to `lichess_db_broadcast_<YYYY-MM>.pgn.zst`. Anything else,
 * the FIDE player endpoint included, answers 404.
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
  return async (url) => {
    const file = fixtureFile(url);
    if (file === undefined) return notFound();
    try {
      // A directory named at run time, never part of the build: the hints
      // keep Turbopack from tracing the whole project into the image.
      const path = join(/*turbopackIgnore: true*/ dir, file);
      return new Response(await readFile(/*turbopackIgnore: true*/ path));
    } catch {
      return notFound();
    }
  };
}

/** The file `url` maps to, only for the exact URLs the clients build. */
function fixtureFile(url: string): string | undefined {
  if (url === BROADCAST_LIST_URL) return 'list.txt';
  const name = url.slice(url.lastIndexOf('/') + 1);
  const month = broadcastMonthSchema.safeParse(DUMP_FILE.exec(name)?.[1]);
  return month.success && broadcastDumpUrl(month.data) === url
    ? name
    : undefined;
}

function notFound(): Response {
  return new Response(null, { status: 404 });
}
