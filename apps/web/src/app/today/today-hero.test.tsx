import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { TodaySummary } from '../../server/training';
import type { HeroState } from './hero-state';
import { TodayHero } from './today-hero';

const t = MESSAGES.training.today;
const today = MESSAGES.today;
/** 08:30 in Vilnius on 27 October 2026. */
const NEXT = new Date('2026-10-27T06:30:00Z');

/** Renders the hero as if it were `now`. */
const at = (now: string): void => {
  vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] });
};

afterEach(() => {
  vi.useRealTimers();
});

type Counts = Omit<TodaySummary, 'rows'>;

function renderHero(state: HeroState, counts: Counts): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <TodayHero state={state} summary={{ ...counts, rows: [] }} />
    </NextIntlClientProvider>,
  );
}

const href = (name: string | RegExp): string | null =>
  screen.getByRole('link', { name }).getAttribute('href');

const linkNames = (): (string | null)[] =>
  screen.queryAllByRole('link').map((a) => a.textContent);

describe('TodayHero (R-142, R-148, U1-M1-3)', () => {
  it("is the region named Today's review in every state", () => {
    for (const state of ['due', 'learn', 'done', 'empty'] as const) {
      const { unmount } = render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <TodayHero
            state={state}
            summary={{
              due: 0,
              toLearn: 0,
              minutes: 0,
              nextDue: null,
              rows: [],
            }}
          />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole('region', { name: t.title })).toBeDefined();
      expect(
        screen.getByRole('heading', { level: 2, name: t.title }),
      ).toBeDefined();
      unmount();
    }
  });

  it('shows the due count and the time before starting, then both ways in', () => {
    renderHero('due', { due: 12, toLearn: 5, minutes: 2, nextDue: NEXT });
    expect(screen.getByText('12 due')).toBeDefined();
    expect(screen.getByText('about 2 min')).toBeDefined();
    expect(linkNames()).toEqual([t.start, 'Learn 5 new moves']);
    expect(href(t.start)).toBe('/training?mode=review');
    expect(href('Learn 5 new moves')).toBe('/training?mode=learn');
    // The next review time is for when nothing is due.
    expect(screen.queryByText(/Next review/u)).toBeNull();
  });

  it('says one new move in the singular', () => {
    renderHero('due', { due: 1, toLearn: 1, minutes: 1, nextDue: null });
    expect(href('Learn 1 new move')).toBe('/training?mode=learn');
  });

  it('offers no new moves when none are left today', () => {
    renderHero('due', { due: 4, toLearn: 0, minutes: 1, nextDue: NEXT });
    expect(linkNames()).toEqual([t.start]);
  });

  it('offers new moves when nothing is due, with the next review time', () => {
    at('2026-10-27T03:30:00Z');
    renderHero('learn', { due: 0, toLearn: 2, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(t.nothingDue)).toBeDefined();
    expect(screen.getByText('Next review: in 3 h')).toBeDefined();
    expect(linkNames()).toEqual(['Learn 2 new moves']);
    expect(href('Learn 2 new moves')).toBe('/training?mode=learn');
  });

  it('says nothing of the next review when none is scheduled', () => {
    renderHero('learn', { due: 0, toLearn: 2, minutes: 0, nextDue: null });
    expect(screen.queryByText(/Next review/u)).toBeNull();
  });

  it('says all is done, when the next review is, and offers nothing', () => {
    at('2026-10-27T03:30:00Z');
    renderHero('done', { due: 0, toLearn: 0, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(today.allDone)).toBeDefined();
    expect(screen.getByText('Next review: in 3 h')).toBeDefined();
    expect(linkNames()).toEqual([]);
  });

  it.each<[now: string, text: string]>([
    ['2026-10-27T06:10:00Z', 'Next review: in 20 min'],
    ['2026-10-26T20:30:00Z', 'Next review: in 10 h'],
    ['2026-10-26T05:00:00Z', 'Next review: tomorrow at 08:30'],
    ['2026-10-25T05:00:00Z', 'Next review: October 27 at 08:30'],
  ])('at %s says "%s"', (now, text) => {
    at(now);
    renderHero('done', { due: 0, toLearn: 0, minutes: 0, nextDue: NEXT });
    expect(screen.getByText(text)).toBeDefined();
  });

  it('gives the date when rendered on the server, which has no reader’s clock', () => {
    at('2026-10-27T03:30:00Z');
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <TodayHero
          state="done"
          summary={{ due: 0, toLearn: 0, minutes: 0, nextDue: NEXT, rows: [] }}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('Next review: October 27 at 08:30');
  });

  it('welcomes a player with nothing to train and shows the ways to start', () => {
    renderHero('empty', { due: 0, toLearn: 0, minutes: 0, nextDue: null });
    expect(screen.getByText(today.welcome)).toBeDefined();
    expect(linkNames()).toEqual([today.create, today.import]);
    expect(href(today.create)).toBe('/repertoires');
    expect(href(today.import)).toBe('/repertoires/import');
  });

  it('keeps every button a 44px target with a focus ring seen on the accent', () => {
    renderHero('due', { due: 3, toLearn: 2, minutes: 1, nextDue: null });
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('min-h-touch');
      expect(link.className).toContain('focus-visible:outline-accent-fg');
    }
  });
});
