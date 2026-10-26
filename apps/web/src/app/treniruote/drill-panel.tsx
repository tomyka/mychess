'use client';

// The panel pieces both drills show (docs/design/training-screen.md): the
// side to move, the move field or the promotion choice, and the line so far.
import { sideToMove, type RepertoireMove } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';
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

/** The moves so far on the line from `rootKey`, newest last. */
export function LineSoFar({
  moves,
  rootKey,
}: {
  readonly moves: readonly RepertoireMove[];
  readonly rootKey: string | undefined;
}): JSX.Element {
  const t = useTranslations('training.drill');
  return (
    <div>
      <h2 className="sr-only">{t('line')}</h2>
      {rootKey === undefined || moves.length === 0 ? null : (
        <p className="overflow-x-auto text-sm whitespace-nowrap text-fg-muted tabular-nums">
          {lineText(moves, rootKey)}
        </p>
      )}
    </div>
  );
}
