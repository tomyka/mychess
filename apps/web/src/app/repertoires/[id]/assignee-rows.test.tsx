import type { Standing } from '@mychess/chess';
import type { CoachAssignment } from '@mychess/db';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import type { AssignmentActionState } from './assign-actions';
import { AssigneeRows } from './assignee-rows';

type Action = (
  previous: AssignmentActionState,
  form: FormData,
) => Promise<AssignmentActionState>;

const server = vi.hoisted(() => ({
  unassign: vi.fn<Action>(),
  deadline: vi.fn<Action>(),
  clear: vi.fn<Action>(),
}));

vi.mock('./assign-actions', () => ({
  assignAction: vi.fn(),
  unassignAction: server.unassign,
  setDeadlineAction: server.deadline,
  clearDeadlineAction: server.clear,
}));

const GROUP = '0b9e7a51-3c2d-4e6f-8a1b-2c3d4e5f6a7b';
const GROUP_NAME = 'Šeštadienio grupė';
const p = MESSAGES.assignment.panel;
const badge = MESSAGES.assignment.badge;
const TODAY = '2026-11-17';

const STILL = { paused: false, forked: false, overdue: false, updated: false };

const TO_GROUP: CoachAssignment = {
  id: 'a-group',
  target: { kind: 'group', id: GROUP, name: GROUP_NAME },
  deadline: '2026-11-30',
  players: [
    {
      playerId: 'egle',
      displayName: 'Eglė',
      deadline: '2026-12-05',
      badges: { ...STILL, overdue: true },
    },
    {
      playerId: 'marta',
      displayName: 'Marta',
      deadline: '2026-11-30',
      badges: { ...STILL, forked: true },
    },
  ],
};

const TO_ROKAS: CoachAssignment = {
  id: 'a-rokas',
  target: { kind: 'player', id: 'rokas', name: 'Rokas' },
  deadline: null,
  players: [
    {
      playerId: 'rokas',
      displayName: 'Rokas',
      deadline: null,
      badges: { ...STILL, paused: true },
    },
  ],
};

/** Half of ten moves learned, one due. */
const HALF: Standing = {
  counts: { notStarted: 4, skipped: 0, due: 1, learned: 5 },
  mastered: false,
};

const STANDINGS = new Map<string, Standing | null>([
  ['egle', HALF],
  ['rokas', { ...HALF, counts: { ...HALF.counts, notStarted: 5, due: 0 } }],
  // Marta made her own copy: the coach sees no progress (R-155).
  ['marta', null],
]);

/** A deadline as a row writes it: the month short, this year's no year. */
const short = (iso: string): string =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Europe/Vilnius',
  }).format(new Date(`${iso}T12:00:00Z`));

/** "due Nov 30", as a row says it. */
const due = (iso: string): string => p.due.replace('{date}', short(iso));

function renderRows(assignments: readonly CoachAssignment[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <AssigneeRows
        assignments={assignments}
        standings={STANDINGS}
        today={TODAY}
      />
    </NextIntlClientProvider>,
  );
}

/** The row called `name`: a player's own, a group's, or a group member's. */
const row = (name: string): HTMLElement =>
  screen.getByRole('listitem', { name });

/** The rows of the members under a group's row. */
const members = (group: HTMLElement): HTMLElement[] =>
  within(group)
    .getAllByRole('listitem')
    .filter((item) => item.parentElement?.closest('li') === group);

const sent = (action: typeof server.clear): Record<string, unknown> =>
  Object.fromEntries(action.mock.lastCall?.[1].entries() ?? []);

/** The row's own Change: a group member's row has none. */
const change = (item: HTMLElement): HTMLElement =>
  within(item).getByRole('button', { name: p.change });

const open = (item: HTMLElement): void => {
  fireEvent.click(change(item));
};

beforeEach(() => {
  server.unassign.mockReset().mockResolvedValue({ saved: 1 });
  server.deadline.mockReset().mockResolvedValue({ saved: 1 });
  server.clear.mockReset().mockResolvedValue({ saved: 1 });
});

describe('AssigneeRows: a row per assignment (R-225)', () => {
  it('shows a player’s own assignment with progress, deadline, badges and Change', () => {
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    // The learned share only (R-225): the coach is shown no due count.
    expect(within(rokas).getByText('50% learned')).toBeDefined();
    expect(within(rokas).queryByText(/learned ·/)).toBeNull();
    expect(
      within(rokas).getByText(MESSAGES.assignment.noDeadline),
    ).toBeDefined();
    expect(within(rokas).getByText(badge.paused)).toBeDefined();
    expect(change(rokas)).toBeDefined();
  });

  it('shows a group as one row: its name, its size and deadline, one Change', () => {
    renderRows([TO_GROUP]);
    const group = row(GROUP_NAME);
    expect(
      within(group).getByText(`2 players · ${due('2026-11-30')}`),
    ).toBeDefined();
    expect(
      within(group).getAllByRole('button', { name: p.change }),
    ).toHaveLength(1);
    expect(screen.queryByText(/Change for/u)).toBeNull();
  });

  it('lists the group’s members under it, with progress and no Change', () => {
    renderRows([TO_GROUP]);
    expect(members(row(GROUP_NAME))).toEqual([row('Eglė'), row('Marta')]);
    const egle = row('Eglė');
    expect(within(egle).getByText('50% learned')).toBeDefined();
    expect(within(egle).queryByText(/learned ·/)).toBeNull();
    expect(within(egle).getByText(badge.overdue)).toBeDefined();
    expect(within(egle).queryByRole('button')).toBeNull();
  });

  it('gives a member’s own deadline only where it is not the group’s (R-16)', () => {
    renderRows([TO_GROUP]);
    // Her join day moved her deadline: her own shows.
    expect(within(row('Eglė')).getByText(due('2026-12-05'))).toBeDefined();
    expect(within(row('Marta')).queryByText(/due/u)).toBeNull();
  });

  it('shows a member’s own copy and no progress (R-155)', () => {
    renderRows([TO_GROUP]);
    const marta = row('Marta');
    expect(within(marta).getByText(badge.forked)).toBeDefined();
    expect(within(marta).queryByText(/learned/)).toBeNull();
  });

  it('says when the group has no deadline', () => {
    renderRows([{ ...TO_GROUP, deadline: null }]);
    expect(
      within(row(GROUP_NAME)).getByText(
        `2 players · ${MESSAGES.assignment.noDeadline}`,
      ),
    ).toBeDefined();
  });

  it('gives a player assigned both directly and through a group both rows', () => {
    const withRokas: CoachAssignment = {
      ...TO_GROUP,
      players: TO_ROKAS.players,
    };
    renderRows([TO_ROKAS, withRokas]);
    const rows = screen.getAllByRole('listitem', { name: 'Rokas' });
    expect(rows).toHaveLength(2);
    const [direct, viaGroup] = rows;
    if (direct === undefined || viaGroup === undefined)
      throw new Error('two rows expected');
    expect(change(direct)).toBeDefined();
    const group = row(GROUP_NAME);
    expect(members(group)).toEqual([viaGroup]);
    expect(within(viaGroup).queryByRole('button')).toBeNull();
    expect(
      within(group).getByText(`1 player · ${due('2026-11-30')}`),
    ).toBeDefined();
  });

  it('keeps a group without players, so it can still be changed', () => {
    renderRows([{ ...TO_GROUP, players: [] }]);
    const group = row(GROUP_NAME);
    expect(
      within(group).getByText(`No players · ${due('2026-11-30')}`),
    ).toBeDefined();
    expect(within(group).queryByRole('list')).toBeNull();
    open(group);
    expect(
      within(group).getByRole('button', { name: p.unassign }),
    ).toBeDefined();
  });

  it('says when it is assigned to no one', () => {
    renderRows([]);
    expect(screen.getByText(p.none)).toBeDefined();
  });
});

describe('AssigneeRows: Change (R-51, R-130)', () => {
  it('opens the deadline and unassign in that row only', () => {
    renderRows([TO_GROUP, TO_ROKAS]);
    const rokas = row('Rokas');
    const button = change(rokas);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText(p.newDeadline)).toBeNull();
    open(rokas);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(rokas).getByLabelText(p.newDeadline)).toBeDefined();
    expect(
      within(rokas).getByRole('button', { name: p.unassign }),
    ).toBeDefined();
    expect(within(row(GROUP_NAME)).queryByLabelText(p.newDeadline)).toBeNull();
    fireEvent.click(button);
    expect(within(rokas).queryByLabelText(p.newDeadline)).toBeNull();
  });

  it('opens the group’s forms in the group’s row, above its members', () => {
    renderRows([TO_GROUP]);
    const group = row(GROUP_NAME);
    open(group);
    const field = within(group).getByLabelText(p.newDeadline);
    expect(within(row('Eglė')).queryByLabelText(p.newDeadline)).toBeNull();
    const [first] = members(group);
    if (first === undefined) throw new Error('members expected');
    expect(
      field.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it('names the group the group’s Change acts for', () => {
    renderRows([TO_GROUP]);
    const described = change(row(GROUP_NAME)).getAttribute('aria-describedby');
    expect(document.getElementById(described ?? '')?.textContent).toBe(
      GROUP_NAME,
    );
  });

  it('says nothing of a group on a player’s own assignment', () => {
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    open(rokas);
    expect(within(rokas).queryByText(/group/i)).toBeNull();
  });

  it('changes the group’s deadline from the group’s row', async () => {
    renderRows([TO_GROUP]);
    const group = row(GROUP_NAME);
    open(group);
    const date = within(group).getByLabelText<HTMLInputElement>(p.newDeadline);
    expect(date.value).toBe('2026-11-30');
    expect(date.min).toBe(TODAY);
    fireEvent.change(date, { target: { value: '2026-12-20' } });
    fireEvent.click(
      within(group).getByRole('button', { name: p.changeDeadline }),
    );
    await waitFor(() => {
      expect(sent(server.deadline)).toEqual({
        assignmentId: 'a-group',
        deadline: '2026-12-20',
      });
    });
    expect(await within(group).findByText(p.deadlineSaved)).toBeDefined();
  });

  it('clears a deadline, offered only while there is one', async () => {
    renderRows([TO_GROUP, TO_ROKAS]);
    open(row('Rokas'));
    expect(
      within(row('Rokas')).queryByRole('button', { name: p.clearDeadline }),
    ).toBeNull();
    const group = row(GROUP_NAME);
    open(group);
    fireEvent.click(
      within(group).getByRole('button', { name: p.clearDeadline }),
    );
    await waitFor(() => {
      expect(sent(server.clear)).toEqual({ assignmentId: 'a-group' });
    });
  });

  it('shows a deadline refusal in the row', async () => {
    server.deadline.mockResolvedValue({ refusal: 'assignment.deadlinePast' });
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    open(rokas);
    fireEvent.click(
      within(rokas).getByRole('button', { name: p.changeDeadline }),
    );
    expect(
      await within(rokas).findByText(MESSAGES.assignment.deadlinePast),
    ).toBeDefined();
  });

  it('unassigns only once confirmed, naming the group it leaves', async () => {
    renderRows([TO_GROUP]);
    const group = row(GROUP_NAME);
    open(group);
    fireEvent.click(within(group).getByRole('button', { name: p.unassign }));
    expect(
      within(group).getByText(
        'Unassign it from Šeštadienio grupė? The repertoire leaves the players’ lists, and they have 30 days to keep their own copy. Anyone who has it another way keeps it.',
      ),
    ).toBeDefined();
    expect(server.unassign).not.toHaveBeenCalled();
    fireEvent.click(
      within(group).getByRole('button', { name: p.unassignConfirm }),
    );
    await waitFor(() => {
      expect(sent(server.unassign)).toEqual({ assignmentId: 'a-group' });
    });
  });

  it('asks about one player in the singular', () => {
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    open(rokas);
    fireEvent.click(within(rokas).getByRole('button', { name: p.unassign }));
    expect(
      within(rokas).getByText(
        'Unassign it from Rokas? The repertoire leaves their list, and they have 30 days to keep their own copy.',
      ),
    ).toBeDefined();
  });

  it('shows an unassign refusal', async () => {
    server.unassign.mockResolvedValue({ refusal: 'assignment.notFound' });
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    open(rokas);
    fireEvent.click(within(rokas).getByRole('button', { name: p.unassign }));
    fireEvent.click(
      within(rokas).getByRole('button', { name: p.unassignConfirm }),
    );
    expect(
      await within(rokas).findByText(MESSAGES.assignment.notFound),
    ).toBeDefined();
  });
});
