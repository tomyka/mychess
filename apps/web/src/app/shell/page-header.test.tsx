import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { BACK_BUTTON } from '../buttons';
import { PageHeader } from './page-header';
import { ShellProvider } from './shell-context';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('PageHeader', () => {
  it('links back to the named parent and titles the page', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader
          back={{ href: '/repertoires', parent: 'Repertoires' }}
          title="Import PGN"
        />
      </NextIntlClientProvider>,
    );
    const back = screen.getByRole('link', { name: 'Back to Repertoires' });
    expect(back.getAttribute('href')).toBe('/repertoires');
    // The same back button as the training screen's (#381).
    expect(back.className).toBe(BACK_BUTTON);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Import PGN',
    );
  });

  it('gives the title an id a button can be described by', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader title="Rokas" titleId="player-name" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 }).id).toBe('player-name');
  });

  it('wraps a long title rather than cutting it (Text length)', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader title="Sicilian Defence, Najdorf Variation, English Attack" />
      </NextIntlClientProvider>,
    );
    const title = screen.getByRole('heading', { level: 1 }).className;
    expect(title).not.toContain('line-clamp');
    expect(title).not.toContain('truncate');
    expect(title).toContain('break-words');
  });

  it('titles a tab page without a way back', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <PageHeader title="Repertoires" />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  describe('inside the shell', () => {
    const inShell = (back?: { href: string; parent: string }) =>
      render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <ShellProvider
            value={{ accountId: 'a1', displayName: 'Rokas', theme: 'system' }}
          >
            <PageHeader {...(back ? { back } : {})} title="Import PGN" />
          </ShellProvider>
        </NextIntlClientProvider>,
      );

    it('carries the account menu on an inner page', () => {
      inShell({ href: '/repertoires', parent: 'Repertoires' });
      expect(screen.getByRole('button', { name: 'Account menu' })).toBeTruthy();
    });

    it('has no account menu on a tab page', () => {
      inShell();
      expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
    });
  });
});
