import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
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
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
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
