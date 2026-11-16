/**
 * Lichess broadcast tournaments (#349, spec "Findings"): an organiser's
 * tournaments page by page (`/api/broadcast/by/{account}`) and one
 * tournament with its rounds (`/api/broadcast/{tourId}`). "Account" (a Lichess
 * user) and "tour" (a broadcast tournament) are Lichess's own words. Which
 * tournaments qualify is the domain's decision; this module only reports
 * what Lichess says, parsed.
 */
import { ok } from '@mychess/chess';
import { z } from 'zod';
import {
  checkBroadcastId,
  LICHESS_BROADCAST_ID,
  LICHESS_BROADCAST_REFUSALS,
  lichessJson,
  type LichessApi,
  type LichessBroadcastResult,
} from './lichess-broadcast-request';

/** The last page Lichess serves of an account's tournaments. */
export const LICHESS_BROADCAST_MAX_PAGE = 20;

/** A Lichess broadcast tournament as the domain needs it. */
export interface LichessBroadcastTour {
  readonly id: string;
  /** Without control or format characters (bidi overrides, zero-width). */
  readonly name: string;
  /** The URL slug; null when Lichess gives none of the usual shape. */
  readonly slug: string | null;
  /** Lichess marks it official (it has a `tier`): it is in the dumps. */
  readonly official: boolean;
  readonly createdAt: Date;
  /**
   * Its first and last day as Lichess gives them (`dates`); `end` is
   * `start` for a tournament with one date; null when Lichess gives none.
   */
  readonly dates: { readonly start: Date; readonly end: Date } | null;
}

/** A tournament of an account's list. */
export interface LichessListedTour {
  readonly tour: LichessBroadcastTour;
  /** Lichess lists no unfinished round for it. */
  readonly finished: boolean;
}

/** A page of an account's tournaments, newest first. */
export interface LichessBroadcastPage {
  readonly tours: readonly LichessListedTour[];
  /** The page after this one; null on the last page. */
  readonly nextPage: number | null;
}

export interface LichessBroadcastRound {
  readonly id: string;
  readonly startsAt: Date | null;
  readonly finishedAt: Date | null;
  /** Lichess gives it a finish time, or marks it finished. */
  readonly finished: boolean;
}

/** A tournament with its rounds. */
export interface LichessBroadcastTourDetail {
  readonly tour: LichessBroadcastTour;
  readonly rounds: readonly LichessBroadcastRound[];
  /** It has rounds, and every one is finished. */
  readonly finished: boolean;
}

/** A Lichess username: what an organiser account may be. */
const LICHESS_USERNAME = /^[A-Za-z0-9_-]{2,30}$/;

const BROADCAST_API_URL = 'https://lichess.org/api/broadcast';

const INVALID = LICHESS_BROADCAST_REFUSALS.invalid;

/** Milliseconds since 1970 as a Date, up to the latest instant a Date holds. */
const instantSchema = z
  .number(INVALID)
  .int(INVALID)
  .min(0, INVALID)
  .max(8.64e15, INVALID)
  .transform((ms) => new Date(ms));

/** Control and format characters (bidi overrides, zero-width), stripped. */
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/**
 * A tournament name without control or format characters, trimmed; refused
 * when nothing is left or more than 200 characters are (Lichess caps names
 * far shorter).
 */
const tourNameSchema = z
  .string(INVALID)
  .transform((name) => name.replace(INVISIBLE_CHARACTERS, '').trim())
  .pipe(z.string(INVALID).min(1, INVALID).max(200, INVALID));

/** A URL slug as Lichess makes them; null for anything else, not a refusal. */
const tourSlugSchema = z
  .string(INVALID)
  .regex(/^[a-z0-9-]{1,200}$/, INVALID)
  .nullable()
  .catch(null);

const broadcastIdSchema = z
  .string(INVALID)
  .regex(LICHESS_BROADCAST_ID, INVALID);

const tourSchema = z
  .object(
    {
      id: broadcastIdSchema,
      name: tourNameSchema,
      slug: tourSlugSchema,
      createdAt: instantSchema,
      dates: z
        .array(instantSchema, INVALID)
        .min(1, INVALID)
        .max(2, INVALID)
        .optional(),
      tier: z.number(INVALID).int(INVALID).nullish(),
    },
    INVALID,
  )
  .transform((tour): LichessBroadcastTour => ({
    id: tour.id,
    name: tour.name,
    slug: tour.slug,
    official: (tour.tier ?? null) !== null,
    createdAt: tour.createdAt,
    dates: datesOf(tour.dates),
  }));

function datesOf(
  dates: readonly Date[] | undefined,
): LichessBroadcastTour['dates'] {
  const start = dates?.[0];
  if (start === undefined) return null;
  return { start, end: dates?.at(-1) ?? start };
}

const pageSchema = z.object(
  {
    currentPageResults: z.array(
      z
        .object(
          { tour: tourSchema, round: z.object({}, INVALID).optional() },
          INVALID,
        )
        .transform(({ tour, round }): LichessListedTour => ({
          tour,
          finished: round === undefined,
        })),
      INVALID,
    ),
    nextPage: z.number(INVALID).int(INVALID).positive(INVALID).nullable(),
  },
  INVALID,
);

const roundSchema = z
  .object(
    {
      id: broadcastIdSchema,
      startsAt: instantSchema.optional(),
      finishedAt: instantSchema.optional(),
      finished: z.boolean(INVALID).optional(),
    },
    INVALID,
  )
  .transform((round): LichessBroadcastRound => ({
    id: round.id,
    startsAt: round.startsAt ?? null,
    finishedAt: round.finishedAt ?? null,
    finished: round.finishedAt !== undefined || round.finished === true,
  }));

const tourDetailSchema = z
  .object({ tour: tourSchema, rounds: z.array(roundSchema, INVALID) }, INVALID)
  .transform(({ tour, rounds }): LichessBroadcastTourDetail => ({
    tour,
    rounds,
    finished: rounds.length > 0 && rounds.every((round) => round.finished),
  }));

/**
 * Page `page` (1 to LICHESS_BROADCAST_MAX_PAGE) of the public tournaments
 * of `account`, 24 a page, newest first; the caller stops paging once
 * tournaments are older than it needs. Throws for an account that is no
 * Lichess username or a page out of range: callers pass constants.
 */
export async function lichessBroadcastsBy(
  api: LichessApi,
  account: string,
  page: number,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<LichessBroadcastPage>> {
  if (!LICHESS_USERNAME.test(account)) {
    throw new RangeError('the account is not a Lichess username');
  }
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > LICHESS_BROADCAST_MAX_PAGE
  ) {
    throw new RangeError('the page is out of range');
  }
  const url = `${BROADCAST_API_URL}/by/${account}?page=${String(page)}`;
  const answer = await lichessJson(api, url, pageSchema, signal);
  if (!answer.ok) return answer;
  const next = answer.value.nextPage;
  return ok({
    tours: answer.value.currentPageResults,
    nextPage: next !== null && next <= LICHESS_BROADCAST_MAX_PAGE ? next : null,
  });
}

/**
 * The tournament `tourId` with its rounds; `invalid` when Lichess answers
 * with another one. Throws for a `tourId` that is no Lichess broadcast ID.
 */
export async function lichessBroadcastTour(
  api: LichessApi,
  tourId: string,
  signal: AbortSignal,
): Promise<LichessBroadcastResult<LichessBroadcastTourDetail>> {
  checkBroadcastId(tourId, 'tour id');
  const schema = tourDetailSchema.refine(
    (detail) => detail.tour.id === tourId,
    INVALID,
  );
  return lichessJson(api, `${BROADCAST_API_URL}/${tourId}`, schema, signal);
}
