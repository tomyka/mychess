'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';
import { ROUTES } from '../../lib/routes';
import { SignOutButton } from '../sign-out-button';
import { useShellAccount } from './shell-context';
import { ThemeSwitch } from './theme-switch';

/** Up to two initials: first and last word of the display name. */
const firstChar = (word: string | undefined): string =>
  Array.from((word ?? '').normalize('NFC'))[0] ?? '';

export const initials = (name: string): string => {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const last = words.length > 1 ? firstChar(words.at(-1)) : '';
  return (firstChar(words[0]) + last).toLocaleUpperCase();
};

const AVATAR =
  'flex size-touch items-center justify-center rounded-pill bg-accent-subtle text-sm font-semibold text-accent focus-visible:ring-2 focus-visible:ring-focus';
const PANEL =
  'absolute right-0 top-full z-30 mt-2 flex w-max max-w-[calc(100vw-2rem)] min-w-56 flex-col gap-1 rounded-card border border-card-edge bg-surface py-2 shadow-card';
const ITEM = 'flex min-h-touch items-center px-3 text-fg hover:bg-sunken';

/**
 * Closes the menu on Escape, a press outside it, or focus leaving it (to
 * outside or to nowhere). Focus going nowhere during a press inside it is
 * not leaving: a browser that does not focus a pressed button or radio
 * (Safari) sends focus to the page then.
 */
function useDismiss(
  open: boolean,
  close: (refocus: boolean) => void,
  root: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const node = root.current;
    if (!open || node === null) return undefined;
    let pressing = false;
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node && node.contains(target);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(true);
    };
    const onPointer = (e: PointerEvent): void => {
      pressing = inside(e.target);
      if (!pressing) close(false);
    };
    const onRelease = (): void => {
      pressing = false;
    };
    const onFocusOut = (e: FocusEvent): void => {
      if (!pressing && !inside(e.relatedTarget)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('pointerup', onRelease);
    node.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('pointerup', onRelease);
      node.removeEventListener('focusout', onFocusOut);
    };
  }, [open, close, root]);
}

/** The avatar and its menu (R-218); nothing outside the shell. */
export function AccountMenu(): JSX.Element | null {
  const account = useShellAccount();
  const t = useTranslations('nav.account');
  const [open, setOpen] = useState(false);
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);
  useDismiss(open, close, root);
  if (account === null) return null;
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t('open')}
        aria-expanded={open}
        aria-controls={panel}
        className={AVATAR}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span aria-hidden="true">{initials(account.displayName)}</span>
      </button>
      {open ? (
        <div id={panel} className={PANEL}>
          <p className="px-3 py-2 font-semibold break-words">
            {account.displayName}
          </p>
          <Link
            href={ROUTES.settings}
            className={ITEM}
            onClick={() => {
              close(false);
            }}
          >
            {t('settings')}
          </Link>
          <Link
            href={ROUTES.myCoaches}
            className={ITEM}
            onClick={() => {
              close(false);
            }}
          >
            {t('myCoaches')}
          </Link>
          <ThemeSwitch />
          <div className="px-3 pt-2">
            <SignOutButton accountId={account.accountId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The account menu in an inner page's own header, below md only: there the
 * shell's top row (and its avatar) is hidden. Nothing outside the shell.
 */
export function PhoneAccountMenu(): JSX.Element | null {
  if (useShellAccount() === null) return null;
  return (
    <div className="ml-auto md:hidden">
      <AccountMenu />
    </div>
  );
}
