import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n/locales';
import type { TodaySummary } from '../server/training';
import { TodayBlock } from './today-block';

const lt = MESSAGES.lt.training.today;
const en = MESSAGES.en.training.today;
const NEXT = new Date('2026-10-27T06:30:00Z');

function renderBlock(summary: TodaySummary, locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone="Europe/Vilnius"
    >
      <TodayBlock summary={summary} />
    </NextIntlClientProvider>,
  );
}

const link = (name: string | RegExp) =>
  screen.getByRole('link', { name }).getAttribute('href');

describe('TodayBlock (U1-M1-3)', () => {
  it('shows the due count and the time before starting', () => {
    renderBlock({ due: 12, toLearn: 3, minutes: 2, nextDue: NEXT });
    expect(
      screen.getByRole('heading', { level: 2, name: lt.title }),
    ).toBeDefined();
    expect(screen.getByText('12 kartotinų · apie 2 min.')).toBeDefined();
    expect(link(lt.start)).toBe('/treniruote?mode=review');
    expect(link('Išmokti 3 naujus ėjimus')).toBe('/treniruote?mode=learn');
    // The next review time is for when nothing is due.
    expect(screen.queryByText(/Kitas kartojimas/)).toBeNull();
  });

  it('writes the counts in English too', () => {
    renderBlock({ due: 1, toLearn: 1, minutes: 1, nextDue: NEXT }, 'en');
    expect(
      screen.getByRole('heading', { level: 2, name: en.title }),
    ).toBeDefined();
    expect(screen.getByText('1 due · about 1 min')).toBeDefined();
    expect(link(en.start)).toBe('/treniruote?mode=review');
    expect(link('Learn 1 new move')).toBe('/treniruote?mode=learn');
  });

  it('offers no new moves when none are left today', () => {
    renderBlock({ due: 4, toLearn: 0, minutes: 1, nextDue: NEXT });
    expect(screen.getByText('4 kartotini · apie 1 min.')).toBeDefined();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      lt.start,
    ]);
  });

  it('says when the next review is when nothing is due', () => {
    renderBlock({ due: 0, toLearn: 2, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(lt.nothingDue)).toBeDefined();
    expect(
      screen.getByText('Kitas kartojimas: spalio 27 d. 08:30'),
    ).toBeDefined();
    expect(screen.queryByRole('link', { name: lt.start })).toBeNull();
    expect(link('Išmokti 2 naujus ėjimus')).toBe('/treniruote?mode=learn');
  });

  it('says only that nothing is due with nothing scheduled or to learn', () => {
    renderBlock({ due: 0, toLearn: 0, minutes: 0, nextDue: null });
    expect(screen.getByText(lt.nothingDue)).toBeDefined();
    expect(screen.queryByText(/Kitas kartojimas/)).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});
