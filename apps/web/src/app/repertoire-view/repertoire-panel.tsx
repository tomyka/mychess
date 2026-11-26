'use client';

import { chapterOf, type Chapter } from '@mychess/chess';
import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import { MoveList, type MoveListProps } from './move-list';
import type { PanelTraining } from './panel-training';
import { PositionBody, PositionEdit } from './position-body';
import { TrainHere } from './train-here';
import type { RepertoireView } from './view';

/** What a view puts in the panel; the panel derives the rest from the view. */
export interface PanelContent {
  /**
   * First in the panel's scroller at every width (sign-off): the summary line
   * (SummaryLine) with Review, Learn and an assignment's status strip, or
   * the coach's line with the player's name. Out of the top bar, so the
   * phone keeps one row above the board.
   */
  readonly summary?: ReactNode;
  /** A line over the chapters (the assigned view's changes since the last visit). */
  readonly lead?: ReactNode;
  /**
   * A line under the move list, by the notes (the coach's "read-only");
   * after the empty state in a repertoire without chapters.
   */
  readonly afterMoves?: ReactNode;
  /** Builder mode: add, rename and delete chapters. */
  readonly chapterBuilder?: ChapterBuilder | undefined;
  /** What shows in place of the position in a repertoire without chapters. */
  readonly empty: ReactNode;
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly commentEditor?: CommentEditor | undefined;
  /** What the comment strip is called, if not "Comment" (a coach's: Coach note). */
  readonly commentLabel?: string | undefined;
  /** The notes under a move's comment, given the move's key. */
  readonly renderNotes?: ((moveKey: string) => ReactNode) | undefined;
  /** The moves the move list marks as carrying the viewer's own note. */
  readonly notedMoves: Readonly<Record<string, string>>;
  readonly noteKind?: MoveListProps['noteKind'];
  /** The moves carrying a coach note kept by a fork (R-47). */
  readonly keptNoteMoves?: MoveListProps['keptNoteMoves'];
  /**
   * The player's training of it: while browsing, Train here under the move
   * list (Learn this line or chapter, R-206; "I know this", R-227) and each
   * chapter's standing (R-225). Absent where the viewer does not train it.
   */
  readonly training?: PanelTraining | undefined;
}

interface RepertoirePanelProps {
  readonly view: RepertoireView;
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  readonly content: PanelContent;
}

/**
 * Under the move list: Train here while a player who trains it browses
 * (spec, "Train here (browse)"), the view's line under the moves, then the
 * move's notes.
 */
function UnderMoves({
  chapter,
  state,
  content,
}: {
  readonly chapter: Chapter;
  readonly state: RepertoireView['state'];
  readonly content: PanelContent;
}): JSX.Element {
  const move = state.path.at(-1);
  return (
    <>
      {content.training === undefined || state.mode !== 'browse' ? null : (
        <TrainHere
          training={content.training}
          graph={state.graph}
          chapterId={chapter.id}
          path={state.path}
        />
      )}
      {content.afterMoves}
      {/* No box at the root, where there are no notes: it would add a gap. */}
      {move === undefined ? null : (
        <PositionBody move={move} renderNotes={content.renderNotes} />
      )}
    </>
  );
}

/**
 * On a phone the scroller; on a desktop a plain column that grows with its
 * content, so the panel scrolls with the page (#331).
 */
const SCROLLER =
  'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-gutter pt-2 pb-3 lg:flex-none lg:gap-4 lg:overflow-visible lg:p-0';

/**
 * The move list's box: on a desktop it scrolls on its own, at most about
 * half a screen high, so stepping keeps the comment strip above it in
 * view; on a phone the whole panel scrolls.
 */
const MOVES_BOX = 'lg:max-h-[50dvh] lg:min-h-40 lg:overflow-y-auto';

/**
 * The scrolling part of the panel: the view's summary line, its lead, the
 * chapter line, in builder mode the intro or the comment field, the moves,
 * then Train here and the move's notes. While browsing the comment strip
 * shows the intro and the comment just above this scroller, at every
 * width. The DOM order is the visual order, so Tab follows what the eye
 * sees (WCAG 2.4.3).
 */
export function RepertoirePanel({
  view,
  names,
  content,
}: RepertoirePanelProps): JSX.Element {
  const { state, dispatch } = view;
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  return (
    <div data-panel-scroller="" className={SCROLLER}>
      {content.summary}
      {content.lead}
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        names={names}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
        builder={content.chapterBuilder}
        standings={
          state.mode === 'browse' ? content.training?.chapters : undefined
        }
      />
      {chapter === undefined ? (
        // No chapter: the view's empty state, then its line under the moves.
        <>
          {content.empty}
          {content.afterMoves}
        </>
      ) : (
        <ChapterBody chapter={chapter} view={view} content={content} />
      )}
    </div>
  );
}

/**
 * The current chapter's part of the scroller: in builder mode the intro or
 * the comment field, the moves, then what goes under them.
 */
function ChapterBody({
  chapter,
  view,
  content,
}: {
  readonly chapter: Chapter;
  readonly view: RepertoireView;
  readonly content: PanelContent;
}): JSX.Element {
  const { state, dispatch } = view;
  return (
    <>
      <PositionEdit
        intro={chapter.intro}
        move={state.path.at(-1) ?? null}
        mode={state.mode}
        commentEditor={content.commentEditor}
      />
      <div data-moves="" className={MOVES_BOX}>
        <MoveList
          graph={state.graph}
          chapterId={state.chapterId}
          path={state.path}
          notedMoves={content.notedMoves}
          noteKind={content.noteKind}
          keptNoteMoves={content.keptNoteMoves}
          building={state.mode === 'build'}
          onGoto={(path) => {
            dispatch({ type: 'goto', path });
          }}
        />
      </div>
      <UnderMoves chapter={chapter} state={state} content={content} />
    </>
  );
}
