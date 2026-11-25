'use client';

// The typed move (docs/design/training-screen.md, owner 2026-11-25): below
// `lg` the field waits behind a Type button, so it neither takes the
// panel's room nor opens the keyboard over the board; at `lg` and up it is
// always shown. The field stays mounted while closed (hidden by CSS), so a
// taken move clears it as on desktop.
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { MoveInput } from '../board/move-input';
import { TONAL_BUTTON } from '../buttons';
import { Icon } from '../line-icon';

export interface MoveEntryProps {
  /** As `MoveInput`'s: whether the drill took the typed move. */
  readonly onTyped: (text: string) => boolean;
  /** Buttons beside Type (the review's Hint). */
  readonly children?: ReactNode;
}

/** A keyboard: its rounded case, a row of keys and the space bar. */
const KEYBOARD_ICON =
  'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM7 10h.01M11 10h.01M15 10h.01M7 14h10';

/** The typed-move field with the buttons beside it, and Type on a phone. */
export function MoveEntry({ onTyped, children }: MoveEntryProps): JSX.Element {
  const t = useTranslations('training.drill');
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const close = (): void => {
    if (!open) return;
    setOpen(false);
    toggle.current?.focus();
  };
  const typed = (text: string): boolean => {
    const taken = onTyped(text);
    if (taken) close();
    return taken;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') close();
  };
  return (
    <div className="flex flex-col gap-3">
      {/* A row of its own: the field grows across it, not down the panel. */}
      <div
        onKeyDown={onKeyDown}
        className={open ? 'flex' : 'flex max-lg:hidden'}
      >
        <MoveInput onTyped={typed} inputRef={field} />
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          onClick={() => {
            if (open) close();
            else setOpen(true);
          }}
          className={`${TONAL_BUTTON} gap-2 lg:hidden`}
        >
          <Icon path={KEYBOARD_ICON} />
          {t('type')}
        </button>
      </div>
    </div>
  );
}
