import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MESSAGES } from '../../i18n/locales';
import SettingsPage from './page';

// What the mocked server knows: the Google pair and the account's links.
const server = vi.hoisted(() => {
  const state: {
    google: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
    links: { id: string; provider: 'google' | 'lichess' }[];
    lichessUnlinked: boolean;
    fresh: boolean;
  } = {
    google: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
    links: [],
    lichessUnlinked: false,
    fresh: true,
  };
  return state;
});

// requireOnboarded never returns for a signed-out or new account;
// session-helpers.test.ts covers that.
vi.mock('../../server/session', () => ({
  hasFreshSession: () => Promise.resolve(server.fresh),
  requireOnboarded: () =>
    Promise.resolve({
      id: 'a1',
      email: 'ruta@example.lt',
      displayName: 'Rūta Jonaitė',
      locale: 'lt',
      entitlement: 'free',
      admin: false,
      disabledAt: null,
      onboardedAt: new Date(),
      createdAt: new Date(),
    }),
}));

vi.mock('../../server/provider-links', () => ({
  linkedProviders: () => Promise.resolve(server.links),
}));

vi.mock('../../server/lichess-unlinked', () => ({
  showLichessUnlinked: (accountId: string) =>
    Promise.resolve(accountId === 'a1' && server.lichessUnlinked),
}));

vi.mock('../../server/env', async (original) => ({
  ...(await original<typeof import('../../server/env')>()),
  readWebEnv: () => server.google,
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: { linkSocial: vi.fn(), unlinkAccount: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// The delete section as it is, keeping the account each render hands it:
// a client component, so whatever it is given reaches the browser.
const handed = vi.hoisted(() => {
  const state: { accounts: unknown[] } = { accounts: [] };
  return state;
});
vi.mock('./delete-section', async (original) => {
  const actual = await original<typeof import('./delete-section')>();
  return {
    ...actual,
    DeleteSection: (props: Parameters<typeof actual.DeleteSection>[0]) => {
      handed.accounts.push(props.account);
      return actual.DeleteSection(props);
    },
  };
});

vi.mock('./actions', () => ({
  updateProfileAction: vi.fn(),
  deleteAccountAction: vi.fn(),
  dismissLichessUnlinkedAction: vi.fn(),
}));

type Search = Record<string, string | string[] | undefined>;

const page = (search: Search = {}): Promise<JSX.Element> =>
  SettingsPage({ searchParams: Promise.resolve(search) });

async function renderPage(search: Search = {}): Promise<void> {
  const element = await page(search);
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {element}
    </NextIntlClientProvider>,
  );
}

const s = MESSAGES.lt.settings;

beforeEach(() => {
  server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
  server.links = [];
  server.lichessUnlinked = false;
  server.fresh = true;
});

describe('the settings page', () => {
  it('has the profile, sign-in methods, data and delete sections, and a way home', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: s.title }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      s.profile.title,
      s.providers.title,
      s.export.title,
      s.delete.title,
    ]);
    expect(
      screen.getByRole('link', { name: s.home }).getAttribute('href'),
    ).toBe('/');
    expect(
      screen
        .getByRole('link', { name: s.export.download })
        .getAttribute('href'),
    ).toBe('/api/account/export');
    expect(
      screen.getByLabelText<HTMLInputElement>(s.profile.displayName).value,
    ).toBe('Rūta Jonaitė');
  });

  it('shows the account’s links and the error code a link came back with', async () => {
    server.links = [{ id: 'pa-1', provider: 'lichess' }];
    await renderPage({ error: ['account_already_linked_to_different_user'] });
    expect(
      screen.getByRole('button', { name: 'Atjungti Lichess' }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('status')
        .some((line) => line.textContent === s.providers.error.linkedElsewhere),
    ).toBe(true);
  });

  it('offers no Google when its secret is missing', async () => {
    server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '' };
    await renderPage();
    expect(
      screen.queryByRole('button', { name: 'Prijungti Google' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Prijungti Lichess' }),
    ).toBeDefined();
  });

  it('says why Lichess is gone when proving the email ended its link (R-90)', async () => {
    server.lichessUnlinked = true;
    await renderPage();
    const providers = screen.getByRole('region', { name: s.providers.title });
    expect(within(providers).getByRole('note').textContent).toContain(
      s.providers.lichessUnlinked,
    );
  });

  it('hands the delete section only what deciding a deletion needs', async () => {
    handed.accounts = [];
    await renderPage();
    const [account] = handed.accounts;
    expect(Object.keys(z.object({}).loose().parse(account)).sort()).toEqual([
      'displayName',
      'email',
      'onboardedAt',
    ]);
    expect(account).toMatchObject({
      displayName: 'Rūta Jonaitė',
      email: 'ruta@example.lt',
    });
  });

  it('asks a session older than a day to sign in again instead of offering the export (R-95)', async () => {
    server.fresh = false;
    await renderPage();
    const data = screen.getByRole('region', { name: s.export.title });
    expect(
      within(data).queryByRole('link', { name: s.export.download }),
    ).toBeNull();
    expect(within(data).getByRole('note').textContent).toBe(s.export.notFresh);
    const deletion = screen.getByRole('region', { name: s.delete.title });
    expect(within(deletion).queryByRole('link')).toBeNull();
    expect(within(deletion).getByRole('note').textContent).toBe(
      s.export.notFresh,
    );
  });

  it('links the export from the delete section for a fresh session', async () => {
    await renderPage();
    const deletion = screen.getByRole('region', { name: s.delete.title });
    expect(within(deletion).getByRole('link').getAttribute('href')).toBe(
      '/api/account/export',
    );
  });

  it('says nothing about Lichess otherwise', async () => {
    await renderPage();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
