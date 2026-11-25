import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { BRAND } from '../../lib/brand';
import { ShellProvider } from './shell-context';
import { TopBar } from './top-bar';

const path = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

const show = (at: string) => {
  path.current = at;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider
        value={{ accountId: 'a1', displayName: 'Rokas', theme: 'system' }}
      >
        <TopBar isCoach={false} due={0} />
      </ShellProvider>
    </NextIntlClientProvider>,
  );
  return {
    wordmark: screen.getByRole('link', { name: BRAND }),
    nav: screen.getByRole('navigation', { name: 'Main' }),
    avatar: screen.getByRole('button', { name: 'Account menu' }),
  };
};

const precedes = (a: Element, b: Element): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('TopBar', () => {
  it("shows the wordmark and the avatar on a tab's own page", () => {
    const { wordmark, avatar } = show('/repertoires');
    expect(wordmark.getAttribute('href')).toBe('/');
    expect(wordmark.parentElement?.className).not.toContain('hidden');
    expect(avatar).toBeTruthy();
  });

  it('is in keyboard order: wordmark, tabs, avatar', () => {
    const { wordmark, nav, avatar } = show('/');
    expect(precedes(wordmark, nav)).toBe(true);
    expect(precedes(nav, avatar)).toBe(true);
  });

  it('hides the wordmark on a phone inner page but keeps the tabs', () => {
    const { wordmark, nav } = show('/repertoires/import');
    expect(wordmark.parentElement?.className).toContain('hidden');
    expect(nav.closest('.hidden')).toBeNull();
  });
});
