'use client';

import { chapterOf, type Chapter } from '@mychess/chess';
import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import { MoveList, type MoveListProps } from './move-list';
import { KnowSection } from './know-section';
import { PositionBody } from './position-body';
import { TrainButtons, type PanelTraining } from './train-buttons';
import type { RepertoireView } from './view';

/** What a view puts in the panel; the panel derives the rest from the view. */
export interface PanelContent {
  /** A line over the chapters (the coach's "read-only"). */
  readonly lead?: ReactNode;
  /** Builder mode: add, rename and delete chapters. */
  readonly chapterBuilder?: ChapterBuilder | undefined;
  /** What shows in place of the position in a repertoire without chapters. */
  readonly empty: ReactNode;
  /** Builder mode: the comment is a field (R-102, R-105). */
  readonly commentEditor?: CommentEditor | undefined;
  /** What the comments are called, if not "Comment" (a coach's: Coach note). */
  readonly commentLabel?: string | undefined;
  /** The notes under a move's comment, given the move's key. */
  readonly renderNotes?: ((moveKey: string) => ReactNode) | undefined;
  /** The moves the move list marks as carrying the viewer's own note. */
  readonly notedMoves: Readonly<Record<string, string>>;
  readonly noteKind?: MoveListProps['noteKind'];
  /** The moves carrying a coach note kept by a fork (R-47). */
  readonly keptNoteMoves?: MoveListProps['keptNoteMoves'];
  /**
   * The player's training of it: the train buttons first, and "I know
   * this" on the current move, its line and each chapter (R-58, R-142).
   * Absent where the viewer does not train it.
   */
  readonly training?: PanelTraining | undefined;
  /** What follows the moves (the owner's actions and sharing). */
  readonly footer?: ReactNode;
}

interface RepertoirePanelProps {
  readonly view: RepertoireView;
  /** What titles the chapters (decision 17, R-158). */
  readonly names: ChapterNames;
  readonly content: PanelContent;
}

/** The position section, then "I know this" for a player who trains it. */
function ChapterPosition({
  chapter,
  state,
  content,
}: {
  readonly chapter: Chapter;
  readonly state: RepertoireView['state'];
  readonly content: PanelContent;
}): JSX.Element {
  return (
    <>
      <PositionBody
        intro={chapter.intro}
        move={state.path.at(-1) ?? null}
        commentEditor={content.commentEditor}
        commentLabel={content.commentLabel}
        renderNotes={content.renderNotes}
      />
      {content.training === undefined ? null : (
        <KnowSection
          training={content.training}
          graph={state.graph}
          chapterId={chapter.id}
          path={state.path}
        />
      )}
    </>
  );
}

/**
 * The scrolling part of the panel: for a player who trains it the train
 * buttons, then chapters, the position (the chapter's intro, or the
 * current move's comment and notes, then "I know this"), then the moves. The DOM
 * order is the visual order at every width, so Tab follows what the eye sees (WCAG 2.4.3).
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0">
      {content.training === undefined ? null : (
        <TrainButtons training={content.training} />
      )}
      {content.lead}
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        names={names}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
        builder={content.chapterBuilder}
        training={content.training}
      />
      {chapter === undefined ? (
        content.empty
      ) : (
        <ChapterPosition chapter={chapter} state={state} content={content} />
      )}
      {chapter === undefined ? null : (
        // On a desktop the moves scroll on their own, so stepping keeps the
        // comment above them in view; on a phone the whole panel scrolls.
        <div className="lg:min-h-40 lg:flex-1 lg:overflow-y-auto">
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
      )}
      {content.footer}
    </div>
  );
}
