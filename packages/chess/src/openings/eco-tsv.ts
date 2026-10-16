// The pure half of `scripts/generate-eco.mjs`: reads lichess-org/chess-openings
// TSV volumes and picks one entry per ECO code. Ported from v1
// (`scripts/generate-eco-data.ts`).
import type { EcoEntry } from './data/eco';

function pgnToSanMoves(pgn: string): string[] {
  return pgn
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^\d+\.+$/.test(token));
}

function parseRow(row: string): EcoEntry {
  const [code, name, pgn] = row.split('\t');
  if (code === undefined || name === undefined || pgn === undefined) {
    throw new Error(`ECO TSV row is not code, name and pgn: ${row}`);
  }
  return { code, name, moves: pgnToSanMoves(pgn) };
}

/** Every row of one volume (`a.tsv` … `e.tsv`), header dropped. */
export function parseEcoTsv(text: string): EcoEntry[] {
  const [, ...rows] = text.trim().split(/\r?\n/);
  return rows.map(parseRow);
}

/**
 * One entry per ECO code, sorted by code. Many names share a code (ECO groups
 * related lines); the shortest move sequence is kept as that code's family
 * name, the first one on a tie. Lines sharing a code with a shorter kept line
 * are not in the table, so classification is best effort (as in v1).
 */
export function oneEntryPerCode(entries: readonly EcoEntry[]): EcoEntry[] {
  const byCode = new Map<string, EcoEntry>();
  for (const entry of entries) {
    const kept = byCode.get(entry.code);
    if (kept === undefined || entry.moves.length < kept.moves.length) {
      byCode.set(entry.code, entry);
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
