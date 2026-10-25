/**
 * One player's training writes run one at a time. Two batches that learn
 * the same new moves in different answer orders would otherwise each wait
 * on the other's uncommitted insert and deadlock: there is no row yet for
 * lockReviews to take in key order.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from '../client';

/** Holds `playerId`'s training lock until `tx` ends, waiting for any holder. */
export async function serialiseTraining(
  tx: Tx,
  playerId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`training:${playerId}`}))`,
  );
}
