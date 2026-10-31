'use server';

// Home's fork offer answers (R-44, R-45, R-130, R-131). The player is always
// the session account, never an id from the form; the database finds the
// offer by id and that player, and the domain's canAnswerForkOffer decides
// in the answer's own transaction.
import { acceptForkOffer, declineForkOffer } from '@mychess/db';
import {
  FORK_OFFER_REFUSALS,
  type ForkOfferRefusal,
  type RepertoireLimitRefusal,
} from '@mychess/domain';
import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { repertoireRoute } from '../lib/routes';
import { getDb } from '../server/db';
import { refusalState } from '../server/refusal-state';
import { requireOnboarded } from '../server/session';

/**
 * What an offer's buttons show after a submit: a refusal, and the limit it
 * names when the player is at their repertoire limit (R-162, R-163).
 */
export interface ForkOfferState {
  readonly refusal?:
    ForkOfferRefusal['reason'] | RepertoireLimitRefusal['reason'];
  readonly limit?: number;
}

const NOT_OPEN: ForkOfferState = { refusal: FORK_OFFER_REFUSALS.notOpen };

const offerSchema = z.object({ offerId: z.uuid() });

/** The offer the form names, for the session player; undefined if malformed. */
async function offerOf(
  form: FormData,
): Promise<{ playerId: string; offerId: string } | undefined> {
  const player = await requireOnboarded();
  const request = offerSchema.safeParse({ offerId: form.get('offerId') });
  return request.success
    ? { playerId: player.id, offerId: request.data.offerId }
    : undefined;
}

/**
 * Keeps a copy (a fork from the offer's snapshot) and goes to it. Another
 * player's offer, one no longer open, or a fork past the player's R-162
 * limits is refused and nothing is written.
 */
export async function acceptForkOfferAction(
  _previous: ForkOfferState,
  form: FormData,
): Promise<ForkOfferState> {
  const ref = await offerOf(form);
  if (ref === undefined) return NOT_OPEN;
  const kept = await acceptForkOffer(getDb(), ref, new Date());
  if (!kept.ok) return refusalState(kept.refusal);
  redirect(repertoireRoute(kept.value.forkId));
}

/** Declines the offer, which then leaves home. */
export async function declineForkOfferAction(
  _previous: ForkOfferState,
  form: FormData,
): Promise<ForkOfferState> {
  const ref = await offerOf(form);
  if (ref === undefined) return NOT_OPEN;
  const declined = await declineForkOffer(getDb(), ref, new Date());
  if (!declined.ok) return { refusal: declined.refusal.reason };
  refresh();
  return {};
}
