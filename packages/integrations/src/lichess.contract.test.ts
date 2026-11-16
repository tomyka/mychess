// The contract with the real Lichess endpoints, run on demand only, never
// in the gate (tests do not call the network):
//   MYCHESS_CONTRACT=1 pnpm --filter @mychess/integrations test lichess.contract
// It makes three requests and reads only the start of one dump.
import { describe, expect, it } from 'vitest';
import {
  broadcastGames,
  broadcastMonths,
  lichessBroadcastsBy,
  lichessBroadcastTour,
  lichessFidePlayer,
  openBroadcastDump,
  openLichessBroadcastPgn,
  type Fetch,
} from './index';

const enabled = process.env['MYCHESS_CONTRACT'] === '1';

const realFetch: Fetch = (url, init) => fetch(url, init);

/** The FIDE ID of the example player in the Lichess API documentation. */
const DOCUMENTED_FIDE_ID = 35009192;

describe.runIf(enabled)('Lichess contract', () => {
  it('lists the broadcast dump months and parses the newest dump', async () => {
    const signal = AbortSignal.timeout(60_000);
    const months = await broadcastMonths(realFetch, signal);
    expect(months.length).toBeGreaterThan(0);
    const newest = months[0] ?? '';
    await using dump = await openBroadcastDump(realFetch, newest, signal);
    const firstGames = [];
    for await (const game of broadcastGames(dump.text)) {
      firstGames.push(game);
      if (firstGames.length === 5) break;
    }
    expect(firstGames).toHaveLength(5);
  }, 60_000);

  it('reads a FIDE player', async () => {
    const player = await lichessFidePlayer(
      realFetch,
      DOCUMENTED_FIDE_ID,
      AbortSignal.timeout(15_000),
    );
    expect(player.ok).toBe(true);
  }, 15_000);
});

// The broadcast API needs a `study:read` token (R-199); these three requests
// run only when MYCHESS_LICHESS_TOKEN holds one as well. Keep the token off
// the command line (shell history): put it in the gitignored env file
// `apps/web/.env.local` and load it with Node's --env-file, from the root:
//   MYCHESS_CONTRACT=1 node --env-file=apps/web/.env.local node_modules/vitest/vitest.mjs run --project integrations lichess.contract
const token = process.env['MYCHESS_LICHESS_TOKEN'] ?? '';

/** Vilnius Open 2026, a finished community tournament of an R-200 organiser. */
const TOUR = { organiser: 'paulauskas', id: '8PbrZM5O' };

describe.runIf(enabled && token !== '')(
  'Lichess broadcast API contract',
  () => {
    const api = { fetch: realFetch, token };

    it("lists an organiser's tournaments", async () => {
      const page = await lichessBroadcastsBy(
        api,
        TOUR.organiser,
        1,
        AbortSignal.timeout(15_000),
      );
      expect(page.ok && page.value.tours.map(({ tour }) => tour.id)).toContain(
        TOUR.id,
      );
    }, 15_000);

    it('reads a finished tournament with its rounds', async () => {
      const tour = await lichessBroadcastTour(
        api,
        TOUR.id,
        AbortSignal.timeout(15_000),
      );
      expect(tour.ok && tour.value.finished).toBe(true);
    }, 15_000);

    it("parses the tournament's PGN", async () => {
      const opened = await openLichessBroadcastPgn(
        api,
        TOUR.id,
        AbortSignal.timeout(30_000),
      );
      if (!opened.ok) throw new Error(opened.refusal.reason);
      await using pgn = opened.value;
      const games = [];
      for await (const game of pgn.games) games.push(game);
      expect(games.length).toBeGreaterThan(0);
    }, 30_000);
  },
);
