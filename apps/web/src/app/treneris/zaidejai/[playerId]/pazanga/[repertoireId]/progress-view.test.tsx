import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/locales';
import type { ProgressPage } from '../../../../../../server/coach-progress';
import { ProgressView } from './progress-view';

const p = MESSAGES.lt.coach.progress;
const COUNTS = { notStarted: 0, skipped: 0, due: 0, learned: 3 };
const PARTIAL = { notStarted: 2, skipped: 0, due: 1, learned: 0 };
const NONE = { notStarted: 0, skipped: 0, due: 0, learned: 0 };
const PAGE: ProgressPage = {
  player: { id: 'p-1', displayName: 'Rokas' },
  repertoire: { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
  badges: { overdue: false, paused: true, forked: false, updated: false },
  standing: { counts: COUNTS, mastered: true },
  chapters: [
    {
      id: 'ch1',
      title: 'Advance variation',
      whiteFirst: true,
      counts: COUNTS,
      mastered: true,
      lines: [
        {
          sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5'],
          counts: COUNTS,
          mastered: true,
        },
      ],
    },
    {
      id: 'ch2',
      title: 'Exchange variation',
      whiteFirst: false,
      counts: PARTIAL,
      mastered: false,
      lines: [{ sans: ['c6', 'd4', 'd5'], counts: PARTIAL, mastered: false }],
    },
    {
      id: 'ch3',
      title: 'Empty chapter',
      whiteFirst: true,
      counts: NONE,
      mastered: false,
      lines: [],
    },
  ],
};

function show(page: ProgressPage = PAGE): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <ProgressView page={page} />
    </NextIntlClientProvider>,
  );
}

function chapterOf(title: string): HTMLDetailsElement {
  const details = screen.getByText(title).closest('details');
  if (details === null) throw new Error(`no chapter ${title}`);
  return details;
}

describe('the progress page (R-152)', () => {
  it('heads with the repertoire, a link to the player, badges and the whole bar', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Karo-Kan gynyba' }),
    ).toBeTruthy();
    const header = screen.getByRole('banner');
    expect(
      within(header).getByRole('link', { name: 'Rokas' }).getAttribute('href'),
    ).toBe('/treneris/zaidejai/p-1');
    expect(within(header).getByText('Pristabdyta')).toBeTruthy();
    expect(within(header).getByText(p.mastered)).toBeTruthy();
  });

  it('shows no badges when there is no assignment', () => {
    show({ ...PAGE, badges: null });
    expect(screen.queryByText('Pristabdyta')).toBeNull();
  });

  it('lists the chapters under their heading, each with lines closed at first', () => {
    show();
    const section = screen.getByRole('region', { name: p.chapters });
    expect(section.querySelector('ul')?.children).toHaveLength(3);
    expect(within(section).getAllByRole('group')).toHaveLength(2);
    expect(chapterOf('Advance variation').open).toBe(false);
  });

  it('opens a chapter to its numbered lines', () => {
    show();
    fireEvent.click(screen.getByText('Advance variation'));
    const chapter = chapterOf('Advance variation');
    expect(chapter.open).toBe(true);
    const lines = within(chapter).getByRole('list', { name: p.lines });
    expect(within(lines).getByText('1. e4 c6 2. d4 d5 3. e5 Bf5')).toBeTruthy();
  });

  it('numbers a Black-first chapter’s lines from 1...', () => {
    show();
    expect(
      within(chapterOf('Exchange variation')).getByText('1... c6 2. d4 d5'),
    ).toBeTruthy();
  });

  it('marks a mastered chapter and not one still in progress', () => {
    show();
    const summaryOf = (title: string): HTMLElement => {
      const summary = chapterOf(title).querySelector('summary');
      if (summary === null) throw new Error('no summary');
      return summary;
    };
    expect(
      within(summaryOf('Advance variation')).getByText(p.mastered),
    ).toBeTruthy();
    expect(
      within(summaryOf('Exchange variation')).queryByText(p.mastered),
    ).toBeNull();
  });

  it('shows a chapter with no own move as a plain row, with nothing to open', () => {
    show();
    const title = screen.getByText('Empty chapter');
    expect(title.closest('details')).toBeNull();
    const chapter = title.closest('li');
    if (chapter === null) throw new Error('no chapter row');
    expect(within(chapter).getByText(p.nothing)).toBeTruthy();
    expect(within(chapter).queryByRole('list')).toBeNull();
  });

  it('makes each chapter’s summary a full touch target', () => {
    show();
    expect(
      chapterOf('Advance variation').querySelector('summary')?.className,
    ).toContain('min-h-touch');
  });
});
