// The FIDE ID search's services for a feature test (#316): the real runner
// and sources on the test database, reading a fake Lichess that serves the
// month list, a player and synthetic dumps, never the network.
//
// Declared in the test file:
//
//   vi.mock('../../src/server/fide-services', async () =>
//     (await import('./support/fide')).fideServicesMock());
//
// Only type imports of the app here, as in ./request.
import {
  broadcastDumpUrl,
  BROADCAST_LIST_URL,
  type Fetch,
} from '@mychess/integrations';
import type { FideServices } from '../../../src/server/fide-services';
import { dumpServer } from '../../fixtures/broadcast-dumps';

/** The services the mocked fideServices() answers with. */
export const fide: { services?: FideServices; fetched: string[] } = {
  fetched: [],
};

/** The body of a `src/server/fide-services` mock. */
export function fideServicesMock(): { fideServices: () => FideServices } {
  return {
    fideServices: () => {
      if (fide.services === undefined) throw new Error('no FIDE services set');
      return fide.services;
    },
  };
}

/** The months listed, newest first, as `YYYY-MM`. */
export function monthsBack(newest: string, count: number): string[] {
  const [year = 0, month = 1] = newest.split('-').map(Number);
  return Array.from({ length: count }, (_, n) =>
    new Date(Date.UTC(year, month - 1 - n, 1)).toISOString().slice(0, 7),
  );
}

/**
 * A fake Lichess: list.txt naming `months`, the FIDE player `player` for
 * any ID, and each month's dump from `dumps`. Every URL asked is recorded
 * in `fide.fetched`.
 */
export function fakeLichess({
  months,
  player,
  dumps,
}: {
  readonly months: readonly string[];
  readonly player: (id: string) => Response;
  readonly dumps: Parameters<typeof dumpServer>[0];
}): Fetch {
  const server = dumpServer(dumps);
  const list = months.map((m) => broadcastDumpUrl(m)).join('\n');
  const playerUrl = /^https:\/\/lichess\.org\/api\/fide\/player\/([0-9]+)$/;
  return (url, init) => {
    fide.fetched.push(url);
    if (url === BROADCAST_LIST_URL) return Promise.resolve(new Response(list));
    const id = playerUrl.exec(url)?.[1];
    if (id !== undefined) return Promise.resolve(player(id));
    return server.fetch(url, init);
  };
}
