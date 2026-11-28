import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import OnboardingPage from './page';

/** The error the mocked `redirect` throws, naming where it sends. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

interface SignedIn {
  displayName: string;
  onboardedAt: Date | null;
}

// The account the mocked session hands over (requireAccount never returns
// for a signed-out visitor; session-helpers.test.ts covers that), and
// whether the session is fresh enough to export (R-95).
const server = vi.hoisted(() => {
  const state: { account: SignedIn; fresh: boolean } = {
    account: { displayName: '', onboardedAt: null },
    fresh: true,
  };
  return state;
});

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock('../../server/session', () => ({
  hasFreshSession: () => Promise.resolve(server.fresh),
  requireAccount: () =>
    Promise.resolve({
      id: 'a1',
      email: 'ruta@example.lt',
      entitlement: 'free',
      admin: false,
      disabledAt: null,
      coachSince: null,
      createdAt: new Date(),
      ...server.account,
    }),
}));

// The disclosure as it is, keeping the account each render hands it: it
// passes it to a client component, so whatever it is given reaches the browser.
const handed = vi.hoisted(() => {
  const state: { accounts: unknown[] } = { accounts: [] };
  return state;
});
vi.mock('./delete-disclosure', async (original) => {
  const actual = await original<typeof import('./delete-disclosure')>();
  return {
    DeleteDisclosure: (
      props: Parameters<typeof actual.DeleteDisclosure>[0],
    ) => {
      handed.accounts.push(props.account);
      return actual.DeleteDisclosure(props);
    },
  };
});

vi.mock('./actions', () => ({ completeOnboardingAction: vi.fn() }));
vi.mock('../settings/actions', () => ({ deleteAccountAction: vi.fn() }));

beforeEach(() => {
  server.account = { displayName: '', onboardedAt: null };
  server.fresh = true;
});

type Search = Record<string, string | string[] | undefined>;

const page = (search: Search = {}): Promise<JSX.Element> =>
  OnboardingPage({ searchParams: Promise.resolve(search) });

async function renderPage(search: Search = {}): Promise<void> {
  const element = await page(search);
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {element}
    </NextIntlClientProvider>,
  );
}

const NEXT = `/invite/${'A'.repeat(42)}_`;
const hiddenNext = () =>
  document.querySelector<HTMLInputElement>('input[type="hidden"][name="next"]');

describe('the onboarding page', () => {
  it('sends an onboarded account home', async () => {
    server.account.onboardedAt = new Date();
    await expect(page()).rejects.toMatchObject({ to: '/' });
  });

  it('sends an onboarded account to the invite it was on its way to (R-81)', async () => {
    server.account.onboardedAt = new Date();
    await expect(page({ next: NEXT })).rejects.toMatchObject({ to: NEXT });
  });

  it('sends an onboarded account home for a return path that is not an invite', async () => {
    server.account.onboardedAt = new Date();
    await expect(page({ next: '//evil.example' })).rejects.toMatchObject({
      to: '/',
    });
  });

  it('hands the first return path to the form as a hidden field', async () => {
    await renderPage({ next: [NEXT, '/settings'] });
    expect(hiddenNext()?.value).toBe(NEXT);
  });

  it('hands the form no return path that is not an invite', async () => {
    await renderPage({ next: 'https://evil.example/' });
    expect(document.querySelector('input[name="next"]')).toBeNull();
  });

  it("prefills the provider's name", async () => {
    server.account = { displayName: 'Ruta J', onboardedAt: null };
    await renderPage();
    expect(
      screen.getByLabelText<HTMLInputElement>(MESSAGES.onboarding.displayName)
        .value,
    ).toBe('Ruta J');
    expect(screen.queryByRole('radio')).toBeNull();
    expect(document.querySelector('input[name="locale"]')).toBeNull();
  });

  it('offers to delete the account, confirmed by its email (R-86)', async () => {
    server.account = { displayName: 'Ruta J', onboardedAt: null };
    await renderPage();
    const d = MESSAGES.settings.delete;
    const disclosure = screen.getByText(MESSAGES.onboarding.deleteAccount, {
      selector: 'summary',
    });
    expect(disclosure.closest('details')?.open).toBe(false);
    expect(
      screen.getByText(d.whatGoes, { selector: 'details p' }),
    ).toBeDefined();
    expect(
      screen.getByText('ruta@example.lt', { selector: 'label strong' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { hidden: true, name: d.confirm }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { hidden: true, name: 'download your data' })
        .getAttribute('href'),
    ).toBe('/api/account/export');
  });

  it('asks a session older than a day to sign in again before exporting (R-95)', async () => {
    server.fresh = false;
    await renderPage();
    expect(screen.queryByRole('link', { hidden: true })).toBeNull();
    expect(screen.getByRole('note', { hidden: true }).textContent).toBe(
      MESSAGES.settings.export.notFresh,
    );
  });

  it('hands the delete disclosure only what deciding a deletion needs', async () => {
    server.account = { displayName: 'Ruta J', onboardedAt: null };
    handed.accounts = [];
    await renderPage();
    expect(handed.accounts).toStrictEqual([
      { displayName: 'Ruta J', email: 'ruta@example.lt', onboardedAt: null },
    ]);
  });
});
