import {
  moveNumber,
  type RepertoireMove,
  type WalkedMove,
} from '@mychess/chess';

/** A move of the list: its chip. */
export interface MoveToken {
  readonly kind: 'move';
  readonly move: RepertoireMove;
  /** Half-moves after the chapter's root. */
  readonly ply: number;
  readonly path: readonly RepertoireMove[];
  /** Black's number shows at the start of a block or after variations. */
  readonly numbered: boolean;
  /**
   * It lands on a position the list goes on from elsewhere (a
   * Transposition): the line goes on there, not after this chip (#331).
   */
  readonly transposes: boolean;
}

/** The alternatives to the move before it, each a block of tokens. */
interface VariationsToken {
  readonly kind: 'variations';
  readonly blocks: readonly Token[][];
}

/** A move chip, or the variations that branch off before the next one. */
export type Token = MoveToken | VariationsToken;

/**
 * A line of the chapter's tree as tokens: the main move at each position,
 * its alternatives as variation blocks right after it, then the main line
 * goes on. Loops along the main line; recurses only into variations.
 */
export function lineTokens(
  nodes: readonly WalkedMove[],
  ply: number,
  path: readonly RepertoireMove[],
): Token[] {
  const tokens: Token[] = [];
  let numbered = true;
  for (
    let at = nodes, p = ply, before = path;
    at[0] !== undefined;
    at = at[0].next, p += 1
  ) {
    const [main, ...alternatives] = at;
    const mainPath = [...before, main.move];
    tokens.push({
      kind: 'move',
      move: main.move,
      ply: p,
      path: mainPath,
      numbered,
      transposes: main.transposes,
    });
    if (alternatives.length > 0)
      tokens.push({
        kind: 'variations',
        blocks: alternatives.map((alt) => lineTokens([alt], p, before)),
      });
    numbered = alternatives.length > 0;
    before = mainPath;
  }
  return tokens;
}

/** A numbered row of the main line: White's move, then Black's. */
export interface MovesRow {
  readonly kind: 'moves';
  /** The full move's number, "6.". */
  readonly number: string;
  /** None when the row starts with Black's move: after variations, or at a Black-first root. */
  readonly white: MoveToken | null;
  /** None when the line ends, or variations follow, after White's move. */
  readonly black: MoveToken | null;
}

/** A row of the list: a numbered pair of moves, or variations on its own. */
export type Row = MovesRow | VariationsToken;

/** Is the move `ply` half-moves after the root White's? */
const isWhite = (ply: number, whiteFirst: boolean): boolean =>
  (ply + (whiteFirst ? 0 : 1)) % 2 === 0;

/** The row a move starts: White's opens it, Black's alone has no White move. */
function rowFor(token: MoveToken, whiteFirst: boolean): MovesRow {
  return isWhite(token.ply, whiteFirst)
    ? {
        kind: 'moves',
        number: moveNumber(token.ply, whiteFirst),
        white: token,
        black: null,
      }
    : {
        kind: 'moves',
        // Black's full move is numbered as White's half-move before it.
        number: moveNumber(token.ply - 1, whiteFirst),
        white: null,
        black: token,
      };
}

/** Does `row` wait for Black's reply to its White move? */
const awaitsBlack = (row: Row | undefined): row is MovesRow =>
  row?.kind === 'moves' && row.white !== null && row.black === null;

/**
 * The main line's tokens (`lineTokens` at the root) as the list's rows: a
 * White move opens a row and the Black move after it fills it; variations
 * close the row and become a row of their own, so a Black move after them
 * starts a row with no White move, as does one at a Black-first root.
 */
export function rowsOf(tokens: readonly Token[], whiteFirst: boolean): Row[] {
  const rows: Row[] = [];
  for (const token of tokens) {
    const last = rows.at(-1);
    if (token.kind === 'variations') rows.push(token);
    else if (!isWhite(token.ply, whiteFirst) && awaitsBlack(last))
      rows[rows.length - 1] = { ...last, black: token };
    else rows.push(rowFor(token, whiteFirst));
  }
  return rows;
}
