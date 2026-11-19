import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { broadcastMonthSchema, fideIdSchema } from '@mychess/domain';
import type { FidePlayer } from '@mychess/integrations';
import { MESSAGES } from '../../i18n/locales';
import type {
  FidePollState,
  FideSearchState,
  SearchSnapshot,
  StartedSearch,
} from '../../server/fide-search';
import { FideSearch } from './fide-search';
import { POLL_MS } from './use-search-progress';

const en = MESSAGES.en.fide;

const server = vi.hoisted(() => ({
  start:
    vi.fn<(previous: unknown, form: FormData) => Promise<FideSearchState>>(),
  poll: vi.fn<(token: unknown) => Promise<FidePollState>>(),
}));

vi.mock('./actions', () => ({
  startFideSearchAction: server.start,
  pollFideSearchAction: server.poll,
}));

type Game = SearchSnapshot['games'][number];

const GAME: Game = {
  url: 'https://lichess.org/broadcast/synthetic/round-1/abc/game1',
  source: { kind: 'month', month: broadcastMonthSchema.parse('2026-10') },
  official: true,
  date: '2026-10-14',
  event: 'Synthetic Open 2026',
  eco: 'B12',
  opening: 'Caro-Kann Defense: Advance Variation',
  colour: 'white',
  opponent: { name: 'Testas, Jonas', fideId: fideIdSchema.parse(90_000_002) },
  outcome: 'win',
};

const progress = (ready: number, waiting = 0, unavailable = 0) => ({
  total: 12,
  ready,
  waiting,
  unavailable,
});

const snapshot = (over: Partial<SearchSnapshot> = {}): SearchSnapshot => ({
  progress: progress(12),
  games: [GAME],
  truncated: false,
  ...over,
});

const PLAYER: FidePlayer = {
  name: 'Jonaitis, Rokas',
  federation: 'LTU',
  title: null,
  standardRating: 2312,
};

const SEARCH: StartedSearch = {
  token: 'token-1',
  fideId: fideIdSchema.parse(13_400_002),
  player: PLAYER,
  snapshot: snapshot(),
};

const started = (search: Partial<StartedSearch> = {}): FideSearchState => ({
  kind: 'started',
  search: { ...SEARCH, ...search },
});

function renderPage(): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <FideSearch truncatedLimit={1000} />
    </NextIntlClientProvider>,
  );
}

const field = () => screen.getByLabelText<HTMLInputElement>(en.idLabel);

async function search(raw: string): Promise<void> {
  fireEvent.change(field(), { target: { value: raw } });
  fireEvent.click(screen.getByRole('button', { name: en.submit }));
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  server.start.mockReset().mockResolvedValue(started());
  server.poll.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the FIDE ID search form', () => {
  it('asks for a FIDE ID with a numeric keyboard and sends it', async () => {
    renderPage();
    // Posted even before hydration: a native GET would put the ID in the URL.
    expect(field().form?.method).toBe('post');
    expect(field().inputMode).toBe('numeric');
    expect(field().name).toBe('fideId');
    expect(screen.getByText(en.idHint)).toBeDefined();
    await search('13400002');
    expect(server.start.mock.lastCall?.[1].get('fideId')).toBe('13400002');
  });

  it('puts the hint between the field and the button, for a phone', () => {
    renderPage();
    const hint = screen.getByText(en.idHint);
    const button = screen.getByRole('button', { name: en.submit });
    expect(
      field().compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      hint.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('says it is searching, and is busy, while the search runs', async () => {
    let answer: (state: FideSearchState) => void = () => undefined;
    server.start.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderPage();
    await search('13400002');
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: en.searching,
    });
    expect(button.disabled).toBe(true);
    expect(field().form?.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      answer(started());
      await Promise.resolve();
    });
    expect(field().form?.getAttribute('aria-busy')).toBe('false');
  });

  it('hides the last refusal while the next search runs (UX)', async () => {
    server.start.mockResolvedValueOnce({
      kind: 'refused',
      refusal: 'fide.idInvalid',
    });
    renderPage();
    await search('12a');
    expect(screen.getByRole('status').textContent).toBe(en.idInvalid);
    let answer: (state: FideSearchState) => void = () => undefined;
    server.start.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await search('13400002');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await act(async () => {
      answer({ kind: 'refused', refusal: 'fide.idInvalid' });
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe(en.idInvalid);
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('is not busy when idle', () => {
    renderPage();
    expect(field().form?.getAttribute('aria-busy')).toBe('false');
  });

  it.each([
    ['fide.idBlank', en.idBlank],
    ['fide.idInvalid', en.idInvalid],
    ['fide.idTooLong', en.idTooLong],
    ['fide.searchUnavailable', en.searchUnavailable],
  ] as const)(
    'shows the refusal %s and keeps what was typed',
    async (refusal, text) => {
      server.start.mockResolvedValue({ kind: 'refused', refusal });
      renderPage();
      await search('12a');
      expect(screen.getByRole('status').textContent).toBe(text);
      expect(field().value).toBe('12a');
      expect(field().getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('names the limit when there were too many searches', async () => {
    server.start.mockResolvedValue({
      kind: 'refused',
      refusal: 'fide.tooManySearches',
      limit: 10,
    });
    renderPage();
    await search('13400002');
    expect(screen.getByRole('status').textContent).toBe(
      'Too many searches: at most 10 a minute. Wait a minute and try again.',
    );
  });
});

describe('a search result', () => {
  it('heads the result with the player’s name, federation and standard rating', async () => {
    renderPage();
    await search('13400002');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Jonaitis, Rokas' }),
    ).toBeDefined();
    expect(
      screen.getByText('FIDE ID 13400002 · LTU · standard rating 2312'),
    ).toBeDefined();
    expect(screen.getByText('12 of 12 months ready')).toBeDefined();
  });

  it('says unrated for a player with no standard rating', async () => {
    server.start.mockResolvedValue(
      started({ player: { ...PLAYER, standardRating: null } }),
    );
    renderPage();
    await search('13400002');
    expect(screen.getByText('FIDE ID 13400002 · LTU · unrated')).toBeDefined();
  });

  it('heads the result with the ID alone when Lichess gave no player', async () => {
    server.start.mockResolvedValue(started({ player: null }));
    renderPage();
    await search('13400002');
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Games of FIDE ID 13400002',
      }),
    ).toBeDefined();
    expect(screen.queryByText(/standard rating/)).toBeNull();
  });

  it('lists a game: date, event, opponent, result, opening and its Lichess link', async () => {
    renderPage();
    await search('13400002');
    const item = within(screen.getByRole('listitem'));
    // Formatted for the page's language (R-180: English).
    expect(item.getByText('Oct 14, 2026 · Synthetic Open 2026')).toBeDefined();
    // The result beside the opponent, read by a screen reader too; the
    // colour is the section's, not repeated on the game (#347 F1).
    const opponent = item.getByText('vs Testas, Jonas (FIDE 90000002)');
    const result = item.getByText(en.win);
    expect(result.parentElement).toBe(opponent.parentElement);
    expect(result.closest('[aria-hidden]')).toBeNull();
    expect(item.queryByText(/^(White|Black)$/)).toBeNull();
    // Inside the family's group, the variation alone (#347 F2).
    expect(item.getByText('B12 Advance Variation')).toBeDefined();
    const link = screen.getByRole('link', {
      name: `${en.openOnLichess} ${en.newTab}`,
    });
    expect(link.getAttribute('href')).toBe(GAME.url);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows each result from the player’s side, an opponent without an ID, and an unknown date', async () => {
    const games: Game[] = [
      { ...GAME, url: `${GAME.url}1`, colour: 'black', outcome: 'loss' },
      { ...GAME, url: `${GAME.url}2`, outcome: 'draw', date: null },
      {
        ...GAME,
        url: `${GAME.url}3`,
        outcome: 'unknown',
        opponent: { name: 'Kitas, Petras', fideId: null },
        eco: null,
        opening: null,
      },
    ];
    server.start.mockResolvedValue(started({ snapshot: snapshot({ games }) }));
    renderPage();
    await search('13400002');
    // Grouped (R-189, R-190): as White the Caro-Kann, then the unknown
    // opening; then as Black.
    const [drawn, unfinished, lost] = screen
      .getAllByRole('listitem')
      .map((li) => within(li));
    expect(drawn?.getByText(en.draw)).toBeDefined();
    expect(
      drawn?.getByText(`${en.dateUnknown} · Synthetic Open 2026`),
    ).toBeDefined();
    expect(unfinished?.getByText(en.unknown)).toBeDefined();
    expect(unfinished?.getByText('vs Kitas, Petras')).toBeDefined();
    expect(unfinished?.queryByText(/FIDE|B12/)).toBeNull();
    expect(lost?.getByText(en.loss)).toBeDefined();
  });

  it('shows the whole opening name when it has no variation', async () => {
    const games: Game[] = [{ ...GAME, eco: 'C42', opening: 'Russian Game' }];
    server.start.mockResolvedValue(started({ snapshot: snapshot({ games }) }));
    renderPage();
    await search('13400002');
    const item = within(screen.getByRole('listitem'));
    expect(item.getByText('C42 Russian Game')).toBeDefined();
  });

  it('links no game whose address is not a Lichess game address', async () => {
    const games: Game[] = [
      { ...GAME, url: 'https://evil.example/lichess.org/x' },
      // On lichess.org, but outside the domain's game URL pattern.
      { ...GAME, url: 'https://lichess.org/x?next=https://evil.example' },
    ];
    server.start.mockResolvedValue(started({ snapshot: snapshot({ games }) }));
    renderPage();
    await search('13400002');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.queryByRole('link', { name: new RegExp(en.openOnLichess) }),
    ).toBeNull();
  });

  it('says when no game was found and nothing is left to wait for', async () => {
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ games: [], progress: progress(1, 0, 11) }),
      }),
    );
    renderPage();
    await search('13400002');
    expect(screen.getByText(en.noGames)).toBeDefined();
    expect(screen.queryByText(en.noMonths)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/CC BY-SA/)).toBeNull();
  });

  it('says no game was found in the ready months so far while others are prepared', async () => {
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ games: [], progress: progress(3, 9) }),
      }),
    );
    renderPage();
    await search('13400002');
    expect(
      screen.getByText('No games of this player in the 3 ready months so far.'),
    ).toBeDefined();
    expect(screen.getByText(en.monthsWaiting)).toBeDefined();
    expect(screen.queryByText(en.noGames)).toBeNull();
  });

  it('says it of one ready month in the singular', async () => {
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ games: [], progress: progress(1, 11) }),
      }),
    );
    renderPage();
    await search('13400002');
    expect(
      screen.getByText('No games of this player in the 1 ready month so far.'),
    ).toBeDefined();
  });

  it('says nothing of games while no month is ready yet', async () => {
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ games: [], progress: progress(0, 12) }),
      }),
    );
    renderPage();
    await search('13400002');
    expect(screen.queryByText(/so far/)).toBeNull();
    expect(screen.queryByText(en.noGames)).toBeNull();
    expect(screen.queryByText(en.noMonths)).toBeNull();
    expect(screen.getByText(en.monthsWaiting)).toBeDefined();
  });

  it('says no month could be searched when none is ready or waiting', async () => {
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ games: [], progress: progress(0, 0, 12) }),
      }),
    );
    renderPage();
    await search('13400002');
    expect(screen.getByText(en.noMonths)).toBeDefined();
    expect(screen.queryByText(en.noGames)).toBeNull();
  });

  it('says only the newest games are shown when the list was cut', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ truncated: true }) }),
    );
    renderPage();
    await search('13400002');
    expect(
      screen.getByText('Only the newest 1,000 games are shown.'),
    ).toBeDefined();
  });

  it('counts unavailable months apart, and does not poll for them', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(10, 0, 2) }) }),
    );
    renderPage();
    await search('13400002');
    expect(screen.getByText('10 of 12 months ready')).toBeDefined();
    expect(
      screen.getByText('2 months unavailable, retried tomorrow.'),
    ).toBeDefined();
    expect(screen.queryByText(en.monthsWaiting)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3 * POLL_MS));
    expect(server.poll).not.toHaveBeenCalled();
  });
});

describe('the games grouped for preparation (#348, R-189, R-190)', () => {
  let n = 0;
  const found = (over: Partial<Game>): Game => {
    n += 1;
    return { ...GAME, url: `${GAME.url}-${String(n)}`, ...over };
  };

  async function showGames(games: Game[]): Promise<void> {
    server.start.mockResolvedValue(started({ snapshot: snapshot({ games }) }));
    renderPage();
    await search('13400002');
  }

  const sectionTitles = () =>
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  /**
   * Each disclosure's summary, in page order, as its lines: the family,
   * the score at a glance (hidden from a screen reader) and the words a
   * screen reader hears instead.
   */
  const summaries = () =>
    [...document.querySelectorAll('summary')].map((summary) => {
      const [family, glance, words] = [...summary.children];
      expect(glance?.getAttribute('aria-hidden')).toBe('true');
      return [family?.textContent, glance?.textContent, words?.textContent];
    });

  /** Each group's family and whether it is open, in page order. */
  const openGroups = () =>
    [...document.querySelectorAll('details')].map((d) => [
      d.querySelector('summary')?.firstChild?.textContent,
      d.open,
    ]);

  it('splits the games by the player’s colour, as White first', async () => {
    await showGames([
      found({ colour: 'black', outcome: 'loss' }),
      found({ colour: 'white' }),
    ]);
    expect(sectionTitles()).toEqual([en.asWhite, en.asBlack]);
    const [white, black] = screen
      .getAllByRole('heading', { level: 3 })
      .map((h) => within(h.closest('section') ?? document.body));
    expect(white?.getByText(en.win)).toBeDefined();
    expect(white?.queryByText(en.loss)).toBeNull();
    expect(black?.getByText(en.loss)).toBeDefined();
  });

  it('leaves out a colour the player had no game in', async () => {
    await showGames([found({ colour: 'black' })]);
    expect(sectionTitles()).toEqual([en.asBlack]);
  });

  it('groups by opening family, most games first, with each group’s count and score', async () => {
    await showGames([
      found({ opening: 'Russian Game', eco: 'C42', outcome: 'draw' }),
      found({ outcome: 'loss' }),
      found({ opening: 'Caro-Kann Defense: Panov Attack', eco: 'B14' }),
      found({ outcome: 'unknown' }),
    ]);
    expect(summaries()).toEqual([
      [
        'Caro-Kann Defense',
        '3 games · +1 =0 −1 · 1 unfinished',
        '3 games · 1 won, 0 drawn, 1 lost · 1 unfinished',
      ],
      ['Russian Game', '1 game · +0 =1 −0', '1 game · 0 won, 1 drawn, 0 lost'],
    ]);
    const caroKann = within(document.querySelector('details') ?? document.body);
    // Each game names its variation; the group names the family (#347 F2).
    expect(caroKann.getByText('B14 Panov Attack')).toBeDefined();
    expect(caroKann.getAllByRole('listitem')).toHaveLength(3);
  });

  it('colours the score’s numbers as the results are coloured (#347 F5)', async () => {
    await showGames([
      found({}),
      found({ outcome: 'draw' }),
      found({ outcome: 'loss' }),
    ]);
    const glance = within(
      document.querySelector('summary [aria-hidden]') ?? document.body,
    );
    expect(glance.getByText('+1').classList).toContain('text-success');
    expect(glance.getByText('=1').classList).toContain('text-fg');
    expect(glance.getByText('−1').classList).toContain('text-error');
  });

  it('lists a group newest first', async () => {
    await showGames([
      found({ date: '2026-03-01', event: 'March Open' }),
      found({ date: null, event: 'Undated Cup' }),
      found({ date: '2026-09-01', event: 'September Open' }),
    ]);
    const texts = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(texts[0]).toContain('September Open');
    expect(texts[1]).toContain('March Open');
    expect(texts[2]).toContain('Undated Cup');
  });

  it('puts the games with no opening in an unknown-opening group, last', async () => {
    await showGames([
      found({ opening: null, eco: null }),
      found({ opening: null, eco: 'A00' }),
      found({ opening: 'Russian Game' }),
    ]);
    expect(summaries().map(([family]) => family)).toEqual([
      'Russian Game',
      en.unknownOpening,
    ]);
  });

  it('opens the two largest groups of each colour, the rest closed', async () => {
    await showGames([
      found({ opening: 'Alekhine Defense' }),
      found({ opening: 'Alekhine Defense' }),
      found({ opening: 'Benoni Defense' }),
      found({ opening: 'Caro-Kann Defense' }),
      found({ colour: 'black', opening: 'Dutch Defense' }),
      found({ colour: 'black', opening: 'English Opening' }),
      found({ colour: 'black', opening: 'French Defense' }),
    ]);
    expect(openGroups()).toEqual([
      ['Alekhine Defense', true],
      ['Benoni Defense', true],
      ['Caro-Kann Defense', false],
      ['Dutch Defense', true],
      ['English Opening', true],
      ['French Defense', false],
    ]);
  });

  it('keeps each group open or closed as it was while new games reorder them (#347)', async () => {
    const first = [
      found({ opening: 'Alekhine Defense' }),
      found({ opening: 'Alekhine Defense' }),
      found({ opening: 'Benoni Defense' }),
      found({ opening: 'Caro-Kann Defense' }),
    ];
    server.start.mockResolvedValue(
      started({
        snapshot: snapshot({ progress: progress(2, 10), games: first }),
      }),
    );
    server.poll.mockResolvedValueOnce({
      kind: 'progress',
      snapshot: snapshot({
        games: [
          ...first,
          // Caro-Kann and a new family now outnumber the Benoni.
          found({ opening: 'Caro-Kann Defense' }),
          found({ opening: 'Caro-Kann Defense' }),
          found({ opening: 'Dutch Defense' }),
          found({ opening: 'Dutch Defense' }),
          found({ opening: 'Dutch Defense' }),
          found({ opening: 'Dutch Defense' }),
        ],
      }),
    });
    renderPage();
    await search('13400002');
    // The person closes the Alekhine.
    const [alekhine] = document.querySelectorAll('details');
    act(() => {
      if (alekhine === undefined) throw new Error('no group');
      alekhine.open = false;
      fireEvent(alekhine, new Event('toggle'));
    });
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(openGroups()).toEqual([
      // New: its default by its place.
      ['Dutch Defense', true],
      // Seen before: as it was shown, or as the person left it.
      ['Caro-Kann Defense', false],
      ['Alekhine Defense', false],
      ['Benoni Defense', true],
    ]);
  });

  it('credits the Lichess broadcasts and their CC BY-SA 4.0 licence under the games', async () => {
    await showGames([found({})]);
    const broadcasts = screen.getByRole('link', {
      name: `Lichess broadcasts ${en.newTab}`,
    });
    const licence = screen.getByRole('link', {
      name: `CC BY-SA 4.0 ${en.newTab}`,
    });
    expect(broadcasts.getAttribute('href')).toBe(
      'https://lichess.org/broadcast',
    );
    expect(licence.getAttribute('href')).toBe(
      'https://creativecommons.org/licenses/by-sa/4.0/',
    );
    for (const link of [broadcasts, licence]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(broadcasts.parentElement?.textContent).toBe(
      `Games from Lichess broadcasts ${en.newTab} · CC BY-SA 4.0 ${en.newTab}`,
    );
    const [game] = screen.getAllByRole('listitem');
    expect(
      Number(game?.compareDocumentPosition(broadcasts)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('while months are being prepared', () => {
  it('polls with the search token until no month is waiting', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(2, 10), games: [] }) }),
    );
    server.poll
      .mockResolvedValueOnce({
        kind: 'progress',
        snapshot: snapshot({ progress: progress(7, 4, 1), games: [] }),
      })
      .mockResolvedValueOnce({
        kind: 'progress',
        snapshot: snapshot({ progress: progress(11, 0, 1) }),
      });
    renderPage();
    await search('13400002');
    expect(screen.getByText('2 of 12 months ready')).toBeDefined();
    expect(screen.getByText(en.monthsWaiting)).toBeDefined();
    expect(screen.queryByText(en.noGames)).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS - 1));
    expect(server.poll).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(server.poll).toHaveBeenLastCalledWith('token-1');
    expect(screen.getByText('7 of 12 months ready')).toBeDefined();
    expect(
      screen.getByText('1 month unavailable, retried tomorrow.'),
    ).toBeDefined();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByText('11 of 12 months ready')).toBeDefined();
    expect(screen.queryByText(en.monthsWaiting)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(3 * POLL_MS));
    expect(server.poll).toHaveBeenCalledTimes(2);
  });

  it('tries again at the next interval after a poll fails', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(2, 10) }) }),
    );
    server.poll
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ kind: 'progress', snapshot: snapshot() });
    renderPage();
    await search('13400002');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(server.poll).toHaveBeenCalledTimes(2);
    expect(screen.getByText('12 of 12 months ready')).toBeDefined();
  });

  it('tries again at the next interval after the server says a poll failed', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(2, 10) }) }),
    );
    server.poll
      .mockResolvedValueOnce({ kind: 'failed' })
      .mockResolvedValueOnce({ kind: 'progress', snapshot: snapshot() });
    renderPage();
    await search('13400002');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByText('2 of 12 months ready')).toBeDefined();
    expect(screen.getByText(en.monthsWaiting)).toBeDefined();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(server.poll).toHaveBeenCalledTimes(2);
    expect(screen.getByText('12 of 12 months ready')).toBeDefined();
  });

  it('announces only the months-ready line, and the expiry when it comes (#347)', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(2, 10, 1) }) }),
    );
    server.poll.mockResolvedValue({ kind: 'expired' });
    renderPage();
    await search('13400002');
    const result = within(screen.getByRole('region', { name: PLAYER.name }));
    const announced = () =>
      result.getAllByRole('status').map((status) => status.textContent);
    expect(announced()).toEqual(['2 of 12 months ready', '']);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(announced()).toEqual(['2 of 12 months ready', en.searchExpired]);
  });

  it('stops and says so when the search has expired', async () => {
    server.start.mockResolvedValue(
      started({ snapshot: snapshot({ progress: progress(2, 10) }) }),
    );
    server.poll.mockResolvedValue({ kind: 'expired' });
    renderPage();
    await search('13400002');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(screen.getByText(en.searchExpired)).toBeDefined();
    expect(screen.queryByText(en.monthsWaiting)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(3 * POLL_MS));
    expect(server.poll).toHaveBeenCalledOnce();
  });

  it('follows only the newest search', async () => {
    server.start
      .mockResolvedValueOnce(
        started({
          token: 'old',
          snapshot: snapshot({ progress: progress(2, 10) }),
        }),
      )
      .mockResolvedValueOnce(
        started({
          token: 'new',
          snapshot: snapshot({ progress: progress(3, 9) }),
        }),
      );
    server.poll.mockImplementation(() =>
      Promise.resolve({
        kind: 'progress',
        snapshot: snapshot({ progress: progress(3, 9) }),
      }),
    );
    renderPage();
    await search('13400002');
    await search('13400003');
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(server.poll.mock.calls).toEqual([['new']]);
  });
});
