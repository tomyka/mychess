import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { CoachPlayerPage } from '../../../../server/coach-pages';
import type { CoachActionState } from '../../actions';
import { PlayerView } from './player-view';

const server = vi.hoisted(() => ({
  unlink:
    vi.fn<
      (previous: CoachActionState, form: FormData) => Promise<CoachActionState>
    >(),
}));

vi.mock('../../actions', () => ({ unlinkPlayerAction: server.unlink }));

const c = MESSAGES.coach;

const ROKAS: CoachPlayerPage = {
  id: 'p-1',
  displayName: 'Rokas',
  // 23:30 UTC is already the next day in Vilnius.
  linkedAt: new Date('2026-10-17T23:30:00Z'),
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
  lastTrainedDays: 0,
  today: '2026-11-20',
  cards: [
    {
      repertoire: { id: 'r-9', name: 'Karo-Kan gynyba', side: 'black' },
      tag: 'assigned',
      status: {
        deadline: null,
        overdue: false,
        paused: true,
        done: false,
        forked: false,
      },
      granted: {
        id: 'r-9',
        standing: {
          counts: { notStarted: 1, skipped: 0, due: 0, learned: 1 },
          mastered: false,
        },
      },
    },
  ],
};

const UNLINK = 'Unlink Rokas';

function renderView(player: CoachPlayerPage): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <PlayerView player={player} />
    </NextIntlClientProvider>,
  );
}

/** The line under the player's name. */
const metaLine = (): HTMLElement => {
  const line = screen.getByText(/linked since/u).closest('p');
  if (line === null) throw new Error('no meta line');
  return line;
};

beforeEach(() => {
  server.unlink.mockReset().mockResolvedValue({});
});

describe('PlayerView', () => {
  it('names the player with a way back to the dashboard', () => {
    renderView(ROKAS);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rokas' }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Back to Coach' }).getAttribute('href'),
    ).toBe('/coach');
  });

  it('says in one line when they last trained, since when they are linked, and the coach’s groups they are in', () => {
    renderView(ROKAS);
    const line = metaLine();
    expect(line.textContent).toBe(
      'trained today · linked since Oct 18 · Sekmadienio grupė · Šeštadienio grupė',
    );
    expect(
      within(line)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Sekmadienio grupė', '/coach/groups/g-1'],
      ['Šeštadienio grupė', '/coach/groups/g-2'],
    ]);
  });

  it('leaves the groups out of the line when the player is in none, and says never trained', () => {
    renderView({ ...ROKAS, groups: [], lastTrainedDays: null });
    expect(metaLine().textContent).toBe('never trained · linked since Oct 18');
    expect(within(metaLine()).queryAllByRole('link')).toEqual([]);
  });

  it('shows one card per repertoire, then once what last trained counts (R-154)', () => {
    renderView(ROKAS);
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Repertoires · 1']);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Karo-Kan gynyba' }),
    ).toBeDefined();
    expect(screen.getAllByText(c.progress.lastTrainedNote)).toHaveLength(1);
    expect(screen.queryByText(/on the repertoires you can see/u)).toBeNull();
  });

  it('has exactly one Unlink, in the error tone, after the last card and the footnote in reading and focus order', () => {
    renderView(ROKAS);
    const buttons = screen.getAllByRole('button', { name: UNLINK });
    expect(buttons).toHaveLength(1);
    const [unlink] = buttons;
    if (unlink === undefined) throw new Error('no Unlink');
    expect(unlink.className).toContain('text-error');
    const lastCard = screen.getAllByRole('listitem').at(-1);
    const note = screen.getByText(c.progress.lastTrainedNote);
    for (const before of [lastCard, note]) {
      expect(before?.compareDocumentPosition(unlink)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('unlinks the player only after the confirm step', async () => {
    renderView(ROKAS);
    fireEvent.click(screen.getByRole('button', { name: UNLINK }));
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
    fireEvent.click(screen.getByRole('button', { name: UNLINK }));
    fireEvent.click(
      await screen.findByRole('button', { name: c.players.confirmUnlink }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(c.notLinked);
    });
  });
});
