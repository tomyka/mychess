import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
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
  locale: 'lt' | 'en';
  onboardedAt: Date | null;
}

// The account the mocked session hands over (requireAccount never returns
// for a signed-out visitor; session-helpers.test.ts covers that), and
// whether the session is fresh enough to export (R-95).
const server = vi.hoisted(() => {
  const state: { account: SignedIn; fresh: boolean } = {
    account: { displayName: '', locale: 'lt', onboardedAt: null },
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
vi.mock('../nustatymai/actions', () => ({ deleteAccountAction: vi.fn() }));

beforeEach(() => {
  server.account = { displayName: '', locale: 'lt', onboardedAt: null };
  server.fresh = true;
});

async function renderPage(locale: 'lt' | 'en'): Promise<void> {
  const element = await OnboardingPage();
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('the onboarding page', () => {
  it('sends an onboarded account home', async () => {
    server.account.onboardedAt = new Date();
    await expect(OnboardingPage()).rejects.toMatchObject({ to: '/' });
  });

  it("prefills the provider's name and the account's language", async () => {
    server.account = {
      displayName: 'Ruta J',
      locale: 'en',
      onboardedAt: null,
    };
    await renderPage('en');
    expect(
      screen.getByLabelText<HTMLInputElement>(
        MESSAGES.en.onboarding.displayName,
      ).value,
    ).toBe('Ruta J');
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'English' }).checked,
    ).toBe(true);
  });

  it('offers to delete the account, confirmed by its email (R-86)', async () => {
    server.account = { displayName: 'Ruta J', locale: 'lt', onboardedAt: null };
    await renderPage('lt');
    const d = MESSAGES.lt.settings.delete;
    const disclosure = screen.getByText(MESSAGES.lt.onboarding.deleteAccount, {
      selector: 'summary',
    });
    expect(disclosure.closest('details')?.open).toBe(false);
    expect(
      screen.getByRole('heading', { level: 2, hidden: true, name: d.title }),
    ).toBeDefined();
    expect(
      screen.getByText('ruta@example.lt', { selector: 'label strong' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { hidden: true, name: d.confirm }),
    ).toBeDefined();
    expect(
      screen
        .getByRole('link', { hidden: true, name: 'atsisiųskite savo duomenis' })
        .getAttribute('href'),
    ).toBe('/api/account/export');
  });

  it('asks a session older than a day to sign in again before exporting (R-95)', async () => {
    server.fresh = false;
    await renderPage('lt');
    expect(screen.queryByRole('link', { hidden: true })).toBeNull();
    expect(screen.getByRole('note', { hidden: true }).textContent).toBe(
      MESSAGES.lt.settings.export.notFresh,
    );
  });

  it('hands the delete disclosure only what deciding a deletion needs', async () => {
    server.account = { displayName: 'Ruta J', locale: 'lt', onboardedAt: null };
    handed.accounts = [];
    await renderPage('lt');
    expect(handed.accounts).toStrictEqual([
      { displayName: 'Ruta J', email: 'ruta@example.lt', onboardedAt: null },
    ]);
  });
});
