'use client';

// What the repertoire page says about the board: its accessible name, the
// cursor square, and each step for screen readers.
import type { Key } from '@lichess-org/chessground/types';
import { chapterChildren, chapterOf, sideToMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
import { chapterLabel } from '../../lib/chapter-label';
import { pieceAt } from '../board/squares';
import { moveNumber } from './board-play';
import type { ScreenState } from './screen-state';

/** The board's accessible name, and what to say for the cursor square. */
export interface BoardWords {
  readonly label: string;
  readonly describe: (square: Key) => string;
}

/** The board's accessible name and its cursor announcement. */
export function useBoardWords(
  name: string,
  state: ScreenState,
  fen: string,
  ecoNames: Readonly<Record<string, string>>,
): BoardWords {
  const t = useTranslations();
  const chapter =
    state.chapterId === null
      ? undefined
      : chapterOf(state.graph, state.chapterId);
  return {
    label:
      chapter === undefined
        ? t('repertoires.board.labelNoChapter', { name })
        : t('repertoires.board.label', {
            name,
            chapter: chapterLabel(t, ecoNames)(chapter),
          }),
    describe: (square: Key): string => {
      const piece = pieceAt(fen, square);
      return t('board.cursor', {
        square,
        piece:
          piece === null
            ? t('board.empty')
            : t(`board.pieces.${piece.color}.${piece.role}`),
      });
    },
  };
}

/** The last step for screen readers: "6. Be2", and "end of line" at a leaf. */
export function Announcer({
  state,
}: {
  readonly state: ScreenState;
}): JSX.Element {
  const t = useTranslations('repertoires.nav');
  const last = state.path.at(-1);
  let text = '';
  if (last !== undefined && state.chapterId !== null) {
    const root = chapterOf(state.graph, state.chapterId)?.rootKey ?? last.from;
    const move = `${moveNumber(state.path.length - 1, sideToMove(root) === 'w')} ${last.san}`;
    const leaf =
      chapterChildren(state.graph)(state.chapterId)(last.to).length === 0;
    text = leaf ? t('endOfLine', { move }) : move;
  }
  return (
    <p aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
