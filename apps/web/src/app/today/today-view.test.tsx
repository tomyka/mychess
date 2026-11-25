import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { TodayForkOffer } from '../../server/assignment-pages';
import type { TodayPage, TodayPageRow } from '../../server/today-page';
import { TodayView } from './today-view';

vi.mock('../fork-offer-actions', () => ({
  acceptForkOfferAction: vi.fn(),
  declineForkOfferAction: vi.fn(),
}));

const ROW: TodayPageRow = {
  repertoireId: '3b0c9f6a-8d1e-4f2a-9c3b-5e6f7a8b9c0d',
  name: 'Sicilian Najdorf',
  side: 'black',
  kind: 'own',
  due: 3,
  canLearn: false,
  action: 'review',
  standing: {
    counts: { notStarted: 0, skipped: 0, due: 3, learned: 7 },
    mastered: false,
  },
  assignment: null,
};

const OFFER: TodayForkOffer = {
  id: 'o-1',
  name: 'Karo-Kan gynyba: pagrindai',
  coachName: 'Jonas',
  daysLeft: 30,
};

/** A page with one due repertoire and no offers unless given. */
const page = (over: Partial<TodayPage> = {}): TodayPage => ({
  displayName: 'Rūta',
  summary: { due: 3, toLearn: 0, minutes: 1, nextDue: null },
  rows: [ROW],
  offers: [],
  ...over,
});

function renderView(props: TodayPage): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TodayView {...props} />
    </NextIntlClientProvider>,
  );
}

const headings = (): [string, string | null][] =>
  screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent]);

describe('TodayView (#381 part 2)', () => {
  it('heads the page Today, for screen readers only, then the hero and the list', () => {
    renderView(page());
    expect(headings()).toEqual([
      ['H1', MESSAGES.today.title],
      ['H2', MESSAGES.training.today.title],
      ['H2', MESSAGES.today.repertoires],
    ]);
    expect(
      screen.getByRole('heading', { level: 1 }).className.split(' '),
    ).toContain('sr-only');
  });

  it('greets the account in a line, not a heading', () => {
    renderView(page());
    const greeting = screen.getByText('Hello, Rūta!');
    expect(greeting.tagName).toBe('P');
    // The wordmark lives in the shell's top bar (#381).
    expect(screen.queryByText(MESSAGES.app.title)).toBeNull();
  });

  // #381: the ways to the other areas and sign-out moved to the shell.
  it('has no sign-out button and no links to the other areas', () => {
    renderView(page());
    expect(
      screen.queryByRole('button', { name: MESSAGES.app.signOut }),
    ).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('shows the copies left to keep after the list, the phone order (R-44)', () => {
    renderView(page({ offers: [OFFER] }));
    expect(headings().slice(1)).toEqual([
      ['H2', MESSAGES.training.today.title],
      ['H2', MESSAGES.today.repertoires],
      ['H2', MESSAGES.forkOffer.title],
      ['H3', OFFER.name],
    ]);
    expect(
      screen.getByRole('button', { name: MESSAGES.forkOffer.keep }),
    ).toBeDefined();
  });

  it('has no offers section without offers', () => {
    renderView(page());
    expect(
      screen.queryByRole('heading', { name: MESSAGES.forkOffer.title }),
    ).toBeNull();
  });

  it('welcomes a player with nothing to train, without a list', () => {
    renderView(
      page({
        summary: { due: 0, toLearn: 0, minutes: 0, nextDue: null },
        rows: [],
      }),
    );
    expect(screen.getByText(MESSAGES.today.welcome)).toBeDefined();
    expect(
      screen.queryByRole('heading', { name: MESSAGES.today.repertoires }),
    ).toBeNull();
  });

  it("shows the hero's due state from the summary", () => {
    renderView(page());
    expect(screen.getByText('3 due')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.training.today.start })
        .getAttribute('href'),
    ).toBe('/training?mode=review');
  });
});
