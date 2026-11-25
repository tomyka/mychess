import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { AccountMenu, initials } from './account-menu';
import { ShellProvider } from './shell-context';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

const show = () =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider
        value={{
          accountId: 'a1',
          displayName: 'Gabija Navickaitė',
          theme: 'system',
        }}
      >
        <AccountMenu />
        <button type="button">outside</button>
      </ShellProvider>
    </NextIntlClientProvider>,
  );

const opener = () => screen.getByRole('button', { name: 'Account menu' });

describe('AccountMenu', () => {
  it('shows the initials and keeps the menu closed at first', () => {
    show();
    expect(opener().textContent).toBe('GN');
    expect(opener().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('opens on the avatar with the name, the links, the theme and sign out', () => {
    show();
    fireEvent.click(opener());
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Gabija Navickaitė')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Settings' }).getAttribute('href'),
    ).toBe('/settings');
    expect(
      screen.getByRole('link', { name: 'My coaches' }).getAttribute('href'),
    ).toBe('/settings#coaches');
    expect(screen.getByRole('radio', { name: 'System' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

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

  it('is a disclosure, not a menu role', () => {
    show();
    fireEvent.click(opener());
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

describe('initials', () => {
  it.each([
    ['Gabija Navickaitė', 'GN'],
    ['Rokas', 'R'],
    ['  ąžuolas  jonas ', 'ĄJ'],
    ['ąžuolas Jonas', 'ĄJ'],
  ])('of %j are %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
