import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import NotFound from './not-found';

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
}));

vi.mock('../server/session', () => ({ getAccount: server.account }));
// The shell reads the session and the due count; here it only marks where
// the page sits.
vi.mock('./shell/app-shell', () => ({
  AppShell: ({ children }: { readonly children: ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

const en = MESSAGES.notFound;

const ONBOARDED = { onboardedAt: new Date('2026-11-01'), disabledAt: null };

async function renderNotFound(): Promise<void> {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {await NotFound()}
    </NextIntlClientProvider>,
  );
}

/** The heading, its one line and the way home, all in the main landmark. */
function expectBody(): void {
  const main = screen.getByRole('main');
  expect(
    within(main).getByRole('heading', { level: 1, name: en.title }),
  ).toBeDefined();
  expect(within(main).getByText(en.body)).toBeDefined();
  // One line: no other text under the heading.
  expect(main.querySelectorAll('p')).toHaveLength(1);
  expect(within(main).getAllByRole('link')).toHaveLength(1);
  const home = within(main).getByRole('link', { name: MESSAGES.nav.goToday });
  expect(home.getAttribute('href')).toBe('/');
}

beforeEach(() => {
  server.account.mockReset();
});

describe('the app 404 page (#381 part 6)', () => {
  it('sits in the app shell for a signed-in, onboarded account', async () => {
    server.account.mockResolvedValue(ONBOARDED);
    await renderNotFound();
    expectBody();
    expect(
      screen.getByTestId('app-shell').contains(screen.getByRole('main')),
    ).toBe(true);
    // Not the entry frame's wordmark: the shell has its own top bar.
    expect(screen.queryByRole('link', { name: 'MyChess' })).toBeNull();
  });

  it('sits in the entry frame for a signed-out visitor', async () => {
    server.account.mockResolvedValue(null);
    await renderNotFound();
    expectBody();
    expect(screen.queryByTestId('app-shell')).toBeNull();
    expect(screen.getByRole('link', { name: 'MyChess' })).toBeDefined();
  });

  it('sits in the entry frame for an account not yet onboarded: the shell would send it to onboarding', async () => {
    server.account.mockResolvedValue({ onboardedAt: null, disabledAt: null });
    await renderNotFound();
    expectBody();
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });
});
