'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';
import { QUIET_ACTION } from '../buttons';
import { Sheet } from '../sheet';
import { SignOutButton } from '../sign-out-button';
import { accountLinks } from './account-links';
import { phoneMenuIn } from './nav-tabs';
import { useShellAccount, type ShellState } from './shell-context';
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
const SEPARATOR = 'my-1 border-border';

/**
 * Tailwind's md breakpoint, where globals.css stops treating the screen as
 * a phone: from here the menu is a dropdown, below it a bottom sheet.
 */
const WIDE = '(min-width: 48rem)';

type Shape = 'dropdown' | 'sheet';

/** The menu's shape for the screen as it is now; read on the press. */
const shapeNow = (): Shape =>
  typeof window.matchMedia !== 'function' || window.matchMedia(WIDE).matches
    ? 'dropdown'
    : 'sheet';

/**
 * Closes the sheet when the screen turns or grows to md or wider while it
 * is open: a phone's bottom sheet does not stay on a desktop-wide screen.
 */
function useCloseOnWide(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return undefined;
    const wide = window.matchMedia(WIDE);
    const onChange = (event: { readonly matches: boolean }): void => {
      if (event.matches) close();
    };
    wide.addEventListener('change', onChange);
    return () => {
      wide.removeEventListener('change', onChange);
    };
  }, [open, close]);
}

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

/**
 * What the menu holds, as a dropdown or a sheet (#381 part 6): the name
 * and the sign-in email; Settings, My coaches and the theme; Sign out as a
 * plain row; divided before the links and before Sign out. The links carry
 * the tab the menu was opened on. `aside` sits beside the name (the
 * sheet's Close).
 */
function MenuItems({
  account,
  nameId,
  onFollow,
  aside,
}: {
  readonly account: ShellState;
  readonly nameId?: string;
  readonly onFollow: () => void;
  readonly aside?: ReactNode;
}): JSX.Element {
  const t = useTranslations('nav.account');
  const links = accountLinks(usePathname());
  return (
    <>
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <h2 id={nameId} className="font-semibold break-words">
            {account.displayName}
          </h2>
          <p className="text-sm break-all text-fg-muted">{account.email}</p>
        </div>
        {aside}
      </div>
      <hr className={SEPARATOR} />
      <Link href={links.settings} className={ITEM} onClick={onFollow}>
        {t('settings')}
      </Link>
      <Link href={links.myCoaches} className={ITEM} onClick={onFollow}>
        {t('myCoaches')}
      </Link>
      <ThemeSwitch />
      <hr className={SEPARATOR} />
      <SignOutButton
        accountId={account.accountId}
        className={`${ITEM} w-full text-start`}
      />
    </>
  );
}

/** The menu as a bottom sheet, below md, named by the display name. */
function MenuSheet({
  account,
  open,
  close,
  opener,
}: {
  readonly account: ShellState;
  readonly open: boolean;
  readonly close: () => void;
  readonly opener: RefObject<HTMLButtonElement | null>;
}): JSX.Element {
  const t = useTranslations('nav.account');
  const nameId = useId();
  return (
    <Sheet open={open} onClose={close} titleId={nameId} returnFocusRef={opener}>
      <div className="flex flex-col gap-1">
        <MenuItems
          account={account}
          nameId={nameId}
          onFollow={close}
          aside={
            <button type="button" onClick={close} className={QUIET_ACTION}>
              {t('close')}
            </button>
          }
        />
      </div>
    </Sheet>
  );
}

/**
 * The avatar and its menu (R-218); nothing outside the shell. A dropdown
 * from md; below it, out of a phone's thumb reach at the top, a bottom
 * sheet (#381 part 6). The shape is read when the avatar is pressed.
 */
export function AccountMenu(): JSX.Element | null {
  const account = useShellAccount();
  const t = useTranslations('nav.account');
  const [open, setOpen] = useState<Shape | null>(null);
  const panel = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus: boolean): void => {
    setOpen(null);
    if (refocus) button.current?.focus();
  }, []);
  const closeQuietly = useCallback((): void => {
    close(false);
  }, [close]);
  useDismiss(open === 'dropdown', close, root);
  useCloseOnWide(open === 'sheet', closeQuietly);
  if (account === null) return null;
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={t('open')}
        aria-expanded={open !== null}
        aria-controls={open === 'sheet' ? undefined : panel}
        className={AVATAR}
        onClick={() => {
          setOpen(open === null ? shapeNow() : null);
        }}
      >
        <span aria-hidden="true">{initials(account.displayName)}</span>
      </button>
      {open === 'dropdown' ? (
        <div id={panel} className={PANEL}>
          <MenuItems account={account} onFollow={closeQuietly} />
        </div>
      ) : null}
      <MenuSheet
        account={account}
        open={open === 'sheet'}
        close={closeQuietly}
        opener={button}
      />
    </div>
  );
}

/**
 * The account menu in a page's own header, below md only, on the pages
 * whose header carries it (phoneMenuIn): there the shell's top row (and
 * its avatar) is collapsed. Nothing on a tab's own page, nothing outside
 * the shell.
 */
export function HeaderAccountMenu(): JSX.Element | null {
  const inShell = useShellAccount() !== null;
  const path = usePathname();
  if (!inShell || phoneMenuIn(path) !== 'header') return null;
  return (
    <div className="ml-auto md:hidden">
      <AccountMenu />
    </div>
  );
}
