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
import { PlayersList, type CoachPlayerRow } from './players-list';

const server = vi.hoisted(() => ({
  unlink: vi.fn<(form: FormData) => Promise<void>>(),
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
};
const GABIJA: CoachPlayerRow = { id: 'p-2', displayName: 'Gabija', groups: [] };

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
  server.unlink.mockReset().mockResolvedValue(undefined);
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
      Object.fromEntries(server.unlink.mock.lastCall?.[0].entries() ?? []),
    ).toEqual({ playerId: 'p-2' });
  });

  it('speaks English on the English page', () => {
    renderList([GABIJA], 'en');
    expect(screen.getByText('Not in any group')).toBeDefined();
  });
});
