'use client';

import type { Promotion } from '@mychess/chess';
import type { Color } from '@lichess-org/chessground/types';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import './board.css';
import { useTranslations } from 'next-intl';
import {
  createElement,
  useEffect,
  useId,
  useRef,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { SECONDARY_BUTTON } from '../buttons';

const PIECES: readonly {
  readonly promotion: Promotion;
  readonly role: string;
}[] = [
  { promotion: 'q', role: 'queen' },
  { promotion: 'r', role: 'rook' },
  { promotion: 'b', role: 'bishop' },
  { promotion: 'n', role: 'knight' },
];

export interface PromotionPickerProps {
  /** The side that promotes: its pieces are shown. */
  readonly color: Color;
  readonly onPick: (promotion: Promotion) => void;
  /** Cancel or Escape: the page puts the pawn back. */
  readonly onCancel: () => void;
}

/**
 * The promotion choice (docs/design/repertoire-screen.md, "The promotion
 * choice"): it replaces the board row, never covers the board. Focus moves
 * to the queen. The pieces are chessground's cburnett images, which its
 * stylesheet draws on a `piece` element inside `.cg-wrap`.
 */
export function PromotionPicker({
  color,
  onPick,
  onCancel,
}: PromotionPickerProps): JSX.Element {
  const t = useTranslations('board.promotion');
  const titleId = useId();
  const queen = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    queen.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') onCancel();
  }

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2"
    >
      <p id={titleId} className="font-medium">
        {t('title')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {PIECES.map(({ promotion, role }) => (
          <button
            key={promotion}
            ref={promotion === 'q' ? queen : undefined}
            type="button"
            aria-label={t(promotion)}
            onClick={() => {
              onPick(promotion);
            }}
            className="inline-flex size-14 items-center justify-center rounded-control border border-border-strong bg-surface"
          >
            <span
              aria-hidden="true"
              className="promotion-piece cg-wrap size-11"
            >
              {createElement('piece', { className: `${role} ${color}` })}
            </span>
          </button>
        ))}
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
