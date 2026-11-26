'use client';

import {
  chapterOf,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useState, type JSX, type ReactNode } from 'react';
import { IntroText } from './intro-text';
import { moveLabel } from './move-label';
import type { ScreenState } from './screen-state';

export interface CommentStripProps {
  readonly graph: RepertoireGraph;
  /** The current chapter, whose intro shows at its root (R-66). */
  readonly chapter: Chapter;
  /** The moves from the chapter root to the current one. */
  readonly path: readonly RepertoireMove[];
  /** What the comment is called, if not "Comment" (a coach's: Coach note). */
  readonly label?: string | undefined;
}

/**
 * A text over this many characters is clamped to two lines, with More: a
 * pure stand-in for "runs past two lines", so nothing measures the layout.
 */
const CLAMP_OVER_CHARS = 140;

/**
 * Where the strip sits (spec, Comment strip): one element, placed by the
 * panel's flex order. On a phone it is in the DOM's place, between the
 * board row and the panel's scroller. On a desktop the scroller is
 * `display: contents` (repertoire-panel.tsx), so its children share this
 * flex column, and `order-1` puts the strip after the chapter line, right
 * above the move list, which carries `order-1` too.
 */
const STRIP_PLACE = 'shrink-0 lg:order-1 lg:mb-4';

/**
 * The strip itself: the view's label as a muted lead-in when it has one,
 * then the move in bold and the text; More past two lines. The lead-in
 * is not counted toward the clamp.
 */
function Strip({
  name,
  lead = null,
  move,
  text,
  children,
}: {
  readonly name: string;
  /** Whose comment it is (a coach's: "Coach note by X"); none for the owner's. */
  readonly lead?: string | null;
  readonly move: string | null;
  /** The text, which decides the clamp. */
  readonly text: string;
  /** How the text is drawn. */
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations('repertoires.panel');
  const [open, setOpen] = useState(false);
  const long = text.length > CLAMP_OVER_CHARS;
  const clamp = long && !open ? 'line-clamp-2' : '';
  return (
    <section
      aria-label={name}
      className={`${STRIP_PLACE} flex flex-col items-start gap-1 bg-accent-subtle px-gutter py-2 text-sm lg:rounded-control lg:px-3`}
    >
      {lead === null ? null : <p className="text-xs text-fg-muted">{lead}</p>}
      <p className={`break-words ${clamp}`}>
        {move === null ? null : (
          <>
            <strong className="font-semibold">{move}</strong>{' '}
          </>
        )}
        {children}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
          className="inline-flex min-h-touch items-center font-semibold text-accent hover:underline"
        >
          {open ? t('less') : t('more')}
        </button>
      ) : null}
    </section>
  );
}

/**
 * The strip for the screen's state: while browsing a chapter only; the
 * builder keeps its comment field in the panel (spec, Builder).
 */
export function BrowseCommentStrip({
  state,
  label,
}: {
  readonly state: ScreenState;
  readonly label?: string | undefined;
}): JSX.Element | null {
  if (state.mode !== 'browse' || state.chapterId === null) return null;
  const chapter = chapterOf(state.graph, state.chapterId);
  if (chapter === undefined) return null;
  return (
    <CommentStrip
      graph={state.graph}
      chapter={chapter}
      path={state.path}
      label={label}
    />
  );
}

/**
 * The comment strip (spec, Comment strip): the current move's comment, or
 * the chapter's intro at its root, while browsing: pinned between the
 * board row and the panel's scroller on a phone, above the move list on a
 * desktop. Named "Comment" (or the view's label) or "Chapter intro" from
 * the catalogue. Nothing when there is neither.
 */
export function CommentStrip({
  graph,
  chapter,
  path,
  label,
}: CommentStripProps): JSX.Element | null {
  const t = useTranslations('repertoires.panel');
  const move = path.at(-1);
  if (move === undefined)
    return chapter.intro === null ? null : (
      <Strip
        key={chapter.id}
        name={t('intro')}
        move={null}
        text={chapter.intro}
      >
        <IntroText intro={chapter.intro} />
      </Strip>
    );
  if (move.comment === null) return null;
  return (
    <Strip
      key={moveKey(move.from, move.san)}
      name={label ?? t('comment')}
      lead={label ?? null}
      move={moveLabel(graph, chapter.id, path, move)}
      text={move.comment}
    >
      <span>{move.comment}</span>
    </Strip>
  );
}
