import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { CreateGroupState } from './actions';
import { GroupsSection, type CoachGroupRow } from './groups-section';

const server = vi.hoisted(() => ({
  create:
    vi.fn<
      (previous: CreateGroupState, form: FormData) => Promise<CreateGroupState>
    >(),
}));

vi.mock('./actions', () => ({ createGroupAction: server.create }));

const g = MESSAGES.lt.coach.groups;

const GROUPS: readonly CoachGroupRow[] = [
  { id: 'g-1', name: 'Sekmadienio grupė', memberCount: 1 },
  { id: 'g-2', name: 'Šeštadienio grupė', memberCount: 3 },
  { id: 'g-3', name: 'Vakarinė grupė', memberCount: 12 },
];

function renderSection(
  groups: readonly CoachGroupRow[],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
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
      ['/treneris/grupes/g-1', 'Sekmadienio grupė1 žaidėjas'],
      ['/treneris/grupes/g-2', 'Šeštadienio grupė3 žaidėjai'],
      ['/treneris/grupes/g-3', 'Vakarinė grupė12 žaidėjų'],
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
        MESSAGES.lt.coach.groupLimit,
      );
    });
    expect(nameField().value).toBe('Grupė 11');
    expect(nameField().getAttribute('aria-invalid')).toBe('true');
  });

  it('counts players in English on the English page', () => {
    renderSection(GROUPS.slice(0, 2), 'en');
    expect(screen.getByText('1 player')).toBeDefined();
    expect(screen.getByText('3 players')).toBeDefined();
  });
});
