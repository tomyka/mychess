import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { TrainButtons } from './train-buttons';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';

function renderButtons(locale: 'lt' | 'en', due: number, toLearn: number) {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <TrainButtons training={{ repertoireId: ID, counts: { due, toLearn } }} />
    </NextIntlClientProvider>,
  );
}

const href = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

describe('TrainButtons (R-142)', () => {
  it('reviews and learns this repertoire only, with the counts', () => {
    renderButtons('lt', 7, 3);
    expect(href('Kartoti (7)')).toBe(`/treniruote?mode=review&r=${ID}`);
    expect(href('Mokytis (3)')).toBe(`/treniruote?mode=learn&r=${ID}`);
  });

  it('says the same in English, a zero count included', () => {
    renderButtons('en', 0, 12);
    expect(href('Review (0)')).toBe(`/treniruote?mode=review&r=${ID}`);
    expect(href('Learn (12)')).toBe(`/treniruote?mode=learn&r=${ID}`);
  });
});
