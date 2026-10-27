import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import type { CoachActionState } from './actions';
import { PlayersList, type CoachPlayerRow } from './players-list';

const server = vi.hoisted(() => ({
  unlink:
    vi.fn<
      (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
    >(),
}));

vi.mock('./actions', () => ({ unlinkPlayerAction: server.unlink }));

const p = MESSAGES.lt.coach.players;

const ROKAS: CoachPlayerRow = {
  id: 'p-1',
  displayName: 'Rokas',
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
  lastTrainedDays: 1,
};
const GABIJA: CoachPlayerRow = {
  id: 'p-2',
  displayName: 'Gabija',
  groups: [],
  lastTrainedDays: null,
};

function renderList(
  players: readonly CoachPlayerRow[],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
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
      ['Rokas', '/treneris/zaidejai/p-1'],
      ['Gabija', '/treneris/zaidejai/p-2'],
    ]);
    expect(
      playerItem('Rokas').getByText(
        'Grupės: Sekmadienio grupė ir Šeštadienio grupė',
      ),
    ).toBeDefined();
    expect(playerItem('Gabija').getByText(p.noGroups)).toBeDefined();
  });

  it('says when each player last trained (R-154)', () => {
    renderList([ROKAS, GABIJA]);
    expect(
      playerItem('Rokas').getByText(MESSAGES.lt.coach.progress.yesterday),
    ).toBeDefined();
    expect(
      playerItem('Gabija').getByText(MESSAGES.lt.coach.progress.neverTrained),
    ).toBeDefined();
  });

  it('joins the group names as the locale joins a list', () => {
    const three = [...ROKAS.groups, { id: 'g-3', name: 'Jaunimas' }];
    renderList([{ ...ROKAS, groups: three }], 'en');
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
        MESSAGES.lt.coach.notLinked,
      );
    });
  });

  it('speaks English on the English page', () => {
    renderList([GABIJA], 'en');
    expect(screen.getByText('Not in any group')).toBeDefined();
  });
});
