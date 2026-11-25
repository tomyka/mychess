// The training top bar's words (R-224): the session's name as the title,
// and under it the item asked: its repertoire, side and chapter. Pure, so
// the rule is tested apart from the frame.
import type { Side, TrainingMode } from '@mychess/chess';

/** The item asked now, as the header names it. */
export interface HeaderItem {
  readonly name: string;
  readonly side: Side;
  /** The chapter's title; null when the entry has none for it. */
  readonly chapter: string | null;
}

export interface HeaderInput {
  readonly mode: TrainingMode;
  /** The repertoire a scoped session trains; null over every repertoire. */
  readonly scopedName: string | null;
  readonly item: HeaderItem | undefined;
}

/** The catalogue keys (under `training`) the header reads as they are. */
type HeaderWord = 'title.review' | 'title.learn' | 'side.white' | 'side.black';

/** The catalogue as the header reads it: words, and the context's patterns. */
export interface HeaderWords {
  readonly word: (key: HeaderWord) => string;
  /** `training.context.repertoire`: the item's repertoire and side. */
  readonly repertoire: (values: {
    readonly name: string;
    readonly side: string;
  }) => string;
  /** `training.context.chapter`: the item's repertoire, then its chapter. */
  readonly chapter: (values: {
    readonly item: string;
    readonly chapter: string;
  }) => string;
}

export interface SessionHeader {
  readonly title: string;
  /** The item's repertoire, side and chapter; null without an item. */
  readonly context: string | null;
}

/** The item's repertoire with its side, or the side alone when the title names it. */
function repertoireOf(
  item: HeaderItem,
  scoped: boolean,
  words: HeaderWords,
): string {
  const side = words.word(`side.${item.side}`);
  return scoped ? side : words.repertoire({ name: item.name, side });
}

/**
 * The top bar's title and context line: a scoped session is titled by its
 * repertoire, so the line under it gives only the side and chapter.
 */
export function sessionHeader(
  { mode, scopedName, item }: HeaderInput,
  words: HeaderWords,
): SessionHeader {
  const title = scopedName ?? words.word(`title.${mode}`);
  if (item === undefined) return { title, context: null };
  const repertoire = repertoireOf(item, scopedName !== null, words);
  const { chapter } = item;
  const context =
    chapter === null || chapter === ''
      ? repertoire
      : words.chapter({ item: repertoire, chapter });
  return { title, context };
}
