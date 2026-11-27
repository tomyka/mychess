import type { CoachStatus } from '@mychess/db';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { AssignmentStatusLine } from './assignment-status-line';

const TODAY = '2026-11-27';

const LIVE: CoachStatus = {
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  forked: false,
};

function show(
  status: Partial<CoachStatus>,
  wording: 'due' | 'deadline' = 'due',
): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <AssignmentStatusLine
        status={{ ...LIVE, ...status }}
        today={TODAY}
        wording={wording}
      />
    </NextIntlClientProvider>,
  );
  return container;
}

/** The pill reading `name`. */
const pill = (name: string): HTMLElement => {
  const found = screen.getByText(name);
  expect(found.className).toContain('rounded-pill');
  return found;
};

describe('AssignmentStatusLine (R-231)', () => {
  it('says the deadline and the days to it, in the due tone when near', () => {
    show({ deadline: '2026-11-30' });
    expect(screen.getByText('Due Nov 30 · in 3 days').className).toContain(
      'text-due',
    );
  });

  it('says "Due today" on the day, in the due tone', () => {
    show({ deadline: TODAY });
    expect(screen.getByText('Due today').className).toContain('text-due');
  });

  it('says one day in the singular', () => {
    show({ deadline: '2026-11-28' });
    expect(screen.getByText('Due Nov 28 · in 1 day')).toBeTruthy();
  });

  it('is not amber more than three days away', () => {
    show({ deadline: '2026-12-01' });
    const text = screen.getByText('Due Dec 1 · in 4 days');
    expect(text.className).not.toContain('text-due');
    expect(text.className).toContain('text-fg-muted');
  });

  it('is not amber once done, and shows the Done pill', () => {
    show({ deadline: '2026-11-30', done: true });
    const text = screen.getByText('Due Nov 30');
    expect(text.className).not.toContain('text-due');
    const done = pill('Done');
    expect(done.className).toContain('border-success');
    expect(done.className).not.toContain('bg-success-subtle');
  });

  it('shows the Overdue pill when overdue', () => {
    show({ deadline: '2026-11-20', overdue: true });
    expect(pill('Overdue').className).toContain('text-error');
    expect(screen.queryByText(/in -/u)).toBeNull();
  });

  it('shows the Paused pill when paused', () => {
    show({ deadline: '2026-12-20', paused: true });
    pill('Paused');
    expect(screen.getByText('Due Dec 20 · in 23 days')).toBeTruthy();
  });

  it('says "No deadline" without one', () => {
    show({});
    expect(screen.getByText('No deadline')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('says "deadline Nov 30" where "due" would read as training', () => {
    show({ deadline: '2026-12-20' }, 'deadline');
    const text = screen.getByText('deadline Dec 20');
    expect(text.className).not.toContain('text-due');
    expect(screen.queryByText(/Due/u)).toBeNull();
  });

  it('keeps the due tone in "deadline" wording when near', () => {
    show({ deadline: '2026-11-30' }, 'deadline');
    expect(screen.getByText('deadline Nov 30').className).toContain('text-due');
  });

  it('drops the due tone in "deadline" wording once done', () => {
    show({ deadline: '2026-11-30', done: true }, 'deadline');
    expect(screen.getByText('deadline Nov 30').className).not.toContain(
      'text-due',
    );
  });

  it('shows only the Done pill when done without a deadline', () => {
    const container = show({ done: true });
    expect(container.textContent).toBe('Done');
    pill('Done');
  });

  it('writes the year of a deadline in another year', () => {
    show({ deadline: '2027-01-15' });
    expect(screen.getByText('Due Jan 15, 2027 · in 49 days')).toBeTruthy();
  });

  it('shows nothing for an own copy: the card says so itself (R-155)', () => {
    const container = show({ deadline: '2026-11-30', forked: true });
    expect(container.textContent).toBe('');
  });
});
