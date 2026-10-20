'use client';

import { chapterOf } from '@mychess/chess';
import type { JSX, ReactNode } from 'react';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import { MoveList, type MoveListProps } from './move-list';
import { PositionBody } from './position-body';
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
  /** What follows the moves (the owner's actions and sharing). */
  readonly footer?: ReactNode;
}

interface RepertoirePanelProps {
  readonly view: RepertoireView;
  /** The opening names the chapters are named after (decision 17). */
  readonly ecoNames: Readonly<Record<string, string>>;
  readonly content: PanelContent;
}

/**
 * The scrolling part of the panel: chapters, then the position (the
 * chapter's intro, or the current move's comment and notes), then the
 * moves. The DOM order is the visual order at every width, so Tab follows
 * what the eye sees (WCAG 2.4.3).
 */
export function RepertoirePanel({
  view,
  ecoNames,
  content,
}: RepertoirePanelProps): JSX.Element {
  const { state, dispatch } = view;
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:px-0">
      {content.lead}
      <ChapterList
        chapters={state.graph.chapters}
        chapterId={state.chapterId}
        ecoNames={ecoNames}
        onSelect={(chapterId) => {
          dispatch({ type: 'chapter', chapterId });
        }}
        builder={content.chapterBuilder}
      />
      {chapter === undefined ? (
        content.empty
      ) : (
        <PositionBody
          intro={chapter.intro}
          move={state.path.at(-1) ?? null}
          commentEditor={content.commentEditor}
          commentLabel={content.commentLabel}
          renderNotes={content.renderNotes}
        />
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
