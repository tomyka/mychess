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

export type ImportPlan =
  | { gameCount: number; moves: MoveRow[]; ecoCode: string | null; ecoName: string | null }
  | { error: string };

/**
 * Turns PGN text + a chosen studied color into the exact move rows to write.
 * Pure — no I/O — so it's directly testable without touching Supabase. The
 * IO layer in $lib/server/pgn-import.ts calls this before writing anything.
 */
export function planImport(pgnText: string, color: 'white' | 'black'): ImportPlan {
  const games = parsePgn(pgnText);

  const moves: MoveRow[] = [];
  for (const game of games) {
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

  if (moves.length === 0) {
    return { error: 'No valid games found in PGN' };
  }

  const firstGameMoves = games.find((g) => g.moves.length > 0)?.moves ?? [];
  const opening = detectOpening(firstGameMoves.map((m) => m.san), ECO_OPENINGS);

  return {
    gameCount: games.length,
    moves,
    ecoCode: opening?.code ?? null,
    ecoName: opening?.name ?? null
  };
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
