import { render, screen, within } from '@testing-library/react';
import { moveKey, START_KEY, startReview } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import type { TrainingData } from '../../lib/training-data';
import type { DrillProps } from './drill';
import { TrainingScreen } from './training-screen';

const T = MESSAGES.training;
const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOW = new Date('2026-10-25T08:00:00Z');
/** 10:00 in Vilnius: winter time starts on 25 October 2026. */
const NEXT = new Date('2026-10-26T08:00:00Z');
const D4 = moveKey(START_KEY, 'd4');

const sync = vi.hoisted(() => {
  const accounts: string[] = [];
  const state: { queued: readonly { key: string; at: Date }[] | null } = {
    queued: null,
  };
  return Object.assign(state, {
    unsynced: 0,
    record: vi.fn(),
    retry: vi.fn(),
    accounts,
  });
});

vi.mock('./use-result-sync', () => ({
  useResultSync: (accountId: string) => {
    sync.accounts.push(accountId);
    return { unsynced: sync.unsynced, record: sync.record, retry: sync.retry };
  },
  useQueuedLearned: () => sync.queued,
}));

vi.mock('@lichess-org/chessground', () => ({
  Chessground: () => ({
    set: vi.fn(),
    setShapes: vi.fn(),
    selectSquare: vi.fn(),
    destroy: vi.fn(),
    state: { drawable: { current: undefined } },
  }),
}));

// The drills are C5's and C6's; here they only show what the screen hands
// them and draw through its frame.
const drills = vi.hoisted(() => {
  const drill =
    (name: string) =>
    ({ data, links, frame }: DrillProps) =>
      frame({
        // The drill reports the item by its ids; the screen names it.
        item: { repertoireId: ID, chapterId: 'main' },
        progress: { done: 2, total: 5 },
        board: <div data-testid="live-board" />,
        panel: (
          <p data-review={links.review}>
            {`${name} drill, ${data.mode}, back to ${links.back}`}
            {data.queued === undefined
              ? null
              : `, ${String(data.queued.length)} queued`}
          </p>
        ),
      });
  return { review: drill('review'), learn: drill('learn') };
});
vi.mock('./review-drill', () => ({ ReviewDrill: drills.review }));
vi.mock('./learn-drill', () => ({ LearnDrill: drills.learn }));

function data(overrides: Partial<TrainingData> = {}): TrainingData {
  return {
    mode: 'review',
    entries: [
      {
        id: ID,
        name: 'Londono sistema',
        side: 'white',
        kind: 'own',
        active: true,
        chapterTitles: { main: 'Main line' },
        graph: graphOf(LONDON),
      },
    ],
    others: [],
    reviews: [],
    tracked: [],
    knownWithoutLearning: [],
    learnedToday: 0,
    coachNotes: [],
    settings: { sessionSize: 20, newPerDay: 10, learnArrows: true },
    now: NOW,
    ...overrides,
  };
}

function renderScreen(d: TrainingData, repertoireId: string | null = ID) {
  return render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <TrainingScreen data={d} accountId="a1" repertoireId={repertoireId} />
    </NextIntlClientProvider>,
  );
}

const heading = (name: string) =>
  screen.getByRole('heading', { level: 2, name });

const href = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  sync.unsynced = 0;
  sync.retry.mockReset();
  sync.accounts = [];
  sync.queued = null;
});

describe('the training screen with nothing due', () => {
  it('says so, when the next review is in Vilnius time, and offers new moves', () => {
    const due = startReview(D4, NOW);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    renderScreen(
      data({
        reviews: [{ ...due, fsrs: { ...due.fsrs, due: NEXT } }],
        tracked: [D4],
        settings: { sessionSize: 20, newPerDay: 3, learnArrows: true },
      }),
    );
    expect(heading(T.empty.nothingDue.title)).toBeDefined();
    expect(screen.getByText('Next review: tomorrow at 10:00')).toBeDefined();
    expect(href('Learn 3 new moves')).toBe(`/training?mode=learn&r=${ID}`);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(href(T.back)).toBe(`/repertoires/${ID}`);
  });

  it('offers no new moves when today’s allowance is used', () => {
    renderScreen(
      data({
        settings: { sessionSize: 20, newPerDay: 2, learnArrows: true },
        learnedToday: 2,
      }),
    );
    expect(heading(T.empty.nothingDue.title)).toBeDefined();
    expect(screen.queryByText(/^Next review:/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Learn \d/ })).toBeNull();
  });

  it('shows the start position dimmed and out of reach', () => {
    renderScreen(data());
    const board = screen.getByRole('application', { hidden: true });
    expect(board.closest('[inert]')).not.toBeNull();
  });

  it('shows nothing due as an accent card with the learn button inverted', () => {
    renderScreen(
      data({ settings: { sessionSize: 20, newPerDay: 3, learnArrows: true } }),
    );
    const card = heading(T.empty.nothingDue.title).closest('section');
    expect(card?.className).toContain('bg-accent');
    expect(card?.className).toContain('text-accent-fg');
    const learn = screen.getByRole('link', { name: /^Learn \d/ });
    expect(learn.className).toContain('bg-surface');
    expect(learn.className).toContain('text-accent');
  });

  it('shows the next review in the card’s own text colour', () => {
    const due = startReview(D4, NOW);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    renderScreen(
      data({
        reviews: [{ ...due, fsrs: { ...due.fsrs, due: NEXT } }],
        tracked: [D4],
      }),
    );
    const next = screen.getByText('Next review: tomorrow at 10:00');
    expect(next.className).toContain('text-accent-fg');
    expect(next.className).not.toContain('text-fg-muted');
  });

  it('shrinks the still board to a strip on a phone, so the card is in view', () => {
    renderScreen(data());
    const board = screen.getByRole('application', { hidden: true });
    const still = board.closest('[inert]');
    const classes = still?.className.split(' ') ?? [];
    // Two ranks of the eight, cut from the bottom: the player's own back
    // ranks, the board inside kept square.
    expect(classes).toContain('max-lg:aspect-[4/1]');
    expect(classes).toContain('max-lg:overflow-hidden');
    expect(classes).toContain('max-lg:flex');
    expect(classes).toContain('max-lg:flex-col');
    expect(classes).toContain('max-lg:justify-end');
    expect(classes).toContain('max-lg:*:shrink-0');
    expect(classes).not.toContain('max-lg:hidden');
  });
});

describe('the training screen with nothing to learn', () => {
  it('says today’s limit is reached', () => {
    renderScreen(
      data({
        mode: 'learn',
        settings: { sessionSize: 20, newPerDay: 0, learnArrows: true },
      }),
    );
    expect(heading(T.empty.limitReached.title)).toBeDefined();
    expect(screen.getByText(T.empty.limitReached.body)).toBeDefined();
  });

  it('shows the notice on a plain surface card', () => {
    renderScreen(
      data({
        mode: 'learn',
        settings: { sessionSize: 20, newPerDay: 0, learnArrows: true },
      }),
    );
    const card = heading(T.empty.limitReached.title).closest('section');
    expect(card?.className).toContain('bg-surface');
    expect(card?.className).not.toContain('bg-accent');
  });

  it('says every move is learned', () => {
    const all = data().entries.flatMap((e) =>
      e.graph.moves.map((m) => moveKey(m.from, m.san)),
    );
    renderScreen(data({ mode: 'learn', tracked: all }), null);
    expect(heading(T.empty.nothingLeft.title)).toBeDefined();
    expect(screen.getByText(T.empty.nothingLeft.body)).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: T.title.learn }),
    ).toBeDefined();
    expect(href(T.back)).toBe('/');
  });
});

describe('the training screen with no moves of the player’s side', () => {
  const empty = data({
    entries: [
      {
        id: ID,
        name: 'Tuščias',
        side: 'black',
        kind: 'own',
        active: true,
        chapterTitles: {},
        graph: graphOf('1. e4 *', 'black'),
      },
    ],
  });

  it('offers to edit the repertoire or import a PGN into it', () => {
    renderScreen(empty);
    expect(heading(T.empty.noMoves.title)).toBeDefined();
    expect(href(T.empty.noMoves.edit)).toBe(`/repertoires/${ID}`);
    expect(href(T.empty.noMoves.import)).toContain(ID);
    const card = heading(T.empty.noMoves.title).closest('section');
    expect(card?.className).toContain('bg-surface');
    expect(card?.className).not.toContain('bg-accent');
  });

  it('offers no edit or import for an assigned repertoire, only the way back', () => {
    renderScreen(
      data({
        entries: empty.entries.map((e) => ({
          ...e,
          kind: 'assigned',
          coachName: 'Ona',
        })),
      }),
    );
    expect(heading(T.empty.noMoves.title)).toBeDefined();
    expect(screen.getByText(T.empty.noMoves.bodyAssigned)).toBeDefined();
    expect(
      screen.queryByRole('link', { name: T.empty.noMoves.edit }),
    ).toBeNull();
    expect(
      screen.queryByRole('link', { name: T.empty.noMoves.import }),
    ).toBeNull();
    expect(href(T.back)).toBe(`/repertoires/assigned/${ID}`);
  });

  it('leads to the repertoires when it trains them all', () => {
    renderScreen(data({ entries: [] }), null);
    expect(heading(T.empty.noMoves.title)).toBeDefined();
    expect(screen.getByText(T.empty.noMoves.bodyAll)).toBeDefined();
    expect(href(T.empty.noMoves.repertoires)).toBe('/repertoires');
    expect(
      screen.getByRole('heading', { level: 1, name: T.title.review }),
    ).toBeDefined();
  });
});

describe('the training screen with something to drill', () => {
  const due = data({ reviews: [startReview(D4, new Date(0))], tracked: [D4] });

  it('hands the review mode to the review drill, drawn in the frame', () => {
    renderScreen(due);
    expect(
      screen.getByText(`review drill, review, back to /repertoires/${ID}`),
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByText('White · Main line')).toBeDefined();
    expect(screen.getByText('2 / 5')).toBeDefined();
    expect(screen.getByTestId('live-board').closest('[inert]')).toBeNull();
    expect(sync.accounts).toContain('a1');
  });

  it('leads an assigned repertoire’s drill back to its assigned page', () => {
    renderScreen({
      ...due,
      entries: due.entries.map((e) => ({
        ...e,
        kind: 'assigned',
        coachName: 'Ona',
      })),
    });
    expect(
      screen.getByText(
        `review drill, review, back to /repertoires/assigned/${ID}`,
      ),
    ).toBeDefined();
  });

  it('hands the learn mode to the learn drill', () => {
    renderScreen(data({ mode: 'learn' }), null);
    const panel = screen.getByText('learn drill, learn, back to /');
    // Its way on to review, over every repertoire.
    expect(panel.dataset['review']).toBe('/training?mode=review');
  });

  it('leads a drill scoped to one repertoire on to that repertoire’s review', () => {
    renderScreen(data({ mode: 'learn' }));
    const panel = screen.getByText(
      `learn drill, learn, back to /repertoires/${ID}`,
    );
    expect(panel.dataset['review']).toBe(`/training?mode=review&r=${ID}`);
  });

  it('shows the banner over the drill only while results wait, and retries', () => {
    const { rerender } = renderScreen(due);
    expect(screen.queryByRole('button', { name: T.sync.retry })).toBeNull();
    sync.unsynced = 2;
    rerender(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <TrainingScreen data={due} accountId="a1" repertoireId={ID} />
      </NextIntlClientProvider>,
    );
    const main = screen.getByRole('main');
    within(main).getByRole('button', { name: T.sync.retry }).click();
    expect(sync.retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('2 results');
  });
});

describe('the header: the session named, the item under it (R-224)', () => {
  const OTHER = '0b6c2a4e-1f3d-4e5a-8b7c-9d0e1f2a3b4c';
  const london = data().entries[0];
  const two = (active: boolean): TrainingData['entries'] =>
    london === undefined
      ? []
      : [london, { ...london, id: OTHER, name: 'Kita', active }];
  const due = data({ reviews: [startReview(D4, new Date(0))], tracked: [D4] });
  const title = () => screen.getByRole('heading', { level: 1 });

  it('titles a session over every repertoire by its name, the item’s repertoire, side and chapter under it', () => {
    renderScreen({ ...due, entries: two(true) }, null);
    expect(title().textContent).toBe(T.title.review);
    expect(title().nextElementSibling?.textContent).toBe(
      'Londono sistema (White) · Main line',
    );
  });

  it('titles a learn pass over every repertoire as learning new moves', () => {
    renderScreen({ ...due, mode: 'learn', entries: two(true) }, null);
    expect(title().textContent).toBe(T.title.learn);
    expect(title().nextElementSibling?.textContent).toBe(
      'Londono sistema (White) · Main line',
    );
  });

  it('titles a scoped session by its repertoire, the side and chapter under it', () => {
    renderScreen({ ...due, entries: two(true) }, ID);
    expect(title().textContent).toBe('Londono sistema');
    expect(title().nextElementSibling?.textContent).toBe('White · Main line');
  });

  it('names the session, not the repertoire, when only one is trained, the other paused', () => {
    renderScreen({ ...due, entries: two(false) }, null);
    expect(title().textContent).toBe(T.title.review);
  });

  it('keeps the session’s name, with no context line, when there is nothing to drill', () => {
    renderScreen(data({ entries: two(true) }), null);
    expect(title().textContent).toBe(T.title.review);
    expect(title().nextElementSibling).toBeNull();
  });
});

describe('the training screen and the results still queued (#330 decision 2)', () => {
  const ONLY_D4 = [
    {
      id: ID,
      name: 'd4',
      side: 'white',
      kind: 'own',
      active: true,
      chapterTitles: {},
      graph: graphOf('1. d4 *'),
    },
  ] as const;

  it('hands the learn drill the moves the browser still queues', () => {
    sync.queued = [{ key: D4, at: NOW }];
    renderScreen(data({ mode: 'learn' }));
    expect(
      screen.getByText(
        `learn drill, learn, back to /repertoires/${ID}, 1 queued`,
      ),
    ).toBeDefined();
  });

  it('hands the snapshot unchanged when nothing learned is queued', () => {
    sync.queued = [];
    renderScreen(data({ mode: 'learn' }));
    expect(
      screen.getByText(`learn drill, learn, back to /repertoires/${ID}`),
    ).toBeDefined();
  });

  it('says every move is learned when the queue holds the last one', () => {
    sync.queued = [{ key: D4, at: NOW }];
    renderScreen(data({ mode: 'learn', entries: ONLY_D4 }));
    expect(heading(T.empty.nothingLeft.title)).toBeDefined();
  });

  it('leaves a review on the snapshot: a queued move’s Review is not the server’s', () => {
    sync.queued = [{ key: D4, at: NOW }];
    renderScreen(
      data({ reviews: [startReview(D4, new Date(0))], tracked: [D4] }),
    );
    expect(
      screen.getByText(`review drill, review, back to /repertoires/${ID}`),
    ).toBeDefined();
  });
});
