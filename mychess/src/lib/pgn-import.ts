import { parsePgn } from './pgn/parser';

export type MoveRow = {
  fromFen: string;
  toFen: string;
  san: string;
  move_number: number;
  is_player_turn: boolean;
  annotation: string | null;
};

export type ImportPlan = { gameCount: number; moves: MoveRow[] } | { error: string };

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
  return { gameCount: games.length, moves };
}
