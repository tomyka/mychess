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
const p = MESSAGES.assignment.panel;
const badge = MESSAGES.assignment.badge;
const TODAY = '2026-11-17';

const STILL = { paused: false, forked: false, overdue: false, updated: false };

const TO_GROUP: CoachAssignment = {
  id: 'a-group',
  target: { kind: 'group', id: GROUP, name: 'Šeštadienio grupė' },
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

/** The row of the player (or empty group) called `name`. */
const row = (name: string): HTMLElement => {
  const item = screen.getByText(name, { exact: true }).closest('li');
  if (item === null) throw new Error(`no row for ${name}`);
  return item;
};

const sent = (action: typeof server.clear): Record<string, unknown> =>
  Object.fromEntries(action.mock.lastCall?.[1].entries() ?? []);

const open = (item: HTMLElement): void => {
  fireEvent.click(within(item).getByRole('button', { name: /^Change/ }));
};

beforeEach(() => {
  server.unassign.mockReset().mockResolvedValue({ saved: 1 });
  server.deadline.mockReset().mockResolvedValue({ saved: 1 });
  server.clear.mockReset().mockResolvedValue({ saved: 1 });
});

describe('AssigneeRows: one row per player (R-225)', () => {
  it('shows each player’s progress, deadline and badges', () => {
    renderRows([TO_GROUP, TO_ROKAS]);
    expect(screen.getAllByRole('listitem', { name: /./ })).toHaveLength(3);
    const egle = row('Eglė');
    // The learned share only (R-225): the coach is shown no due count.
    expect(within(egle).getByText('50% learned')).toBeDefined();
    expect(within(egle).queryByText(/learned ·/)).toBeNull();
    // Her join day moved her deadline (R-16): her own shows.
    expect(
      within(egle).getByText(p.due.replace('{date}', short('2026-12-05'))),
    ).toBeDefined();
    expect(within(egle).getByText(badge.overdue)).toBeDefined();
    const rokas = row('Rokas');
    expect(within(rokas).getByText('50% learned')).toBeDefined();
    expect(
      within(rokas).getByText(MESSAGES.assignment.noDeadline),
    ).toBeDefined();
    expect(within(rokas).getByText(badge.paused)).toBeDefined();
  });

  it('shows a player’s own copy and no progress (R-155)', () => {
    renderRows([TO_GROUP]);
    const marta = row('Marta');
    expect(within(marta).getByText(badge.forked)).toBeDefined();
    expect(within(marta).queryByText(/learned/)).toBeNull();
  });

  it('names the group a player has it through, and not for a player’s own', () => {
    renderRows([TO_GROUP, TO_ROKAS]);
    const through = p.inGroup.replace('{name}', 'Šeštadienio grupė');
    expect(within(row('Eglė')).getByText(through)).toBeDefined();
    expect(within(row('Marta')).getByText(through)).toBeDefined();
    expect(within(row('Rokas')).queryByText(through)).toBeNull();
  });

  it('gives a player assigned both directly and through a group a row for each', () => {
    const withRokas: CoachAssignment = {
      ...TO_GROUP,
      players: TO_ROKAS.players,
    };
    renderRows([TO_ROKAS, withRokas]);
    const through = p.inGroup.replace('{name}', 'Šeštadienio grupė');
    const rows = screen.getAllByRole('listitem', { name: 'Rokas' });
    expect(rows).toHaveLength(2);
    const [direct, viaGroup] = rows;
    if (direct === undefined || viaGroup === undefined)
      throw new Error('two rows expected');
    expect(within(direct).queryByText(through)).toBeNull();
    expect(
      within(direct).getByRole('button', { name: p.change }),
    ).toBeDefined();
    expect(within(viaGroup).getByText(through)).toBeDefined();
    expect(
      within(viaGroup).getByRole('button', {
        name: p.changeFor.replace('{name}', 'Šeštadienio grupė'),
      }),
    ).toBeDefined();
  });

  it('keeps a group without players, so it can still be changed', () => {
    renderRows([{ ...TO_GROUP, players: [] }]);
    const group = row('Šeštadienio grupė');
    expect(within(group).getByText(p.emptyGroup)).toBeDefined();
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
    const change = within(rokas).getByRole('button', { name: p.change });
    expect(change.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText(p.newDeadline)).toBeNull();
    open(rokas);
    expect(change.getAttribute('aria-expanded')).toBe('true');
    expect(within(rokas).getByLabelText(p.newDeadline)).toBeDefined();
    expect(
      within(rokas).getByRole('button', { name: p.unassign }),
    ).toBeDefined();
    expect(within(row('Eglė')).queryByLabelText(p.newDeadline)).toBeNull();
    fireEvent.click(change);
    expect(within(rokas).queryByLabelText(p.newDeadline)).toBeNull();
  });

  it('names the group on Change, and shows the group’s deadline it edits', () => {
    renderRows([TO_GROUP]);
    const egle = row('Eglė');
    // Her row shows her own deadline (R-16) ...
    expect(
      within(egle).getByText(p.due.replace('{date}', short('2026-12-05'))),
    ).toBeDefined();
    fireEvent.click(
      within(egle).getByRole('button', {
        name: p.changeFor.replace('{name}', 'Šeštadienio grupė'),
      }),
    );
    // ... while Change edits the group's, so the forms say it first.
    expect(
      within(egle).getByText(
        p.groupDeadline.replace('{date}', short('2026-11-30')),
      ),
    ).toBeDefined();
  });

  it('says when the group it edits has no deadline', () => {
    renderRows([{ ...TO_GROUP, deadline: null }]);
    const egle = row('Eglė');
    open(egle);
    expect(within(egle).getByText(p.groupNoDeadline)).toBeDefined();
  });

  it('says nothing of a group on a player’s own assignment', () => {
    renderRows([TO_ROKAS]);
    const rokas = row('Rokas');
    open(rokas);
    expect(within(rokas).queryByText(/group/i)).toBeNull();
  });

  it('changes the deadline of the assignment the row is in', async () => {
    renderRows([TO_GROUP]);
    const egle = row('Eglė');
    open(egle);
    const date = within(egle).getByLabelText<HTMLInputElement>(p.newDeadline);
    expect(date.value).toBe('2026-11-30');
    expect(date.min).toBe(TODAY);
    fireEvent.change(date, { target: { value: '2026-12-20' } });
    fireEvent.click(
      within(egle).getByRole('button', { name: p.changeDeadline }),
    );
    await waitFor(() => {
      expect(sent(server.deadline)).toEqual({
        assignmentId: 'a-group',
        deadline: '2026-12-20',
      });
    });
    expect(await within(egle).findByText(p.deadlineSaved)).toBeDefined();
  });

  it('clears a deadline, offered only while there is one', async () => {
    renderRows([TO_GROUP, TO_ROKAS]);
    open(row('Rokas'));
    expect(
      within(row('Rokas')).queryByRole('button', { name: p.clearDeadline }),
    ).toBeNull();
    const egle = row('Eglė');
    open(egle);
    fireEvent.click(
      within(egle).getByRole('button', { name: p.clearDeadline }),
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
    const egle = row('Eglė');
    open(egle);
    fireEvent.click(within(egle).getByRole('button', { name: p.unassign }));
    expect(
      within(egle).getByText(
        'Unassign it from Šeštadienio grupė? The repertoire leaves the players’ lists, and they have 30 days to keep their own copy. Anyone who has it another way keeps it.',
      ),
    ).toBeDefined();
    expect(server.unassign).not.toHaveBeenCalled();
    fireEvent.click(
      within(egle).getByRole('button', { name: p.unassignConfirm }),
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
