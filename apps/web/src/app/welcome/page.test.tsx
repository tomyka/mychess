import type { InviteTeaser } from '@mychess/db';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

// The delete control as it is, keeping the account each render hands it: a
// client component, so whatever it is given reaches the browser.
const handed = vi.hoisted(() => {
  const state: { accounts: unknown[] } = { accounts: [] };
  return state;
});
vi.mock('../delete-account-control', async (original) => {
  const actual = await original<typeof import('../delete-account-control')>();
  return {
    DeleteAccountControl: (
      props: Parameters<typeof actual.DeleteAccountControl>[0],
    ) => {
      handed.accounts.push(props.account);
      return actual.DeleteAccountControl(props);
    },
  };
});

// What the invite in the return path may say (R-235).
const teaser = vi.hoisted(() => ({
  of: vi.fn<(next: string | null) => Promise<InviteTeaser | null>>(),
}));
vi.mock('../../server/invite-teaser', () => ({ teaserOf: teaser.of }));

vi.mock('./actions', () => ({ completeOnboardingAction: vi.fn() }));
vi.mock('../settings/actions', () => ({ deleteAccountAction: vi.fn() }));

beforeEach(() => {
  teaser.of.mockReset().mockResolvedValue(null);
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
const o = MESSAGES.onboarding;
const d = MESSAGES.settings.delete;
const deleteLink = (): HTMLElement =>
  screen.getByRole('button', { name: d.open });

/** Presses Delete account…; the sheet it opens. */
const openDelete = (): HTMLElement => {
  fireEvent.click(deleteLink());
  return screen.getByRole('dialog', { name: d.title });
};
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

  it('shows the form in the entry frame, the delete link under the card', async () => {
    await renderPage();
    expect(
      screen.getByRole('link', { name: 'MyChess' }).getAttribute('href'),
    ).toBe('/');
    const main = screen.getByRole('main');
    const [card, below] = Array.from(main.children);
    expect(
      within(main).getByRole('heading', { level: 1, name: o.title }),
    ).toBeDefined();
    expect(card?.contains(screen.getByRole('button', { name: o.submit }))).toBe(
      true,
    );
    expect(below?.contains(deleteLink())).toBe(true);
    // One wordmark: the form no longer has its own.
    expect(screen.getAllByText('MyChess')).toHaveLength(1);
  });

  it('offers to delete the account in a sheet, confirmed by its email (R-86)', async () => {
    server.account = { displayName: 'Ruta J', onboardedAt: null };
    await renderPage();
    expect(screen.queryByRole('dialog')).toBeNull();
    const sheet = openDelete();
    expect(
      within(sheet).getByText('ruta@example.lt', { selector: 'label strong' }),
    ).toBeDefined();
    expect(
      within(sheet).getByRole('button', { name: d.confirm }),
    ).toBeDefined();
    expect(
      within(sheet)
        .getByRole('link', { name: 'download your data' })
        .getAttribute('href'),
    ).toBe('/api/account/export');
  });

  // Finding 23: opening the delete form must not move the page. The form
  // opens in a modal dialog, in the top layer, not in the card's column.
  // jsdom has no layout: e2e/settings.spec.ts checks the heading's position.
  it('opens the delete form in a dialog, outside the card', async () => {
    await renderPage();
    const sheet = openDelete();
    expect(sheet.tagName).toBe('DIALOG');
    const [card] = Array.from(screen.getByRole('main').children);
    expect(card?.contains(sheet)).toBe(false);
  });

  it('asks a session older than a day to sign in again before exporting (R-95)', async () => {
    server.fresh = false;
    await renderPage();
    const sheet = openDelete();
    expect(within(sheet).queryByRole('link')).toBeNull();
    expect(within(sheet).getByRole('note').textContent).toBe(
      MESSAGES.settings.export.notFresh,
    );
  });

  // Which tokens are looked up is teaserOf's (invite-teaser.test.ts).
  describe('from an invite link (R-235)', () => {
    it('asks for the teaser of its return path and names the coach', async () => {
      teaser.of.mockResolvedValue({
        coachDisplayName: 'Rimantas',
        groupName: 'Juniors 2026',
      });
      await renderPage({ next: NEXT });
      expect(screen.getByText('Next: the invite from Rimantas')).toBeDefined();
      expect(teaser.of).toHaveBeenCalledExactlyOnceWith(NEXT);
    });

    it('says nothing without a teaser, and asks with no return path', async () => {
      await renderPage();
      expect(screen.queryByText(/Next: the invite/u)).toBeNull();
      expect(teaser.of).toHaveBeenCalledExactlyOnceWith(null);
    });
  });

  it('hands the delete control only what deciding a deletion needs', async () => {
    server.account = { displayName: 'Ruta J', onboardedAt: null };
    handed.accounts = [];
    await renderPage();
    expect(handed.accounts).toStrictEqual([
      { displayName: 'Ruta J', email: 'ruta@example.lt', onboardedAt: null },
    ]);
  });
});
