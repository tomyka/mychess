import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import type { TodaySummary } from '../server/training';
import { HomeView } from './home-view';

vi.mock('./fork-offer-actions', () => ({
  acceptForkOfferAction: vi.fn(),
  declineForkOfferAction: vi.fn(),
}));

/** Nothing due and nothing to learn: the block's quietest state. */
const QUIET: TodaySummary = {
  due: 0,
  toLearn: 0,
  minutes: 0,
  nextDue: null,
  rows: [],
};

describe('HomeView', () => {
  it('greets the account', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <HomeView displayName="Rūta" fromCoach={[]} offers={[]} today={QUIET} />
      </NextIntlClientProvider>,
    );
    // The greeting is the page's one h1, today's review the first section
    // under it; the wordmark lives in the shell's top bar (#381).
    expect(
      screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent]),
    ).toEqual([
      ['H1', 'Hello, Rūta!'],
      ['H2', MESSAGES.training.today.title],
    ]);
    expect(screen.queryByText(MESSAGES.app.title)).toBeNull();
  });

  // #381: the ways to the other areas and sign-out moved to the shell.
  it('has no sign-out button and no links to the other areas', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <HomeView
          displayName="Jonas"
          fromCoach={[]}
          offers={[]}
          today={QUIET}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByRole('button', { name: MESSAGES.app.signOut }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('shows what a coach assigned and the copies left to keep (R-15, R-44)', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <HomeView
          displayName="Rokas"
          fromCoach={[
            {
              repertoireId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10',
              name: 'Londono sistema',
              side: 'white',
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
      MESSAGES.training.today.title,
      MESSAGES.assignment.home.title,
      MESSAGES.forkOffer.title,
    ]);
    expect(screen.getByRole('link', { name: 'Londono sistema' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: MESSAGES.forkOffer.keep }),
    ).toBeDefined();
  });

  // U1-M1-3: the due count and the estimate show before starting.
  it("shows today's review with its count and the way to start", () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <HomeView
          displayName="Rokas"
          fromCoach={[]}
          offers={[]}
          today={{ ...QUIET, due: 12, minutes: 2 }}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('12 due · about 2 min')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.training.today.start })
        .getAttribute('href'),
    ).toBe('/training?mode=review');
  });
});
