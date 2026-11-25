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
import { useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { PromotionPicker } from '../board/promotion-picker';
import { Icon, TICK_ICON } from '../line-icon';
import type { MoveInput as DrillMoveInput } from './drill-input';
import { MoveEntry } from './move-entry';
import { phoneLine } from './phone-line';

type Color = 'white' | 'black';

/** The dot's disc and ring: fixed colours, the same in both themes. */
const DOT: Record<Color, string> = {
  white: 'border-side-black bg-side-white',
  black: 'border-side-ring bg-side-black',
};

/** The side-to-move dot and its words. */
export function ToMove({ color }: { readonly color: Color }): JSX.Element {
  const t = useTranslations('training.drill');
  return (
    <p className="flex items-center gap-2 text-sm text-fg-muted">
      <span
        aria-hidden="true"
        className={`size-3 rounded-full border ${DOT[color]}`}
      />
      {t(`toMove.${color}`)}
    </p>
  );
}

export type StatusTone = 'prompt' | 'success' | 'error' | 'due';

const PILL =
  'flex items-center gap-2 self-start rounded-control px-3 py-2 text-base font-semibold';
const STATUS_CLASS: Record<StatusTone, string> = {
  prompt: 'text-lg font-bold',
  success: `${PILL} bg-success-subtle text-success`,
  error: `${PILL} bg-error-subtle text-error`,
  due: `${PILL} bg-due-subtle text-due`,
};
/** Each result's icon: a tick, a cross, an exclamation mark. */
const ICON: Record<StatusTone, string | null> = {
  prompt: null,
  success: TICK_ICON,
  error: 'M6 6l12 12M18 6L6 18',
  due: 'M12 8v5M12 16h.01',
};

/** The prompt, plain and bold, or an answer's result as a tinted pill with its icon. */
export function StatusLine({
  tone,
  text,
}: {
  readonly tone: StatusTone;
  readonly text: string;
}): JSX.Element {
  const path = ICON[tone];
  return (
    <p className={STATUS_CLASS[tone]}>
      {path === null ? null : <Icon path={path} strokeWidth={2.5} />}
      {text}
    </p>
  );
}

/**
 * The typed-move entry with `children` (buttons such as Hint) beside its
 * Type button, or the promotion choice in their place.
 */
export function MoveRow({
  input,
  color,
  children,
}: {
  readonly input: DrillMoveInput;
  readonly color: Color;
  readonly children?: ReactNode;
}): JSX.Element {
  if (input.promotion !== null)
    return (
      <PromotionPicker
        color={color}
        onPick={input.pick}
        onCancel={input.cancel}
      />
    );
  return <MoveEntry onTyped={input.onTyped}>{children}</MoveEntry>;
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
  readonly phone: string;
  readonly rows: readonly ListRow[];
}

function layoutsOf(
  moves: readonly RepertoireMove[],
  rootKey: string | undefined,
): Layouts | null {
  if (rootKey === undefined || moves.length === 0) return null;
  const whiteFirst = sideToMove(rootKey) === 'w';
  const sans = moves.map(shownSan);
  return {
    text: lineText(sans, whiteFirst),
    phone: phoneLine(sans, whiteFirst),
    rows: listRows(moves, whiteFirst),
  };
}

/**
 * The moves so far on the line from `rootKey`, newest last. A phone shows
 * them as wrapping text cut to the last full moves (phoneLine), with the
 * whole line kept for screen readers; a desktop as the design's two-column
 * move list in the panel, in a box of its own that takes the panel's spare
 * height and scrolls itself, so a long line never scrolls the panel and
 * hides the move field above it (#323). Only one of the two is announced
 * at a width, so a screen reader hears the line once. Whenever the line
 * changes the list jumps to its newest move (no smooth scroll, so reduced
 * motion holds).
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
  const box = useRef<HTMLDivElement>(null);
  const text = layouts?.text;
  useLayoutEffect(() => {
    const scroller = box.current;
    if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
  }, [text]);
  return (
    <div ref={box} className="lg:min-h-0 lg:overflow-y-auto">
      <h2 className="sr-only">{t('line')}</h2>
      {layouts === null ? null : (
        <>
          <p className="sr-only lg:hidden">{layouts.text}</p>
          <p
            aria-hidden="true"
            className="text-sm leading-relaxed text-fg-muted tabular-nums lg:hidden"
          >
            {layouts.phone}
          </p>
          {/* On a portrait tablet (`tall:`) the panel is board-wide under
              the board: fixed move columns keep the list compact. */}
          <ol className="hidden gap-x-4 gap-y-1 tabular-nums lg:grid lg:grid-cols-[2.5rem_5rem_5rem] tall:grid-cols-[auto_8rem_8rem] tall:justify-start">
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
