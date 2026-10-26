import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  moveKey,
  playerKeys,
  START_KEY,
  startReview,
  type ReviewState,
} from '@mychess/chess';
import type { TrainingResult } from '@mychess/domain';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import type { TrainingData } from '../../lib/training-data';
import type { FrameParts } from './drill';
import { ReviewDrill } from './review-drill';
import { TrainingFrame } from './training-frame';
import type { DrillClock } from './drill-input';

const T = MESSAGES.lt.training;
const MOVE_INPUT = MESSAGES.lt.board.moveInput.label;
const NOW = new Date('2026-10-25T08:00:00Z');
const DAY = 86_400_000;
const LONDON_ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const london = graphOf(LONDON);

/** The position after 1. d4 d5, where the London plays 2. Bf4. */
const afterD5 = (() => {
  const d5 = london.moves.find((m) => m.san === 'd5');
  if (d5 === undefined) throw new Error('the London has 1... d5');
  return d5.to;
})();
const D4 = moveKey(START_KEY, 'd4');
const BF4 = moveKey(afterD5, 'Bf4');

/** What the board was told to show, newest last; and its move handler. */
const ground = vi.hoisted(() => {
  const sets: Config[] = [];
  const handlers: { after: ((orig: Key, dest: Key) => void) | null } = {
    after: null,
  };
  return { sets, handlers };
});

vi.mock('@lichess-org/chessground', () => ({
  Chessground: (_: HTMLElement, config: Config) => {
    const after = config.movable?.events?.after;
    ground.handlers.after =
      after === undefined
        ? null
        : (orig, dest) => {
            after(orig, dest, { premove: false });
          };
    ground.sets.push(config);
    return {
      set: (next: Config) => {
        ground.sets.push(next);
      },
      setShapes: vi.fn(),
      selectSquare: vi.fn(),
      destroy: vi.fn(),
      state: { drawable: { current: undefined } },
    };
  },
}));

/** The newest value the board was given for `key`. */
const lastWith = <K extends keyof Config>(key: K): Config[K] | undefined =>
  ground.sets.filter((c) => key in c).at(-1)?.[key];

/** The arrows the board shows now. */
const arrows = () =>
  (lastWith('drawable')?.autoShapes ?? []).map(
    (s) => `${s.orig}${s.dest ?? ''}`,
  );

/** The board's square classes now (the cursor, a flash, a hint). */
const marked = () => lastWith('highlight')?.custom;

/** A Review of `key` due `daysAgo` days before NOW. */
function dueReview(key: string, daysAgo: number): ReviewState {
  return startReview(key, new Date(NOW.getTime() - (daysAgo + 1) * DAY));
}

function data(overrides: Partial<TrainingData> = {}): TrainingData {
  return {
    mode: 'review',
    entries: [
      {
        id: LONDON_ID,
        name: 'Londono sistema',
        side: 'white',
        kind: 'own',
        active: true,
        graph: london,
      },
    ],
    others: [],
    reviews: [dueReview(D4, 2), dueReview(BF4, 1)],
    learned: [D4, BF4],
    learnedToday: 0,
    settings: { sessionSize: 20, newPerDay: 10 },
    nextDue: null,
    now: NOW,
    ...overrides,
  };
}

let recorded: TrainingResult[];
let clock: { at: Date; ids: number };

const testClock: DrillClock = {
  now: () => clock.at,
  newId: () => {
    clock.ids += 1;
    return `00000000-0000-4000-8000-${String(clock.ids).padStart(12, '0')}`;
  },
};

/** A frame that lays the parts out plainly, so each can be found. */
function frame(parts: FrameParts): JSX.Element {
  return (
    <main data-finished={parts.finished === true ? 'yes' : 'no'}>
      <h1>{parts.title ?? 'no title'}</h1>
      {parts.progress === undefined ? null : (
        <p data-testid="counter">
          {`${String(parts.progress.done)} / ${String(parts.progress.total)}`}
        </p>
      )}
      {parts.board}
      <div data-testid="panel">{parts.panel}</div>
      <footer>{parts.actions}</footer>
    </main>
  );
}

function renderDrill(
  d: TrainingData = data(),
  drawFrame: (parts: FrameParts) => JSX.Element = frame,
) {
  return render(
    <NextIntlClientProvider
      locale="lt"
      messages={MESSAGES.lt}
      timeZone="Europe/Vilnius"
    >
      <ReviewDrill
        data={d}
        sync={{
          record: (r) => {
            recorded.push(r);
          },
          unsynced: 0,
          retry: vi.fn(),
        }}
        links={{ back: '/repertuarai/x', learn: '/treniruote?mode=learn' }}
        frame={drawFrame}
        clock={testClock}
      />
    </NextIntlClientProvider>,
  );
}

/** Types `move` into the move field and submits it. */
function type(move: string): void {
  const field = screen.getByLabelText(MOVE_INPUT);
  fireEvent.change(field, { target: { value: move } });
  const form = field.closest('form');
  if (form === null) throw new Error('the move field sits in a form');
  fireEvent.submit(form);
}

/** Lets `ms` of the drill's timers run. */
function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const panel = () => screen.getByTestId('panel').textContent;
const counter = () => screen.getByTestId('counter').textContent;
const kinds = () => recorded.map((r) => r.kind);

beforeEach(() => {
  vi.useFakeTimers();
  recorded = [];
  clock = { at: NOW, ids: 0 };
  ground.sets.length = 0;
  ground.handlers.after = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the review drill', () => {
  it('asks the first due move in its repertoire, from that side', () => {
    renderDrill();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(counter()).toBe('0 / 2');
    expect(panel()).toContain(T.review.prompt);
    expect(panel()).toContain(T.drill.toMove.white);
    expect(lastWith('orientation')).toBe('white');
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
  });

  it('records a right move as a pass once, says so, then goes on', () => {
    renderDrill();
    type('d4');
    expect(recorded).toEqual([
      {
        resultId: '00000000-0000-4000-8000-000000000001',
        kind: 'pass',
        moveKey: D4,
        repertoireId: LONDON_ID,
        answeredAt: NOW,
      },
    ]);
    expect(panel()).toContain(T.review.correct);
    expect(marked()?.get('d4')).toContain('correct');
    expect(counter()).toBe('1 / 2');
    wait(400);
    expect(kinds()).toEqual(['pass']);
  });

  it('plays the opponent’s reply first on a chained item, input locked meanwhile', () => {
    renderDrill();
    type('d4');
    wait(400);
    expect(lastWith('fen')).toBe(fenOf(afterD5));
    expect(lastWith('lastMove')).toEqual(['d7', 'd5']);
    expect(panel()).toContain('1... d5');
    // The field keeps focus, but a move waits for the reply's slide.
    type('Bf4');
    expect(kinds()).toEqual(['pass']);
    wait(150);
    expect(panel()).toContain('1. d4 d5');
    type('Bf4');
    expect(kinds()).toEqual(['pass', 'pass']);
  });

  it('records a wrong move as a lapse, shows the arrow, and the right move then goes on without a second record', () => {
    renderDrill();
    type('e4');
    expect(kinds()).toEqual(['lapse']);
    expect(panel()).toContain(T.review.lapse);
    expect(arrows()).toEqual(['d2d4']);
    expect(marked()?.get('e4')).toContain('wrong');
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    type('Nf3');
    type('d4');
    expect(kinds()).toEqual(['lapse']);
    expect(panel()).toContain(T.review.correct);
    wait(400);
    wait(150);
    expect(counter()).toBe('1 / 2');
    expect(panel()).toContain(T.review.prompt);
  });

  it('takes a move played on the board', () => {
    renderDrill();
    act(() => {
      ground.handlers.after?.('d2', 'd4');
    });
    expect(kinds()).toEqual(['pass']);
  });

  it('keeps focus on the board through a lapse played on it and the replay', () => {
    renderDrill(data(), (parts) => (
      <TrainingFrame
        {...parts}
        mode="review"
        backHref="/repertuarai/x"
        defaultTitle="no title"
        side="white"
        banner={null}
      />
    ));
    const board = screen.getByRole('application', {
      name: MESSAGES.lt.board.label,
    });
    board.focus();
    act(() => {
      ground.handlers.after?.('e2', 'e4');
    });
    expect(kinds()).toEqual(['lapse']);
    expect(document.activeElement).toBe(board);
    wait(400);
    expect(document.activeElement).toBe(board);
    act(() => {
      ground.handlers.after?.('d2', 'd4');
    });
    wait(400);
    wait(150);
    expect(screen.getByRole('main').textContent).toContain(T.review.prompt);
    expect(document.activeElement).toBe(board);
  });

  it('says a typed move that is not legal, and records nothing', () => {
    renderDrill();
    type('Ke5');
    expect(panel()).toContain(MESSAGES.lt.board.moveInput.unknown);
    expect(recorded).toEqual([]);
  });

  it('records a hint once and highlights the piece to move; a wrong move after it shows the arrow', () => {
    renderDrill();
    fireEvent.click(screen.getByRole('button', { name: T.review.hint }));
    expect(kinds()).toEqual(['hint']);
    expect(marked()?.get('d2')).toContain('hint');
    expect(panel()).toContain(T.review.hinted);
    expect(
      screen
        .getByRole('button', { name: T.review.hint })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: T.review.hint }));
    type('e4');
    expect(arrows()).toEqual(['d2d4']);
    expect(kinds()).toEqual(['hint']);
  });

  it('lists the other repertoires that play another move here, scoped or not', () => {
    const other = (id: string, name: string, pgn: string) => ({
      id,
      name,
      side: 'white' as const,
      graph: graphOf(pgn),
    });
    renderDrill(
      data({
        entries: [
          ...data().entries,
          { ...other('e1', 'Angliška', '1. c4 *'), kind: 'own', active: true },
        ],
        others: [other('i1', 'Itališka', '1. e4 e5 2. Nf3 *')],
      }),
    );
    const notice = screen.getByRole('note');
    expect(notice.textContent).toContain('Angliška: c4');
    expect(notice.textContent).toContain('Itališka: e4');
    expect(notice.textContent).not.toContain('Londono');
  });

  it('shows no notice when every repertoire agrees', () => {
    renderDrill();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('ends the session at any time, the results already recorded', () => {
    renderDrill();
    type('d4');
    const end = screen.getByRole('link', { name: T.drill.end });
    expect(end.getAttribute('href')).toBe('/repertuarai/x');
    expect(kinds()).toEqual(['pass']);
  });

  it('shows the done summary with the session’s counts and the graded progress', () => {
    renderDrill();
    type('d4');
    wait(400);
    wait(150);
    type('Bf4');
    wait(400);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByRole('main').dataset['finished']).toBe('yes');
    expect(counter()).toBe('2 / 2');
    const left = new Set(playerKeys(london)).size - 2;
    // Both passes moved their Reviews out of today: none is due.
    expect(
      screen.getByText(
        new RegExp(`^2 išmokta · 0 kartotinų · ${String(left)}`),
      ),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    expect(
      screen.getByRole('link', { name: T.done.learn }).getAttribute('href'),
    ).toBe('/treniruote?mode=learn');
    expect(screen.queryByRole('link', { name: T.drill.end })).toBeNull();
    // The ways on sit in the bottom bar, Done first.
    const bar = screen.getByRole('main').querySelector('footer');
    expect(
      Array.from(bar?.querySelectorAll('a') ?? [], (a) => a.textContent),
    ).toEqual([T.done.done, T.done.learn]);
  });

  it('offers Continue once a lapse is due again, and starts a new session over it', () => {
    renderDrill(data({ reviews: [dueReview(D4, 2)], learned: [D4] }));
    type('e4');
    type('d4');
    wait(400);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    // The lapse comes back within minutes (R-78).
    clock.at = new Date(NOW.getTime() + DAY / 24);
    wait(DAY / 24);
    fireEvent.click(screen.getByRole('button', { name: T.done.continue }));
    expect(counter()).toBe('0 / 1');
    expect(panel()).toContain(T.review.prompt);
    type('d4');
    expect(kinds()).toEqual(['lapse', 'pass']);
  });
});

describe('the review drill on a promotion', () => {
  const PROMOTING = '8/P7/8/8/8/2k5/8/7K w - -';
  const promotion = graphOf(`[FEN "${PROMOTING} 0 1"]\n\n1. a8=Q *`);
  const QUEEN = moveKey(PROMOTING, 'a8=Q');
  const promoting = () =>
    data({
      entries: [
        {
          id: LONDON_ID,
          name: 'Pėstininkas',
          side: 'white',
          kind: 'own',
          active: true,
          graph: promotion,
        },
      ],
      reviews: [dueReview(QUEEN, 1)],
      learned: [QUEEN],
    });
  const P = MESSAGES.lt.board.promotion;

  it('asks for the piece, then takes the move', () => {
    renderDrill(promoting());
    act(() => {
      ground.handlers.after?.('a7', 'a8');
    });
    expect(recorded).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: P.q }));
    expect(kinds()).toEqual(['pass']);
  });

  it('puts the pawn back when the choice is cancelled', () => {
    renderDrill(promoting());
    act(() => {
      ground.handlers.after?.('a7', 'a8');
    });
    const before = ground.sets.length;
    fireEvent.click(screen.getByRole('button', { name: P.cancel }));
    expect(recorded).toEqual([]);
    expect(screen.getByLabelText(MOVE_INPUT)).toBeDefined();
    expect(ground.sets.slice(before).some((c) => 'fen' in c)).toBe(true);
  });
});

describe('the review drill in a Black repertoire', () => {
  it('shows the board from Black, after the line so far', () => {
    const taimanov = graphOf(TAIMANOV, 'black');
    const e4 = taimanov.moves.find((m) => m.san === 'e4');
    if (e4 === undefined) throw new Error('the Taimanov starts 1. e4');
    const C5 = moveKey(e4.to, 'c5');
    renderDrill(
      data({
        entries: [
          {
            id: LONDON_ID,
            name: 'Taimanovo variantas',
            side: 'black',
            kind: 'assigned',
            active: true,
            graph: taimanov,
          },
        ],
        reviews: [dueReview(C5, 1)],
        learned: [C5],
      }),
    );
    expect(lastWith('orientation')).toBe('black');
    expect(lastWith('lastMove')).toEqual(['e2', 'e4']);
    expect(panel()).toContain(T.drill.toMove.black);
    expect(panel()).toContain('1. e4');
    type('c5');
    expect(kinds()).toEqual(['pass']);
    expect(panel()).toContain('1. e4 c5');
  });
});
