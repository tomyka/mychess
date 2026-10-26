import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { LastTrained } from './last-trained';

const p = MESSAGES.lt.coach.progress;

const show = (days: number | null): void => {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <LastTrained days={days} />
    </NextIntlClientProvider>,
  );
};

describe('LastTrained (R-154)', () => {
  it('says today for 0 days', () => {
    show(0);
    expect(screen.getByText(p.today)).toBeTruthy();
  });

  it('says yesterday for 1 day', () => {
    show(1);
    expect(screen.getByText(p.yesterday)).toBeTruthy();
  });

  it.each([
    [2, 'prieš 2 dienas'],
    [10, 'prieš 10 dienų'],
    [21, 'prieš 21 dieną'],
  ])('says %i days ago, declined', (days, words) => {
    show(days);
    expect(
      screen.getByText(`Paskutinį kartą treniravosi ${words}`),
    ).toBeTruthy();
  });

  it('says not trained yet without a result', () => {
    show(null);
    expect(screen.getByText(p.neverTrained)).toBeTruthy();
  });
});
