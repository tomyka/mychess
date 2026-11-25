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
  /** `training.context.side`: the side as shown after the repertoire's name. */
  readonly side: (values: { readonly side: string }) => string;
}

/**
 * The context line, whole for screen readers and in parts for the eye, so
 * the name and the chapter can each be cut short and the side never is.
 */
export interface HeaderContext {
  /** The whole line, read once by a screen reader. */
  readonly text: string;
  /** The repertoire's name; null in a scoped session, whose title names it. */
  readonly name: string | null;
  /** The side: after a name in its pattern, else the word alone. */
  readonly side: string;
  /** The chapter's title; null when the entry has none for it. */
  readonly chapter: string | null;
}

export interface SessionHeader {
  readonly title: string;
  /** The item's repertoire, side and chapter; null without an item. */
  readonly context: HeaderContext | null;
}

/** The context line's parts: the name only when the title does not give it. */
function partsOf(
  item: HeaderItem,
  scoped: boolean,
  words: HeaderWords,
): Omit<HeaderContext, 'text'> {
  const side = words.word(`side.${item.side}`);
  const { chapter } = item;
  if (scoped) return { name: null, side, chapter };
  return { name: item.name, side: words.side({ side }), chapter };
}

/** The item's repertoire with its side, or the side alone when the title names it, then the chapter. */
function textOf(item: HeaderItem, scoped: boolean, words: HeaderWords): string {
  const side = words.word(`side.${item.side}`);
  const repertoire = scoped
    ? side
    : words.repertoire({ name: item.name, side });
  const { chapter } = item;
  return chapter === null
    ? repertoire
    : words.chapter({ item: repertoire, chapter });
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
  const scoped = scopedName !== null;
  return {
    title,
    context: {
      text: textOf(item, scoped, words),
      ...partsOf(item, scoped, words),
    },
  };
}
