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

/**
 * The label for one game/chapter within a multi-game PGN: Event first (most
 * export tools put a real title there), falling back to White (some export
 * tools — e.g. ChessBase reference/study files — put the chapter title
 * there instead, with Black hardcoded to a fixed boilerplate value),
 * falling back to a plain ordinal when neither holds anything ("1-indexed
 * game N" — used for header-less PGNs, or ones where White/Black are
 * simply absent).
 */
export function chapterName(headers: Record<string, string>, index: number): string {
  return usableHeader(headers.Event) ?? usableHeader(headers.White) ?? `Game ${index + 1}`;
}

/**
 * Turns PGN text + a chosen studied color into one import chapter per game
 * in the file — each game's moves stay in their own chapter rather than
 * merging into a shared tree, since $lib/server/pgn-import.ts creates one
 * repertoire per chapter when a PGN contains more than one game. Pure — no
 * I/O — so it's directly testable without touching Supabase.
 */
export function planMultiImport(pgnText: string, color: 'white' | 'black'): MultiImportPlan {
  const games = parsePgn(pgnText);

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
      name: chapterName(game.headers, index),
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
