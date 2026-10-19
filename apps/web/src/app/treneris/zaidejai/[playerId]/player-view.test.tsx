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
import type { CoachActionState } from '../../actions';
import { PlayerView, type CoachPlayerPageData } from './player-view';

const server = vi.hoisted(() => ({
  unlink:
    vi.fn<
      (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
    >(),
}));

vi.mock('../../actions', () => ({ unlinkPlayerAction: server.unlink }));

const c = MESSAGES.lt.coach;

const ROKAS: CoachPlayerPageData = {
  id: 'p-1',
  displayName: 'Rokas',
  // 23:30 UTC is already the next day in Vilnius.
  linkedAt: new Date('2026-10-17T23:30:00Z'),
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
  repertoires: [
    { id: 'r-1', name: 'Londono sistema', side: 'white' },
    { id: 'r-2', name: 'Taimanovas', side: 'black' },
  ],
};

function renderView(
  player: CoachPlayerPageData,
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <PlayerView player={player} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  server.unlink.mockReset().mockResolvedValue({});
});

describe('PlayerView', () => {
  it('names the player, when they linked, and a way back to the dashboard', () => {
    renderView(ROKAS);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rokas' }),
    ).toBeDefined();
    expect(screen.getByText('Susieta nuo 2026-10-18')).toBeDefined();
    expect(
      screen.getByRole('link', { name: c.back }).getAttribute('href'),
    ).toBe('/treneris');
  });

  it('links each of the coach’s groups the player is in to its page', () => {
    renderView(ROKAS);
    expect(
      screen.getByRole('heading', { level: 2, name: c.player.groupsTitle }),
    ).toBeDefined();
    expect(
      within(screen.getByRole('region', { name: c.player.groupsTitle }))
        .getAllByRole('listitem')
        .map((item) => [
          item.textContent,
          item.querySelector('a')?.getAttribute('href'),
        ]),
    ).toEqual([
      ['Sekmadienio grupė', '/treneris/grupes/g-1'],
      ['Šeštadienio grupė', '/treneris/grupes/g-2'],
    ]);
  });

  it('links each repertoire the player shares with the coach to its page (R-42)', () => {
    renderView(ROKAS);
    const section = within(
      screen.getByRole('region', { name: c.shared.title }),
    );
    expect(
      section
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Londono sistemaBaltaisiais', '/treneris/zaidejai/p-1/repertuarai/r-1'],
      ['TaimanovasJuodaisiais', '/treneris/zaidejai/p-1/repertuarai/r-2'],
    ]);
  });

  it('says when the player shares no repertoire with the coach', () => {
    renderView({ ...ROKAS, repertoires: [] });
    expect(
      screen.getByText('Rokas dar nebendrina su jumis nė vieno repertuaro.'),
    ).toBeDefined();
  });

  it('says when the player is in none of the coach’s groups', () => {
    renderView({ ...ROKAS, groups: [] });
    expect(screen.getByText(c.players.noGroups)).toBeDefined();
    expect(
      within(
        screen.getByRole('region', { name: c.player.groupsTitle }),
      ).queryAllByRole('listitem'),
    ).toEqual([]);
  });

  it('unlinks the player only after the confirm step', async () => {
    renderView(ROKAS);
    fireEvent.click(screen.getByRole('button', { name: c.players.unlink }));
    expect(
      await screen.findByText(
        c.players.unlinkConfirm.replace('{name}', 'Rokas'),
      ),
    ).toBeDefined();
    expect(server.unlink).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: c.players.confirmUnlink }),
    );
    await waitFor(() => {
      expect(server.unlink).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(server.unlink.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ playerId: 'p-1' });
  });

  it('shows a refused Unlink', async () => {
    server.unlink.mockResolvedValue({ refusal: 'coach.notLinked' });
    renderView(ROKAS);
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: c.players.unlink }));
    fireEvent.click(
      await screen.findByRole('button', { name: c.players.confirmUnlink }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(c.notLinked);
    });
  });

  it('speaks English on the English page', () => {
    renderView(ROKAS, 'en');
    expect(screen.getByText('Linked since Oct 18, 2026')).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Back to the coach dashboard' }),
    ).toBeDefined();
  });
});
