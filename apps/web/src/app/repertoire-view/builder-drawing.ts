'use client';

// The builder's drawing (decision 16): draw mode's taps and mouse drawing,
// each change saved at once (`setMarks`). Internal to the builder
// (use-repertoire-builder.tsx).
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import type { MarkColor, Marks } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useState, type ActionDispatch } from 'react';
import { marksOf, toggleMark } from '../board/shapes';
import { markChange } from './board-play';
import type { Edit } from './builder-edit';
import type { ScreenAction, ScreenState } from './screen-state';
import { canMark } from './use-screen';

/** What draw mode and mouse drawing do, and what they announce. */
export interface Drawing {
  readonly said: string;
  readonly onSquare: (square: Key) => void;
  readonly onShapes: (shapes: DrawShape[]) => void;
  readonly onEscape: () => void;
}

type Dispatch = ActionDispatch<[action: ScreenAction]>;

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
 * Draw mode: a first square, then a second toggles an arrow (or, the same
 * square, a circle) in the chosen colour; mouse drawing saves the same way.
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
