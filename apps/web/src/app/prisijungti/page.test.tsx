import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import SignInPage from './page';

/** The error the mocked `redirect` throws, naming where it sends. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

// What the mocked server knows: the signed-in account and the Google pair.
const server = vi.hoisted(() => {
  const state: {
    account: { id: string } | null;
    google: { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
  } = {
    account: null,
    google: { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
  };
  return state;
});

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock('../../server/session', () => ({
  getAccount: () => Promise.resolve(server.account),
}));

vi.mock('../../server/env', async (original) => ({
  ...(await original<typeof import('../../server/env')>()),
  readWebEnv: () => server.google,
}));

vi.mock('../../lib/auth-client', () => ({
  authClient: { signIn: { magicLink: vi.fn(), social: vi.fn() } },
}));

type Search = Record<string, string | string[] | undefined>;

const page = (search: Search = {}): Promise<JSX.Element> =>
  SignInPage({ searchParams: Promise.resolve(search) });

async function renderPage(search: Search = {}): Promise<void> {
  const element = await page(search);
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {element}
    </NextIntlClientProvider>,
  );
}

const lt = MESSAGES.lt;

beforeEach(() => {
  server.account = null;
  server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
});

describe('the sign-in page', () => {
  it('sends a signed-in account home', async () => {
    server.account = { id: 'a1' };
    await expect(page()).rejects.toMatchObject({ to: '/' });
  });

  it('sends a signed-in account to the invite it was on its way to (R-81)', async () => {
    server.account = { id: 'a1' };
    const next = `/k/${'A'.repeat(42)}_`;
    await expect(page({ next })).rejects.toMatchObject({ to: next });
  });

  it.each([
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['another page', '/nustatymai'],
  ])('sends a signed-in account home for %s', async (_, next) => {
    server.account = { id: 'a1' };
    await expect(page({ next })).rejects.toMatchObject({ to: '/' });
  });

  it('shows the error code it was sent back with', async () => {
    await renderPage({ error: 'lichess_email_in_use' });
    expect(screen.getByRole('status').textContent).toBe(
      lt.signIn.error.lichessEmailInUse,
    );
  });

  it('reads the first error code when there are several', async () => {
    await renderPage({ error: ['account.emailInvalid', 'x'] });
    expect(screen.getByRole('status').textContent).toBe(
      lt.account.emailInvalid,
    );
  });

  it('says the account was deleted after a deletion', async () => {
    await renderPage({ deleted: '1' });
    expect(screen.getByRole('status').textContent).toBe(lt.signIn.deleted);
  });

  it('offers Google when it is set up', async () => {
    await renderPage();
    expect(
      screen.getByRole('button', { name: lt.signIn.google }),
    ).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('offers no Google when its secret is missing', async () => {
    server.google = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '' };
    await renderPage();
    expect(screen.queryByRole('button', { name: lt.signIn.google })).toBeNull();
  });
});
