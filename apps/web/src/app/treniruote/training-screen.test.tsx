import { render, screen, within } from '@testing-library/react';
import { moveKey, START_KEY, startReview } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import type { TrainingData } from '../../lib/training-data';
import type { DrillProps } from './drill';
import { TrainingScreen } from './training-screen';

const T = MESSAGES.lt.training;
const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const NOW = new Date('2026-10-25T08:00:00Z');
/** 10:00 in Vilnius: winter time starts on 25 October 2026. */
const NEXT = new Date('2026-10-26T08:00:00Z');
const D4 = moveKey(START_KEY, 'd4');

const sync = vi.hoisted(() => {
  const accounts: string[] = [];
  return { unsynced: 0, record: vi.fn(), retry: vi.fn(), accounts };
});

vi.mock('./use-result-sync', () => ({
  useResultSync: (accountId: string) => {
    sync.accounts.push(accountId);
    return { unsynced: sync.unsynced, record: sync.record, retry: sync.retry };
  },
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
        title: `${name} item`,
        progress: { done: 2, total: 5 },
        board: <div data-testid="live-board" />,
        panel: <p>{`${name} drill, ${data.mode}, back to ${links.back}`}</p>,
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
        graph: graphOf(LONDON),
      },
    ],
    others: [],
    reviews: [],
    learned: [],
    learnedToday: 0,
    settings: { sessionSize: 20, newPerDay: 10 },
    nextDue: null,
    now: NOW,
    ...overrides,
  };
}

function renderScreen(d: TrainingData, repertoireId: string | null = ID) {
  return render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <TrainingScreen data={d} accountId="a1" repertoireId={repertoireId} />
    </NextIntlClientProvider>,
  );
}

const heading = (name: string) =>
  screen.getByRole('heading', { level: 2, name });

const href = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

beforeEach(() => {
  sync.unsynced = 0;
  sync.retry.mockReset();
  sync.accounts = [];
});

describe('the training screen with nothing due', () => {
  it('says so, when the next review is in Vilnius time, and offers new moves', () => {
    const due = startReview(D4, NOW);
    renderScreen(
      data({
        reviews: [{ ...due, fsrs: { ...due.fsrs, due: NEXT } }],
        learned: [D4],
        nextDue: NEXT,
        settings: { sessionSize: 20, newPerDay: 3 },
      }),
    );
    expect(heading(T.empty.nothingDue.title)).toBeDefined();
    expect(screen.getByText(/^Kitas kartojimas:/).textContent).toContain(
      '10:00',
    );
    expect(href('Mokytis 3 naujų ėjimų')).toBe(
      `/treniruote?mode=learn&r=${ID}`,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(href(T.back)).toBe(`/repertuarai/${ID}`);
  });

  it('offers no new moves when today’s allowance is used', () => {
    renderScreen(
      data({ settings: { sessionSize: 20, newPerDay: 2 }, learnedToday: 2 }),
    );
    expect(heading(T.empty.nothingDue.title)).toBeDefined();
    expect(screen.queryByText(/^Kitas kartojimas:/)).toBeNull();
    expect(screen.queryByRole('link', { name: /^Mokytis \d/ })).toBeNull();
  });

  it('shows the start position dimmed and out of reach', () => {
    renderScreen(data());
    const board = screen.getByRole('application', { hidden: true });
    expect(board.closest('[inert]')).not.toBeNull();
  });
});

describe('the training screen with nothing to learn', () => {
  it('says today’s limit is reached', () => {
    renderScreen(
      data({ mode: 'learn', settings: { sessionSize: 20, newPerDay: 0 } }),
    );
    expect(heading(T.empty.limitReached.title)).toBeDefined();
    expect(screen.getByText(T.empty.limitReached.body)).toBeDefined();
  });

  it('says every move is learned', () => {
    const all = data().entries.flatMap((e) =>
      e.graph.moves.map((m) => moveKey(m.from, m.san)),
    );
    renderScreen(data({ mode: 'learn', learned: all }), null);
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
        graph: graphOf('1. e4 *', 'black'),
      },
    ],
  });

  it('offers to edit the repertoire or import a PGN into it', () => {
    renderScreen(empty);
    expect(heading(T.empty.noMoves.title)).toBeDefined();
    expect(href(T.empty.noMoves.edit)).toBe(`/repertuarai/${ID}`);
    expect(href(T.empty.noMoves.import)).toContain(ID);
  });

  it('offers no edit or import for an assigned repertoire, only the way back', () => {
    renderScreen(
      data({
        entries: empty.entries.map((e) => ({ ...e, kind: 'assigned' })),
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
    expect(href(T.back)).toBe(`/repertuarai/priskirti/${ID}`);
  });

  it('leads to the repertoires when it trains them all', () => {
    renderScreen(data({ entries: [] }), null);
    expect(heading(T.empty.noMoves.title)).toBeDefined();
    expect(screen.getByText(T.empty.noMoves.bodyAll)).toBeDefined();
    expect(href(T.empty.noMoves.repertoires)).toBe('/repertuarai');
    expect(
      screen.getByRole('heading', { level: 1, name: T.title.review }),
    ).toBeDefined();
  });
});

describe('the training screen with something to drill', () => {
  const due = data({ reviews: [startReview(D4, new Date(0))], learned: [D4] });

  it('hands the review mode to the review drill, drawn in the frame', () => {
    renderScreen(due);
    expect(
      screen.getByText(`review drill, review, back to /repertuarai/${ID}`),
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { level: 1, name: 'review item' }),
    ).toBeDefined();
    expect(screen.getByText('2 / 5')).toBeDefined();
    expect(screen.getByTestId('live-board').closest('[inert]')).toBeNull();
    expect(sync.accounts).toContain('a1');
  });

  it('leads an assigned repertoire’s drill back to its assigned page', () => {
    renderScreen({
      ...due,
      entries: due.entries.map((e) => ({ ...e, kind: 'assigned' })),
    });
    expect(
      screen.getByText(
        `review drill, review, back to /repertuarai/priskirti/${ID}`,
      ),
    ).toBeDefined();
  });

  it('hands the learn mode to the learn drill', () => {
    renderScreen(data({ mode: 'learn' }), null);
    expect(screen.getByText('learn drill, learn, back to /')).toBeDefined();
  });

  it('shows the banner over the drill only while results wait, and retries', () => {
    const { rerender } = renderScreen(due);
    expect(screen.queryByRole('button', { name: T.sync.retry })).toBeNull();
    sync.unsynced = 2;
    rerender(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        <TrainingScreen data={due} accountId="a1" repertoireId={ID} />
      </NextIntlClientProvider>,
    );
    const main = screen.getByRole('main');
    within(main).getByRole('button', { name: T.sync.retry }).click();
    expect(sync.retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('2 rezultatai');
  });
});
