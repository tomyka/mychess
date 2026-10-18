import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { RenameGroupState } from '../../actions';
import { GroupView, type CoachGroupPageData } from './group-view';

const server = vi.hoisted(() => ({
  rename:
    vi.fn<
      (previous: RenameGroupState, form: FormData) => Promise<RenameGroupState>
    >(),
  remove: vi.fn<(form: FormData) => Promise<void>>(),
  add: vi.fn<(form: FormData) => Promise<void>>(),
  delete: vi.fn<(form: FormData) => Promise<void>>(),
}));

vi.mock('../../actions', () => ({
  renameGroupAction: server.rename,
  removeMemberAction: server.remove,
  addMemberAction: server.add,
  deleteGroupAction: server.delete,
}));

const c = MESSAGES.lt.coach;
const g = c.group;

const GROUP: CoachGroupPageData = {
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
};

function renderView(
  group: CoachGroupPageData,
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <GroupView group={group} />
    </NextIntlClientProvider>,
  );
}

const fieldsOf = (form: FormData | undefined): Record<string, unknown> =>
  Object.fromEntries(form?.entries() ?? []);

const nameField = () => screen.getByLabelText<HTMLInputElement>(c.groups.name);
const members = () =>
  within(screen.getByRole('region', { name: g.membersTitle }));

beforeEach(() => {
  server.rename.mockReset().mockResolvedValue({ saved: true });
  server.remove.mockReset().mockResolvedValue(undefined);
  server.add.mockReset().mockResolvedValue(undefined);
  server.delete.mockReset().mockResolvedValue(undefined);
});

describe('GroupView', () => {
  it('names the group and has a way back to the dashboard', () => {
    renderView(GROUP);
    expect(
      screen.getByRole('heading', { level: 1, name: GROUP.name }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: c.back }).getAttribute('href'),
    ).toBe('/treneris');
  });

  it('renames the group and says it is saved', async () => {
    renderView(GROUP);
    expect(nameField().value).toBe(GROUP.name);
    fireEvent.change(nameField(), { target: { value: 'Sekmadienio grupė' } });
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() => {
      expect(server.rename).toHaveBeenCalledTimes(1);
    });
    expect(fieldsOf(server.rename.mock.lastCall?.[1])).toEqual({
      groupId: 'g-1',
      name: 'Sekmadienio grupė',
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(g.saved);
    });
  });

  it('shows a refused name and keeps what was typed', async () => {
    server.rename.mockResolvedValue({ refusal: 'groupName.blank' });
    renderView(GROUP);
    fireEvent.change(nameField(), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: g.save }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.groupName.blank,
      );
    });
    expect(nameField().value).toBe(' ');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
  });

  it('lists the members, each with Remove', async () => {
    renderView(GROUP);
    expect(
      members()
        .getAllByRole('listitem')
        .map((item) => item.firstChild?.textContent),
    ).toEqual(['Rokas', 'Rūta']);
    fireEvent.click(
      members().getByRole('button', {
        name: g.removeNamed.replace('{name}', 'Rūta'),
      }),
    );
    await waitFor(() => {
      expect(server.remove).toHaveBeenCalledTimes(1);
    });
    expect(fieldsOf(server.remove.mock.lastCall?.[0])).toEqual({
      groupId: 'g-1',
      playerId: 'p-2',
    });
  });

  it('says when the group has no members', () => {
    renderView({ ...GROUP, members: [] });
    expect(members().getByText(g.noMembers)).toBeDefined();
  });

  it('adds one of the linked players not yet in the group', async () => {
    renderView(GROUP);
    const picker = screen.getByLabelText<HTMLSelectElement>(g.addLabel);
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
    expect(fieldsOf(server.add.mock.lastCall?.[0])).toEqual({
      groupId: 'g-1',
      playerId: 'p-4',
    });
  });

  it('has no picker when every linked player is in the group', () => {
    renderView({ ...GROUP, addable: [] });
    expect(screen.getByText(g.allIn)).toBeDefined();
    expect(screen.queryByLabelText(g.addLabel)).toBeNull();
  });

  it('says how to get players when nobody is linked', () => {
    renderView({ ...GROUP, members: [], addable: [] });
    expect(screen.getByText(c.players.empty)).toBeDefined();
    expect(screen.queryByText(g.allIn)).toBeNull();
  });

  it('deletes the group only after the confirm step', async () => {
    renderView(GROUP);
    fireEvent.click(screen.getByRole('button', { name: g.delete }));
    expect(
      await screen.findByText(g.deleteConfirm.replace('{name}', GROUP.name)),
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

  it('speaks English on the English page', () => {
    renderView(GROUP, 'en');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Players in the group' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Remove Rokas from the group' }),
    ).toBeDefined();
  });
});
