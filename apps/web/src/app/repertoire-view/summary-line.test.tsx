import type { Standing } from '@mychess/chess';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { PanelTraining } from './panel-training';
import { SummaryLine, type SummaryAssignment } from './summary-line';
import { panelTraining } from './test-training';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const a = MESSAGES.assignment;

/** 64% learned: 16 of 25 own moves. */
const STANDING = {
  counts: { notStarted: 5, skipped: 0, due: 4, learned: 16 },
  mastered: false,
};

function trained(
  due: number,
  toLearn: number,
  limitReached = false,
): PanelTraining {
  return panelTraining({
    repertoireId: ID,
    counts: { due, toLearn },
    standing: STANDING,
    limitReached,
  });
}

function renderLine(
  props: {
    readonly standing?: Standing;
    readonly training?: PanelTraining;
    readonly assignment?: SummaryAssignment;
  } = {},
): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <SummaryLine
        standing={props.standing ?? props.training?.standing}
        training={props.training}
        assignment={props.assignment}
      />
    </NextIntlClientProvider>,
  );
}

const href = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

const assignment = (
  over: Partial<SummaryAssignment> = {},
): SummaryAssignment => ({
  coachName: 'Rimantas V.',
  deadline: '2026-11-30',
  today: '2026-11-26',
  overdue: false,
  paused: false,
  ...over,
});

describe('SummaryLine (spec, Summary row)', () => {
  it('says the share learned, then Review and Learn today, on one wrapping row', () => {
    renderLine({ training: trained(4, 9) });
    const learned = screen.getByText('64% learned');
    expect(href('Review 4')).toBe(`/training?mode=review&r=${ID}`);
    expect(href('Learn 9 today')).toBe(`/training?mode=learn&r=${ID}`);
    // One row: the words and both buttons share it.
    const row = learned.parentElement;
    expect(row?.className).toContain('flex-wrap');
    const review = screen.getByRole('link', { name: 'Review 4' });
    expect(review.parentElement).toBe(row);
    // Side and chapters are not repeated (the board and "Ch 1/6" say them).
    expect(screen.queryByText(/chapter|White|Black/u)).toBeNull();
  });

  it('draws Review and Learn as compact tonal buttons, still 44px high', () => {
    renderLine({ training: trained(4, 9) });
    for (const name of ['Review 4', 'Learn 9 today']) {
      const { className } = screen.getByRole('link', { name });
      expect(className).toContain('bg-accent-subtle');
      expect(className).toContain('px-3');
      expect(className).toContain('text-sm');
      expect(className).toContain('min-h-touch');
    }
  });

  it('says New with the size while nothing is started', () => {
    renderLine({
      standing: {
        counts: { notStarted: 15, skipped: 0, due: 0, learned: 0 },
        mastered: false,
      },
    });
    expect(screen.getByText('New · 15 moves')).toBeDefined();
  });

  it('shows Mastered as the pill', () => {
    renderLine({
      standing: {
        counts: { notStarted: 0, skipped: 0, due: 0, learned: 25 },
        mastered: true,
      },
    });
    expect(screen.getByText(MESSAGES.coach.progress.mastered)).toBeDefined();
    expect(screen.queryByText(/learned/u)).toBeNull();
  });

  it('never says the due count beside the share learned: Review says it', () => {
    renderLine({ training: trained(4, 0) });
    expect(screen.queryByText(/due/u)).toBeNull();
  });

  it('leaves out a button whose count is zero', () => {
    renderLine({ training: trained(0, 9) });
    expect(screen.queryByRole('link', { name: /Review/u })).toBeNull();
    expect(href('Learn 9 today')).toBe(`/training?mode=learn&r=${ID}`);
  });

  it('has no buttons with nothing due and nothing to learn', () => {
    renderLine({ training: trained(0, 0) });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('says the daily limit is reached in place of Learn (decision 11)', () => {
    renderLine({ training: trained(2, 0, true) });
    expect(screen.queryByRole('link', { name: /Learn/u })).toBeNull();
    expect(
      screen.getByText(/Daily limit reached: 10 new moves a day\./u),
    ).toBeDefined();
    expect(href(MESSAGES.training.repertoire.limitSettings)).toBe(
      '/settings#training',
    );
    expect(href('Review 2')).toBe(`/training?mode=review&r=${ID}`);
  });

  it('is nothing without training or an assignment, so it leaves no gap', () => {
    renderLine();
    expect(document.body.textContent).toBe('');
  });
});

describe('SummaryLine: the assigned status strip', () => {
  it('names the coach, a separator, then the deadline with the days left, on the second line', () => {
    renderLine({ training: trained(4, 9), assignment: assignment() });
    // One inline run: no flex gap widens the first separator (sign-off).
    const run = screen.getByText('Rimantas V.').parentElement;
    expect(run?.textContent).toBe('Rimantas V. · due Nov 30 · in 4 days');
    expect(run?.className ?? '').not.toMatch(/flex|gap/u);
    expect(screen.getByText('due Nov 30 · in 4 days')).toBeDefined();
    expect(screen.queryByText(a.badge.overdue)).toBeNull();
    const strip = run?.parentElement;
    // The second line: after the row with the share learned.
    expect(strip?.previousElementSibling).toBe(
      screen.getByText('64% learned').parentElement,
    );
  });

  it('says one day in the singular', () => {
    renderLine({ assignment: assignment({ today: '2026-11-29' }) });
    expect(screen.getByText('due Nov 30 · in 1 day')).toBeDefined();
  });

  it('says due today on the day', () => {
    renderLine({ assignment: assignment({ today: '2026-11-30' }) });
    expect(screen.getByText('due today')).toBeDefined();
  });

  it('shows the Overdue pill in place of the deadline once it passed', () => {
    renderLine({
      assignment: assignment({ today: '2026-12-02', overdue: true }),
    });
    expect(screen.getByText(a.badge.overdue)).toBeDefined();
    expect(screen.queryByText(/^due/u)).toBeNull();
    const run = screen.getByText('Rimantas V.').parentElement;
    expect(run?.textContent).toBe('Rimantas V.');
    // The pills follow the run, after the flex gap.
    expect(run?.parentElement?.textContent).toBe(
      `Rimantas V.${a.badge.overdue}`,
    );
  });

  it('shows no deadline, and no separator, when there is none', () => {
    renderLine({ assignment: assignment({ deadline: null }) });
    expect(screen.getByText('Rimantas V.').parentElement?.textContent).toBe(
      'Rimantas V.',
    );
    expect(screen.queryByText(/due/u)).toBeNull();
  });

  it('keeps the share learned while paused, with the Paused pill and no buttons (R-222, R-46)', () => {
    // The assigned view passes the standing and, while paused, no training.
    renderLine({
      standing: STANDING,
      assignment: assignment({ paused: true }),
    });
    expect(screen.getByText('64% learned')).toBeDefined();
    expect(screen.getByText(a.badge.paused)).toBeDefined();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
