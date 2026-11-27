import type { Standing } from '@mychess/chess';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type {
  CoachPlayerPage,
  RepertoireCard,
} from '../../../../server/coach-pages';
import { RepertoireCards } from './repertoire-cards';

const c = MESSAGES.coach;
const GABIJA = { id: 'p-1', displayName: 'Gabija' };
// 20 November in Vilnius: the Najdorf is due in 10 days.
const TODAY = '2026-11-20';

const STANDING: Standing = {
  counts: { learned: 4, due: 1, skipped: 3, notStarted: 2 },
  mastered: false,
};
const STATUS = {
  deadline: '2026-11-30',
  overdue: false,
  paused: false,
  done: false,
  forked: false,
};

const NAJDORF: RepertoireCard = {
  repertoire: { id: 'r-1', name: 'Najdorf', side: 'black' },
  tag: 'assigned',
  status: STATUS,
  granted: { id: 'r-1', standing: STANDING },
};
const TAIMANOV: RepertoireCard = {
  repertoire: { id: 'r-2', name: 'Taimanov', side: 'black' },
  tag: 'shared',
  status: null,
  granted: { id: 'r-2', standing: STANDING },
};
const ITALIAN: RepertoireCard = {
  repertoire: { id: 'r-3', name: 'Italian', side: 'white' },
  tag: 'fork',
  status: { ...STATUS, forked: true },
  granted: { id: 'f-3', standing: STANDING },
};

function show(cards: readonly RepertoireCard[]): void {
  const player: CoachPlayerPage = {
    ...GABIJA,
    linkedAt: new Date('2026-10-01T08:00:00Z'),
    groups: [],
    lastTrainedDays: null,
    today: TODAY,
    cards,
  };
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <RepertoireCards player={player} />
    </NextIntlClientProvider>,
  );
}

/** The card (list item) a repertoire's title heads, to query within. */
const card = (title: string) => {
  const item = screen
    .getByRole('heading', { level: 3, name: title })
    .closest('li');
  if (item === null) throw new Error(`no card for ${title}`);
  return within(item);
};

type Card = ReturnType<typeof card>;

/** STANDING's counts in words, as one paragraph reads (spans inside). */
const COUNTS_LINE = (_: string, element: Element | null): boolean =>
  element?.tagName === 'P' &&
  element.textContent ===
    '40% learned · 1 due · 3 marked as known · 2 to learn';

const hrefOf = (scope: Card, name: string): string | null =>
  scope.getByRole('link', { name }).getAttribute('href');

describe('RepertoireCards (R-231)', () => {
  it('heads the list with the count of repertoires', () => {
    show([NAJDORF, TAIMANOV]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Repertoires · 2' }),
    ).toBeDefined();
  });

  it('shows an assignment with its tag, deadline, bar and counts, and links to its progress and the coach’s repertoire', () => {
    show([NAJDORF]);
    const najdorf = card('Najdorf');
    expect(najdorf.getByText(c.progress.tag.assigned)).toBeDefined();
    expect(najdorf.getByText('Due Nov 30 · in 10 days')).toBeDefined();
    expect(najdorf.getByText(COUNTS_LINE)).toBeDefined();
    expect(hrefOf(najdorf, c.progress.title)).toBe(
      '/coach/players/p-1/progress/r-1',
    );
    expect(hrefOf(najdorf, c.progress.openRepertoire)).toBe('/repertoires/r-1');
  });

  it('shows a share with its tag and the way to add notes, without a deadline line', () => {
    show([TAIMANOV]);
    const taimanov = card('Taimanov');
    expect(taimanov.getByText(c.progress.tag.shared)).toBeDefined();
    expect(taimanov.queryByText(/^Due |No deadline/u)).toBeNull();
    expect(hrefOf(taimanov, c.progress.title)).toBe(
      '/coach/players/p-1/progress/r-2',
    );
    expect(hrefOf(taimanov, c.progress.openShared)).toBe(
      '/coach/players/p-1/repertoires/r-2',
    );
  });

  it('titles an own copy as the player’s, with its shared fork’s progress and links (R-155)', () => {
    show([ITALIAN]);
    const italian = card('Gabija’s own copy of Italian');
    expect(italian.getByText(c.progress.tag.fork)).toBeDefined();
    expect(italian.getByText(COUNTS_LINE)).toBeDefined();
    expect(hrefOf(italian, c.progress.title)).toBe(
      '/coach/players/p-1/progress/f-3',
    );
    expect(hrefOf(italian, c.progress.openShared)).toBe(
      '/coach/players/p-1/repertoires/f-3',
    );
  });

  it('says an own copy not shared ended the progress view, with no progress or links (R-155)', () => {
    show([{ ...ITALIAN, granted: null }]);
    const italian = card('Gabija’s own copy of Italian');
    expect(
      italian.getByText(
        'Your progress view ended when Gabija made their own copy.',
      ),
    ).toBeDefined();
    expect(italian.queryByText(/% learned/u)).toBeNull();
    expect(italian.queryAllByRole('link')).toEqual([]);
  });

  it('keeps the cards in the order given, one column on a phone and two from md', () => {
    show([NAJDORF, ITALIAN, TAIMANOV]);
    const list = screen.getByRole('list');
    expect(
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Najdorf', 'Gabija’s own copy of Italian', 'Taimanov']);
    // The layout rule is the behaviour here: two columns from md.
    expect(list.className).toContain('md:grid-cols-2');
  });

  it('says when the coach may see none of the player’s repertoires', () => {
    show([]);
    expect(
      screen.getByText('Gabija has no repertoires you can see yet.'),
    ).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
