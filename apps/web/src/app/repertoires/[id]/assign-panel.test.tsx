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
import type { CoachAssignment } from '@mychess/db';
import type { AssignPanelData } from '../../../server/coach-assignments';
import type { AssignmentActionState } from './assign-actions';
import { AssignPanel } from './assign-panel';

type Action = (
  previous: AssignmentActionState,
  form: FormData,
) => Promise<AssignmentActionState>;

const server = vi.hoisted(() => ({
  assign: vi.fn<Action>(),
  unassign: vi.fn<Action>(),
  deadline: vi.fn<Action>(),
  clear: vi.fn<Action>(),
}));

vi.mock('./assign-actions', () => ({
  assignAction: server.assign,
  unassignAction: server.unassign,
  setDeadlineAction: server.deadline,
  clearDeadlineAction: server.clear,
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const GROUP = '0b9e7a51-3c2d-4e6f-8a1b-2c3d4e5f6a7b';
const p = MESSAGES.assignment.panel;
const badge = MESSAGES.assignment.badge;

/** A day as the page writes it. */
const day = (iso: string): string =>
  new Intl.DateTimeFormat('en', {
    dateStyle: 'long',
    timeZone: 'Europe/Vilnius',
  }).format(new Date(`${iso}T12:00:00Z`));

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
      badges: { ...STILL, paused: true, overdue: true },
    },
    {
      playerId: 'marta',
      displayName: 'Marta',
      deadline: null,
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

/** Today in Vilnius, as the loader gives it. */
const TODAY = '2026-11-17';

const PEOPLE: Pick<AssignPanelData, 'players' | 'groups' | 'today'> = {
  players: [
    { id: 'rokas', displayName: 'Rokas' },
    { id: 'egle', displayName: 'Eglė' },
  ],
  groups: [{ id: GROUP, name: 'Šeštadienio grupė' }],
  today: TODAY,
};

function renderPanel(
  data: AssignPanelData = { ...PEOPLE, assignments: [] },
): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <AssignPanel repertoireId={ID} data={data} />
    </NextIntlClientProvider>,
  );
}

const sent = (action: typeof server.assign): Record<string, unknown> =>
  Object.fromEntries(action.mock.lastCall?.[1].entries() ?? []);

const options = (): string[] =>
  within(screen.getByLabelText(p.target))
    .getAllByRole('option')
    .map((option) => option.textContent);

beforeEach(() => {
  server.assign.mockReset().mockResolvedValue({ saved: 1 });
  server.unassign.mockReset().mockResolvedValue({ saved: 1 });
  server.deadline.mockReset().mockResolvedValue({ saved: 1 });
  server.clear.mockReset().mockResolvedValue({ saved: 1 });
});

describe('AssignPanel: assigning (R-15, R-16)', () => {
  it('offers the linked players and groups and an optional date', () => {
    renderPanel();
    expect(
      screen.getByRole('heading', { level: 2, name: p.title }),
    ).toBeDefined();
    expect(options()).toEqual([p.choose, 'Rokas', 'Eglė', 'Šeštadienio grupė']);
    expect(screen.getByRole('group', { name: p.players }).tagName).toBe(
      'OPTGROUP',
    );
    expect(screen.getByRole('group', { name: p.groups }).tagName).toBe(
      'OPTGROUP',
    );
    const date = screen.getByLabelText<HTMLInputElement>(p.deadline);
    expect(date.type).toBe('date');
    expect(date.required).toBe(false);
    expect(screen.getByText(p.none)).toBeDefined();
  });

  it('assigns the picked group with the date', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(p.target), {
      target: { value: `group:${GROUP}` },
    });
    fireEvent.change(screen.getByLabelText(p.deadline), {
      target: { value: '2026-11-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: p.assign }));
    await waitFor(() => {
      expect(server.assign).toHaveBeenCalledTimes(1);
    });
    expect(sent(server.assign)).toEqual({
      repertoireId: ID,
      target: `group:${GROUP}`,
      deadline: '2026-11-30',
    });
    expect(await screen.findByText(p.assigned)).toBeDefined();
  });

  it('assigns a player with no date', async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(p.target), {
      target: { value: 'player:rokas' },
    });
    fireEvent.click(screen.getByRole('button', { name: p.assign }));
    await waitFor(() => {
      expect(sent(server.assign)).toEqual({
        repertoireId: ID,
        target: 'player:rokas',
        deadline: '',
      });
    });
  });

  it('still says it was assigned once the last target is taken', async () => {
    const panel = (data: AssignPanelData) => (
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <AssignPanel repertoireId={ID} data={data} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(
      panel({
        players: [],
        groups: PEOPLE.groups,
        assignments: [TO_ROKAS],
        today: TODAY,
      }),
    );
    fireEvent.change(screen.getByLabelText(p.target), {
      target: { value: `group:${GROUP}` },
    });
    fireEvent.click(screen.getByRole('button', { name: p.assign }));
    expect(await screen.findByText(p.assigned)).toBeDefined();
    // The page refreshes: no one is left to offer, so the form goes.
    rerender(
      panel({
        players: [],
        groups: [],
        assignments: [TO_ROKAS, TO_GROUP],
        today: TODAY,
      }),
    );
    expect(screen.getByText(p.everyone)).toBeDefined();
    expect(screen.queryByRole('button', { name: p.assign })).toBeNull();
    const status = screen.getByText(p.assigned);
    expect(status.getAttribute('role')).toBe('status');
  });

  it('shows a refusal value', async () => {
    server.assign.mockResolvedValue({ refusal: 'assignment.alreadyAssigned' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: p.assign }));
    expect(
      await screen.findByText(MESSAGES.assignment.alreadyAssigned),
    ).toBeDefined();
    expect(screen.queryByText(p.assigned)).toBeNull();
  });

  it('offers what the loader left assignable, leaving out an empty kind', () => {
    renderPanel({
      players: [{ id: 'egle', displayName: 'Eglė' }],
      groups: [],
      assignments: [TO_GROUP, TO_ROKAS],
      today: TODAY,
    });
    expect(options()).toEqual([p.choose, 'Eglė']);
    expect(screen.queryByRole('group', { name: p.groups })).toBeNull();
  });

  it('says why there is nothing to pick', () => {
    renderPanel({ players: [], groups: [], assignments: [], today: TODAY });
    expect(screen.getByText(p.nobody)).toBeDefined();
    expect(screen.queryByRole('button', { name: p.assign })).toBeNull();
  });

  it('says when it is already everyone’s', () => {
    renderPanel({
      players: [],
      groups: [],
      assignments: [TO_GROUP, TO_ROKAS],
      today: TODAY,
    });
    expect(screen.getByText(p.everyone)).toBeDefined();
    expect(screen.queryByRole('button', { name: p.assign })).toBeNull();
  });
});

/** The list item of the assignment to `name`. */
const row = (name: string): HTMLElement => {
  const item = screen.getByText(name, { selector: 'h4' }).closest('li');
  if (item === null) throw new Error(`no row for ${name}`);
  return item;
};

describe('AssignPanel: the assignments (R-46, R-51, R-128, R-132)', () => {
  it('lists each target with its deadline and each player’s badges', () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP, TO_ROKAS] });
    expect(screen.queryByText(p.none)).toBeNull();
    const group = row('Šeštadienio grupė');
    expect(within(group).getByText(p.group)).toBeDefined();
    expect(
      within(group).getByText(
        MESSAGES.assignment.deadlineOn.replace('{date}', day('2026-11-30')),
      ),
    ).toBeDefined();
    const egle = within(group).getByText('Eglė').closest('li');
    if (egle === null) throw new Error('no Eglė');
    expect(within(egle).getByText(badge.paused)).toBeDefined();
    expect(within(egle).getByText(badge.overdue)).toBeDefined();
    // Her join day moved her deadline (R-16).
    expect(
      within(egle).getByText(
        p.playerDeadline.replace('{date}', day('2026-12-05')),
      ),
    ).toBeDefined();
    const marta = within(group).getByText('Marta').closest('li');
    if (marta === null) throw new Error('no Marta');
    expect(within(marta).getByText(badge.forked)).toBeDefined();
    expect(within(marta).queryByText(badge.paused)).toBeNull();

    const rokas = row('Rokas');
    expect(
      within(rokas).getByText(MESSAGES.assignment.noDeadline),
    ).toBeDefined();
    expect(within(rokas).getByText(badge.paused)).toBeDefined();
    expect(within(rokas).queryByText(badge.overdue)).toBeNull();
  });

  it('says when a group has no players yet', () => {
    renderPanel({
      ...PEOPLE,
      assignments: [{ ...TO_GROUP, players: [] }],
    });
    expect(
      within(row('Šeštadienio grupė')).getByText(p.emptyGroup),
    ).toBeDefined();
  });

  it('changes the deadline', async () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP] });
    const group = row('Šeštadienio grupė');
    const date = within(group).getByLabelText<HTMLInputElement>(p.newDeadline);
    expect(date.value).toBe('2026-11-30');
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

  it('clears the deadline, offered only while there is one', async () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP, TO_ROKAS] });
    expect(
      within(row('Rokas')).queryByRole('button', { name: p.clearDeadline }),
    ).toBeNull();
    fireEvent.click(
      within(row('Šeštadienio grupė')).getByRole('button', {
        name: p.clearDeadline,
      }),
    );
    await waitFor(() => {
      expect(sent(server.clear)).toEqual({ assignmentId: 'a-group' });
    });
    expect(server.deadline).not.toHaveBeenCalled();
    expect(
      await within(row('Šeštadienio grupė')).findByText(p.deadlineSaved),
    ).toBeDefined();
  });

  it('hints at today as the earliest deadline in both date fields (R-203)', () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP] });
    expect(screen.getByLabelText<HTMLInputElement>(p.deadline).min).toBe(TODAY);
    expect(
      within(row('Šeštadienio grupė')).getByLabelText<HTMLInputElement>(
        p.newDeadline,
      ).min,
    ).toBe(TODAY);
  });

  it('says when a deadline is already past (R-203, R-210)', async () => {
    server.deadline.mockResolvedValue({ refusal: 'assignment.deadlinePast' });
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP] });
    const group = row('Šeštadienio grupė');
    fireEvent.click(
      within(group).getByRole('button', { name: p.changeDeadline }),
    );
    expect(
      await within(group).findByText(MESSAGES.assignment.deadlinePast),
    ).toBeDefined();
  });

  it('shows a deadline refusal in its row', async () => {
    server.deadline.mockResolvedValue({
      refusal: 'assignment.deadlineInvalid',
    });
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP] });
    const group = row('Šeštadienio grupė');
    fireEvent.click(
      within(group).getByRole('button', { name: p.changeDeadline }),
    );
    expect(
      await within(group).findByText(MESSAGES.assignment.deadlineInvalid),
    ).toBeDefined();
  });

  it('unassigns only once confirmed, saying what the players keep', async () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP] });
    const group = row('Šeštadienio grupė');
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
    renderPanel({ ...PEOPLE, assignments: [TO_ROKAS] });
    const rokas = row('Rokas');
    fireEvent.click(within(rokas).getByRole('button', { name: p.unassign }));
    expect(
      within(rokas).getByText(
        'Unassign it from Rokas? The repertoire leaves their list, and they have 30 days to keep their own copy.',
      ),
    ).toBeDefined();
  });

  it('shows an unassign refusal', async () => {
    server.unassign.mockResolvedValue({ refusal: 'assignment.notFound' });
    renderPanel({ ...PEOPLE, assignments: [TO_ROKAS] });
    const rokas = row('Rokas');
    fireEvent.click(within(rokas).getByRole('button', { name: p.unassign }));
    fireEvent.click(
      within(rokas).getByRole('button', { name: p.unassignConfirm }),
    );
    expect(
      await within(rokas).findByText(MESSAGES.assignment.notFound),
    ).toBeDefined();
  });
});
