import {
  broadcastGameSchema,
  gameForPlayer,
  preferOfficialCopies,
  type BroadcastGameInput,
  type BroadcastWindow,
} from '@mychess/domain';
import { describe, expect, it } from 'vitest';
import { FOUND_GAMES_LIMIT, gamesForFideId } from '../src';
import { useTestDatabase } from '../src/testing';
import { writeMonth, writeTour } from './support/broadcast-writes';
import {
  fideId,
  game,
  gamesNumbered,
  month,
  months,
  tourGame,
} from './support/broadcasts';

const { db } = useTestDatabase();

/** Dumps up to 2026-09, so the window starts in 2025-10. */
const WINDOW: BroadcastWindow = {
  oldest: month('2025-10'),
  newest: month('2026-09'),
};

const COMMUNITY = { lastRoundAt: new Date('2026-10-20T10:00:00Z') };
const OFFICIAL = {
  official: true,
  lastRoundAt: new Date('2026-10-10T10:00:00Z'),
};

describe('gamesForFideId without community copies (#349, spec decision 5)', () => {
  it('leaves the community copies out before the limit, so they cannot stand in for official games cut off', async () => {
    await writeMonth(db, '2026-09', gamesNumbered(FOUND_GAMES_LIMIT));
    await writeTour(
      db,
      'Com00001',
      [tourGame(1), tourGame(2), tourGame(3)],
      COMMUNITY,
    );
    const found = await gamesForFideId(db, fideId(100), {
      months: months('2026-09'),
      window: WINDOW,
    });
    expect(found.games).toHaveLength(FOUND_GAMES_LIMIT);
    expect(found.truncated).toBe(false);
    expect(found.games.every((one) => one.source.kind === 'month')).toBe(true);
  });

  it('agrees with the domain rule (preferOfficialCopies) on the shared cases', async () => {
    const inMonth = [
      game(1, { date: '2026-09-01' }),
      game(2, { date: null }),
      game(3, { date: '2026-09-03', blackFideId: null }),
    ];
    const outOfScope = [game(4, { date: '2026-08-04' })];
    const official = [tourGame(5, { date: '2026-10-05' })];
    const community = [
      tourGame(11, { date: '2026-09-01' }),
      tourGame(12, { date: '2026-09-01', result: '0-1' }),
      tourGame(13, { date: '2026-09-01', whiteFideId: 200, blackFideId: 100 }),
      tourGame(14, { date: '2026-09-02' }),
      tourGame(15, { date: null }),
      tourGame(16, { date: '2026-09-03', blackFideId: null }),
      tourGame(17, { date: '2026-10-05' }),
      tourGame(18, { date: '2026-08-04' }),
      tourGame(19, { date: '2026-09-01', result: '*' }),
    ];
    const secondCommunity = [tourGame(21, { date: '2026-09-02' })];
    await writeMonth(db, '2026-09', inMonth);
    await writeMonth(db, '2026-08', outOfScope);
    await writeTour(db, 'Off00001', official, OFFICIAL);
    await writeTour(db, 'Com00001', community, COMMUNITY);
    await writeTour(db, 'Com00002', secondCommunity, COMMUNITY);

    const found = await gamesForFideId(db, fideId(100), {
      months: months('2026-09'),
      window: WINDOW,
    });

    const inScope = [
      ...[...inMonth, ...official].map((one) => asFound(one, true)),
      ...[...community, ...secondCommunity].map((one) => asFound(one, false)),
    ];
    const expected = preferOfficialCopies(inScope).map((one) => one.url);
    expect(found.games.map((one) => one.url).sort()).toEqual(expected.sort());
    expect(inScope.length - expected.length).toBe(2);
    expect(expected).not.toContain(tourGame(11).url);
    expect(expected).not.toContain(tourGame(17).url);
  });
});

/** A fixture game as a search finds it for FIDE ID 100. */
function asFound(input: BroadcastGameInput, official: boolean) {
  const parsed = broadcastGameSchema.parse(input);
  return {
    url: parsed.url,
    official,
    date: parsed.date,
    ...gameForPlayer(parsed, fideId(100)),
  };
}
