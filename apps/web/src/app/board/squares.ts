import type { BoardMove } from '@mychess/chess';
import type { Key } from '@lichess-org/chessground/types';

const SQUARE = /^[a-h][1-8]$/;

/** Is `value` a board square chessground knows? */
export function isKey(value: string): value is Key {
  return SQUARE.test(value);
}

/** The two squares of a UCI move, or none for anything else. */
export function squaresOf(uci: string): Key[] {
  const orig = uci.slice(0, 2);
  const dest = uci.slice(2, 4);
  return isKey(orig) && isKey(dest) ? [orig, dest] : [];
}

/** Chessground's destinations map from the position's legal moves. */
export function destsOf(moves: readonly BoardMove[]): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const { orig, dest } of moves) {
    if (!isKey(orig) || !isKey(dest)) continue;
    const list = dests.get(orig) ?? [];
    if (!list.includes(dest)) list.push(dest);
    dests.set(orig, list);
  }
  return dests;
}

/** A piece as the board's announcements name it (`board.pieces`). */
export interface BoardPiece {
  readonly color: 'white' | 'black';
  readonly role: 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
}

const ROLES: ReadonlyMap<string, BoardPiece['role']> = new Map([
  ['k', 'king'],
  ['q', 'queen'],
  ['r', 'rook'],
  ['b', 'bishop'],
  ['n', 'knight'],
  ['p', 'pawn'],
]);

/** One FEN rank with each run of empty squares spelled out as spaces. */
const spelledOut = (rank: string): string =>
  rank.replace(/\d/g, (run) => ' '.repeat(Number(run)));

/**
 * The piece on `square` of a FEN's board, or null: the board's cursor
 * announcement reads it without chess.js (plan Task 16).
 */
export function pieceAt(fen: string, square: Key): BoardPiece | null {
  const ranks = fen.split(' ')[0]?.split('/') ?? [];
  const rank = ranks[8 - Number(square.charAt(1))] ?? '';
  const letter = spelledOut(rank).charAt('abcdefgh'.indexOf(square.charAt(0)));
  const role = ROLES.get(letter.toLowerCase());
  if (role === undefined) return null;
  return { color: letter === letter.toLowerCase() ? 'black' : 'white', role };
}
