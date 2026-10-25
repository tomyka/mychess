'use client';

import type { Key } from '@lichess-org/chessground/types';
import { useTranslations } from 'next-intl';
import { pieceAt } from './squares';

/** What the board's cursor says for a square of `fen`: "e4, white knight". */
export function useSquareWords(fen: string): (square: Key) => string {
  const t = useTranslations('board');
  return (square) => {
    const piece = pieceAt(fen, square);
    return t('cursor', {
      square,
      piece:
        piece === null ? t('empty') : t(`pieces.${piece.color}.${piece.role}`),
    });
  };
}
