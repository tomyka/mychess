import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CreateGroupState } from './actions';
import { GroupsSection, type DashboardGroup } from './groups-section';

const server = vi.hoisted(() => ({
  create:
    vi.fn<
      (previous: CreateGroupState, form: FormData) => Promise<CreateGroupState>
    >(),
}));

vi.mock('./actions', () => ({ createGroupAction: server.create }));

const g = MESSAGES.coach.groups;
const TODAY = '2026-11-27';

const assignment = (name: string, deadline: string | null) => ({
  repertoireId: `r-${name}`,
  repertoireName: name,
  deadline,
});

const GROUPS: readonly DashboardGroup[] = [
  { id: 'g-1', name: 'Sekmadienio grupė', memberCount: 1, assignments: [] },
  {
    id: 'g-2',
    name: 'Šeštadienio grupė',
    memberCount: 6,
    assignments: [
      assignment('Italian', '2026-12-20'),
      assignment('No date', null),
      assignment('Slav Defence', '2026-11-30'),
    ],
  },
  {
    id: 'g-3',
    name: 'Vakarinė grupė',
    memberCount: 12,
    assignments: [assignment('London', null)],
  },
];

function renderSection(groups: readonly DashboardGroup[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <GroupsSection groups={groups} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

const newGroup = () => screen.getByRole('button', { name: g.new });
const nameField = () => screen.getByLabelText<HTMLInputElement>(g.name);
const create = () => screen.getByRole('button', { name: g.create });

/** Opens the create form, as the coach does with New group. */
function openForm(): void {
  fireEvent.click(newGroup());
}

beforeEach(() => {
  server.create.mockReset().mockResolvedValue({ createdId: 'g-new' });
  // jsdom has no scrollIntoView; the form asks for it as it opens.
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  return () => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  };
});

describe('GroupsSection', () => {
  it('offers only New group when there are no groups', () => {
    renderSection([]);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Groups · 0' }),
    ).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
    expect(newGroup()).toBeDefined();
  });

  it('links each group card to its page, with its players and nearest assignment', () => {
    renderSection(GROUPS);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Groups · 3' }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('listitem')
        .map((item) => [
          item.querySelector('a')?.getAttribute('href'),
          item.textContent,
        ]),
    ).toEqual([
      ['/coach/groups/g-1', 'Sekmadienio grupė1 player'],
      [
        '/coach/groups/g-2',
        'Šeštadienio grupė6 players · Slav Defence due Nov 30 · +2 more',
      ],
      ['/coach/groups/g-3', 'Vakarinė grupė12 players · London'],
    ]);
    expect(
      screen.getByRole('link', { name: 'Šeštadienio grupė' }),
    ).toBeDefined();
  });

  it('keeps the create form closed until New group, and Cancel closes it again', () => {
    renderSection(GROUPS);
    expect(screen.queryByLabelText(g.name)).toBeNull();
    expect(newGroup().getAttribute('aria-expanded')).toBe('false');
    openForm();
    expect(newGroup().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(nameField());
    fireEvent.click(screen.getByRole('button', { name: g.cancel }));
    expect(screen.queryByLabelText(g.name)).toBeNull();
    expect(document.activeElement).toBe(newGroup());
  });

  it('scrolls the opened form, then the new link, into view above the tab bar', async () => {
    const scrolled: { text: string; options: unknown }[] = [];
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element, options: unknown) {
        scrolled.push({ text: this.textContent, options });
      },
    });
    const link = 'http://localhost:3000/invite/abc';
    server.create.mockResolvedValue({ createdId: 'g-new', link });
    renderSection([]);
    openForm();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.text).toContain(g.name);
    expect(scrolled[0]?.options).toEqual({ block: 'nearest' });
    fireEvent.change(nameField(), { target: { value: 'Grupė' } });
    fireEvent.click(create());
    await screen.findByLabelText(MESSAGES.coach.invites.link);
    expect(scrolled.at(-1)?.text).toContain(MESSAGES.coach.invites.linkOnce);
    expect(scrolled.at(-1)?.options).toEqual({ block: 'nearest' });
  });

  it('sends the typed name and empties the field once the group is made', async () => {
    renderSection([]);
    openForm();
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
    openForm();
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
    openForm();
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
    openForm();
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
    openForm();
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
