'use client';

import { chapterOf, type Chapter } from '@mychess/chess';
import type { JSX, ReactNode } from 'react';
import type { ChapterNames } from '../../lib/chapter-label';
import { ChapterList, type ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import { MoveList, type MoveListProps } from './move-list';
import { KnowSection } from './know-section';
import { PositionBody } from './position-body';
import type { PanelTraining } from './panel-training';
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
   * The player's training of it: "I know this" on the current move and its
   * line (R-58), the line's Learn link (R-206) and, while browsing, each
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
        mode={state.mode}
        commentEditor={content.commentEditor}
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
 * On a phone the scroller; on a desktop `display: contents`, so its
 * children join the panel's flex column (the panel scrolls with the page,
 * #331) and the comment strip, earlier in the DOM, can sit above the move
 * list by flex order (comment-strip.tsx). `space-y-4` keeps the gaps there.
 */
const SCROLLER =
  'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-gutter py-3 lg:contents lg:space-y-4';

/**
 * The move list's box: on a desktop it scrolls on its own, at most about
 * half a screen high, so stepping keeps the comment above it in view; on a
 * phone the whole panel scrolls. `lg:order-1` keeps it after the comment
 * strip; anything placed after the move list needs it too.
 */
const MOVES_BOX = 'lg:order-1 lg:max-h-[50dvh] lg:min-h-40 lg:overflow-y-auto';

/**
 * The scrolling part of the panel: the view's lead, the chapter line, the
 * position (the move's notes, then "I know this"; in builder mode also the
 * intro or the comment field), then the moves. While browsing the comment
 * strip shows the intro and the comment: above this scroller on a phone,
 * between the position and the moves on a desktop. Apart from the strip on
 * a desktop, the DOM order is the visual order, so Tab follows what the
 * eye sees (WCAG 2.4.3).
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
        content.empty
      ) : (
        <ChapterPosition chapter={chapter} state={state} content={content} />
      )}
      {chapter === undefined ? null : (
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
      )}
    </div>
  );
}
