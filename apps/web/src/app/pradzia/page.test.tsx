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
// for a signed-out visitor; session-helpers.test.ts covers that).
const server = vi.hoisted(() => {
  const state: { account: SignedIn } = {
    account: { displayName: '', locale: 'lt', onboardedAt: null },
  };
  return state;
});

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock('../../server/session', () => ({
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

vi.mock('./actions', () => ({ completeOnboardingAction: vi.fn() }));

beforeEach(() => {
  server.account = { displayName: '', locale: 'lt', onboardedAt: null };
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
});
