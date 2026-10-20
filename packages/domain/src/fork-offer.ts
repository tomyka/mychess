import type { Result } from '@mychess/chess';

/** How long a fork offer stays open (R-44). */
export const FORK_OFFER_DAYS = 30;
const DAY_MS = 86_400_000;

/** How an Assignment ended for the player (R-44, R-45, R-130, R-131). */
export const FORK_OFFER_REASONS = [
  'unassigned',
  'unlinked',
  'leftGroup',
  'deleted',
] as const;
export type ForkOfferReason = (typeof FORK_OFFER_REASONS)[number];

/** Message-catalogue keys for fork offer refusals. */
export const FORK_OFFER_REFUSALS = { notOpen: 'forkOffer.notOpen' } as const;

export interface ForkOfferRefusal {
  readonly reason: (typeof FORK_OFFER_REFUSALS)[keyof typeof FORK_OFFER_REFUSALS];
}

/** A fork offer as stored: its expiry and how it was answered, if at all. */
export interface ForkOfferFacts {
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  /** Set when the player was assigned the repertoire again (lead decision 4). */
  readonly closedAt: Date | null;
}

export type ForkOfferState =
  'open' | 'expired' | 'accepted' | 'declined' | 'closed';

/** When an offer made at `now` expires (R-44). */
export const forkOfferExpiry = (now: Date): Date =>
  new Date(now.getTime() + FORK_OFFER_DAYS * DAY_MS);

/** Where an offer stands at `now`: an answer wins over expiry. */
export function forkOfferState(
  offer: ForkOfferFacts,
  now: Date,
): ForkOfferState {
  if (offer.acceptedAt !== null) return 'accepted';
  if (offer.declinedAt !== null) return 'declined';
  if (offer.closedAt !== null) return 'closed';
  return now < offer.expiresAt ? 'open' : 'expired';
}

/** A player keeps or declines only an open offer. */
export function canAnswerForkOffer(
  offer: ForkOfferFacts,
  now: Date,
): Result<undefined, ForkOfferRefusal> {
  return forkOfferState(offer, now) === 'open'
    ? { ok: true, value: undefined }
    : { ok: false, refusal: { reason: FORK_OFFER_REFUSALS.notOpen } };
}
