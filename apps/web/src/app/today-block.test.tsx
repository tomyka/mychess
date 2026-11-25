import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import type { TodaySummary } from '../server/training';
import { TodayBlock } from './today-block';

const t = MESSAGES.training.today;
/** 08:30 in Vilnius on 27 October 2026. */
const NEXT = new Date('2026-10-27T06:30:00Z');

/** Renders the block as if it were `now`. */
const at = (now: string): void => {
  vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] });
};

afterEach(() => {
  vi.useRealTimers();
});

/** A summary; with no rows unless given. */
type Summary = Omit<TodaySummary, 'rows'> & Partial<Pick<TodaySummary, 'rows'>>;

function renderBlock(summary: Summary): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <TodayBlock summary={{ rows: [], ...summary }} />
    </NextIntlClientProvider>,
  );
}

const link = (name: string | RegExp) =>
  screen.getByRole('link', { name }).getAttribute('href');

describe('TodayBlock (U1-M1-3)', () => {
  it('shows the due count and the time before starting', () => {
    renderBlock({ due: 12, toLearn: 3, minutes: 2, nextDue: NEXT });
    expect(
      screen.getByRole('heading', { level: 2, name: t.title }),
    ).toBeDefined();
    expect(screen.getByText('12 due · about 2 min')).toBeDefined();
    expect(link(t.start)).toBe('/training?mode=review');
    expect(link('Learn 3 new moves')).toBe('/training?mode=learn');
    // The next review time is for when nothing is due.
    expect(screen.queryByText(/Next review/)).toBeNull();
  });

  it('says one new move in the singular', () => {
    renderBlock({ due: 1, toLearn: 1, minutes: 1, nextDue: NEXT });
    expect(screen.getByText('1 due · about 1 min')).toBeDefined();
    expect(link('Learn 1 new move')).toBe('/training?mode=learn');
  });

  it('offers no new moves when none are left today', () => {
    renderBlock({ due: 4, toLearn: 0, minutes: 1, nextDue: NEXT });
    expect(screen.getByText('4 due · about 1 min')).toBeDefined();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([
      t.start,
    ]);
  });

  it('says when the next review is when nothing is due', () => {
    at('2026-10-27T03:30:00Z');
    renderBlock({ due: 0, toLearn: 2, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(t.nothingDue)).toBeDefined();
    expect(screen.getByText('Next review: in 3 h')).toBeDefined();
    expect(screen.queryByRole('link', { name: t.start })).toBeNull();
    expect(link('Learn 2 new moves')).toBe('/training?mode=learn');
  });

  it.each<[now: string, text: string]>([
    ['2026-10-27T06:10:00Z', 'Next review: in 20 min'],
    ['2026-10-26T20:30:00Z', 'Next review: in 10 h'],
    ['2026-10-26T05:00:00Z', 'Next review: tomorrow at 08:30'],
    ['2026-10-25T05:00:00Z', 'Next review: October 27 at 08:30'],
  ])('at %s says "%s"', (now, text) => {
    at(now);
    renderBlock({ due: 0, toLearn: 0, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(text)).toBeDefined();
  });

  // #330 decision 6: a 24-hour clock, the year only when it is not this one.
  it.each<[next: string, now: string, text: string]>([
    [
      '2026-10-27T13:18:00Z',
      '2026-10-26T05:00:00Z',
      'Next review: tomorrow at 15:18',
    ],
    [
      '2026-10-27T13:18:00Z',
      '2026-10-25T05:00:00Z',
      'Next review: October 27 at 15:18',
    ],
    [
      '2027-01-05T10:00:00Z',
      '2026-12-20T10:00:00Z',
      'Next review: January 5, 2027 at 12:00',
    ],
  ])('due at %s seen at %s, says "%s"', (next, now, text) => {
    at(now);
    renderBlock({ due: 0, toLearn: 0, minutes: 0, nextDue: new Date(next) });
    expect(screen.getByText(text)).toBeDefined();
  });

  it('gives the date when rendered on the server, which has no reader’s clock', () => {
    at('2026-10-27T03:30:00Z');
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <TodayBlock
          summary={{
            due: 0,
            toLearn: 0,
            minutes: 0,
            nextDue: NEXT,
            rows: [],
          }}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Next review: October 27 at 08:30');
  });

  it('says only that nothing is due with nothing scheduled or to learn', () => {
    renderBlock({ due: 0, toLearn: 0, minutes: 0, nextDue: null });
    expect(screen.getByText(t.nothingDue)).toBeDefined();
    expect(screen.queryByText(/Next review/)).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('TodayBlock’s due moves per repertoire (R-207)', () => {
  const row = (
    id: string,
    name: string,
    side: 'white' | 'black',
    due: number,
  ): TodaySummary['rows'][number] => ({
    id,
    name,
    side,
    kind: 'own',
    due,
    canLearn: false,
    counts: { notStarted: 0, skipped: 0, due, learned: 1 },
    mastered: false,
  });
  const ROWS = [
    row('r2', 'Taimanovas', 'black', 2),
    row('r1', 'Londonas', 'white', 1),
    // Nothing due: not on this list.
    row('r3', 'Karo-Kanas', 'black', 0),
  ];

  it('lists each repertoire with due moves, each linking to its own review', () => {
    renderBlock({
      due: 3,
      toLearn: 0,
      minutes: 1,
      nextDue: null,
      rows: ROWS,
    });
    const list = within(screen.getByRole('list'));
    const links = list.getAllByRole('link');
    // Only the name is the link; side and count follow it (UX sign-off).
    expect(links.map((a) => a.textContent)).toEqual(['Taimanovas', 'Londonas']);
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Taimanovas Black · 2 due',
      'Londonas White · 1 due',
    ]);
    // The counts never wrap apart on a phone.
    expect(list.getByText('Black · 2 due').className).toContain(
      'whitespace-nowrap',
    );
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/training?mode=review&r=r2',
      '/training?mode=review&r=r1',
    ]);
    // The review of every repertoire stays the main action.
    expect(link(t.start)).toBe('/training?mode=review');
  });
});
