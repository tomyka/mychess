import type {
  AssigneeStanding,
  CoachAssignmentPlayer,
  CoachStatus,
} from '@mychess/db';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import { AssigneeRow } from './assignee-row';

const TODAY = '2026-11-17';
const s = MESSAGES.coach.status;

/** The deadline Dec 20, nothing on. */
const ON_TIME: CoachStatus = {
  deadline: '2026-12-20',
  overdue: false,
  paused: false,
  done: false,
  forked: false,
};

const ROKAS: CoachAssignmentPlayer = {
  playerId: 'rokas',
  displayName: 'Rokas',
  deadline: '2026-12-20',
  status: ON_TIME,
};

/** Half of ten moves learned, one due, on time. */
const HALF: AssigneeStanding = {
  standing: {
    counts: { notStarted: 4, skipped: 0, due: 1, learned: 5 },
    mastered: false,
  },
  status: ON_TIME,
};

function wrap(children: ReactNode): HTMLElement {
  const { container } = render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <ul>{children}</ul>
    </NextIntlClientProvider>,
  );
  return container;
}

/**
 * Renders Rokas's row; a shown standing's status is the player's, as the
 * read gives them (one object).
 */
function renderRow(
  shown: AssigneeStanding | null,
  player: CoachAssignmentPlayer = shown === null
    ? ROKAS
    : { ...ROKAS, status: shown.status },
  groupDeadline?: string | null,
): HTMLElement {
  return wrap(
    <AssigneeRow
      nameId="rokas-name"
      name={player.displayName}
      player={player}
      shown={shown}
      today={TODAY}
      {...(groupDeadline === undefined ? {} : { groupDeadline })}
    />,
  );
}

const row = (): HTMLElement => screen.getByRole('listitem', { name: 'Rokas' });

const withStatus = (status: Partial<CoachStatus>): AssigneeStanding => ({
  ...HALF,
  status: { ...ON_TIME, ...status },
});

describe('AssigneeRow: a player’s row (R-231)', () => {
  it('shows the name, the bar, % learned and the due count in the due tone', () => {
    const container = renderRow(HALF);
    expect(within(row()).getByText('Rokas')).toBeDefined();
    const bar = container.querySelector('.bg-learned')?.parentElement;
    expect(bar?.classList.contains('h-1.5')).toBe(true);
    expect(within(row()).getByText('50% learned')).toBeDefined();
    expect(within(row()).getByText('1 due').className).toBe('text-due');
  });

  it('says the deadline as "deadline Dec 20", never "due Dec 20"', () => {
    renderRow(HALF);
    expect(
      within(row()).getByText(s.deadline.replace('{date}', 'Dec 20')),
    ).toBeDefined();
    expect(within(row()).queryByText(/due Dec/i)).toBeNull();
  });

  it('draws a near deadline in the due tone', () => {
    renderRow(withStatus({ deadline: '2026-11-19' }));
    expect(within(row()).getByText('deadline Nov 19').className).toBe(
      'text-due',
    );
  });

  it('says when there is no deadline', () => {
    renderRow(withStatus({ deadline: null }));
    expect(within(row()).getByText(s.noDeadline)).toBeDefined();
  });

  it('shows the Overdue, Paused and Done pills from the status', () => {
    renderRow(withStatus({ overdue: true, paused: true }));
    expect(
      within(row()).getByText(MESSAGES.assignment.badge.overdue),
    ).toBeDefined();
    expect(
      within(row()).getByText(MESSAGES.assignment.badge.paused),
    ).toBeDefined();
    expect(within(row()).queryByText(s.done)).toBeNull();
  });

  it('shows Done once every move is tracked (R-129)', () => {
    renderRow(withStatus({ done: true }));
    expect(within(row()).getByText(s.done)).toBeDefined();
  });

  it('says the player’s status where it is shown no progress', () => {
    renderRow(null, {
      ...ROKAS,
      status: { ...ON_TIME, deadline: '2026-11-10', overdue: true },
    });
    expect(
      within(row()).getByText(MESSAGES.assignment.badge.overdue),
    ).toBeDefined();
    expect(within(row()).getByText('deadline Nov 10')).toBeDefined();
    expect(within(row()).queryByText(/learned/)).toBeNull();
  });

  it('shows a fork as "Own copy", with no bar, progress or deadline (R-155)', () => {
    const container = renderRow(null, {
      ...ROKAS,
      status: { ...ON_TIME, forked: true },
    });
    expect(
      within(row()).getByText(MESSAGES.coach.progress.tag.fork),
    ).toBeDefined();
    expect(container.querySelector('.bg-learned')).toBeNull();
    expect(within(row()).queryByText(/learned/)).toBeNull();
    expect(within(row()).queryByText(/deadline/)).toBeNull();
  });

  it('leaves out the deadline the group row says, keeping the pills', () => {
    renderRow(withStatus({ paused: true }), undefined, '2026-12-20');
    expect(within(row()).queryByText(/deadline/)).toBeNull();
    expect(
      within(row()).getByText(MESSAGES.assignment.badge.paused),
    ).toBeDefined();
  });

  it('says a member’s own deadline where it is not the group’s (R-16)', () => {
    renderRow(HALF, ROKAS, '2026-11-30');
    expect(within(row()).getByText('deadline Dec 20')).toBeDefined();
  });

  it('puts the row’s action beside the name and its panel under the row', () => {
    wrap(
      <AssigneeRow
        nameId="rokas-name"
        name="Rokas"
        player={ROKAS}
        shown={HALF}
        today={TODAY}
        action={<button type="button">Act</button>}
      >
        <p>Panel</p>
      </AssigneeRow>,
    );
    const act = within(row()).getByRole('button', { name: 'Act' });
    const panel = within(row()).getByText('Panel');
    const learned = within(row()).getByText('50% learned');
    const follows = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(act, learned)).toBe(true);
    expect(follows(learned, panel)).toBe(true);
  });
});
