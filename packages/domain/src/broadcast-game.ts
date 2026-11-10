import type { Side } from '@mychess/chess';
import { z } from 'zod';
import { fideIdSchema, type FideId } from './fide-id';

/** The PGN game results a broadcast header carries. */
export const BROADCAST_RESULTS = ['1-0', '0-1', '1/2-1/2', '*'] as const;

export type BroadcastResult = (typeof BROADCAST_RESULTS)[number];

/** A game's result from one player's side; `unknown` for an unfinished `*`. */
export type PlayerOutcome = 'win' | 'draw' | 'loss' | 'unknown';

/** Who played a broadcast game and how it ended (spec decision 1). */
export interface BroadcastPairing {
  readonly white: string;
  readonly whiteFideId: FideId | null;
  readonly black: string;
  readonly blackFideId: FideId | null;
  readonly result: BroadcastResult;
}

/** A broadcast game seen from the searched player's side (R-185). */
export interface PlayerGame {
  readonly colour: Side;
  readonly opponent: {
    readonly name: string;
    readonly fideId: FideId | null;
  };
  readonly outcome: PlayerOutcome;
}

const WHITE_OUTCOME: Readonly<Record<BroadcastResult, PlayerOutcome>> = {
  '1-0': 'win',
  '0-1': 'loss',
  '1/2-1/2': 'draw',
  '*': 'unknown',
};

const BLACK_OUTCOME: Readonly<Record<BroadcastResult, PlayerOutcome>> = {
  '1-0': 'loss',
  '0-1': 'win',
  '1/2-1/2': 'draw',
  '*': 'unknown',
};

/**
 * A Lichess game link a broadcast game may carry, as a regular expression
 * source the database's check constraint shares (security M1): https, the
 * lichess.org host, and a path of letters, digits, `/`, `_` and `-` only,
 * so it is safe as a link target. It holds no quote.
 */
export const LICHESS_GAME_URL = '^https://lichess\\.org/[A-Za-z0-9/_-]+$';

/** The most characters a broadcast name, event, ECO or opening keeps. */
export const BROADCAST_TEXT_MAX = 200;

/**
 * The one message-catalogue key of a broadcast game the index refuses; it
 * is skipped and counted, never shown.
 */
export const BROADCAST_GAME_ISSUE = 'fide.gameInvalid';

/** A C0 or C1 control character, a line break included. */
const CONTROL_CHARACTER = /\p{Cc}/u;

const broadcastText = z
  .string()
  .trim()
  .min(1, BROADCAST_GAME_ISSUE)
  .max(BROADCAST_TEXT_MAX, BROADCAST_GAME_ISSUE)
  .refine((text) => !CONTROL_CHARACTER.test(text), BROADCAST_GAME_ISSUE);

/** Whether `text` (`YYYY-MM-DD`) names a day of the calendar. */
function isCalendarDate(text: string): boolean {
  const day = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(text);
}

const calendarDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, BROADCAST_GAME_ISSUE)
  .refine(isCalendarDate, BROADCAST_GAME_ISSUE);

/**
 * A broadcast game as the index keeps it (security M3), checked again where
 * it is written whoever parsed it before: a Lichess link, FIDE IDs the
 * index keeps (isIndexableGame), a real date or none, one of the four
 * results, and short single-line texts.
 */
export const broadcastGameSchema = z
  .object({
    url: z.string().regex(new RegExp(LICHESS_GAME_URL), BROADCAST_GAME_ISSUE),
    white: broadcastText,
    whiteFideId: fideIdSchema.nullable(),
    black: broadcastText,
    blackFideId: fideIdSchema.nullable(),
    date: calendarDate.nullable(),
    result: z.enum(BROADCAST_RESULTS, BROADCAST_GAME_ISSUE),
    eco: broadcastText.nullable(),
    opening: broadcastText.nullable(),
    event: broadcastText,
  })
  .refine((game) => isIndexableGame(game), BROADCAST_GAME_ISSUE);

/** A broadcast game as a dump parser hands it over, before the check. */
export type BroadcastGameInput = z.input<typeof broadcastGameSchema>;

/** A broadcast game the index keeps. */
export type BroadcastGame = z.infer<typeof broadcastGameSchema>;

/**
 * Whether the index keeps a game (spec decision 1): it names at least one
 * FIDE ID, and not the same one on both sides, which would leave the
 * player's colour unknown.
 */
export function isIndexableGame(game: BroadcastPairing): boolean {
  if (game.whiteFideId === null) return game.blackFideId !== null;
  return game.whiteFideId !== game.blackFideId;
}

/**
 * The game from the side of the player with `id` (R-185): colour, opponent
 * and result. Throws for a game the player is not in, or is on both sides
 * of: the search only returns indexed games with the player in them.
 */
export function gameForPlayer(game: BroadcastPairing, id: FideId): PlayerGame {
  const white = game.whiteFideId === id;
  const black = game.blackFideId === id;
  if (white === black) {
    throw new RangeError(`FIDE ID ${String(id)} is not on one side only`);
  }
  return white
    ? {
        colour: 'white',
        opponent: { name: game.black, fideId: game.blackFideId },
        outcome: WHITE_OUTCOME[game.result],
      }
    : {
        colour: 'black',
        opponent: { name: game.white, fideId: game.whiteFideId },
        outcome: BLACK_OUTCOME[game.result],
      };
}

/**
 * The family of a Lichess opening name (R-189): the part before the first
 * `:`, trimmed, so "Sicilian Defense: Najdorf Variation" is "Sicilian
 * Defense". Null for a game with no opening name, or none before the `:`.
 */
export function openingFamily(opening: string | null): string | null {
  if (opening === null) return null;
  const colon = opening.indexOf(':');
  const family = (colon === -1 ? opening : opening.slice(0, colon)).trim();
  return family === '' ? null : family;
}

/** What grouping reads of a found game (R-189, R-190). */
export interface PreparationGame {
  readonly colour: Side;
  readonly outcome: PlayerOutcome;
  readonly opening: string | null;
  /** `YYYY-MM-DD`, or null when the broadcast gave no date. */
  readonly date: string | null;
}

/** How many games of a group the player won, drew, lost and left unfinished. */
export type PreparationScore = Readonly<Record<PlayerOutcome, number>>;

/** The games of one opening family; `family` is null for no opening name. */
export interface OpeningFamilyGroup<G extends PreparationGame> {
  readonly family: string | null;
  /** Newest first, undated last. */
  readonly games: readonly G[];
  readonly score: PreparationScore;
}

/** The groups of the games the searched player had one colour in. */
export interface PreparationSection<G extends PreparationGame> {
  readonly colour: Side;
  /** Most games first, ties by family name, the unknown opening last. */
  readonly groups: readonly OpeningFamilyGroup<G>[];
}

const PREPARATION_SIDES: readonly Side[] = ['white', 'black'];

/**
 * A search's games for preparation (R-189, R-190): as White, then as
 * Black, a colour with no game left out; inside each, one group per opening
 * family, the largest first, ties by family name and the unknown opening
 * last; a group's games newest first, with the player's score.
 */
export function groupForPreparation<G extends PreparationGame>(
  games: readonly G[],
): PreparationSection<G>[] {
  return PREPARATION_SIDES.map((colour) => ({
    colour,
    groups: familyGroups(games.filter((game) => game.colour === colour)),
  })).filter((section) => section.groups.length > 0);
}

function familyGroups<G extends PreparationGame>(
  games: readonly G[],
): OpeningFamilyGroup<G>[] {
  const byFamily = new Map<string | null, G[]>();
  for (const game of games.toSorted(newestFirst)) {
    const family = openingFamily(game.opening);
    const members = byFamily.get(family);
    if (members === undefined) byFamily.set(family, [game]);
    else members.push(game);
  }
  return [...byFamily]
    .map(([family, members]) => ({
      family,
      games: members,
      score: scoreOf(members),
    }))
    .sort(largestFirst);
}

/** Newest date first, undated last; equal dates keep the order given. */
function newestFirst(a: PreparationGame, b: PreparationGame): number {
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  return b.date.localeCompare(a.date);
}

/** Most games first, ties by family name; the one unknown group last. */
function largestFirst<G extends PreparationGame>(
  a: OpeningFamilyGroup<G>,
  b: OpeningFamilyGroup<G>,
): number {
  if (a.family === null) return 1;
  if (b.family === null) return -1;
  return (
    b.games.length - a.games.length || a.family.localeCompare(b.family, 'en')
  );
}

function scoreOf(games: readonly PreparationGame[]): PreparationScore {
  const score = { win: 0, draw: 0, loss: 0, unknown: 0 };
  for (const game of games) score[game.outcome] += 1;
  return score;
}
