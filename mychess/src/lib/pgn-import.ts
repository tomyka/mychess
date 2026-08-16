import { parsePgn, type ParsedGame } from './pgn/parser';
import { detectOpening } from './openings/classify';
import { ECO_OPENINGS } from './openings/eco-data';

export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
};

export type ImportChapter = {
  name: string;
  moves: MoveRow[];
  ecoCode: string | null;
  ecoName: string | null;
};

export type MultiImportPlan = ImportChapter[] | { error: string };

/** PGN's own placeholder for an unset header ("?") never counts as usable text. */
function usableHeader(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '?' ? trimmed : null;
}

/** How many games (in the same multi-game PGN) carry each distinct Event/White/Black value. */
export type HeaderValueCounts = {
  event: Map<string, number>;
  white: Map<string, number>;
  black: Map<string, number>;
};

function countHeaderValues(games: ParsedGame[], field: 'Event' | 'White' | 'Black'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const game of games) {
    const value = usableHeader(game.headers[field]);
    if (value === null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function countHeaderValuesAcrossGames(games: ParsedGame[]): HeaderValueCounts {
  return {
    event: countHeaderValues(games, 'Event'),
    white: countHeaderValues(games, 'White'),
    black: countHeaderValues(games, 'Black')
  };
}

/**
 * The label for one game/chapter within a multi-game PGN: Event first (most
 * export tools put a real title there), falling back to White then Black
 * (some export tools — e.g. ChessBase reference/study files — put the
 * chapter title in one of those two instead, hardcoding the other to a
 * fixed placeholder — which one holds the title varies by export tool/
 * version, so both are tried), falling back to a plain ordinal when none of
 * the three holds anything ("1-indexed game N" — used for header-less
 * PGNs, or ones where White/Black are simply absent).
 *
 * A header value is only trusted as a chapter title if it's *distinguishing*
 * — i.e. it appears on at most one game in the file, per `collisions` (an
 * optional cross-game tally from `countHeaderValuesAcrossGames`). Some export
 * tools stamp every game in a multi-game file with the same collection/study
 * title in Event, rather than a per-game title — trusting that verbatim would
 * collapse every chapter in the file down to one identical name, which is
 * worse than falling through to the next header (or an ordinal).
 */
export function chapterName(headers: Record<string, string>, index: number, collisions?: HeaderValueCounts): string {
  const isDistinguishing = (value: string | null, counts: Map<string, number> | undefined) =>
    value !== null && (counts?.get(value) ?? 1) <= 1;

  const event = usableHeader(headers.Event);
  if (isDistinguishing(event, collisions?.event)) return event as string;

  const white = usableHeader(headers.White);
  if (isDistinguishing(white, collisions?.white)) return white as string;

  const black = usableHeader(headers.Black);
  if (isDistinguishing(black, collisions?.black)) return black as string;

  return `Game ${index + 1}`;
}

/**
 * Turns PGN text + a chosen studied color into one import chapter per game
 * in the file — each game's moves stay in their own chapter rather than
 * merging into a shared tree, since $lib/server/pgn-import.ts creates one
 * repertoire per chapter when a PGN contains more than one game. Imports
 * every move in each chapter, uncapped — which variations a player actually
 * practices is a separate, adjustable-after-the-fact choice (see
 * `variation_practice_exclusions`), not something decided once here at
 * import time. Pure — no I/O — so it's directly testable without touching
 * Supabase.
 */
export function planMultiImport(pgnText: string, color: 'white' | 'black'): MultiImportPlan {
  const games = parsePgn(pgnText);
  const collisions = countHeaderValuesAcrossGames(games);

  const chapters: ImportChapter[] = games.map((game, index) => {
    const moves: MoveRow[] = game.moves.map((move) => ({
      fromFen: move.parentFen,
      toFen: move.fen,
      san: move.san,
      move_number: move.ply,
      is_player_turn: move.color === color,
      annotation: move.annotation ?? null
    }));
    const opening = detectOpening(game.moves.map((m) => m.san), ECO_OPENINGS);
    return {
      name: chapterName(game.headers, index, collisions),
      moves,
      ecoCode: opening?.code ?? null,
      ecoName: opening?.name ?? null
    };
  });

  if (chapters.length === 0) {
    return { error: 'No valid games found in PGN' };
  }

  return chapters;
}

/** Which side `username` played in a game, matched against the PGN's White/Black headers (case-insensitive). */
export function resolvePlayerColor(headers: Record<string, string>, username: string): 'white' | 'black' | null {
  const target = username.trim().toLowerCase();
  if (headers.White?.trim().toLowerCase() === target) return 'white';
  if (headers.Black?.trim().toLowerCase() === target) return 'black';
  return null;
}

export type GameImportPlan = {
  moves: MoveRow[];
  matchedGameCount: number;
  studiedColor: 'white' | 'black';
  ecoCode: string | null;
  ecoName: string | null;
};

/**
 * Like `planImport`, but for "my games" auto-import (chess.com/Lichess): the
 * player can be on either side from one game to the next, so the studied
 * color is resolved per game from its own White/Black headers instead of
 * being fixed for the whole import. Games where neither side matches
 * `username` are skipped. Returns null if no game matched.
 */
export function planGameImport(pgnText: string, username: string): GameImportPlan | null {
  const games = parsePgn(pgnText);

  const moves: MoveRow[] = [];
  let matchedGameCount = 0;
  let firstMatch: { game: ParsedGame; color: 'white' | 'black' } | null = null;

  for (const game of games) {
    const color = resolvePlayerColor(game.headers, username);
    if (!color) continue;
    matchedGameCount++;
    if (!firstMatch) firstMatch = { game, color };
    for (const move of game.moves) {
      moves.push({
        fromFen: move.parentFen,
        toFen: move.fen,
        san: move.san,
        move_number: move.ply,
        is_player_turn: move.color === color,
        annotation: move.annotation ?? null
      });
    }
  }

  if (!firstMatch) return null;

  const opening = detectOpening(firstMatch.game.moves.map((m) => m.san), ECO_OPENINGS);

  return {
    moves,
    matchedGameCount,
    studiedColor: firstMatch.color,
    ecoCode: opening?.code ?? null,
    ecoName: opening?.name ?? null
  };
}
