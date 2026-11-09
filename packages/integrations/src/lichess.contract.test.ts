// The contract with the real Lichess endpoints, run on demand only, never
// in the gate (tests do not call the network):
//   MYCHESS_CONTRACT=1 pnpm --filter @mychess/integrations test lichess.contract
// It makes three requests and reads only the start of one dump.
import { describe, expect, it } from 'vitest';
import {
  broadcastGames,
  broadcastMonths,
  lichessFidePlayer,
  openBroadcastDump,
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
