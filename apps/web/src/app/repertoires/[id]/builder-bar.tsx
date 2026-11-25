'use client';

import type { MarkColor } from '@mychess/chess';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { DANGER_BUTTON, SECONDARY_BUTTON } from '../../buttons';

export interface BuilderBarProps {
  /** The current move as the move list numbers it ("6...a6"); null at a chapter root. */
  readonly move: string | null;
  /** The chapter's moves after it that removing it takes along. */
  readonly count: number;
  /** Saving, or the repertoire changed elsewhere: no edit now. */
  readonly disabled: boolean;
  readonly drawMode: boolean;
  readonly drawColor: MarkColor;
  readonly onRemove: () => void;
  readonly onDraw: (on: boolean) => void;
  readonly onColor: (color: MarkColor) => void;
}

/** The PGN order of the mark colours (docs/design/repertoire-screen.md). */
const COLORS: readonly MarkColor[] = ['G', 'R', 'Y', 'B'];

const SWATCH: Record<MarkColor, string> = {
  G: 'bg-board-mark-green',
  R: 'bg-board-mark-red',
  Y: 'bg-board-mark-yellow',
  B: 'bg-board-mark-blue',
};

const ROW = 'flex flex-wrap items-center gap-2';

/** Where focus goes after the bar changes (docs/design, Keyboard). */
type FocusTarget = 'remove' | 'cancel' | 'draw' | 'color';

/** A request to focus, new each time so asking twice focuses twice. */
interface FocusRequest {
  readonly to: FocusTarget;
}

type BarRefs = Readonly<
  Record<FocusTarget, RefObject<HTMLButtonElement | null>>
>;

/**
 * The bar's buttons and where focus goes next: to Cancel when the
 * confirmation opens, back to Remove when it closes, to the chosen colour
 * when draw mode opens and back to Draw when it ends.
 */
function useBarFocus(drawMode: boolean) {
  const remove = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const draw = useRef<HTMLButtonElement>(null);
  const color = useRef<HTMLButtonElement>(null);
  const [refs] = useState<BarRefs>({ remove, cancel, draw, color });
  const [request, setRequest] = useState<FocusRequest | null>(null);
  const [wasDrawing, setWasDrawing] = useState(drawMode);
  if (wasDrawing !== drawMode) {
    setWasDrawing(drawMode);
    setRequest({ to: drawMode ? 'color' : 'draw' });
  }
  useEffect(() => {
    if (request !== null) refs[request.to].current?.focus();
  }, [request, refs]);
  return {
    refs,
    focus: (to: FocusTarget) => {
      setRequest({ to });
    },
  };
}

function Check(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/**
 * The four colour buttons: a swatch at every width (the names beside them
 * wrapped the row to three lines in the 360px desktop panel); the name is
 * the accessible name and the tooltip.
 */
function ColorButtons({
  chosen,
  chosenRef,
  onColor,
}: {
  readonly chosen: MarkColor;
  readonly chosenRef: RefObject<HTMLButtonElement | null>;
  readonly onColor: (color: MarkColor) => void;
}): JSX.Element {
  const t = useTranslations('repertoires');
  return (
    <div role="group" aria-label={t('builder.drawColors')} className={ROW}>
      {COLORS.map((color) => (
        <button
          key={color}
          ref={color === chosen ? chosenRef : undefined}
          type="button"
          aria-pressed={color === chosen}
          onClick={() => {
            onColor(color);
          }}
          title={t(`colors.${color}`)}
          className="inline-flex min-h-touch min-w-touch items-center rounded-control"
        >
          <span
            className={`inline-flex size-touch items-center justify-center rounded-control ${SWATCH[color]} ${color === chosen ? 'ring-2 ring-fg' : ''}`}
          >
            {color === chosen ? (
              <span className="inline-flex rounded-full bg-surface p-0.5 text-fg">
                <Check />
              </span>
            ) : null}
          </span>
          <span className="sr-only">{t(`colors.${color}`)}</span>
        </button>
      ))}
    </div>
  );
}

/** "Remove 6...a6 and the 14 moves after it that only it reaches?" */
function RemoveConfirm({
  move,
  count,
  cancelRef,
  onRemove,
  onCancel,
}: {
  readonly move: string;
  readonly count: number;
  readonly cancelRef: RefObject<HTMLButtonElement | null>;
  readonly onRemove: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') onCancel();
  }
  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
      <p>{t('removeConfirm', { san: move, count })}</p>
      <div className={ROW}>
        <button type="button" onClick={onRemove} className={DANGER_BUTTON}>
          {t('removeSubmit')}
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className={SECONDARY_BUTTON}
        >
          {t('removeCancel')}
        </button>
      </div>
    </div>
  );
}

/** Remove (on a move only) and Draw, disabled at a chapter root with the reason. */
function IdleRow({
  props,
  refs,
  onAsk,
}: {
  readonly props: BuilderBarProps;
  readonly refs: {
    readonly remove: RefObject<HTMLButtonElement | null>;
    readonly draw: RefObject<HTMLButtonElement | null>;
  };
  readonly onAsk: () => void;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  const hintId = useId();
  const atRoot = props.move === null;
  return (
    <div className="flex flex-col gap-1">
      <div className={ROW}>
        {atRoot ? null : (
          <button
            ref={refs.remove}
            type="button"
            disabled={props.disabled}
            onClick={onAsk}
            className={SECONDARY_BUTTON}
          >
            {t('remove')}
          </button>
        )}
        <button
          ref={refs.draw}
          type="button"
          aria-pressed={false}
          aria-describedby={atRoot ? hintId : undefined}
          disabled={props.disabled || atRoot}
          onClick={() => {
            props.onDraw(true);
          }}
          className={SECONDARY_BUTTON}
        >
          {t('draw')}
        </button>
      </div>
      {atRoot ? (
        <p id={hintId} className="text-sm text-fg-muted">
          {t('drawAtRoot')}
        </p>
      ) : null}
    </div>
  );
}

/** Draw mode's row: the four colours and Done, then how to draw. */
function DrawRow({
  props,
  chosenRef,
}: {
  readonly props: BuilderBarProps;
  readonly chosenRef: RefObject<HTMLButtonElement | null>;
}): JSX.Element {
  const t = useTranslations('repertoires.builder');
  return (
    <div className="flex flex-col gap-2">
      <div className={ROW}>
        <ColorButtons
          chosen={props.drawColor}
          chosenRef={chosenRef}
          onColor={props.onColor}
        />
        <button
          type="button"
          onClick={() => {
            props.onDraw(false);
          }}
          className={`${SECONDARY_BUTTON} ml-auto`}
        >
          {t('drawDone')}
        </button>
      </div>
      <p className="rounded-control bg-sunken px-4 py-3 text-sm">
        {t('drawHint')}
      </p>
    </div>
  );
}

/**
 * The builder row under the board (docs/design/repertoire-screen.md): remove
 * the current move after an inline confirmation naming what goes with it,
 * and draw mode's colours for touch and keyboard drawing.
 */
export function BuilderBar(props: BuilderBarProps): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const { refs, focus } = useBarFocus(props.drawMode);
  if (props.drawMode) return <DrawRow props={props} chosenRef={refs.color} />;
  if (confirming && props.move !== null)
    return (
      <RemoveConfirm
        move={props.move}
        count={props.count}
        cancelRef={refs.cancel}
        onRemove={() => {
          setConfirming(false);
          props.onRemove();
        }}
        onCancel={() => {
          setConfirming(false);
          focus('remove');
        }}
      />
    );
  return (
    <IdleRow
      props={props}
      refs={refs}
      onAsk={() => {
        setConfirming(true);
        focus('cancel');
      }}
    />
  );
}
