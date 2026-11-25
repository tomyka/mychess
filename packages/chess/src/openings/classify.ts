/**
 * Opening classification by position (R-63, R-216): a line is named after
 * the deepest named position it passes through, over every named line of
 * the table, so a transposition into a known opening is recognised whatever
 * the move order.
 */
import { Chess } from 'chess.js';
import { positionKey } from '../position-key';
import type { ChapterNameSource } from '../repertoire/graph';
import { ECO, ECO_FAMILIES, type EcoEntry } from './data/eco';

/** What a chapter is called: a text to show, or a message key to translate. */
export type ChapterName =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'key';
      readonly key: 'chapter.untitled';
      readonly number: number;
    };

/** Plays `san` on `chess`; false when it is not a legal move there. */
function play(chess: Chess, san: string): boolean {
  try {
    chess.move(san);
    return true;
  } catch {
    return false;
  }
}

/**
 * Each named line's final position to its entry; a later line wins a shared
 * position (the row lichess lists later, as before R-216).
 */
export function indexByPosition(
  entries: readonly EcoEntry[],
): ReadonlyMap<string, EcoEntry> {
  return new Map(entries.map((entry) => [entry.key, entry] as const));
}

const BY_POSITION = indexByPosition(ECO);

const FAMILY_BY_CODE: ReadonlyMap<string, EcoEntry> = new Map(
  ECO_FAMILIES.map((entry) => [entry.code, entry] as const),
);

/**
 * The deepest named line among `keys`, the positions a line passes through
 * in order, or null. A position already passed (a repetition) is not a new
 * match, so returning to a shallower opening keeps the one found further on.
 */
export function classifyKeys(keys: readonly string[]): EcoEntry | null {
  const reached = new Set<string>();
  let found: EcoEntry | null = null;
  for (const key of keys) {
    if (!reached.has(key)) found = BY_POSITION.get(key) ?? found;
    reached.add(key);
  }
  return found;
}

/**
 * The deepest named line along a line from the standard start: the match
 * furthest along it, or null, as `classifyKeys` counts it. An illegal move
 * ends the line there.
 */
export function classify(sans: readonly string[]): EcoEntry | null {
  const chess = new Chess();
  const keys: string[] = [];
  for (const san of sans) {
    if (!play(chess, san)) break;
    keys.push(positionKey(chess.fen()));
  }
  return classifyKeys(keys);
}

/**
 * An ECO code's family name (its shortest line), the code itself for a code
 * the table does not have.
 */
export function ecoName(eco: string): string {
  return FAMILY_BY_CODE.get(eco)?.name ?? eco;
}

/** What to call a chapter. */
export function chapterName(source: ChapterNameSource): ChapterName {
  switch (source.kind) {
    case 'custom':
    case 'header':
      return { kind: 'text', text: source.name };
    case 'eco':
      return { kind: 'text', text: ecoName(source.eco) };
    case 'index':
      return { kind: 'key', key: 'chapter.untitled', number: source.number };
  }
}
