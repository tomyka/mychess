'use client';

// The panel pieces both drills show (docs/design/training-screen.md): the
// side to move, the move field or the promotion choice, and the line so far.
import {
  annotatedSan,
  lineText,
  moveNumber,
  sideToMove,
  type RepertoireMove,
} from '@mychess/chess';
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, type JSX } from 'react';
import { MoveInput } from '../board/move-input';
import { PromotionPicker } from '../board/promotion-picker';
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

/** A move as the line shows it: its SAN and the glyphs of its NAGs (R-175). */
const shownSan = (move: RepertoireMove): string =>
  annotatedSan(move.san, move.nags);

/** One row of the desktop move list: `2.  Nf3  d6`. */
interface ListRow {
  readonly number: string;
  readonly white: string;
  readonly black: string;
}

/**
 * The moves in rows of a number, White's move and Black's; a line Black
 * opens starts `1...` with an empty White cell.
 */
function listRows(
  moves: readonly RepertoireMove[],
  whiteFirst: boolean,
): ListRow[] {
  const offset = whiteFirst ? 0 : 1;
  const sans = [...(whiteFirst ? [] : ['']), ...moves.map(shownSan)];
  return Array.from({ length: Math.ceil(sans.length / 2) }, (_, row) => ({
    number: moveNumber(Math.max(0, 2 * row - offset), whiteFirst),
    white: sans[2 * row] ?? '',
    black: sans[2 * row + 1] ?? '',
  }));
}

interface Layouts {
  readonly text: string;
  readonly rows: readonly ListRow[];
}

function layoutsOf(
  moves: readonly RepertoireMove[],
  rootKey: string | undefined,
): Layouts | null {
  if (rootKey === undefined || moves.length === 0) return null;
  const whiteFirst = sideToMove(rootKey) === 'w';
  return {
    text: lineText(moves.map(shownSan), whiteFirst),
    rows: listRows(moves, whiteFirst),
  };
}

/**
 * The moves so far on the line from `rootKey`, newest last. A phone shows
 * them as one row that scrolls sideways; a desktop as the design's
 * two-column move list in the panel, in a box of its own that takes the
 * panel's spare height and scrolls itself, so a long line never scrolls the
 * panel and hides the move field above it (#323). Only one of the two is
 * displayed at a width, so a screen reader hears the line once. Whenever
 * the line changes the shown layout jumps to its newest move (no smooth
 * scroll, so reduced motion holds).
 */
export function LineSoFar({
  moves,
  rootKey,
}: {
  readonly moves: readonly RepertoireMove[];
  readonly rootKey: string | undefined;
}): JSX.Element {
  const t = useTranslations('training.drill');
  const layouts = layoutsOf(moves, rootKey);
  const row = useRef<HTMLParagraphElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const text = layouts?.text;
  useLayoutEffect(() => {
    const element = row.current;
    if (element !== null) element.scrollLeft = element.scrollWidth;
    const scroller = box.current;
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }, [text]);
  return (
    <div ref={box} className="lg:min-h-0 lg:overflow-y-auto">
      <h2 className="sr-only">{t('line')}</h2>
      {layouts === null ? null : (
        <>
          <p
            ref={row}
            className="overflow-x-auto text-sm whitespace-nowrap text-fg-muted tabular-nums lg:hidden"
          >
            {layouts.text}
          </p>
          <ol className="hidden grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 tabular-nums lg:grid">
            {layouts.rows.map(({ number, white, black }) => (
              <li key={number} className="col-span-3 grid grid-cols-subgrid">
                <span className="text-fg-muted">{number}</span>
                <span>{white}</span>
                <span>{black}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
