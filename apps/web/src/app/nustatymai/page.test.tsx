import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import SettingsPage from './page';

// What the mocked server knows: the Google pair and the account's links.
const server = vi.hoisted(() => {
  const state: {
    google: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
    links: { id: string; provider: 'google' | 'lichess' }[];
  } = {
    google: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
    links: [],
  };
  return state;
});

// requireOnboarded never returns for a signed-out or new account;
// session-helpers.test.ts covers that.
vi.mock('../../server/session', () => ({
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

vi.mock('./actions', () => ({
  updateProfileAction: vi.fn(),
  deleteAccountAction: vi.fn(),
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
});
