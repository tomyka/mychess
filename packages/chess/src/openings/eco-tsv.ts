// The pure half of `scripts/generate-eco.mjs`: reads lichess-org/chess-openings
// TSV volumes and keeps every named line, each with the key of the position
// it ends in (R-216). Ported from v1 (`scripts/generate-eco-data.ts`).
//
// Node runs the generator on this file directly, and Node's resolver needs
// file extensions, so this module imports no other module of the package at
// run time: the position-key function is passed in.
import { Chess } from 'chess.js';

/** One named line, a row of a TSV volume. */
export interface EcoLine {
  /** ECO code, `A00` to `E99`. */
  readonly code: string;
  /** English name, as lichess spells it. */
  readonly name: string;
  /** The line from the standard start position, in SAN. */
  readonly moves: readonly string[];
}

/** A named line with the key of the position it ends in: what `eco.json` holds. */
export interface EcoEntry extends EcoLine {
  /** The key of the position the line ends in, computed by the generator. */
  readonly key: string;
}

function pgnToSanMoves(pgn: string): string[] {
  return pgn
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^\d+\.+$/.test(token));
}

function parseRow(row: string): EcoLine {
  const [code, name, pgn] = row.split('\t');
  if (code === undefined || name === undefined || pgn === undefined) {
    throw new Error(`ECO TSV row is not code, name and pgn: ${row}`);
  }
  return { code, name, moves: pgnToSanMoves(pgn) };
}

/** Every row of one volume (`a.tsv` … `e.tsv`), header dropped. */
export function parseEcoTsv(text: string): EcoLine[] {
  const [, ...rows] = text.trim().split(/\r?\n/);
  return rows.map(parseRow);
}

/** The FEN after `line`'s moves from the start; throws at an illegal move. */
function finalFen(line: EcoLine): string {
  const chess = new Chess();
  for (const san of line.moves) {
    try {
      chess.move(san);
    } catch {
      throw new Error(`ECO ${line.code}: illegal move ${san}`);
    }
  }
  return chess.fen();
}

/**
 * Each line with the key of the position it ends in (R-216: lines are
 * matched by position). `keyOf` is `positionKey`. An illegal move means the
 * source data is broken, so it throws, naming the line.
 */
export function withPositionKeys(
  lines: readonly EcoLine[],
  keyOf: (fen: string) => string,
): EcoEntry[] {
  return lines.map((line) => ({ ...line, key: keyOf(finalFen(line)) }));
}

/**
 * One entry per ECO code, sorted by code. Many names share a code (ECO groups
 * related lines); the shortest move sequence is kept as that code's family
 * line, the first one on a tie.
 */
export function oneEntryPerCode<T extends EcoLine>(entries: readonly T[]): T[] {
  const byCode = new Map<string, T>();
  for (const entry of entries) {
    const kept = byCode.get(entry.code);
    if (kept === undefined || entry.moves.length < kept.moves.length) {
      byCode.set(entry.code, entry);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
