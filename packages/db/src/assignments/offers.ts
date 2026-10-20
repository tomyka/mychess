/**
 * A player's open fork offers (R-44, R-45, R-130, R-131). Every read
 * filters by the session player.
 */
import { SIDES, type Side } from '@mychess/chess';
import {
  FORK_OFFER_REASONS,
  forkOfferDaysLeft,
  forkOfferState,
  type ForkOfferReason,
} from '@mychess/domain';
import { and, desc, eq, gt, isNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Executor } from '../client';
import { forkOffers } from '../assignment-schema';

/**
 * The offers still open at `now`, as SQL. Mirrors the domain's
 * forkOfferState: not accepted, declined or closed, and now < expires_at.
 */
export const openAt = (now: Date): SQL | undefined =>
  and(
    isNull(forkOffers.acceptedAt),
    isNull(forkOffers.declinedAt),
    isNull(forkOffers.closedAt),
    gt(forkOffers.expiresAt, now),
  );

/** One open offer as the player sees it. */
export interface OpenForkOffer {
  readonly id: string;
  /** Null once the coach deleted the repertoire (R-131). */
  readonly repertoireId: string | null;
  readonly name: string;
  readonly side: Side;
  readonly coachName: string;
  readonly reason: ForkOfferReason;
  readonly expiresAt: Date;
  /** forkOfferDaysLeft at `now`. */
  readonly daysLeft: number;
}

const offerRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    repertoireId: z.uuid().nullable(),
    name: z.string(),
    side: z.enum(SIDES),
    coachName: z.string(),
    reason: z.enum(FORK_OFFER_REASONS),
    expiresAt: z.date(),
    acceptedAt: z.date().nullable(),
    declinedAt: z.date().nullable(),
    closedAt: z.date().nullable(),
  }),
);

/** `playerId`'s offers open at `now`, newest first, with the days left. */
export async function openForkOffers(
  db: Executor,
  playerId: string,
  now: Date,
): Promise<OpenForkOffer[]> {
  const rows = offerRowsSchema.parse(
    await db
      .select({
        id: forkOffers.id,
        repertoireId: forkOffers.repertoireId,
        name: forkOffers.name,
        side: forkOffers.side,
        coachName: forkOffers.coachName,
        reason: forkOffers.reason,
        expiresAt: forkOffers.expiresAt,
        acceptedAt: forkOffers.acceptedAt,
        declinedAt: forkOffers.declinedAt,
        closedAt: forkOffers.closedAt,
      })
      .from(forkOffers)
      .where(and(eq(forkOffers.playerId, playerId), openAt(now)))
      .orderBy(desc(forkOffers.createdAt), desc(forkOffers.id)),
  );
  return rows
    .filter((row) => forkOfferState(row, now) === 'open')
    .map((row) => ({
      id: row.id,
      repertoireId: row.repertoireId,
      name: row.name,
      side: row.side,
      coachName: row.coachName,
      reason: row.reason,
      expiresAt: row.expiresAt,
      daysLeft: forkOfferDaysLeft(row.expiresAt, now),
    }));
}
