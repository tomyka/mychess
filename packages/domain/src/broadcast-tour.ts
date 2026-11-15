/**
 * Lichess broadcast tournaments the FIDE ID search indexes beside the dump
 * months (#349): the approved organisers whose tournaments are listed
 * nightly (R-196, R-200), and which tournaments are fetched (spec decision
 * 2). A tournament is indexed as a month is: pending, processing, done or
 * failed (BroadcastMonthStatus and its decide functions).
 *
 * A tournament still running is refused, not stored: an organiser's is
 * listed again every night and queued the night after it finishes; a
 * pasted one is refused with fide.tourNotFinished, so the user pastes it
 * again once it has finished (spec decision 4).
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';
import { BROADCAST_GAME_ISSUE, BROADCAST_TEXT_MAX } from './broadcast-game';
import type { BroadcastMonthStatus } from './broadcast-month';
import {
  isAfterBroadcastDumps,
  isWithinBroadcastWindow,
  type BroadcastWindow,
} from './broadcast-window';

/**
 * The Lichess accounts whose broadcast tournaments are listed nightly
 * (R-196, R-200). The owner approves each one: adding or removing one is a
 * reviewed code change, never configuration.
 */
export const APPROVED_BROADCAST_ORGANISERS = [
  'vakarinis',
  'kesnor7',
  'paulauskas',
] as const;

export type ApprovedOrganiser = (typeof APPROVED_BROADCAST_ORGANISERS)[number];

/** Message-catalogue keys for the tournament refusals. */
export const BROADCAST_TOUR_REFUSALS = {
  notFinished: 'fide.tourNotFinished',
  outsideWindow: 'fide.tourOutsideWindow',
  inDumps: 'fide.tourInDumps',
  claimLost: 'fide.tourClaimLost',
  notClaimable: 'fide.tourNotClaimable',
} as const;

type TourRefusalKey =
  (typeof BROADCAST_TOUR_REFUSALS)[keyof typeof BROADCAST_TOUR_REFUSALS];

/** Why a tournament is not queued (qualifyBroadcastTour). */
export interface BroadcastTourRefusal {
  readonly reason: Exclude<
    TourRefusalKey,
    'fide.tourClaimLost' | 'fide.tourNotClaimable'
  >;
}

/** Why a tournament's claim, write or failure was refused. */
export interface BroadcastTourClaimRefusal {
  readonly reason: Extract<
    TourRefusalKey,
    'fide.tourClaimLost' | 'fide.tourNotClaimable'
  >;
}

/**
 * A Lichess broadcast id (a tournament's or a round's): eight letters or
 * digits, as a regular expression source the database's check shares.
 */
export const BROADCAST_TOUR_ID_PATTERN = '^[A-Za-z0-9]{8}$';

export const broadcastTourIdSchema = z
  .string()
  .regex(new RegExp(BROADCAST_TOUR_ID_PATTERN), 'fide.tourIdInvalid')
  .brand<'BroadcastTourId'>();

export type BroadcastTourId = z.infer<typeof broadcastTourIdSchema>;

/** The approved organiser `account` names, any letter case; null for others. */
export function approvedOrganiser(account: string): ApprovedOrganiser | null {
  const lower = account.toLowerCase();
  return APPROVED_BROADCAST_ORGANISERS.find((name) => name === lower) ?? null;
}

/** The kinds of BroadcastTourOrigin, which the database's check shares. */
export const BROADCAST_TOUR_ORIGINS = ['organiser', 'pasted'] as const;

/** How a tournament reached the index: an organiser's list, or a pasted link. */
export type BroadcastTourOrigin =
  | { readonly kind: 'organiser'; readonly organiser: ApprovedOrganiser }
  | { readonly kind: 'pasted' };

/** What Lichess says of a tournament, as qualifyBroadcastTour reads it. */
export interface BroadcastTourCandidate {
  readonly id: string;
  readonly name: string;
  /** Lichess marks it official: its games reach the dumps. */
  readonly official: boolean;
  /** Every round finished. */
  readonly finished: boolean;
  /** The start of its last round (Lichess's last date); null for none. */
  readonly lastRoundAt: Date | null;
  readonly origin: BroadcastTourOrigin;
}

/**
 * A tournament name: no control character, nor a format one (bidi
 * overrides, zero-width), which the integrations strip already (security
 * L3).
 */
const tourNameSchema = z
  .string()
  .trim()
  .min(1, BROADCAST_GAME_ISSUE)
  .max(BROADCAST_TEXT_MAX, BROADCAST_GAME_ISSUE)
  .refine((text) => !/[\p{Cc}\p{Cf}]/u.test(text), BROADCAST_GAME_ISSUE);

const originSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('organiser'),
    organiser: z.enum(APPROVED_BROADCAST_ORGANISERS),
  }),
  z.object({ kind: z.literal('pasted') }),
]);

/**
 * The fields of a tournament to queue, unbranded: what the database checks
 * again where it writes one. Parsing with it makes no QueuedBroadcastTour.
 */
export const broadcastTourFieldsSchema = z.object({
  id: broadcastTourIdSchema,
  name: tourNameSchema,
  official: z.boolean(),
  lastRoundAt: z.date(),
  origin: originSchema,
});

/**
 * A tournament qualifyBroadcastTour allowed: what the index queues. Not
 * exported from the package (security L1), so only qualifyBroadcastTour
 * makes one.
 */
const queuedBroadcastTourSchema =
  broadcastTourFieldsSchema.brand<'QueuedBroadcastTour'>();

export type QueuedBroadcastTour = z.infer<typeof queuedBroadcastTourSchema>;

/** A tournament's index state: the lifecycle of a month's (spec decision 1). */
export type BroadcastTourStatus = BroadcastMonthStatus;

/**
 * Whether the index fetches `tour`, with the search covering `window`
 * (spec decision 2): only a finished tournament whose last round is in the
 * window; an organiser's official one only once its last round is past
 * the newest dump month, as the dumps hold it otherwise; a pasted one,
 * official or community, whenever it is finished and in the window. The
 * window ends at `now`: a last round dated later is outside it (security
 * L2). Throws for an id or name the caller should have parsed.
 */
export function qualifyBroadcastTour(
  tour: BroadcastTourCandidate,
  window: BroadcastWindow,
  now: Date,
): Result<QueuedBroadcastTour, BroadcastTourRefusal> {
  if (!tour.finished) return refuse(BROADCAST_TOUR_REFUSALS.notFinished);
  const { lastRoundAt } = tour;
  if (
    lastRoundAt === null ||
    !isWithinBroadcastWindow(lastRoundAt, window) ||
    lastRoundAt.getTime() > now.getTime()
  ) {
    return refuse(BROADCAST_TOUR_REFUSALS.outsideWindow);
  }
  if (
    tour.origin.kind === 'organiser' &&
    tour.official &&
    !isAfterBroadcastDumps(lastRoundAt, window)
  ) {
    return refuse(BROADCAST_TOUR_REFUSALS.inDumps);
  }
  return ok(
    queuedBroadcastTourSchema.parse({
      id: tour.id,
      name: tour.name,
      official: tour.official,
      lastRoundAt,
      origin: tour.origin,
    }),
  );
}

/**
 * A broadcast game link: two slugs, the round id, the game id
 * (`/broadcast/{tour}/{round}/{roundId}/{gameId}`).
 */
const TOUR_GAME_URL =
  /^https:\/\/lichess\.org\/broadcast\/[A-Za-z0-9-]+\/[A-Za-z0-9-]+\/([A-Za-z0-9]{8})\/[A-Za-z0-9]{8}$/;

/**
 * Whether a tournament keeps the game at `url` (security M1): a broadcast
 * game link of one of its own rounds, `roundIds`. Any other link in a
 * tournament's PGN could take the place of another broadcast's game, as
 * the first source to store a link keeps it.
 */
export function isGameOfTour(
  url: string,
  roundIds: readonly BroadcastTourId[],
): boolean {
  const roundId = TOUR_GAME_URL.exec(url)?.[1];
  return roundId !== undefined && roundIds.some((id) => id === roundId);
}
