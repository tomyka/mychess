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
        side="black"
        chapters={6}
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

describe('SummaryLine (spec, Header)', () => {
  it('says the side, the chapters and the share learned, then Review and Learn today', () => {
    renderLine({ training: trained(4, 9) });
    expect(screen.getByText('Black · 6 chapters · 64% learned')).toBeDefined();
    expect(href('Review 4')).toBe(`/training?mode=review&r=${ID}`);
    expect(href('Learn 9 today')).toBe(`/training?mode=learn&r=${ID}`);
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

  it('says only the side and the chapters without training', () => {
    renderLine();
    expect(screen.getByText('Black · 6 chapters')).toBeDefined();
    expect(screen.queryByText(/learned/u)).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('says one chapter in the singular', () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <SummaryLine side="white" chapters={1} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('White · 1 chapter')).toBeDefined();
  });
});

describe('SummaryLine: the assigned status strip', () => {
  it('names the coach and the deadline with the days left', () => {
    renderLine({ training: trained(4, 9), assignment: assignment() });
    expect(screen.getByText('Rimantas V.')).toBeDefined();
    expect(screen.getByText('due Nov 30 · in 4 days')).toBeDefined();
    expect(screen.queryByText(a.badge.overdue)).toBeNull();
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
    expect(screen.getByText('Rimantas V.')).toBeDefined();
  });

  it('shows no deadline when there is none', () => {
    renderLine({ assignment: assignment({ deadline: null }) });
    expect(screen.getByText('Rimantas V.')).toBeDefined();
    expect(screen.queryByText(/due/u)).toBeNull();
  });

  it('keeps the share learned while paused, with the Paused pill and no buttons (R-222, R-46)', () => {
    // The assigned view passes the standing and, while paused, no training.
    renderLine({
      standing: STANDING,
      assignment: assignment({ paused: true }),
    });
    expect(screen.getByText('Black · 6 chapters · 64% learned')).toBeDefined();
    expect(screen.getByText(a.badge.paused)).toBeDefined();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
