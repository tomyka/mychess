/**
 * A FIDE player as Lichess knows them (#316, spec decision 5), from
 * `GET https://lichess.org/api/fide/player/<id>`, for the search result's
 * header: name, federation, title and standard rating.
 */
import { ok, refuse, type Result } from '@mychess/chess';
import { z } from 'zod';
import { discard, get, readCappedText, type Fetch } from './http';

/** Message-catalogue keys for a player the endpoint does not give. */
export const FIDE_PLAYER_REFUSALS = {
  notFound: 'fide.playerNotFound',
  invalid: 'fide.playerInvalid',
} as const;

export interface FidePlayerRefusal {
  readonly reason: (typeof FIDE_PLAYER_REFUSALS)[keyof typeof FIDE_PLAYER_REFUSALS];
}

export interface FidePlayer {
  readonly name: string;
  /** The FIDE federation code, as `LTU`. */
  readonly federation: string;
  /** The FIDE title, as `GM` or `WFM`; null for none. */
  readonly title: string | null;
  /** The standard rating; null for an unrated player. */
  readonly standardRating: number | null;
}

/** The most bytes of an answer read (security requirements, task 1). */
const PLAYER_MAX_BYTES = 64 * 1024;

/** The domain's FIDE ID range (`@mychess/domain` fide-id.ts). */
const FIDE_ID_MAX = 999_999_999;

const INVALID = FIDE_PLAYER_REFUSALS.invalid;

/** What the errors call the endpoint's answer, without the ID. */
const ANSWER = 'the FIDE player answer';

const playerSchema = z.object({
  id: z.number(INVALID).int(INVALID),
  name: z
    .string(INVALID)
    .trim()
    .min(1, INVALID)
    .max(200, INVALID)
    .regex(/^\P{Cc}+$/u, INVALID),
  federation: z.string(INVALID).regex(/^[A-Z]{3}$/, INVALID),
  title: z
    .string(INVALID)
    .regex(/^[A-Za-z]{1,4}$/, INVALID)
    .optional(),
  standard: z
    .number(INVALID)
    .int(INVALID)
    .min(0, INVALID)
    .max(4000, INVALID)
    .optional(),
});

/**
 * The FIDE player with `id`, or a refusal when Lichess does not know them
 * or its answer does not parse. Fails on another error status or an answer
 * over 64 KB. Throws for an `id` that is no FIDE ID: callers pass one the
 * domain's fideId parsed. No error text holds the ID or its URL, so a
 * logged error does not tell who was searched (security M3).
 */
export async function lichessFidePlayer(
  fetch: Fetch,
  id: number,
  signal: AbortSignal,
): Promise<Result<FidePlayer, FidePlayerRefusal>> {
  if (!Number.isInteger(id) || id < 1 || id > FIDE_ID_MAX) {
    throw new RangeError('the FIDE ID is out of range');
  }
  const response = await playerAnswer(fetch, id, signal);
  if (response.status === 404) {
    discard(response);
    return refuse(FIDE_PLAYER_REFUSALS.notFound);
  }
  if (!response.ok) {
    discard(response);
    throw new Error(`${ANSWER} was ${String(response.status)}`);
  }
  const text = await readCappedText(response, PLAYER_MAX_BYTES, signal, ANSWER);
  const parsed = playerSchema.safeParse(jsonOrUndefined(text));
  if (!parsed.success || parsed.data.id !== id) return refuse(INVALID);
  const { name, federation, title, standard } = parsed.data;
  return ok({
    name,
    federation,
    title: title ?? null,
    standardRating: standard ?? null,
  });
}

/**
 * The endpoint's answer for `id`. A failed request fails with the abort
 * reason when `signal` was aborted, else with a fixed text: fetch errors may
 * name the URL, which holds the ID.
 */
async function playerAnswer(
  fetch: Fetch,
  id: number,
  signal: AbortSignal,
): Promise<Response> {
  const url = `https://lichess.org/api/fide/player/${String(id)}`;
  try {
    return await get(fetch, url, signal);
  } catch {
    signal.throwIfAborted();
    throw new Error('the FIDE player request failed');
  }
}

/** `text` parsed as JSON; undefined, which the schema refuses, when it is not. */
function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
