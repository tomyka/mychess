'use client';

// Builder mode's hooks (docs/design/repertoire-screen.md, Phone, builder):
// every edit goes through editRepertoireAction with the version the screen
// holds, one at a time; the chess package decides each one on the server.
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import {
  chapterOf,
  moveKey,
  moveNumber,
  removalCount,
  sideToMove,
  START_KEY,
  type EditOp,
  type MarkColor,
  type Marks,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ChapterNames } from '../../../lib/chapter-label';
import { marksOf, toggleMark } from '../../board/shapes';
import { editRepertoireAction } from './actions';
import {
  canMark,
  markChange,
  placeAdded,
  SAVING,
  type ChapterBuilder,
  type CommentEditor,
  type FieldOutcome,
  type RepertoireView,
  type ScreenMessage,
} from '../../repertoire-view';

type ScreenState = RepertoireView['state'];
type Dispatch = RepertoireView['dispatch'];

/** Where the screen goes once an edit is saved. */
interface Placement {
  readonly chapterId?: string | null;
  readonly path?: readonly RepertoireMove[];
  readonly message?: ScreenMessage;
}

/** One edit: `place` says where to go after it; a `field` shows its own refusal. */
export type Edit = (
  op: EditOp,
  options?: {
    readonly place?: (graph: RepertoireGraph) => Placement;
    readonly field?: boolean;
  },
) => Promise<FieldOutcome>;

/** After this long a save says "Saving" (docs/design, Saving). */
const SAVING_AFTER_MS = 1000;
const FAILED = 'repertoires.failed';

/**
 * Sends one edit with the screen's version and lands its outcome: the new
 * graph and what titles its chapters, or the refusal. A board edit's refusal shows
 * in the status line and puts the pieces back; a field shows its own,
 * unless the repertoire changed elsewhere, which the whole screen shows.
 */
export function editor(
  repertoireId: string,
  state: ScreenState,
  dispatch: Dispatch,
  onNames: (names: ChapterNames) => void,
): Edit {
  const refuse = (refusal: string, field: boolean): FieldOutcome => {
    if (field && refusal !== 'repertoire.stale') dispatch({ type: 'settled' });
    else {
      dispatch({ type: 'refused', reason: refusal });
      dispatch({ type: 'reset' });
    }
    return { ok: false, refusal };
  };
  return async (op, { place, field = false } = {}) => {
    dispatch({ type: 'saving' });
    const timer = setTimeout(() => {
      dispatch({
        type: 'say',
        message: { key: SAVING, tone: 'info' },
      });
    }, SAVING_AFTER_MS);
    try {
      const outcome = await editRepertoireAction({
        repertoireId,
        version: state.version,
        op,
      });
      if (!outcome.ok) return refuse(outcome.refusal, field);
      onNames(outcome.names);
      const { graph, version } = outcome;
      dispatch({ type: 'saved', graph, version, ...place?.(graph) });
      return { ok: true };
    } catch {
      return refuse(FAILED, field);
    } finally {
      clearTimeout(timer);
    }
  };
}

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

/** What draw mode and mouse drawing do, and what they announce. */
export interface Drawing {
  readonly said: string;
  readonly onSquare: (square: Key) => void;
  readonly onShapes: (shapes: DrawShape[]) => void;
  readonly onEscape: () => void;
}

/** The words for a mark just toggled: "Arrow e2 to e4, red, added". */
function useMarkWords() {
  const t = useTranslations('repertoires');
  return (marks: Marks, from: string, to: string, color: MarkColor): string => {
    const change = markChange(marks, from, to);
    const values = {
      color: t(`colors.${color}`),
      change: change.added ? 'added' : 'removed',
    };
    return change.kind === 'arrow'
      ? t('builder.arrowSaid', { ...values, from, to })
      : t('builder.circleSaid', { ...values, square: from });
  };
}

/**
 * Draw mode (decision 16): a first square, then a second toggles an arrow
 * (or, the same square, a circle) in the chosen colour; mouse drawing saves
 * the same way. Each change is saved at once (`setMarks`).
 */
export function useDrawing(
  state: ScreenState,
  dispatch: Dispatch,
  edit: Edit,
): Drawing {
  const t = useTranslations('repertoires.builder');
  const words = useMarkWords();
  const [said, setSaid] = useState('');
  const last = state.path.at(-1);
  const { chapterId } = state;
  const save = (marks: Marks): void => {
    if (last === undefined || chapterId === null) return;
    const { from, san } = last;
    const copied = { arrows: [...marks.arrows], circles: [...marks.circles] };
    void edit({ kind: 'setMarks', chapterId, from, san, marks: copied });
  };
  return {
    said,
    onSquare(square) {
      if (!state.drawMode || last === undefined || !canMark(state)) return;
      const first = state.drawFrom;
      if (first === null) {
        dispatch({ type: 'drawFrom', square });
        setSaid(t('drawFrom', { square }));
        return;
      }
      const marks = toggleMark(last, first, square, state.drawColor);
      dispatch({ type: 'drawFrom', square: null });
      setSaid(words(marks, first, square, state.drawColor));
      save(marks);
    },
    onShapes(shapes) {
      if (canMark(state)) save(marksOf(shapes));
    },
    onEscape() {
      if (state.drawFrom !== null) dispatch({ type: 'drawFrom', square: null });
      else if (state.drawMode) dispatch({ type: 'draw', on: false });
    },
  };
}

/** Removes the current move from the chapter, then says "Removed". */
export function useRemoveMove(state: ScreenState, edit: Edit): () => void {
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

/** The move the builder bar removes, as "12. Nf3", and how many go with it. */
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

/** The builder's comment field on the current move. */
export function commentEditor(
  state: ScreenState,
  edit: Edit,
): CommentEditor | undefined {
  const last = state.path.at(-1);
  if (state.mode !== 'build' || last === undefined) return undefined;
  const key = moveKey(last.from, last.san);
  return {
    disabled: state.saving || state.stale,
    onSave: (comment) =>
      edit({ kind: 'editComment', moveKey: key, comment }, { field: true }),
  };
}

/** The chapter list's builder actions: add (and open), rename, delete. */
export function chapterBuilder(
  state: ScreenState,
  edit: Edit,
): ChapterBuilder | undefined {
  if (state.mode !== 'build') return undefined;
  const current = state.chapterId;
  return {
    disabled: state.saving || state.stale,
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
