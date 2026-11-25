import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CoachActionState } from './actions';
import { PlayersList, type CoachPlayerRow } from './players-list';

const server = vi.hoisted(() => ({
  unlink:
    vi.fn<
      (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
    >(),
}));

vi.mock('./actions', () => ({ unlinkPlayerAction: server.unlink }));

const p = MESSAGES.coach.players;

const ROKAS: CoachPlayerRow = {
  id: 'p-1',
  displayName: 'Rokas',
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
  lastTrainedDays: 1,
  linkedAt: new Date('2026-09-14T10:00:00Z'),
  nearestDeadline: '2026-11-01',
  overdue: true,
};
const GABIJA: CoachPlayerRow = {
  id: 'p-2',
  displayName: 'Gabija',
  groups: [],
  lastTrainedDays: null,
  linkedAt: new Date('2026-10-02T10:00:00Z'),
  nearestDeadline: null,
  overdue: false,
};

/** "Linked since" with `date` written as the page writes it, in Vilnius. */
const linkedSince = (date: Date): string =>
  MESSAGES.coach.player.linkedSince.replace(
    '{date}',
    new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeZone: 'Europe/Vilnius',
    }).format(date),
  );

function renderList(players: readonly CoachPlayerRow[]): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <PlayersList players={players} />
    </NextIntlClientProvider>,
  );
}

const playerItem = (name: string) =>
  within(screen.getByRole('link', { name }).closest('li') ?? document.body);

beforeEach(() => {
  server.unlink.mockReset().mockResolvedValue({});
});

describe('PlayersList', () => {
  it('says how to get a first player', () => {
    renderList([]);
    expect(
      screen.getByRole('heading', { level: 2, name: p.title }),
    ).toBeDefined();
    expect(screen.getByText(p.empty)).toBeDefined();
  });

  it('links each player to their page and names their groups', () => {
    renderList([ROKAS, GABIJA]);
    expect(
      screen
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Rokas', '/coach/players/p-1'],
      ['Gabija', '/coach/players/p-2'],
    ]);
    expect(
      playerItem('Rokas').getByText(
        'Groups: Sekmadienio grupė and Šeštadienio grupė',
      ),
    ).toBeDefined();
    expect(playerItem('Gabija').getByText(p.noGroups)).toBeDefined();
  });

  it('says when each player last trained (R-154)', () => {
    renderList([ROKAS, GABIJA]);
    expect(
      playerItem('Rokas').getByText(MESSAGES.coach.progress.yesterday),
    ).toBeDefined();
    expect(
      playerItem('Gabija').getByText(MESSAGES.coach.progress.neverTrained),
    ).toBeDefined();
  });

  it('joins the group names as English joins a list', () => {
    const three = [...ROKAS.groups, { id: 'g-3', name: 'Jaunimas' }];
    renderList([{ ...ROKAS, groups: three }]);
    expect(
      playerItem('Rokas').getByText(
        'Groups: Sekmadienio grupė, Šeštadienio grupė, and Jaunimas',
      ),
    ).toBeDefined();
  });

  it('unlinks a player only after the confirm step', async () => {
    renderList([ROKAS, GABIJA]);
    const gabija = playerItem('Gabija');
    fireEvent.click(gabija.getByRole('button', { name: p.unlink }));
    expect(
      gabija.getByText(p.unlinkConfirm.replace('{name}', 'Gabija')),
    ).toBeDefined();
    expect(server.unlink).not.toHaveBeenCalled();
    fireEvent.click(gabija.getByRole('button', { name: p.confirmUnlink }));
    await waitFor(() => {
      expect(server.unlink).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.unlink.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ playerId: 'p-2' });
  });

  it('shows a refused Unlink in the players section', async () => {
    server.unlink.mockResolvedValue({ refusal: 'coach.notLinked' });
    renderList([ROKAS, GABIJA]);
    const players = within(screen.getByRole('region', { name: p.title }));
    expect(players.getByRole('status').textContent).toBe('');
    const gabija = playerItem('Gabija');
    fireEvent.click(gabija.getByRole('button', { name: p.unlink }));
    fireEvent.click(gabija.getByRole('button', { name: p.confirmUnlink }));
    await waitFor(() => {
      expect(players.getByRole('status').textContent).toBe(
        MESSAGES.coach.notLinked,
      );
    });
  });

  it('tells two players of the same name apart by when each linked (#329)', () => {
    const other = { ...ROKAS, id: 'p-3', linkedAt: GABIJA.linkedAt };
    renderList([ROKAS, other]);
    const rows = screen
      .getAllByRole('link', { name: 'Rokas' })
      .map((link) => link.closest('li')?.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain(linkedSince(ROKAS.linkedAt));
    expect(rows[1]).toContain(linkedSince(GABIJA.linkedAt));
  });

  it('marks a player with an overdue assignment, and gives the nearest deadline otherwise (#329)', () => {
    const a = MESSAGES.assignment;
    const due = {
      ...GABIJA,
      id: 'p-4',
      displayName: 'Eglė',
      nearestDeadline: '2026-12-01',
    };
    renderList([ROKAS, GABIJA, due]);
    const rokas = playerItem('Rokas');
    expect(rokas.getByText(a.badge.overdue)).toBeDefined();
    expect(rokas.queryByText(/^Deadline/u)).toBeNull();
    const egle = playerItem('Eglė');
    expect(
      egle.getByText(
        a.deadlineOn.replace(
          '{date}',
          new Intl.DateTimeFormat('en', {
            dateStyle: 'long',
            timeZone: 'Europe/Vilnius',
          }).format(new Date('2026-12-01T12:00:00Z')),
        ),
      ),
    ).toBeDefined();
    expect(egle.queryByText(a.badge.overdue)).toBeNull();
    const gabija = playerItem('Gabija');
    expect(gabija.queryByText(a.badge.overdue)).toBeNull();
    expect(gabija.queryByText(/^Deadline/u)).toBeNull();
  });

  it('keeps Unlink a quiet text action, not a button as big as the name (#329)', () => {
    renderList([ROKAS]);
    const unlink = playerItem('Rokas').getByRole('button', { name: p.unlink });
    expect(unlink.className).not.toContain('border');
    expect(unlink.className).toContain('underline');
  });
});
