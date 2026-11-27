import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { ProgressCounts } from '@mychess/chess';
import type { AssignedFacts } from '../../server/assignment-pages';
import type { TodayPageRow } from '../../server/today-page';
import { RepertoireRows } from './repertoire-rows';

const OWN_ID = '3b0c9f6a-8d1e-4f2a-9c3b-5e6f7a8b9c0d';
const ASSIGNED_ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const badge = MESSAGES.assignment.badge;

/** A standing of `counts`, not mastered unless said. */
const standing = (counts: ProgressCounts, mastered = false) => ({
  counts,
  mastered,
});

const row = (over: Partial<TodayPageRow> = {}): TodayPageRow => ({
  repertoireId: OWN_ID,
  name: 'Sicilian Najdorf',
  side: 'white',
  kind: 'own',
  due: 0,
  canLearn: false,
  action: null,
  standing: standing({ notStarted: 30, skipped: 0, due: 8, learned: 62 }),
  assignment: null,
  ...over,
});

const FACTS: AssignedFacts = {
  coachName: 'Rimantas',
  deadline: '2026-12-03',
  badges: { overdue: true, paused: true, updated: false },
};

/** A paused assignment: todayRows gives it no action (R-46, R-222). */
const ASSIGNED = row({
  repertoireId: ASSIGNED_ID,
  name: 'Caro-Kann',
  side: 'black',
  kind: 'assigned',
  assignment: FACTS,
});

function renderRows(rows: readonly TodayPageRow[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <RepertoireRows rows={rows} />
    </NextIntlClientProvider>,
  );
}

/** The list item whose name link is `name`. */
const item = (name: string): HTMLElement => {
  const li = screen.getByRole('link', { name }).closest('li');
  if (li === null) throw new Error(`no item for ${name}`);
  return li;
};

/** The text of the element `el`'s aria-describedby names. */
const description = (el: HTMLElement): string | null | undefined => {
  const id = el.getAttribute('aria-describedby');
  return id === null ? null : document.getElementById(id)?.textContent;
};

describe('RepertoireRows (R-221, R-222)', () => {
  it('is the region My repertoires with one item per row, in order', () => {
    renderRows([row(), ASSIGNED]);
    const region = screen.getByRole('region', {
      name: MESSAGES.today.repertoires,
    });
    expect(
      within(region).getByRole('heading', {
        level: 2,
        name: MESSAGES.today.repertoires,
      }),
    ).toBeDefined();
    // The list's own items; an assignment's badges are a list inside its item.
    const [list] = within(region).getAllByRole('list');
    expect(
      within(region)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement === list)
        .map((li) => li.querySelector('a')?.textContent),
    ).toEqual(['Sicilian Najdorf', 'Caro-Kann']);
  });

  it('links an own repertoire to its page with its side and share learned', () => {
    renderRows([row()]);
    expect(
      screen
        .getByRole('link', { name: 'Sicilian Najdorf' })
        .getAttribute('href'),
    ).toBe(`/repertoires/${OWN_ID}`);
    const own = within(item('Sicilian Najdorf'));
    expect(own.getByText('White')).toBeDefined();
    // 62 learned of 100 moves (R-177).
    expect(own.getByText('62% learned')).toBeDefined();
    expect(own.queryByText(MESSAGES.coach.progress.mastered)).toBeNull();
  });

  it('keeps the name link a 44px target one text line high', () => {
    renderRows([row()]);
    const name = screen.getByRole('link', { name: 'Sicilian Najdorf' });
    expect(name.className).toContain('after:-inset-y-2.5');
    expect(name.className).toContain('break-words');
  });

  it('shows a paused assignment with its coach, deadline and badges, linked to its page, and no button', () => {
    renderRows([ASSIGNED]);
    expect(
      screen.getByRole('link', { name: 'Caro-Kann' }).getAttribute('href'),
    ).toBe(`/repertoires/assigned/${ASSIGNED_ID}`);
    const caro = within(item('Caro-Kann'));
    expect(caro.getByText('Black')).toBeDefined();
    expect(caro.getByText('Assigned by Rimantas')).toBeDefined();
    expect(caro.getByText('Deadline: December 3, 2026')).toBeDefined();
    expect(caro.getByText(badge.overdue)).toBeDefined();
    expect(caro.getByText(badge.paused)).toBeDefined();
    expect(caro.queryByText(badge.updated)).toBeNull();
    // Its only link is its name: no Review or Learn (R-222).
    expect(caro.getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Caro-Kann',
    ]);
  });

  it('shows an assigned row whose facts are gone as a plain row', () => {
    renderRows([{ ...ASSIGNED, assignment: null }]);
    expect(
      screen.getByRole('link', { name: 'Caro-Kann' }).getAttribute('href'),
    ).toBe(`/repertoires/assigned/${ASSIGNED_ID}`);
    expect(screen.queryByText(/Assigned by/u)).toBeNull();
  });

  it("offers the repertoire's own review, described by its name (R-207)", () => {
    renderRows([row({ due: 8, canLearn: true, action: 'review' })]);
    const review = screen.getByRole('link', { name: 'Review 8' });
    expect(review.getAttribute('href')).toBe(
      `/training?mode=review&r=${OWN_ID}`,
    );
    expect(description(review)).toBe('Sicilian Najdorf');
    expect(review.className).toContain('min-h-touch');
    // One button: the row's action, decided in the chess package.
    expect(
      screen.queryByRole('link', { name: MESSAGES.today.learn }),
    ).toBeNull();
  });

  it('offers learning when that is the action', () => {
    renderRows([row({ canLearn: true, action: 'learn' })]);
    const learn = screen.getByRole('link', { name: MESSAGES.today.learn });
    expect(learn.getAttribute('href')).toBe(`/training?mode=learn&r=${OWN_ID}`);
    expect(description(learn)).toBe('Sicilian Najdorf');
  });

  it('has no button without an action', () => {
    renderRows([row()]);
    expect(
      within(item('Sicilian Najdorf'))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Sicilian Najdorf']);
  });

  it('marks a mastered repertoire (R-178)', () => {
    renderRows([
      row({
        standing: standing(
          { notStarted: 0, skipped: 0, due: 0, learned: 40 },
          true,
        ),
      }),
    ]);
    const own = within(item('Sicilian Najdorf'));
    expect(own.getByText('100% learned')).toBeDefined();
    expect(own.getByText(MESSAGES.coach.progress.mastered)).toBeDefined();
  });

  it('shows no share and no bar for a repertoire without moves', () => {
    renderRows([
      row({
        standing: standing({ notStarted: 0, skipped: 0, due: 0, learned: 0 }),
      }),
    ]);
    const own = item('Sicilian Najdorf');
    expect(within(own).queryByText(/% learned/u)).toBeNull();
    expect(own.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('draws the bar as decoration at the share learned', () => {
    renderRows([row()]);
    const bar = item('Sicilian Najdorf').querySelector('[aria-hidden="true"]');
    expect(bar?.querySelector('span')?.style.width).toBe('62%');
  });
});
