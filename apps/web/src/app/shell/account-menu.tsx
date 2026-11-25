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
  'absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-1 rounded-card border border-card-edge bg-surface py-2 shadow-card';
const ITEM = 'flex min-h-touch items-center px-3 text-fg hover:bg-sunken';

/** Closes the menu on Escape or a press outside it. */
function useDismiss(
  open: boolean,
  close: (refocus: boolean) => void,
  root: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(true);
    };
    const onPointer = (e: PointerEvent): void => {
      if (!(e.target instanceof Node && root.current?.contains(e.target)))
        close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
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
          <p className="px-3 py-2 font-semibold">{account.displayName}</p>
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
