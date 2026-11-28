import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { outOfOrder } from '../../../test/dom-order';
import { MESSAGES } from '../../i18n/catalogue';
import { AccountMenu, HeaderAccountMenu, initials } from './account-menu';
import { ShellProvider } from './shell-context';

const nav = vi.hoisted(() => ({ path: '/' }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => nav.path,
}));
vi.mock('../../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

const ACCOUNT = {
  accountId: 'a1',
  displayName: 'Gabija Navickaitė',
  email: 'gabija@example.test',
  theme: 'system',
} as const;

const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider value={ACCOUNT}>
        <AccountMenu />
        <button type="button">outside</button>
      </ShellProvider>
    </NextIntlClientProvider>,
  );

interface FakeScreen {
  /** Every media query asked, in order. */
  readonly asked: string[];
  /** The screen turns (or is resized) across md: listeners hear it. */
  readonly cross: (wide: boolean) => void;
}

/** The screen is md wide or wider (`wide`), as matchMedia answers it. */
function screenIsWide(wide: boolean): FakeScreen {
  const asked: string[] = [];
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let matches = wide;
  vi.stubGlobal('matchMedia', (query: string) => {
    asked.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (
        _: 'change',
        listener: (event: { matches: boolean }) => void,
      ) => {
        listeners.add(listener);
      },
      removeEventListener: (
        _: 'change',
        listener: (event: { matches: boolean }) => void,
      ) => {
        listeners.delete(listener);
      },
    };
  });
  return {
    asked,
    cross: (now) => {
      matches = now;
      act(() => {
        for (const listener of listeners) listener({ matches: now });
      });
    },
  };
}

const opener = () => screen.getByRole('button', { name: 'Account menu' });

beforeEach(() => {
  nav.path = '/';
  screenIsWide(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountMenu', () => {
  it('shows the initials and keeps the menu closed at first', () => {
    show();
    expect(opener().textContent).toBe('GN');
    expect(opener().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('opens on the avatar with the name and email, the links, the theme and sign out, in that order and divided (#381)', () => {
    show();
    fireEvent.click(opener());
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    const [before, after] = screen.getAllByRole('separator');
    if (before === undefined || after === undefined)
      throw new Error('two separators expected');
    expect(
      outOfOrder([
        screen.getByText(ACCOUNT.displayName),
        screen.getByText(ACCOUNT.email),
        before,
        screen.getByRole('link', { name: 'Settings' }),
        screen.getByRole('link', { name: 'My coaches' }),
        screen.getByRole('radio', { name: 'System' }),
        after,
        screen.getByRole('button', { name: 'Sign out' }),
      ]),
    ).toEqual([]);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('shows Sign out as a plain row, not an outlined button (#381)', () => {
    show();
    fireEvent.click(opener());
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.className.split(' ')).not.toContain('border');
  });

  it('writes the email muted, under the name (#381)', () => {
    show();
    fireEvent.click(opener());
    expect(screen.getByText(ACCOUNT.email).className.split(' ')).toContain(
      'text-fg-muted',
    );
  });

  it('is the dropdown where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    show();
    fireEvent.click(opener());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeDefined();
  });

  it.each([
    ['/', 'today'],
    ['/repertoires/r-1', 'repertoires'],
    ['/fide', 'opponents'],
    ['/coach/groups/g-1', 'coach'],
  ])(
    'opened on %s, sends Settings and My coaches back to the %s tab (#381)',
    (path, from) => {
      nav.path = path;
      show();
      fireEvent.click(opener());
      expect(
        screen.getByRole('link', { name: 'Settings' }).getAttribute('href'),
      ).toBe(`/settings?from=${from}`);
      expect(
        screen.getByRole('link', { name: 'My coaches' }).getAttribute('href'),
      ).toBe(`/settings?from=${from}#coaches`);
    },
  );

  it('closes on Escape and gives focus back to the avatar', () => {
    show();
    fireEvent.click(opener());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes on a press outside it', () => {
    show();
    fireEvent.click(opener());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('closes when focus leaves it', () => {
    show();
    fireEvent.click(opener());
    const settings = screen.getByRole('link', { name: 'Settings' });
    fireEvent.focusOut(settings, { relatedTarget: opener() });
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    fireEvent.focusOut(settings, {
      relatedTarget: screen.getByRole('button', { name: 'outside' }),
    });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('closes when focus leaves the page', () => {
    show();
    fireEvent.click(opener());
    fireEvent.focusOut(opener(), { relatedTarget: null });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('stays open when a press inside it sends focus nowhere', () => {
    show();
    fireEvent.click(opener());
    const dark = screen.getByRole('radio', { name: 'Dark' });
    fireEvent.pointerDown(dark);
    fireEvent.focusOut(opener(), { relatedTarget: null });
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
    fireEvent.pointerUp(dark);
    fireEvent.focusOut(opener(), { relatedTarget: null });
    expect(screen.queryByRole('radio', { name: 'Dark' })).toBeNull();
  });

  it('keeps a chosen theme when the menu is closed and reopened', () => {
    show();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(opener());
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked,
    ).toBe(true);
  });

  it('closes when a link in it is followed', () => {
    show();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('is a disclosure, not a menu role, on a wide screen', () => {
    show();
    fireEvent.click(opener());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener().getAttribute('aria-haspopup')).toBeNull();
    const id = opener().getAttribute('aria-controls');
    expect(id).not.toBeNull();
    expect(document.getElementById(id ?? '')).not.toBeNull();
  });

  it('renders nothing outside the shell', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <AccountMenu />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });
});

describe('AccountMenu on a phone (#381 part 6)', () => {
  it('asks the md breakpoint when the avatar is pressed, not before', () => {
    const { asked } = screenIsWide(false);
    show();
    expect(asked).toEqual([]);
    fireEvent.click(opener());
    expect(asked.length).toBeGreaterThan(0);
    expect(new Set(asked)).toEqual(new Set(['(min-width: 48rem)']));
  });

  it('closes the sheet when the screen turns or grows to md or wider, rather than leave a phone sheet on a desktop', () => {
    const fake = screenIsWide(false);
    show();
    fireEvent.click(opener());
    expect(screen.getByRole('dialog')).toBeDefined();
    fake.cross(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener().getAttribute('aria-expanded')).toBe('false');
  });

  it('heads the sheet with the display name', () => {
    screenIsWide(false);
    show();
    fireEvent.click(opener());
    const sheet = screen.getByRole('dialog', { name: ACCOUNT.displayName });
    expect(
      within(sheet).getByRole('heading', {
        level: 2,
        name: ACCOUNT.displayName,
      }),
    ).toBeDefined();
  });

  it('opens a sheet named by the display name, with the same contents', () => {
    screenIsWide(false);
    show();
    fireEvent.click(opener());
    const sheet = screen.getByRole('dialog', { name: ACCOUNT.displayName });
    expect(within(sheet).getByText(ACCOUNT.email)).toBeDefined();
    expect(
      within(sheet)
        .getByRole('link', { name: 'Settings' })
        .getAttribute('href'),
    ).toBe('/settings?from=today');
    expect(
      within(sheet).getByRole('link', { name: 'My coaches' }),
    ).toBeDefined();
    expect(within(sheet).getByRole('radio', { name: 'System' })).toBeDefined();
    expect(within(sheet).getAllByRole('separator')).toHaveLength(2);
    expect(
      within(sheet).getByRole('button', { name: 'Sign out' }),
    ).toBeDefined();
  });

  it('closes from its Close button, giving focus back to the avatar', () => {
    screenIsWide(false);
    show();
    fireEvent.click(opener());
    const sheet = screen.getByRole('dialog', { name: ACCOUNT.displayName });
    fireEvent.click(
      within(sheet).getByRole('button', {
        name: MESSAGES.nav.account.close,
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it('closes on Escape, as the browser turns it into the dialog cancel', () => {
    screenIsWide(false);
    show();
    fireEvent.click(opener());
    const sheet = screen.getByRole('dialog', { name: ACCOUNT.displayName });
    fireEvent(sheet, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes when a link in it is followed', () => {
    screenIsWide(false);
    show();
    fireEvent.click(opener());
    fireEvent.click(screen.getByRole('link', { name: 'My coaches' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('initials', () => {
  it.each([
    ['Gabija Navickaitė', 'GN'],
    ['Rokas', 'R'],
    ['  ąžuolas  jonas ', 'ĄJ'],
    ['ąžuolas Jonas', 'ĄJ'],
  ])('of %j are %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe('HeaderAccountMenu (#400)', () => {
  const inShell = () =>
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <ShellProvider value={{ ...ACCOUNT, displayName: 'Rokas' }}>
          <HeaderAccountMenu />
        </ShellProvider>
      </NextIntlClientProvider>,
    );

  it('carries the avatar below md only, on a page that is not a tab', () => {
    nav.path = '/coach/groups/g-1';
    inShell();
    const avatar = screen.getByRole('button', { name: 'Account menu' });
    expect(avatar.closest('[class~="md:hidden"]')).not.toBeNull();
  });

  it('carries nothing on a tab’s own page: the top bar has the avatar there', () => {
    nav.path = '/coach';
    const { container } = inShell();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing outside the shell', () => {
    nav.path = '/coach/groups/g-1';
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <HeaderAccountMenu />
      </NextIntlClientProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
