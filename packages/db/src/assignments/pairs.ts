/**
 * (player, repertoire) pairs as map keys and as SQL, and account id lists as
 * SQL: the set-based writes of a change (plan decision 8) and the state
 * reads. Each list is bound as an array, one bind parameter whatever its
 * length. Internal to the package.
 */
import type { PlayerRepertoire } from '@mychess/domain';
import { sql, type Column, type SQL } from 'drizzle-orm';

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
 * The rows whose `player` (text) and `repertoire` (uuid) columns are one of
 * `pairs`; no row for no pairs. The pairs are bound as two arrays, so any
 * number of them fits in one statement's bind parameters.
 */
export const inPairs = (
  player: Column,
  repertoire: Column,
  pairs: readonly PlayerRepertoire[],
): SQL =>
  sql`(${player}, ${repertoire}) in (select * from unnest(${sql.param(
    pairs.map((pair) => pair.playerId),
  )}::text[], ${sql.param(pairs.map((pair) => pair.repertoireId))}::uuid[]))`;

/**
 * The rows whose `account` (text) column is one of `ids`; no row for no
 * ids. The ids are bound as one array, so any number of them fits in one
 * statement's bind parameters.
 */
export const inIds = (account: Column, ids: readonly string[]): SQL =>
  sql`${account} = any(${sql.param([...ids])}::text[])`;
