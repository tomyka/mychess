import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { PRIMARY_BUTTON } from '../buttons';
import { TrainButtons } from './train-buttons';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

const LEARN = {
  tracked: [],
  learnedToday: 0,
  limits: { reviews: 20, newPerDay: 10 },
};

function renderButtons(due: number, toLearn: number, limitReached = false) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TrainButtons
        training={{
          repertoireId: ID,
          counts: { due, toLearn },
          learn: LEARN,
          limitReached,
        }}
      />
    </NextIntlClientProvider>,
  );
}

const href = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

/** The links styled as the page's main action. */
const mainActions = () =>
  screen
    .getAllByRole('link')
    .filter((a) => a.className === PRIMARY_BUTTON)
    .map((a) => a.textContent);

describe('TrainButtons (R-142)', () => {
  it('reviews and learns this repertoire only, with the counts', () => {
    renderButtons(7, 3);
    expect(href('Review (7)')).toBe(`/training?mode=review&r=${ID}`);
    expect(href('Learn (3)')).toBe(`/training?mode=learn&r=${ID}`);
  });

  it('says a zero count too', () => {
    renderButtons(0, 12);
    expect(href('Review (0)')).toBe(`/training?mode=review&r=${ID}`);
    expect(href('Learn (12)')).toBe(`/training?mode=learn&r=${ID}`);
  });

  it('makes Review the main action while moves are due', () => {
    renderButtons(7, 3);
    expect(mainActions()).toEqual(['Review (7)']);
  });

  it('makes Learn the main action when nothing is due', () => {
    renderButtons(0, 3);
    expect(mainActions()).toEqual(['Learn (3)']);
  });

  it('has no main action with nothing due and nothing to learn', () => {
    renderButtons(0, 0);
    expect(mainActions()).toEqual([]);
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('says the daily limit is reached instead of “Learn (0)” (decision 11)', () => {
    renderButtons(2, 0, true);
    expect(screen.queryByRole('link', { name: /Learn/ })).toBeNull();
    expect(
      screen.getByText(/Daily limit reached: 10 new moves a day\./),
    ).toBeDefined();
    expect(href(MESSAGES.training.repertoire.limitSettings)).toBe(
      '/settings#training',
    );
    expect(href('Review (2)')).toBe(`/training?mode=review&r=${ID}`);
  });

  it('says the daily limit is reached with nothing due too', () => {
    renderButtons(0, 0, true);
    expect(
      screen.getByText(/Daily limit reached: 10 new moves a day\./),
    ).toBeDefined();
    expect(href(MESSAGES.training.repertoire.limitSettings)).toBe(
      '/settings#training',
    );
  });
});
