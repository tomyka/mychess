'use client';

import { chapterOf, type Chapter } from '@mychess/chess';
import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import { MoveList, type MoveListProps } from './move-list';
import type { RepertoireTraining } from '../../server/training';
import { PositionBody, PositionEdit } from './position-body';
import { TrainHere } from './train-here';
import type { RepertoireView } from './view';

/**
 * First in the panel's scroller at every width (sign-off), out of the top
 * bar so the phone keeps one row above the board.
 */
interface PanelSummary {
  /**
   * The summary line (SummaryLine) with Review, Learn and an assignment's
   * status strip, or the coach's line with the player's name.
   */
  readonly line?: ReactNode;
  /** Under it, over the chapters: an assignment's changes since the last visit. */
  readonly changes?: ReactNode;
}

/**
 * The notes on the moves as the viewer has them: which moves the move list
 * marks and what shows under a move.
 */
interface PanelNotes {
  /** The viewer's own notes by move key; the move list marks their moves. */
  readonly byMove: Readonly<Record<string, string>>;
  /** Whose they are, and so their mark: Personal notes unless a coach's. */
  readonly kind?: MoveListProps['noteKind'];
  /** The moves carrying a coach note kept by a fork (R-47), marked too. */
  readonly kept?: MoveListProps['keptNoteMoves'];
  /**
   * What shows under the move list for the current move, given its key;
   * nothing when absent (the coach's note sits under the comment strip).
   */
  readonly render?: (moveKey: string) => ReactNode;
  /**
   * A line under the move list before them (the coach's "read-only"), at
   * every move; after the empty state in a repertoire without chapters.
   */
  readonly preface?: ReactNode;
}

/** The move's Comment (R-102): what it is called, and in builder mode its field. */
interface PanelComment {
  /** What the comment strip is called, if not "Comment" (an assignment's: Coach note). */
  readonly label?: string | undefined;
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly editor?: CommentEditor | undefined;
}

/**
 * What a view puts in the panel; the panel places it and derives the rest
 * from the view.
 */
export interface PanelContent {
  /** None where the top bar says it all (the coach's shared view). */
  readonly summary?: PanelSummary;
  readonly notes: PanelNotes;
  readonly comment?: PanelComment | undefined;
  /** Builder mode: add, rename and delete chapters. */
  readonly chapterBuilder?: ChapterBuilder | undefined;
  /** What shows in place of the position in a repertoire without chapters. */
  readonly empty: ReactNode;
  /**
   * The player's training of it, as its loader gave it: while browsing,
   * each chapter's standing (R-225, kept while paused, R-228) and, when
   * they may train it now, Train here under the move list (Learn this line
   * or chapter, R-206; "I know this", R-227). Absent or null where the
   * viewer does not train it.
   */
  readonly training?: RepertoireTraining | null | undefined;
}

interface RepertoirePanelProps {
  readonly view: RepertoireView;
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  readonly content: PanelContent;
}

/**
 * Under the move list: Train here while a player who trains it browses
 * (spec, "Train here (browse)"), the notes' preface, then the move's notes.
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
  const trainable = content.training?.trainable ?? null;
  return (
    <>
      {trainable === null || state.mode !== 'browse' ? null : (
        <TrainHere
          training={trainable}
          graph={state.graph}
          chapterId={chapter.id}
          path={state.path}
        />
      )}
      {content.notes.preface}
      {/* No box at the root, where there are no notes: it would add a gap. */}
      {move === undefined ? null : (
        <PositionBody move={move} renderNotes={content.notes.render} />
      )}
    </>
  );
}

/**
 * The move list's box: on a desktop it takes the room the panel leaves (at
 * least 10rem) and scrolls on its own, so selecting a move scrolls only
 * this box and the page never scrolls (Task 18); on a phone the whole
 * panel scrolls.
 */
const MOVES_BOX = 'lg:min-h-40 lg:flex-1 lg:overflow-y-auto';

/**
 * What scrolls in the panel (the frame's scroller): the view's summary
 * line and any changes since the last visit, the chapter line, in builder
 * mode the intro or the comment field, the moves, then Train here, the
 * notes' preface and the move's notes. While browsing the comment strip
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
    <>
      {content.summary?.line}
      {content.summary?.changes}
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
        // No chapter: the view's empty state, then the notes' preface.
        <>
          {content.empty}
          {content.notes.preface}
        </>
      ) : (
        <ChapterBody chapter={chapter} view={view} content={content} />
      )}
    </>
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
        commentEditor={content.comment?.editor}
      />
      <div data-moves="" className={MOVES_BOX}>
        <MoveList
          graph={state.graph}
          chapterId={state.chapterId}
          path={state.path}
          notedMoves={content.notes.byMove}
          noteKind={content.notes.kind}
          keptNoteMoves={content.notes.kept}
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
