'use client';

import {
  chapterOf,
  moveKey,
  type Chapter,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import {
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
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
 * Whether the text, clamped to two lines, runs past them: measured after
 * layout and again whenever the strip is resized (a phone turned, a panel
 * widened), while it is clamped; once expanded, the last answer stands so
 * Less stays. The strip is keyed by move, so each move measures afresh.
 * Where there is no ResizeObserver (jsdom) it measures once.
 */
function useOverflow(open: boolean): {
  readonly ref: RefObject<HTMLParagraphElement | null>;
  readonly overflows: boolean;
} {
  const ref = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const text = ref.current;
    if (text === null || open) return undefined;
    const measure = (): void => {
      setOverflows(text.scrollHeight > text.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => {
      observer.disconnect();
    };
  }, [open]);
  return { ref, overflows };
}

/**
 * The strip's left edge (spec, Comment strip): 2px of `comment-edge`:
 * accent in the dark theme, where `accent-subtle` is close to the page
 * (sign-off); transparent in light, so the text does not shift between
 * themes. Where it sits, under the board row and above the panel's
 * scroller at every width, is the frame's (repertoire-frame.tsx).
 */
const STRIP_EDGE = 'border-l-2 border-l-comment-edge';

/**
 * The strip itself: the view's label as a muted lead-in when it has one,
 * then the move in bold and the text, clamped to two lines; More only when
 * it runs past them (spec, Comment strip). The lead-in is not counted
 * toward the clamp.
 */
function Strip({
  name,
  lead = null,
  move,
  children,
}: {
  readonly name: string;
  /** Whose comment it is (a coach's: "Coach note by X"); none for the owner's. */
  readonly lead?: string | null;
  readonly move: string | null;
  /** How the text is drawn. */
  readonly children: ReactNode;
}): JSX.Element {
  const t = useTranslations('repertoires.panel');
  const [open, setOpen] = useState(false);
  const { ref, overflows } = useOverflow(open);
  return (
    <section
      aria-label={name}
      className={`${STRIP_EDGE} flex flex-col items-start gap-1 bg-accent-subtle px-gutter py-2 text-sm lg:rounded-control lg:px-3`}
    >
      {lead === null ? null : <p className="text-xs text-fg-muted">{lead}</p>}
      <p ref={ref} className={`break-words ${open ? '' : 'line-clamp-2'}`}>
        {move === null ? null : (
          <>
            <strong className="font-semibold">{move}</strong>{' '}
          </>
        )}
        {children}
      </p>
      {overflows ? (
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
 * board row and the panel's scroller at every width. Named "Comment" (or
 * the view's label) or "Chapter intro" from
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
      <Strip key={chapter.id} name={t('intro')} move={null}>
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
    >
      <span>{move.comment}</span>
    </Strip>
  );
}
