import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/catalogue';
import type { ProgressPage } from '../../../../../../server/coach-progress';
import { ProgressView } from './progress-view';

const p = MESSAGES.coach.progress;
const LEARNED = { notStarted: 0, skipped: 0, due: 0, learned: 3 };
const DUE = { notStarted: 2, skipped: 1, due: 4, learned: 3 };
const UNSTARTED = { notStarted: 5, skipped: 0, due: 0, learned: 0 };
const HALF = { notStarted: 1, skipped: 0, due: 0, learned: 1 };
const NONE = { notStarted: 0, skipped: 0, due: 0, learned: 0 };
const PAGE: ProgressPage = {
  player: { id: 'p-1', displayName: 'Rokas' },
  repertoire: { id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' },
  tag: 'assigned',
  status: {
    deadline: '2026-11-30',
    overdue: false,
    paused: false,
    done: false,
    forked: false,
  },
  today: '2026-11-27',
  standing: { counts: DUE, mastered: false },
  chapters: [
    {
      id: 'ch1',
      title: 'Caro-Kann Defense: Advance Variation',
      whiteFirst: true,
      counts: DUE,
      mastered: false,
      lines: [
        {
          sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nf3', 'e6'],
          counts: DUE,
          mastered: false,
        },
        {
          sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Nc3', 'e6'],
          counts: UNSTARTED,
          mastered: false,
        },
        {
          sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'h4', 'h5'],
          counts: LEARNED,
          mastered: true,
        },
        {
          sans: ['e4', 'c6', 'd4', 'd5', 'e5', 'Bf5', 'Be2', 'e6'],
          counts: HALF,
          mastered: false,
        },
      ],
    },
    {
      id: 'ch2',
      title: 'Caro-Kann Defense: Exchange Variation',
      whiteFirst: false,
      counts: UNSTARTED,
      mastered: false,
      lines: [{ sans: ['c6', 'd4', 'd5'], counts: UNSTARTED, mastered: false }],
    },
    {
      id: 'ch3',
      title: 'Caro-Kann Defense: Two Knights Attack',
      whiteFirst: true,
      counts: LEARNED,
      mastered: true,
      lines: [{ sans: ['e4', 'c6'], counts: LEARNED, mastered: true }],
    },
    {
      id: 'ch4',
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
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ProgressView page={page} />
    </NextIntlClientProvider>,
  );
}

function chapterOf(title: string): HTMLDetailsElement {
  const details = screen.getByText(title).closest('details');
  if (details === null) throw new Error(`no chapter ${title}`);
  return details;
}

function summaryOf(title: string): HTMLElement {
  const summary = chapterOf(title).querySelector('summary');
  if (summary === null) throw new Error('no summary');
  return summary;
}

/** The text of the line that starts with `text`, and its state. */
function lineOf(title: string, text: string): HTMLElement {
  const lines = within(chapterOf(title)).getByRole('list', { name: p.lines });
  const line = within(lines).getByText(text).closest('li');
  if (line === null) throw new Error(`no line ${text}`);
  return line;
}

const header = (): HTMLElement => screen.getByRole('banner');

/** Whether an element in `root` reads `text` whole, across its parts. */
const reads = (root: HTMLElement, text: string): boolean =>
  [...root.querySelectorAll('p, span')].some((one) => one.textContent === text);

describe('the progress page (R-152)', () => {
  it('heads with the repertoire, the way back to the player, the tag and the status', () => {
    show();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Karo-Kan gynyba' }),
    ).toBeTruthy();
    // Its parent is the player's page, not the dashboard (#381).
    expect(
      within(header())
        .getByRole('link', { name: 'Back to Rokas' })
        .getAttribute('href'),
    ).toBe('/coach/players/p-1');
    expect(within(header()).getByText('Rokas')).toBeTruthy();
    expect(within(header()).getByText('Assigned')).toBeTruthy();
    expect(within(header()).getByText('Due Nov 30 · in 3 days')).toBeTruthy();
  });

  it('heads with the whole bar at header size and the counts in words', () => {
    show();
    expect(header().querySelector('[aria-hidden="true"].h-2')).not.toBeNull();
    expect(
      reads(header(), '30% learned · 4 due · 1 marked as known · 2 to learn'),
    ).toBe(true);
  });

  it('opens an assignment as the coach’s own repertoire', () => {
    show();
    expect(
      within(header())
        .getByRole('link', { name: 'Open repertoire' })
        .getAttribute('href'),
    ).toBe('/repertoires/r-1');
    expect(
      within(header()).queryByRole('link', { name: 'Open & add notes' }),
    ).toBeNull();
  });

  it('shows the Overdue pill of an overdue assignment', () => {
    show({
      ...PAGE,
      status: {
        deadline: '2026-11-20',
        overdue: true,
        paused: false,
        done: false,
        forked: false,
      },
    });
    expect(within(header()).getByText('Overdue')).toBeTruthy();
  });

  it('tags a shared repertoire, with no status, opening it to add notes', () => {
    show({ ...PAGE, tag: 'shared', status: null });
    expect(within(header()).getByText('Shared with you')).toBeTruthy();
    expect(within(header()).queryByText(/^Due /)).toBeNull();
    expect(
      within(header())
        .getByRole('link', { name: 'Open & add notes' })
        .getAttribute('href'),
    ).toBe('/coach/players/p-1/repertoires/r-1');
    expect(
      within(header()).queryByRole('link', { name: 'Open repertoire' }),
    ).toBeNull();
  });

  it('titles a fork by whose own copy it is, tags it "Own copy", opening it to add notes (R-155)', () => {
    show({ ...PAGE, tag: 'fork', status: null });
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Rokas’s own copy of Karo-Kan gynyba',
      }),
    ).toBeTruthy();
    // The title names the player; the tag need not again.
    expect(within(header()).getByText('Own copy').className).toContain(
      'rounded-pill',
    );
    expect(within(header()).queryByText('Rokas’s own copy')).toBeNull();
    expect(within(header()).queryByText('Shared with you')).toBeNull();
    expect(
      within(header())
        .getByRole('link', { name: 'Open & add notes' })
        .getAttribute('href'),
    ).toBe('/coach/players/p-1/repertoires/r-1');
  });

  it('lists the chapters under their heading, each closed at first', () => {
    show();
    const section = screen.getByRole('region', { name: p.chapters });
    expect(section.querySelector('ul')?.children).toHaveLength(4);
    expect(within(section).getAllByRole('group')).toHaveLength(3);
    expect(chapterOf('Caro-Kann Defense: Advance Variation').open).toBe(false);
  });

  it('sums each chapter up as % and due, not started, or Mastered', () => {
    show();
    expect(
      reads(
        summaryOf('Caro-Kann Defense: Advance Variation'),
        '30% learned · 4 due',
      ),
    ).toBe(true);
    expect(
      within(summaryOf('Caro-Kann Defense: Exchange Variation')).getByText(
        'Not started · 5 moves',
      ),
    ).toBeTruthy();
    const mastered = summaryOf('Caro-Kann Defense: Two Knights Attack');
    expect(within(mastered).getByText(p.mastered)).toBeTruthy();
    // Mastered says it all: no "100% learned" beside it.
    expect(within(mastered).queryByText(/learned/u)).toBeNull();
    expect(
      within(summaryOf('Caro-Kann Defense: Advance Variation')).queryByText(
        p.mastered,
      ),
    ).toBeNull();
  });

  it('opens a chapter to its lines, each from where it leaves the trunk', () => {
    show();
    const title = 'Caro-Kann Defense: Advance Variation';
    fireEvent.click(screen.getByText(title));
    expect(chapterOf(title).open).toBe(true);
    expect(lineOf(title, '… 4. Nf3 e6')).toBeTruthy();
    expect(lineOf(title, '… 4. Nc3 e6')).toBeTruthy();
  });

  it('gives each line its state on the right: due, not started, Mastered or % learned', () => {
    show();
    const title = 'Caro-Kann Defense: Advance Variation';
    expect(
      within(lineOf(title, '… 4. Nf3 e6')).getByText('4 due'),
    ).toBeTruthy();
    expect(
      within(lineOf(title, '… 4. Nc3 e6')).getByText('Not started'),
    ).toBeTruthy();
    expect(
      within(lineOf(title, '… 4. h4 h5')).getByText(p.mastered),
    ).toBeTruthy();
    expect(
      within(lineOf(title, '… 4. Be2 e6')).getByText('50% learned'),
    ).toBeTruthy();
  });

  it('writes a one-line chapter whole, a Black-first one from 1...', () => {
    show();
    expect(
      lineOf('Caro-Kann Defense: Exchange Variation', '1... c6 2. d4 d5'),
    ).toBeTruthy();
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
      summaryOf('Caro-Kann Defense: Advance Variation').className,
    ).toContain('min-h-touch');
  });
});
