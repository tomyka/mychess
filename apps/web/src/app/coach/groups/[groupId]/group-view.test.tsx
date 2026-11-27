import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type {
  CoachActionState,
  CreateInviteState,
  RenameGroupState,
} from '../../actions';
import { GroupView, type GroupPageData } from './group-view';

const server = vi.hoisted(() => ({
  rename:
    vi.fn<
      (previous: RenameGroupState, form: FormData) => Promise<RenameGroupState>
    >(),
  remove:
    vi.fn<
      (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
    >(),
  add: vi.fn<
    (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
  >(),
  delete: vi.fn<(form: FormData) => Promise<void>>(),
  invite:
    vi.fn<
      (
        previous: CreateInviteState,
        form: FormData,
      ) => Promise<CreateInviteState>
    >(),
}));

vi.mock('../../actions', () => ({
  renameGroupAction: server.rename,
  removeMemberAction: server.remove,
  addMemberAction: server.add,
  deleteGroupAction: server.delete,
  createInviteAction: server.invite,
  revokeInviteAction: vi.fn(),
}));

const c = MESSAGES.coach;
const g = c.group;

const STATUS = {
  deadline: '2026-11-30',
  overdue: false,
  paused: false,
  done: false,
  forked: false,
};
const STANDING = {
  kind: 'granted',
  standing: {
    counts: { notStarted: 1, skipped: 0, due: 0, learned: 1 },
    mastered: false,
  },
} as const;

const PAGE: GroupPageData = {
  id: 'g-1',
  name: 'Šeštadienio grupė',
  members: [
    { id: 'p-1', displayName: 'Rokas' },
    { id: 'p-2', displayName: 'Rūta' },
  ],
  addable: [
    { id: 'p-3', displayName: 'Gabija' },
    { id: 'p-4', displayName: 'Jonas' },
  ],
  grid: {
    columns: [
      {
        id: 'r-1',
        name: 'Karo-Kan gynyba',
        side: 'black',
        deadline: '2026-11-30',
        done: 1,
        count: 2,
      },
    ],
    rows: [
      {
        player: { id: 'p-1', displayName: 'Rokas' },
        lastTrainedDays: 1,
        cells: [{ status: { ...STATUS, done: true }, view: STANDING }],
      },
      {
        player: { id: 'p-2', displayName: 'Rūta' },
        lastTrainedDays: null,
        cells: [{ status: STATUS, view: STANDING }],
      },
    ],
  },
  assignments: [
    {
      repertoireId: 'r-1',
      repertoireName: 'Karo-Kan gynyba',
      deadline: '2026-11-30',
    },
  ],
  invite: { id: 'i-1', expiresAt: new Date('2026-12-10T10:00:00Z') },
  today: '2026-11-27',
};

function renderView(page: GroupPageData = PAGE): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <GroupView page={page} />
    </NextIntlClientProvider>,
  );
}

const fieldsOf = (form: FormData | undefined): Record<string, unknown> =>
  Object.fromEntries(form?.entries() ?? []);

const title = () => screen.queryByRole('heading', { level: 1 });
const rename = () => screen.getByRole('button', { name: g.rename });
const nameField = () => screen.getByLabelText<HTMLInputElement>(c.groups.name);
const players = () =>
  within(screen.getByRole('region', { name: /^Players · / }));
const assigned = () =>
  within(screen.getByRole('region', { name: g.assignedTitle }));

/** The whole line of an assignment whose deadline says `deadline`. */
const assignedLine = (deadline: string): string | null =>
  assigned().getByText(deadline).closest('p')?.textContent ?? null;

/** The member row of `name`. */
const memberItem = (name: string) =>
  within(
    players()
      .getAllByRole('listitem')
      .find((item) => item.firstChild?.textContent === name) ?? document.body,
  );

beforeEach(() => {
  server.rename.mockReset().mockResolvedValue({ saved: true });
  server.remove.mockReset().mockResolvedValue({});
  server.add.mockReset().mockResolvedValue({});
  server.delete.mockReset().mockResolvedValue(undefined);
  server.invite.mockReset().mockResolvedValue({});
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

describe('GroupView: the header', () => {
  it('names the group and has a way back to the dashboard', () => {
    renderView();
    expect(title()?.textContent).toBe(PAGE.name);
    expect(
      screen.getByRole('link', { name: 'Back to Coach' }).getAttribute('href'),
    ).toBe('/coach');
  });

  it('says how many players and names the nearest assignment in its meta line', () => {
    renderView({
      ...PAGE,
      assignments: [
        { repertoireId: 'r-2', repertoireName: 'Slav Defence', deadline: null },
        ...PAGE.assignments,
      ],
    });
    expect(
      screen.getByText('2 players · Karo-Kan gynyba due Nov 30 · +1 more'),
    ).toBeDefined();
  });

  it('names the nearest assignment by name alone when none has a deadline', () => {
    renderView({
      ...PAGE,
      assignments: [
        { repertoireId: 'r-2', repertoireName: 'Slav Defence', deadline: null },
        {
          repertoireId: 'r-1',
          repertoireName: 'Karo-Kan gynyba',
          deadline: null,
        },
      ],
    });
    expect(
      screen.getByText('2 players · Karo-Kan gynyba · +1 more'),
    ).toBeDefined();
  });

  it('swaps the title for the rename form; Cancel brings the title back and focus to Rename', () => {
    renderView();
    fireEvent.click(rename());
    expect(title()).toBeNull();
    expect(nameField().value).toBe(PAGE.name);
    expect(document.activeElement).toBe(nameField());
    expect(screen.getByRole('button', { name: g.save })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: g.cancel }));
    expect(title()?.textContent).toBe(PAGE.name);
    expect(screen.queryByLabelText(c.groups.name)).toBeNull();
    expect(document.activeElement).toBe(rename());
  });

  it('renames the group, closes the form and says it is saved', async () => {
    renderView();
    fireEvent.click(rename());
    fireEvent.change(nameField(), { target: { value: 'Sekmadienio grupė' } });
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() => {
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain(g.saved);
    });
    expect(fieldsOf(server.rename.mock.lastCall?.[1])).toEqual({
      groupId: 'g-1',
      name: 'Sekmadienio grupė',
    });
    expect(title()).not.toBeNull();
    expect(screen.queryByLabelText(c.groups.name)).toBeNull();
    expect(document.activeElement).toBe(rename());
  });

  it('keeps the form open on a refused name, with what was typed', async () => {
    server.rename.mockResolvedValue({ refusal: 'groupName.blank' });
    renderView();
    fireEvent.click(rename());
    fireEvent.change(nameField(), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() => {
      expect(
        screen.getAllByRole('status').map((status) => status.textContent),
      ).toContain(MESSAGES.groupName.blank);
    });
    expect(nameField().value).toBe(' ');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
    expect(title()).toBeNull();
  });
});

describe('GroupView: the sections', () => {
  it('starts with Progress, before every other section', () => {
    renderView();
    const titles = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual([
      c.progress.gridTitle,
      g.assignedTitle,
      g.inviteTitle,
      'Players · 2',
    ]);
  });

  it('lists what is assigned to the group, its deadline and how many are done, to its Repertoire screen', () => {
    renderView();
    const link = assigned().getByRole('link', { name: 'Karo-Kan gynyba' });
    expect(link.getAttribute('href')).toBe('/repertoires/r-1/manage');
    expect(assignedLine('due Nov 30')).toBe('due Nov 30 · 1 done of 2');
  });

  it('draws a near deadline in the due tone, as the Repertoire screen does', () => {
    renderView();
    expect(assigned().getByText('due Nov 30').className).toContain('text-due');
  });

  it('draws a far deadline muted', () => {
    const [column] = PAGE.grid.columns;
    if (column === undefined) throw new Error('fixture');
    renderView({
      ...PAGE,
      grid: { ...PAGE.grid, columns: [{ ...column, deadline: '2026-12-30' }] },
    });
    const deadline = assigned().getByText('due Dec 30');
    expect(deadline.className).not.toContain('text-due');
    expect(deadline.className).toContain('text-fg-muted');
  });

  it('says the done count the read gives, over the live holders only (R-155)', () => {
    const [column] = PAGE.grid.columns;
    if (column === undefined) throw new Error('fixture');
    renderView({
      ...PAGE,
      grid: { ...PAGE.grid, columns: [{ ...column, done: 3, count: 5 }] },
    });
    expect(assignedLine('due Nov 30')).toBe('due Nov 30 · 3 done of 5');
  });

  it('says No deadline for an assignment without one', () => {
    const [column] = PAGE.grid.columns;
    if (column === undefined) throw new Error('fixture');
    renderView({
      ...PAGE,
      grid: { ...PAGE.grid, columns: [{ ...column, deadline: null }] },
    });
    expect(assignedLine(c.status.noDeadline)).toBe(
      `${c.status.noDeadline} · 1 done of 2`,
    );
  });

  it('has no assignments section when nothing is assigned', () => {
    renderView({
      ...PAGE,
      assignments: [],
      grid: { columns: [], rows: [] },
    });
    expect(screen.queryByRole('region', { name: g.assignedTitle })).toBeNull();
  });

  it('shows the invite link section with New link', () => {
    renderView();
    const invite = within(screen.getByRole('region', { name: g.inviteTitle }));
    expect(invite.getByText('An open link expires Dec 10')).toBeDefined();
    expect(invite.getByRole('button', { name: g.newLink })).toBeDefined();
  });
});

describe('GroupView: players', () => {
  it('lists the members, each with Remove in the error tone, which asks first (#329)', async () => {
    renderView();
    expect(
      players()
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent),
    ).toEqual(['Rokas', 'Rūta']);
    const ruta = memberItem('Rūta');
    const remove = ruta.getByRole('button', { name: g.remove });
    expect(remove.className).toContain('text-error');
    fireEvent.click(remove);
    expect(server.remove).not.toHaveBeenCalled();
    expect(
      ruta.getByText(g.removeConfirm.replace('{name}', 'Rūta')),
    ).toBeDefined();
    fireEvent.click(ruta.getByRole('button', { name: g.confirmRemove }));
    await waitFor(() => {
      expect(server.remove).toHaveBeenCalledTimes(1);
    });
    expect(fieldsOf(server.remove.mock.lastCall?.[1])).toEqual({
      groupId: 'g-1',
      playerId: 'p-2',
    });
  });

  it('shows a refused Remove in the players section', async () => {
    server.remove.mockResolvedValue({ refusal: 'coach.notCoach' });
    renderView();
    const rokas = memberItem('Rokas');
    fireEvent.click(rokas.getByRole('button', { name: g.remove }));
    fireEvent.click(rokas.getByRole('button', { name: g.confirmRemove }));
    await waitFor(() => {
      expect(
        players()
          .getAllByRole('status')
          .map((status) => status.textContent),
      ).toContain(c.notCoach);
    });
  });

  it('says when the group has no members', () => {
    renderView({ ...PAGE, members: [] });
    expect(players().getByText(g.noMembers)).toBeDefined();
  });

  it('opens the picker inline with Add a player and adds one of the linked players not yet in', async () => {
    renderView();
    expect(screen.queryByLabelText(g.addLabel)).toBeNull();
    const open = players().getByRole('button', { name: g.addTitle });
    expect(open.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const picker = screen.getByLabelText<HTMLSelectElement>(g.addLabel);
    expect(document.activeElement).toBe(picker);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Gabija', 'Jonas']);
    fireEvent.change(picker, { target: { value: 'p-4' } });
    fireEvent.click(screen.getByRole('button', { name: g.add }));
    await waitFor(() => {
      expect(server.add).toHaveBeenCalledTimes(1);
    });
    expect(fieldsOf(server.add.mock.lastCall?.[1])).toEqual({
      groupId: 'g-1',
      playerId: 'p-4',
    });
  });

  it('closes the picker with Cancel and gives focus back to Add a player', () => {
    renderView();
    const open = players().getByRole('button', { name: g.addTitle });
    fireEvent.click(open);
    fireEvent.click(players().getByRole('button', { name: g.cancel }));
    expect(screen.queryByLabelText(g.addLabel)).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('shows a refused Add beside the picker', async () => {
    server.add.mockResolvedValue({ refusal: 'coach.notLinked' });
    renderView();
    fireEvent.click(players().getByRole('button', { name: g.addTitle }));
    fireEvent.click(screen.getByRole('button', { name: g.add }));
    await waitFor(() => {
      expect(
        players()
          .getAllByRole('status')
          .map((status) => status.textContent),
      ).toContain(c.notLinked);
    });
  });

  it('says why there is no one to add instead of the picker', () => {
    renderView({ ...PAGE, addable: [] });
    expect(players().getByText(g.allIn)).toBeDefined();
    expect(players().queryByRole('button', { name: g.addTitle })).toBeNull();
  });

  it('says how to get players when nobody is linked', () => {
    renderView({ ...PAGE, members: [], addable: [] });
    expect(players().getByText(c.players.empty)).toBeDefined();
  });
});

describe('GroupView: deleting', () => {
  it('has one Delete group in the error tone, last on the page, placed at the right of the header from md', () => {
    renderView();
    const remove = screen.getByRole('button', { name: g.delete });
    expect(remove.className).toContain('text-error');
    // Last in reading order: the bottom of the page on a phone.
    const main = screen.getByRole('main');
    expect(main.lastElementChild?.contains(remove)).toBe(true);
    expect(
      screen
        .getByRole('region', { name: /^Players · / })
        .compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // From md the page's grid puts it beside the header: the layout rule.
    expect(main.lastElementChild?.className.split(' ')).toEqual(
      expect.arrayContaining(['md:col-start-2', 'md:row-start-1']),
    );
  });

  it('deletes the group only after the confirm step', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: g.delete }));
    expect(
      await screen.findByText(g.deleteConfirm.replace('{name}', PAGE.name)),
    ).toBeDefined();
    expect(server.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: g.confirmDelete }));
    await waitFor(() => {
      expect(server.delete).toHaveBeenCalledTimes(1);
    });
    expect(fieldsOf(server.delete.mock.lastCall?.[0])).toEqual({
      groupId: 'g-1',
    });
  });
});
