/**
 * (player, repertoire) pairs as map keys and as SQL: the set-based writes of
 * a change (plan decision 8) and the state reads. Internal to the package.
 */
import type { PlayerRepertoire } from '@mychess/domain';
import { and, eq, or, sql, type Column, type SQL } from 'drizzle-orm';

/** A pair as a map key. */
export const pairKey = (pair: PlayerRepertoire): string =>
  JSON.stringify([pair.playerId, pair.repertoireId]);

/** The pairs once each, in first-seen order. */
export const uniquePairs = (
  pairs: readonly PlayerRepertoire[],
): PlayerRepertoire[] => [
  ...new Map(
    pairs.map(({ playerId, repertoireId }) => [
      pairKey({ playerId, repertoireId }),
      { playerId, repertoireId },
    ]),
  ).values(),
];

/**
 * The rows whose `player` and `repertoire` columns are one of `pairs`;
 * no row for no pairs.
 */
export const inPairs = (
  player: Column,
  repertoire: Column,
  pairs: readonly PlayerRepertoire[],
): SQL =>
  or(
    ...pairs.map((pair) =>
      and(eq(player, pair.playerId), eq(repertoire, pair.repertoireId)),
    ),
  ) ?? sql`false`;
