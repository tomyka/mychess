// What the builder's edits are, given the screen as it is: a new move, the
// current move removed, the comment field and the chapter list's actions.
// Internal to the builder (use-repertoire-builder.tsx).
import {
  chapterOf,
  moveKey,
  moveNumber,
  removalCount,
  sideToMove,
  START_KEY,
} from '@mychess/chess';
import { placeAdded } from './board-play';
import type { ChapterBuilder } from './chapter-list';
import type { CommentEditor } from './comment';
import type { Edit } from './builder-edit';
import { editsBlocked, type ScreenState } from './screen-state';

/** A new move played on the board or typed, saved where the screen is. */
export function addMove(
  state: ScreenState,
  edit: Edit,
  from: string,
): (san: string) => void {
  const { chapterId, path } = state;
  return (san) => {
    void edit(
      { kind: 'addMove', chapterId, from, san },
      {
        place: (graph) => placeAdded(graph, { chapterId, path }, { from, san }),
      },
    );
  };
}

/** Removes the current move from the chapter, then says "Removed". */
export function removeMove(state: ScreenState, edit: Edit): () => void {
  const last = state.path.at(-1);
  const { chapterId, path } = state;
  return () => {
    if (last === undefined || chapterId === null) return;
    void edit(
      { kind: 'removeMove', chapterId, from: last.from, san: last.san },
      {
        place: () => ({
          path: path.slice(0, -1),
          message: { key: 'repertoires.builder.removeDone', tone: 'success' },
        }),
      },
    );
  };
}

/** The move the builder row removes, as "12. Nf3", and how many go with it. */
export function removalTarget(state: ScreenState): {
  readonly move: string | null;
  readonly count: number;
} {
  const last = state.path.at(-1);
  if (last === undefined || state.chapterId === null)
    return { move: null, count: 0 };
  const root = chapterOf(state.graph, state.chapterId)?.rootKey ?? START_KEY;
  const number = moveNumber(state.path.length - 1, sideToMove(root) === 'w');
  return {
    move: `${number} ${last.san}`,
    count: removalCount(state.graph, state.chapterId, last.from, last.san),
  };
}

/** The comment field on the current move; none at a chapter root. */
export function commentEditor(
  state: ScreenState,
  edit: Edit,
): CommentEditor | undefined {
  const last = state.path.at(-1);
  if (last === undefined) return undefined;
  const key = moveKey(last.from, last.san);
  return {
    disabled: editsBlocked(state),
    onSave: (comment) =>
      edit({ kind: 'editComment', moveKey: key, comment }, { field: true }),
  };
}

/** The chapter list's builder actions: add (and open), rename, delete. */
export function chapterBuilder(state: ScreenState, edit: Edit): ChapterBuilder {
  const current = state.chapterId;
  return {
    disabled: editsBlocked(state),
    onAdd: () => {
      void edit(
        { kind: 'addChapter' },
        {
          place: (graph) => ({
            chapterId: graph.chapters.at(-1)?.id ?? null,
            path: [],
          }),
        },
      );
    },
    onRename: (chapterId, name) =>
      edit({ kind: 'renameChapter', chapterId, name }, { field: true }),
    onDelete: (chapterId) => {
      void edit(
        { kind: 'removeChapter', chapterId },
        {
          place: (graph) =>
            chapterId === current
              ? { chapterId: graph.chapters[0]?.id ?? null, path: [] }
              : {},
        },
      );
    },
  };
}
