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

/** The panel's data; the standings are AssigneeRows' own test. */
type Data = Omit<AssignPanelData, 'standings'>;

const withStandings = (data: Data): AssignPanelData => ({
  ...data,
  standings: new Map(),
});

function renderPanel(data: Data = { ...PEOPLE, assignments: [] }): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <AssignPanel repertoireId={ID} data={withStandings(data)} />
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
      screen.getByRole('heading', { level: 3, name: p.title }),
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
    const panel = (data: Data) => (
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <AssignPanel repertoireId={ID} data={withStandings(data)} />
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

describe('AssignPanel: whom it is assigned to (R-225)', () => {
  it('lists a row per player first, then the assign form', () => {
    renderPanel({ ...PEOPLE, assignments: [TO_GROUP, TO_ROKAS] });
    const list = screen.getByRole('heading', { level: 2, name: p.list });
    const form = screen.getByRole('heading', { level: 3, name: p.title });
    const rows = screen.getAllByRole('listitem', { name: /./ });
    expect(rows).toEqual(
      ['Eglė', 'Marta', 'Rokas'].map((name) =>
        screen.getByRole('listitem', { name }),
      ),
    );
    const follows = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(rows.every((item) => follows(list, item))).toBe(true);
    expect(rows.every((item) => follows(item, form))).toBe(true);
    expect(screen.queryByText(p.none)).toBeNull();
  });

  it('says when it is assigned to no one', () => {
    renderPanel();
    expect(screen.getByText(p.none)).toBeDefined();
  });

  it('hints at today as the earliest deadline in the assign form (R-203)', () => {
    renderPanel();
    expect(screen.getByLabelText<HTMLInputElement>(p.deadline).min).toBe(TODAY);
  });
});
