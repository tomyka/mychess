import { Chess } from 'chess.js';

interface ParsedMove {
  san: string;
  fen: string;       // FEN *after* the move
  parentFen: string; // FEN *before* the move
  color: 'white' | 'black';
  ply: number;       // 1-based half-move count to reach `fen`
  annotation?: string;
}

export interface ParsedGame {
  headers: Record<string, string>;
  moves: ParsedMove[];
  root_fen: string;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Half-moves played to reach a position, derived from its FEN. */
function plyOf(fen: string): number {
  const parts = fen.split(' ');
  const turn = parts[1]; // side to move: 'w' | 'b'
  const fullmove = parseInt(parts[5] ?? '1', 10) || 1;
  return (fullmove - 1) * 2 + (turn === 'b' ? 1 : 0);
}

function parseHeaders(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const re = /\[(\w+)\s+"([^"]*)"\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) headers[m[1]] = m[2];
  return headers;
}

/**
 * Parse a game's movetext into a flat list of moves, following *every*
 * variation (parenthesised RAV), not just the main line — chess.js's own
 * `loadPgn`/`history` drops variations entirely.
 *
 * A `(` opens an alternative to the move just played, so it branches from the
 * position *before* that move; `)` returns to the main line. The branch point
 * is captured on a stack so nested variations resume correctly. Because the
 * downstream graph is keyed on (from-position, SAN), branches naturally merge
 * into a shared move tree with multiple edges out of a position.
 */
function parseMovetext(movetext: string, rootFen: string): ParsedMove[] {
  const cleaned = movetext
    .replace(/\{[^}]*\}/g, ' ') // brace comments
    .replace(/;[^\n]*/g, ' ')   // rest-of-line comments
    .replace(/\$\d+/g, ' ')     // NAG glyphs ($1, $19, ...)
    .replace(/\(/g, ' ( ')
    .replace(/\)/g, ' ) ');

  const tokens = cleaned.split(/\s+/).filter(Boolean);

  const moves: ParsedMove[] = [];
  const seen = new Set<string>(); // dedupe identical edges within this game

  let board = new Chess(rootFen);
  // FEN before the most recent move on the current line — the point a `(`
  // branches from. Null until at least one move has been played on this line.
  let lastParentFen: string | null = null;
  const stack: Array<{ resumeFen: string; resumeParentFen: string | null }> = [];

  for (const raw of tokens) {
    if (raw === '(') {
      if (lastParentFen === null) continue; // malformed variation, ignore
      stack.push({ resumeFen: board.fen(), resumeParentFen: lastParentFen });
      board = new Chess(lastParentFen); // rewind to before the branched move
      continue;
    }
    if (raw === ')') {
      const top = stack.pop();
      if (top) {
        board = new Chess(top.resumeFen);
        lastParentFen = top.resumeParentFen;
      }
      continue;
    }
    // move numbers ("12.", "12...") and results ("1-0", "*") carry no move
    if (/^\d+\.(\.\.)?$/.test(raw)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(raw)) continue;

    // strip a glued leading move number ("1.e4") and trailing !/? glyphs
    const san = raw.replace(/^\d+\.(\.\.)?/, '').replace(/[!?]+$/, '');
    if (!san) continue;

    const parentFen = board.fen();
    let move;
    try {
      move = board.move(san);
    } catch {
      move = null;
    }
    if (!move) continue; // not legal in this position — skip stray token

    const childFen = board.fen();
    const key = `${parentFen}|${move.san}`;
    if (!seen.has(key)) {
      seen.add(key);
      moves.push({
        san: move.san,
        fen: childFen,
        parentFen,
        color: move.color === 'w' ? 'white' : 'black',
        ply: plyOf(childFen)
      });
    }
    lastParentFen = parentFen;
  }

  return moves;
}

/**
 * Parse a PGN string (single or multi-game) into ParsedGame[].
 * Follows all variations, not just the main line.
 */
export function parsePgn(pgn: string): ParsedGame[] {
  const games: ParsedGame[] = [];
  // Exports from ChessBase/Chess Publisher etc. commonly use CRLF, in which
  // case the separator between games is "\r\n\r\n" — a bare \n\n never
  // matches inside that, so every game in the file would otherwise be
  // swallowed into one and have its movetext nonsensically concatenated.
  const blocks = pgn.trim().split(/\r?\n\r?\n(?=\[)/);

  for (const block of blocks) {
    try {
      const headers = parseHeaders(block);
      const root_fen = headers.FEN ?? START_FEN;
      // Validate the root before replaying — a bad FEN header would throw.
      new Chess(root_fen);

      const movetext = block.replace(/\[(\w+)\s+"[^"]*"\]/g, ' ');
      const moves = parseMovetext(movetext, root_fen);

      // Drop blocks that yielded no legal moves (garbage input, header-only).
      if (moves.length === 0) continue;

      games.push({ headers, moves, root_fen });
    } catch {
      // Skip invalid blocks
    }
  }

  return games;
}
