// The training top bar's words (R-224), resolved in one place: the
// session's name as the title (a scoped session's repertoire, else the
// mode's), and under it the item the drill reports by its ids: its
// repertoire, side and chapter, named from the training data. Pure, over
// the catalogue's translator, so the rule is tested apart from the frame.
import type { TrainingData } from '../../lib/training-data';

/** The item a drill asks now, by its ids. */
export interface ItemIds {
  readonly repertoireId: string | undefined;
  readonly chapterId: string | undefined;
}

/** The session the header names. */
export interface HeaderScope {
  readonly data: Pick<TrainingData, 'mode' | 'entries'>;
  /** The repertoire the page is scoped to (R-142); null over every one. */
  readonly scopedId: string | null;
}

/** The catalogue keys (under `training`) the header reads. */
type HeaderKey =
  | 'title.review'
  | 'title.learn'
  | 'side.white'
  | 'side.black'
  | 'context.repertoire'
  | 'context.chapter'
  | 'context.side';

/** The catalogue's translator under `training`, as the header reads it. */
export type HeaderTranslator = (
  key: HeaderKey,
  values?: Record<string, string>,
) => string;

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
  /** The item's repertoire, side and chapter; null without a known item. */
  readonly context: HeaderContext | null;
}

type Entry = TrainingData['entries'][number];

/** The context line of `entry`'s item in `chapterId`, the name left to a scoped title. */
function contextOf(
  entry: Entry,
  chapterId: string | undefined,
  scoped: boolean,
  t: HeaderTranslator,
): HeaderContext {
  const side = t(`side.${entry.side}`);
  const chapter =
    (chapterId === undefined ? undefined : entry.chapterTitles[chapterId]) ??
    null;
  const repertoire = scoped
    ? side
    : t('context.repertoire', { name: entry.name, side });
  const text =
    chapter === null
      ? repertoire
      : t('context.chapter', { item: repertoire, chapter });
  if (scoped) return { text, name: null, side, chapter };
  return { text, name: entry.name, side: t('context.side', { side }), chapter };
}

/**
 * The top bar's title and context line for `item`: a scoped session is
 * titled by its repertoire, so the line under it gives only the side and
 * chapter. No item, or one of no known repertoire, has no context line.
 */
export function sessionHeader(
  { data, scopedId }: HeaderScope,
  item: ItemIds | undefined,
  t: HeaderTranslator,
): SessionHeader {
  const entryOf = (id: string | null | undefined): Entry | undefined =>
    data.entries.find((e) => e.id === id);
  const scoped = entryOf(scopedId);
  const title = scoped?.name ?? t(`title.${data.mode}`);
  const entry = entryOf(item?.repertoireId);
  if (entry === undefined) return { title, context: null };
  const context = contextOf(entry, item?.chapterId, scoped !== undefined, t);
  return { title, context };
}
