/**
 * A broadcast game's headers mapped to the record the index keeps. The
 * format checks repeat, minimally, the domain's (`@mychess/domain`
 * broadcast-game.ts and fide-id.ts), which this package may not import; the
 * database re-checks every record with broadcastGameSchema anyway.
 */

/** The PGN results a record may carry; the domain's BROADCAST_RESULTS. */
const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'] as const;

type Result = (typeof RESULTS)[number];

/**
 * A broadcast game as the dump parser hands it to the index: the shape of
 * the domain's BroadcastGameInput, field for field.
 */
export interface BroadcastGameRecord {
  readonly url: string;
  readonly white: string;
  readonly whiteFideId: number | null;
  readonly black: string;
  readonly blackFideId: number | null;
  /** The day played as `YYYY-MM-DD`, or null when the Date is not a day. */
  readonly date: string | null;
  readonly result: Result;
  readonly eco: string | null;
  readonly opening: string | null;
  readonly event: string;
}

/** The domain's LICHESS_GAME_URL: a link safe as a link target. */
const LICHESS_GAME_URL = /^https:\/\/lichess\.org\/[A-Za-z0-9/_-]+$/;

/** A FIDE ID as the domain's fideId reads it: 1 to 9 digits, no leading 0. */
const FIDE_ID = /^[1-9][0-9]{0,8}$/;

/** A PGN Date of a known day: `YYYY.MM.DD`. */
const PGN_DATE = /^([0-9]{4})\.([0-9]{2})\.([0-9]{2})$/;

const CONTROL_CHARACTERS = /\p{Cc}/gu;

const HIGH_SURROGATE_AT_END = /[\uD800-\uDBFF]$/;

type Headers = ReadonlyMap<string, string>;

/**
 * The record of a game's `headers`, texts cut to `textChars`; null for a
 * game the index does not keep: one without a Lichess GameURL, a valid
 * Result, a White, a Black or an event, or without a FIDE ID on either
 * side, or with the same one on both.
 */
export function recordOf(
  headers: Headers,
  textChars: number,
): BroadcastGameRecord | null {
  const url = headers.get('GameURL') ?? '';
  const result = resultOf(headers.get('Result'));
  const whiteFideId = fideIdOf(headers.get('WhiteFideId'));
  const blackFideId = fideIdOf(headers.get('BlackFideId'));
  if (
    !LICHESS_GAME_URL.test(url) ||
    result === null ||
    !isIndexable(whiteFideId, blackFideId)
  ) {
    return null;
  }
  const texts = textsOf(headers, textChars);
  return texts === null
    ? null
    : {
        url,
        whiteFideId,
        blackFideId,
        result,
        date: dateOf(headers),
        ...texts,
      };
}

interface Texts {
  readonly white: string;
  readonly black: string;
  readonly event: string;
  readonly eco: string | null;
  readonly opening: string | null;
}

function textsOf(headers: Headers, textChars: number): Texts | null {
  const text = (name: string): string | null =>
    cleanText(headers.get(name), textChars);
  const white = text('White');
  const black = text('Black');
  const event = text('BroadcastName') ?? text('Event');
  if (white === null || black === null || event === null) return null;
  return { white, black, event, eco: text('ECO'), opening: text('Opening') };
}

/**
 * The domain's isIndexableGame: a FIDE ID on at least one side, and not the
 * same one on both, which would leave the player's colour unknown.
 */
function isIndexable(white: number | null, black: number | null): boolean {
  return white === null ? black !== null : white !== black;
}

function resultOf(raw: string | undefined): Result | null {
  return RESULTS.find((result) => result === raw) ?? null;
}

function fideIdOf(raw: string | undefined): number | null {
  return raw !== undefined && FIDE_ID.test(raw) ? Number(raw) : null;
}

function dateOf(headers: Headers): string | null {
  const parts = PGN_DATE.exec(headers.get('Date') ?? '');
  if (parts === null) return null;
  const [, year, month, day] = parts;
  const date = `${year ?? ''}-${month ?? ''}-${day ?? ''}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(date)
    ? date
    : null;
}

/**
 * `raw` without control characters, trimmed and cut to `max` UTF-16 units
 * (the unit of the domain's length check) without splitting a character;
 * null when nothing is left.
 */
function cleanText(raw: string | undefined, max: number): string | null {
  const cut = (raw ?? '')
    .replace(CONTROL_CHARACTERS, '')
    .trim()
    .slice(0, max)
    .replace(HIGH_SURROGATE_AT_END, '')
    .trim();
  return cut === '' ? null : cut;
}
