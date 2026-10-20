/**
 * A player keeps or declines a fork offer (R-44, R-45, R-130, R-131). Each
 * answer locks the offer FOR UPDATE, filtered by the session player, and
 * lets the domain decide (canAnswerForkOffer): another player's offer, or
 * one not open, is refused and nothing is written.
 */
import {
  canAnswerForkOffer,
  FORK_OFFER_REFUSALS,
  type ForkOfferRefusal,
  type Result,
} from '@mychess/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { forkOffers } from '../assignment-schema';
import type { Executor, Tx } from '../client';
import { isUuid } from '../ids';
import { DONE, refusal } from '../results';
import { SIDES } from '@mychess/chess';
import { writeFork } from './fork';
import { snapshotSchema } from './snapshot';

/** One of the player's offers; `playerId` is the session account. */
export interface ForkOfferRef {
  readonly playerId: string;
  readonly offerId: string;
}

const NOT_OPEN = refusal(FORK_OFFER_REFUSALS.notOpen);

const offerRowsSchema = z.array(
  z.object({
    name: z.string(),
    side: z.enum(SIDES),
    coachName: z.string(),
    snapshot: snapshotSchema,
    expiresAt: z.date(),
    acceptedAt: z.date().nullable(),
    declinedAt: z.date().nullable(),
    closedAt: z.date().nullable(),
  }),
);
type OfferRow = z.infer<typeof offerRowsSchema>[number];

const isOffer = (ref: ForkOfferRef) =>
  and(eq(forkOffers.id, ref.offerId), eq(forkOffers.playerId, ref.playerId));

/**
 * Runs `answer` on the player's own offer if canAnswerForkOffer allows it,
 * the offer locked until the transaction ends.
 */
function onOpenOffer<T>(
  db: Executor,
  ref: ForkOfferRef,
  now: Date,
  answer: (tx: Tx, offer: OfferRow) => Promise<T>,
): Promise<Result<T, ForkOfferRefusal>> {
  if (!isUuid(ref.offerId)) return Promise.resolve(NOT_OPEN);
  return db.transaction(async (tx) => {
    const [offer] = offerRowsSchema.parse(
      await tx
        .select({
          name: forkOffers.name,
          side: forkOffers.side,
          coachName: forkOffers.coachName,
          snapshot: forkOffers.snapshot,
          expiresAt: forkOffers.expiresAt,
          acceptedAt: forkOffers.acceptedAt,
          declinedAt: forkOffers.declinedAt,
          closedAt: forkOffers.closedAt,
        })
        .from(forkOffers)
        .where(isOffer(ref))
        .for('update'),
    );
    if (offer === undefined) return NOT_OPEN;
    const allowed = canAnswerForkOffer(offer, now);
    if (!allowed.ok) return allowed;
    return { ok: true, value: await answer(tx, offer) };
  });
}

/**
 * Keeps a copy (plan decision 7) from the offer's snapshot, so it works
 * after the coach changed or deleted the repertoire, and marks the offer
 * accepted with its fork.
 */
export function acceptForkOffer(
  db: Executor,
  ref: ForkOfferRef,
  now: Date,
): Promise<Result<{ forkId: string }, ForkOfferRefusal>> {
  return onOpenOffer(db, ref, now, async (tx, offer) => {
    const forkId = await writeFork(tx, {
      ...offer.snapshot,
      playerId: ref.playerId,
      name: offer.name,
      side: offer.side,
      coachName: offer.coachName,
      now,
    });
    await tx
      .update(forkOffers)
      .set({ acceptedAt: now, forkId })
      .where(isOffer(ref));
    return { forkId };
  });
}

/** Declines the player's own open offer. */
export async function declineForkOffer(
  db: Executor,
  ref: ForkOfferRef,
  now: Date,
): Promise<Result<undefined, ForkOfferRefusal>> {
  const answered = await onOpenOffer(db, ref, now, async (tx) => {
    await tx.update(forkOffers).set({ declinedAt: now }).where(isOffer(ref));
  });
  return answered.ok ? DONE : answered;
}
