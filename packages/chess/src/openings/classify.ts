/**
 * Opening classification by position (R-63): a line is named after the
 * deepest ECO position it passes through, so a transposition into a known
 * opening is recognised whatever the move order.
 */
import { Chess } from 'chess.js';
import { positionKey } from '../position-key';
import type { ChapterNameSource } from '../repertoire/graph';
import { ECO, type EcoEntry } from './data/eco';
import { ECO_LT } from './data/eco-lt';

export type Locale = 'en' | 'lt';

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
 * Each ECO line's final position to its entry. When two entries reach one
 * position the later, more specific code wins. An illegal move means the
 * generated data is broken, a programmer error, so it throws.
 */
export function indexByPosition(
  entries: readonly EcoEntry[],
): ReadonlyMap<string, EcoEntry> {
  return new Map(
    entries.map((entry) => {
      const chess = new Chess();
      for (const san of entry.moves) {
        if (!play(chess, san)) {
          throw new Error(`ECO ${entry.code}: illegal move ${san}`);
        }
      }
      return [positionKey(chess.fen()), entry] as const;
    }),
  );
}

/** Built once at module load, so broken ECO data fails at startup. */
const BY_POSITION = indexByPosition(ECO);

const BY_CODE: ReadonlyMap<string, EcoEntry> = new Map(
  ECO.map((entry) => [entry.code, entry] as const),
);

/**
 * The deepest ECO entry along a line from the standard start: the match
 * furthest along it, or null. A position the line already reached earlier
 * (a repetition) is not a new match, so returning to a shallower opening
 * keeps the one found further on. An illegal move ends the line there.
 */
export function classify(sans: readonly string[]): EcoEntry | null {
  const chess = new Chess();
  const reached = new Set<string>();
  let found: EcoEntry | null = null;
  for (const san of sans) {
    if (!play(chess, san)) break;
    const key = positionKey(chess.fen());
    if (!reached.has(key)) found = BY_POSITION.get(key) ?? found;
    reached.add(key);
  }
  return found;
}

/**
 * An ECO code's name: Lithuanian for `lt` (English when it has none),
 * English otherwise, the code itself for a code the table does not have.
 */
export function ecoName(eco: string, locale: Locale): string {
  const english = BY_CODE.get(eco)?.name ?? eco;
  return locale === 'lt' ? (ECO_LT[eco] ?? english) : english;
}

/** What to call a chapter in `locale`. */
export function chapterName(
  source: ChapterNameSource,
  locale: Locale,
): ChapterName {
  switch (source.kind) {
    case 'custom':
    case 'header':
      return { kind: 'text', text: source.name };
    case 'eco':
      return { kind: 'text', text: ecoName(source.eco, locale) };
    case 'index':
      return { kind: 'key', key: 'chapter.untitled', number: source.number };
  }
}
