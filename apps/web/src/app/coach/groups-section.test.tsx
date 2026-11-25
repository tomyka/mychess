import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CreateGroupState } from './actions';
import { GroupsSection, type CoachGroupRow } from './groups-section';

const server = vi.hoisted(() => ({
  create:
    vi.fn<
      (previous: CreateGroupState, form: FormData) => Promise<CreateGroupState>
    >(),
}));

vi.mock('./actions', () => ({ createGroupAction: server.create }));

const g = MESSAGES.coach.groups;

const GROUPS: readonly CoachGroupRow[] = [
  { id: 'g-1', name: 'Sekmadienio grupė', memberCount: 1 },
  { id: 'g-2', name: 'Šeštadienio grupė', memberCount: 3 },
  { id: 'g-3', name: 'Vakarinė grupė', memberCount: 12 },
];

function renderSection(groups: readonly CoachGroupRow[]): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <GroupsSection groups={groups} />
    </NextIntlClientProvider>,
  );
}

const nameField = () => screen.getByLabelText<HTMLInputElement>(g.name);
const create = () => screen.getByRole('button', { name: g.create });

beforeEach(() => {
  server.create.mockReset().mockResolvedValue({ createdId: 'g-new' });
});

describe('GroupsSection', () => {
  it('says when there are no groups', () => {
    renderSection([]);
    expect(
      screen.getByRole('heading', { level: 2, name: g.title }),
    ).toBeDefined();
    expect(screen.getByText(g.empty)).toBeDefined();
  });

  it('links each group to its page with its member count', () => {
    renderSection(GROUPS);
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => [
          item.querySelector('a')?.getAttribute('href'),
          item.textContent,
        ]),
    ).toEqual([
      ['/coach/groups/g-1', 'Sekmadienio grupė1 player'],
      ['/coach/groups/g-2', 'Šeštadienio grupė3 players'],
      ['/coach/groups/g-3', 'Vakarinė grupė12 players'],
    ]);
  });

  it('sends the typed name and empties the field once the group is made', async () => {
    renderSection([]);
    fireEvent.change(nameField(), { target: { value: 'Šeštadienio grupė' } });
    fireEvent.click(create());
    await waitFor(() => {
      expect(server.create).toHaveBeenCalledTimes(1);
    });
    const form = server.create.mock.lastCall?.[1];
    expect(Object.fromEntries(form?.entries() ?? [])).toEqual({
      name: 'Šeštadienio grupė',
    });
    await waitFor(() => {
      expect(nameField().value).toBe('');
    });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows a refusal and keeps the typed name', async () => {
    server.create.mockResolvedValue({ refusal: 'coach.groupLimit' });
    renderSection(GROUPS);
    fireEvent.change(nameField(), { target: { value: 'Grupė 11' } });
    fireEvent.click(create());
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.coach.groupLimit,
      );
    });
    expect(nameField().value).toBe('Grupė 11');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
  });

  it('shows the new group’s invite link once, to copy (R-204)', async () => {
    const link = 'http://localhost:3000/invite/abc';
    server.create.mockResolvedValue({ createdId: 'g-new', link });
    renderSection([]);
    fireEvent.change(nameField(), { target: { value: 'Grupė' } });
    fireEvent.click(create());
    const i = MESSAGES.coach.invites;
    expect((await screen.findByLabelText<HTMLInputElement>(i.link)).value).toBe(
      link,
    );
    expect(screen.getByRole('button', { name: i.copy })).toBeDefined();
    expect(screen.getByText(i.linkOnce)).toBeDefined();
  });

  it('shows each new group’s own link, the 4th as well as the 1st (ux sign-off)', async () => {
    const i = MESSAGES.coach.invites;
    renderSection([]);
    for (let n = 1; n <= 4; n += 1) {
      const link = `http://localhost:3000/invite/${String(n)}`;
      server.create.mockResolvedValueOnce({
        createdId: `g-${String(n)}`,
        link,
      });
      fireEvent.change(nameField(), {
        target: { value: `Grupė ${String(n)}` },
      });
      fireEvent.click(create());
      await waitFor(() => {
        expect(screen.getByLabelText<HTMLInputElement>(i.link).value).toBe(
          link,
        );
      });
    }
    expect(server.create).toHaveBeenCalledTimes(4);
  });

  it('says the group was made without a link at the open-invite limit (R-114)', async () => {
    server.create.mockResolvedValue({
      createdId: 'g-new',
      noLink: 'coach.inviteLimit',
    });
    renderSection([]);
    fireEvent.change(nameField(), { target: { value: 'Grupė' } });
    fireEvent.click(create());
    expect(
      await screen.findByText(g.createdNoLink.replace('{limit}', '50')),
    ).toBeDefined();
    expect(screen.queryByLabelText(MESSAGES.coach.invites.link)).toBeNull();
    // The group was made: the field is empty again and not marked invalid.
    expect(nameField().value).toBe('');
    expect(nameField().getAttribute('aria-invalid')).toBeNull();
  });
});
