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
  ])(
    'says %i days ago, declined, on the repertoires the coach sees',
    (days, words) => {
      show(days);
      expect(
        screen.getByText(
          `Paskutinį kartą treniravosi ${words} su jums matomais repertuarais`,
        ),
      ).toBeTruthy();
    },
  );

  // Another coach's repertoires are not counted: a player who trained
  // yesterday elsewhere must not read as idle (R-154, #329).
  it.each([
    [0, 'Paskutinį kartą treniravosi šiandien su jums matomais repertuarais'],
    [1, 'Paskutinį kartą treniravosi vakar su jums matomais repertuarais'],
  ])('scopes %i days to the repertoires the coach sees', (days, said) => {
    show(days);
    expect(screen.getByText(said)).toBeTruthy();
  });

  it('scopes every English line to the repertoires the coach sees', () => {
    const en = MESSAGES.en.coach.progress;
    for (const line of [en.today, en.yesterday, en.daysAgo])
      expect(line).toContain('on the repertoires you can see');
  });

  it('says not trained yet without a result', () => {
    show(null);
    expect(screen.getByText(p.neverTrained)).toBeTruthy();
  });

  it('says only what holds: no training on the repertoires the coach sees, not none at all (R-154, #329)', () => {
    show(null);
    expect(
      screen.getByText('Dar nesitreniravo su jums matomais repertuarais'),
    ).toBeTruthy();
    expect(MESSAGES.en.coach.progress.neverTrained).toBe(
      'Not trained yet on the repertoires you can see',
    );
  });
});
