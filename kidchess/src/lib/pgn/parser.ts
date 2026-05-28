import { Chess } from 'chess.js';

export interface ParsedMove {
  san: string;
  fen: string;       // FEN *after* the move
  parentFen: string; // FEN *before* the move
  color: 'white' | 'black';
  ply: number;       // 1-based
  annotation?: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  root_fen: string;
}

/**
 * Parse a PGN string (single or multi-game) into ParsedGame[].
 * Main line only (variations ignored).
 */
export function parsePgn(pgn: string): ParsedGame[] {
  const games: ParsedGame[] = [];
  const blocks = pgn.trim().split(/\n\n(?=\[)/);

  for (const block of blocks) {
    try {
      const chess = new Chess();
      chess.loadPgn(block, { strict: false });

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(chess.header())) {
        headers[k] = v as string;
      }

      const history = chess.history({ verbose: true });
      const root_fen = new Chess().fen();

      // Replay to extract FENs
      const replay = new Chess();
      const moves: ParsedMove[] = [];
      for (let i = 0; i < history.length; i++) {
        const parentFen = replay.fen();
        const m = history[i];
        replay.move(m.san);
        moves.push({
          san: m.san,
          fen: replay.fen(),
          parentFen,
          color: m.color === 'w' ? 'white' : 'black',
          ply: i + 1
        });
      }

      games.push({ headers, moves, root_fen });
    } catch {
      // Skip invalid blocks
    }
  }

  return games;
}

/** Extract unique FEN positions from parsed games */
export function extractPositions(games: ParsedGame[]): Set<string> {
  const fens = new Set<string>();
  for (const g of games) {
    fens.add(g.root_fen);
    for (const m of g.moves) {
      fens.add(m.fen);
      fens.add(m.parentFen);
    }
  }
  return fens;
}
