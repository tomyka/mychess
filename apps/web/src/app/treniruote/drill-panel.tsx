'use client';

// The panel pieces both drills show (docs/design/training-screen.md): the
// side to move, the move field or the promotion choice, and the line so far.
import { sideToMove, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, type JSX } from 'react';
import { MoveInput } from '../board/move-input';
import { PromotionPicker } from '../board/promotion-picker';
import { moveNumber } from '../repertoire-view';
import type { MoveInput as DrillMoveInput } from './drill-input';

type Color = 'white' | 'black';

/** The side-to-move dot and its words. */
export function ToMove({ color }: { readonly color: Color }): JSX.Element {
  const t = useTranslations('training.drill');
  return (
    <p className="flex items-center gap-2 text-sm text-fg-muted">
      <span
        aria-hidden="true"
        className={`size-3 rounded-full border border-border-strong ${color === 'white' ? 'bg-white' : 'bg-black'}`}
      />
      {t(`toMove.${color}`)}
    </p>
  );
}

/** The typed-move field, or the promotion choice in its place. */
export function MoveRow({
  input,
  color,
}: {
  readonly input: DrillMoveInput;
  readonly color: Color;
}): JSX.Element {
  if (input.promotion !== null)
    return (
      <PromotionPicker
        color={color}
        onPick={input.pick}
        onCancel={input.cancel}
      />
    );
  // A row of its own: the field grows across it, not down the panel.
  return (
    <div className="flex">
      <MoveInput onTyped={input.onTyped} />
    </div>
  );
}

/** Moves from `rootKey` as a line is written: `1. d4 d5 2. Bf4`. */
function lineText(moves: readonly RepertoireMove[], rootKey: string): string {
  const whiteFirst = sideToMove(rootKey) === 'w';
  return moves
    .map((move, ply) => {
      const white = (ply + (whiteFirst ? 0 : 1)) % 2 === 0;
      return white || ply === 0
        ? `${moveNumber(ply, whiteFirst)} ${move.san}`
        : move.san;
    })
    .join(' ');
}

/**
 * The moves so far on the line from `rootKey`, newest last, as one row that
 * scrolls sideways. Whenever the line changes the row jumps to its end (no
 * smooth scroll, so reduced motion holds), keeping the newest move in view;
 * the text stays whole for screen readers.
 */
export function LineSoFar({
  moves,
  rootKey,
}: {
  readonly moves: readonly RepertoireMove[];
  readonly rootKey: string | undefined;
}): JSX.Element {
  const t = useTranslations('training.drill');
  const text =
    rootKey === undefined || moves.length === 0
      ? null
      : lineText(moves, rootKey);
  const row = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const element = row.current;
    if (element !== null) element.scrollLeft = element.scrollWidth;
  }, [text]);
  return (
    <div>
      <h2 className="sr-only">{t('line')}</h2>
      {text === null ? null : (
        <p
          ref={row}
          className="overflow-x-auto text-sm whitespace-nowrap text-fg-muted tabular-nums"
        >
          {text}
        </p>
      )}
    </div>
  );
}
