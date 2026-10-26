import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import type { TodaySummary } from '../server/training';
import { HomeView } from './home-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: { signOut: vi.fn() },
}));

vi.mock('./fork-offer-actions', () => ({
  acceptForkOfferAction: vi.fn(),
  declineForkOfferAction: vi.fn(),
}));

/** Nothing due and nothing to learn: the block's quietest state. */
const QUIET: TodaySummary = { due: 0, toLearn: 0, minutes: 0, nextDue: null };

const greetings = { lt: 'Sveiki, Rūta!', en: 'Hello, Rūta!' } as const;
const signOut = { lt: 'Atsijungti', en: 'Sign out' } as const;
const settings = { lt: 'Nustatymai', en: 'Settings' } as const;

describe('HomeView', () => {
  it.each(['lt', 'en'] as const)(
    'names the site and greets the account in %s',
    (locale) => {
      render(
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
          <HomeView
            accountId="rokas"
            displayName="Rūta"
            isCoach={false}
            fromCoach={[]}
            offers={[]}
            today={QUIET}
          />
        </NextIntlClientProvider>,
      );
      // The brand is a label, as on the other pages; the greeting is the
      // page's one h1, today's review the first section under it.
      expect(screen.getByText('mychess').tagName).toBe('P');
      expect(
        screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent]),
      ).toEqual([
        ['H1', greetings[locale]],
        ['H2', MESSAGES[locale].training.today.title],
      ]);
      expect(
        screen.getByRole('button', { name: signOut[locale] }),
      ).toBeDefined();
      expect(
        screen
          .getByRole('link', { name: settings[locale] })
          .getAttribute('href'),
      ).toBe('/nustatymai');
      expect(
        screen
          .getByRole('link', { name: MESSAGES[locale].app.repertoires })
          .getAttribute('href'),
      ).toBe('/repertuarai');
      expect(
        screen.queryByRole('link', { name: MESSAGES[locale].app.coachArea }),
      ).toBeNull();
    },
  );

  // C-M1-1: the coach dashboard appears alongside the player's own area.
  it('links a coach to the coach dashboard', () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <HomeView
          accountId="rokas"
          displayName="Jonas"
          isCoach
          fromCoach={[]}
          offers={[]}
          today={QUIET}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen
        .getByRole('link', { name: MESSAGES.lt.app.coachArea })
        .getAttribute('href'),
    ).toBe('/treneris');
    expect(
      screen.getByRole('link', { name: settings.lt }).getAttribute('href'),
    ).toBe('/nustatymai');
  });

  it('shows what a coach assigned and the copies left to keep (R-15, R-44)', () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <HomeView
          accountId="rokas"
          displayName="Rokas"
          isCoach={false}
          fromCoach={[
            {
              repertoireId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10',
              name: 'Londono sistema',
              coachName: 'Jonas',
              deadline: null,
              badges: {
                overdue: false,
                paused: false,
                forked: false,
                updated: true,
              },
            },
          ]}
          offers={[
            {
              id: 'o-1',
              name: 'Karo-Kan gynyba: pagrindai',
              coachName: 'Jonas',
              daysLeft: 30,
            },
          ]}
          today={QUIET}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      MESSAGES.lt.training.today.title,
      MESSAGES.lt.assignment.home.title,
      MESSAGES.lt.forkOffer.title,
    ]);
    expect(screen.getByRole('link', { name: 'Londono sistema' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: MESSAGES.lt.forkOffer.keep }),
    ).toBeDefined();
  });

  // U1-M1-3: the due count and the estimate show before starting.
  it("shows today's review with its count and the way to start", () => {
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <HomeView
          accountId="rokas"
          displayName="Rokas"
          isCoach={false}
          fromCoach={[]}
          offers={[]}
          today={{ due: 12, toLearn: 0, minutes: 2, nextDue: null }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('12 kartotinų · apie 2 min.')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.lt.training.today.start })
        .getAttribute('href'),
    ).toBe('/treniruote?mode=review');
  });
});
