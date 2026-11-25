import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  legalMoves,
  moveKey,
  playerKeys,
  positionAfterMove,
  positionKey,
  START_KEY,
  startReview,
  type ReviewState,
} from '@mychess/chess';
import type { TrainingResult } from '@mychess/domain';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  graphOf,
  LONDON,
  pgnWithMoves,
  TAIMANOV,
} from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import type { TrainingData } from '../../lib/training-data';
import type { FrameParts } from './drill';
import { ReviewDrill } from './review-drill';
import { TrainingFrame } from './training-frame';
import { FEEDBACK_MS, type DrillClock } from './drill-input';

const T = MESSAGES.training;
const MOVE_INPUT = MESSAGES.board.moveInput.label;
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
/** The position after 1. e4, a wrong answer to 1. d4. */
const AFTER_E4 = positionAfterMove(START_KEY, {
  orig: 'e2',
  dest: 'e4',
  san: 'e4',
  promotion: null,
});

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
        chapterTitles: {},
        graph: london,
      },
    ],
    others: [],
    reviews: [dueReview(D4, 2), dueReview(BF4, 1)],
    tracked: [D4, BF4],
    knownWithoutLearning: [],
    learnedToday: 0,
    coachNotes: [],
    settings: { sessionSize: 20, newPerDay: 10, learnArrows: true },
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
      <h1>{parts.item?.name ?? 'no item'}</h1>
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
      locale="en"
      messages={MESSAGES}
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
        links={{
          back: '/repertoires/x',
          learn: '/training?mode=learn',
          review: '/training?mode=review',
        }}
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
    wait(FEEDBACK_MS);
    expect(kinds()).toEqual(['pass']);
  });

  it('plays the opponent’s reply first on a chained item, the board locked meanwhile', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    expect(lastWith('fen')).toBe(fenOf(afterD5));
    expect(lastWith('lastMove')).toEqual(['d7', 'd5']);
    expect(panel()).toContain('1... d5');
    expect(lastWith('movable')?.dests?.size ?? 0).toBe(0);
    wait(150);
    expect(lastWith('movable')?.dests?.size ?? 0).toBeGreaterThan(0);
    expect(panel()).toContain('1. d4 d5');
    type('Bf4');
    expect(kinds()).toEqual(['pass', 'pass']);
  });

  it('takes a move typed while the reply still slides in (#324)', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    // The position is the player's already; only the board waits.
    type('Bf4');
    expect(kinds()).toEqual(['pass', 'pass']);
    expect(panel()).toContain(T.review.correct);
    expect(screen.getByLabelText<HTMLInputElement>(MOVE_INPUT).value).toBe('');
    wait(150);
    wait(FEEDBACK_MS);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
  });

  it('refuses a move typed during the correct flash, before the next card shows', () => {
    renderDrill();
    type('d4');
    type('Bf4');
    expect(kinds()).toEqual(['pass']);
    expect(screen.getByLabelText<HTMLInputElement>(MOVE_INPUT).value).toBe(
      'Bf4',
    );
    expect(panel()).toContain(T.review.correct);
  });

  it('grades a wrong move typed during the reply’s slide as a lapse', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    type('c4');
    wait(FEEDBACK_MS);
    expect(kinds()).toEqual(['pass', 'lapse']);
    expect(arrows()).toEqual(['c1f4']);
    wait(150);
    type('Bf4');
    expect(kinds()).toEqual(['pass', 'lapse']);
    expect(panel()).toContain(T.review.correct);
  });

  it('records a wrong move as a lapse, holds it for its flash, then shows the arrow, and the right move then goes on without a second record (#381)', () => {
    renderDrill();
    type('e4');
    expect(kinds()).toEqual(['lapse']);
    expect(panel()).toContain(T.review.lapse);
    // The wrong move stays on the board for the flash, no arrow yet (#381).
    expect(arrows()).toEqual([]);
    expect(marked()?.get('e4')).toContain('wrong');
    expect(lastWith('fen')).toBe(fenOf(AFTER_E4));
    type('d4');
    expect(panel()).not.toContain(T.review.correct);
    wait(FEEDBACK_MS - 1);
    expect(lastWith('fen')).toBe(fenOf(AFTER_E4));
    wait(1);
    expect(arrows()).toEqual(['d2d4']);
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    type('Nf3');
    wait(FEEDBACK_MS);
    type('d4');
    expect(kinds()).toEqual(['lapse']);
    expect(panel()).toContain(T.review.correct);
    wait(FEEDBACK_MS);
    wait(150);
    // The lapsed move is asked again at the end (R-78); owing its repeat,
    // it is not finished (R-223).
    expect(counter()).toBe('0 / 2');
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
        backHref="/repertoires/x"
        title="no title"
        context={null}
        side="white"
        banner={null}
      />
    ));
    const board = screen.getByRole('application', {
      name: MESSAGES.board.label,
    });
    board.focus();
    act(() => {
      ground.handlers.after?.('e2', 'e4');
    });
    expect(kinds()).toEqual(['lapse']);
    expect(document.activeElement).toBe(board);
    wait(FEEDBACK_MS);
    expect(document.activeElement).toBe(board);
    act(() => {
      ground.handlers.after?.('d2', 'd4');
    });
    wait(FEEDBACK_MS);
    wait(150);
    expect(screen.getByRole('main').textContent).toContain(T.review.prompt);
    expect(document.activeElement).toBe(board);
  });

  it('says a typed move that is not legal, and records nothing', () => {
    renderDrill();
    type('Ke5');
    expect(panel()).toContain(MESSAGES.board.moveInput.unknown);
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
    wait(FEEDBACK_MS);
    expect(arrows()).toEqual(['d2d4']);
    expect(kinds()).toEqual(['hint']);
  });

  it('fades a used Hint and marks it unavailable (R-61)', () => {
    renderDrill();
    const hint = screen.getByRole('button', { name: T.review.hint });
    fireEvent.click(hint);
    expect(hint.getAttribute('aria-disabled')).toBe('true');
    expect(hint.className).toContain('aria-disabled:opacity-50');
    expect(hint.className).toContain('aria-disabled:cursor-not-allowed');
  });

  describe('the two-answers notice (R-54, R-174, #330 decision 4)', () => {
    const other = (id: string, name: string, pgn: string) => ({
      id,
      name,
      side: 'white' as const,
      graph: graphOf(pgn),
    });
    const twoOthers = () =>
      data({
        entries: [
          ...data().entries,
          {
            ...other('e1', 'Angliška', '1. c4 *'),
            kind: 'own',
            active: true,
            chapterTitles: {},
          },
        ],
        others: [other('i1', 'Itališka', '1. e4 e5 2. Nf3 *')],
      });
    const sentence = (name: string, move: string) =>
      T.twoAnswers.other.replace('{name}', name).replace('{move}', move);
    const next = () => screen.queryByRole('button', { name: T.drill.next });

    it('says nothing before the answer, so it cannot hint', () => {
      renderDrill(twoOthers());
      expect(screen.queryByRole('note')).toBeNull();
    });

    it('names each other repertoire and its move once, in one sentence, after the answer, scoped or not', () => {
      renderDrill(twoOthers());
      type('d4');
      const notice = screen.getByRole('note');
      expect(
        Array.from(notice.querySelectorAll('p'), (p) => p.textContent),
      ).toEqual([sentence('Angliška', 'c4'), sentence('Itališka', 'e4')]);
      expect(notice.textContent.match(/c4/g)).toHaveLength(1);
      expect(notice.textContent).not.toContain('Londono');
    });

    it('holds a right answer until Next, so the notice can be read', () => {
      renderDrill(twoOthers());
      type('d4');
      wait(2000);
      expect(screen.getByRole('note')).toBeDefined();
      const button = next();
      if (button === null) throw new Error('a Next button');
      fireEvent.click(button);
      wait(150);
      expect(screen.queryByRole('note')).toBeNull();
      expect(panel()).toContain('1. d4 d5');
    });

    it('shows with the arrow after a wrong answer', () => {
      renderDrill(twoOthers());
      type('e4');
      wait(FEEDBACK_MS);
      expect(arrows()).toEqual(['d2d4']);
      expect(screen.getByRole('note').textContent).toContain(
        sentence('Angliška', 'c4'),
      );
    });
  });

  it('shows no notice when every repertoire agrees', () => {
    renderDrill();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('ends the session at any time, the results already recorded', () => {
    renderDrill();
    type('d4');
    const end = screen.getByRole('link', { name: T.drill.end });
    expect(end.getAttribute('href')).toBe('/repertoires/x');
    expect(kinds()).toEqual(['pass']);
  });

  it('shows the done summary with the session’s counts and the graded progress', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    wait(150);
    type('Bf4');
    wait(FEEDBACK_MS);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByRole('main').dataset['finished']).toBe('yes');
    expect(counter()).toBe('2 / 2');
    const left = new Set(playerKeys(london)).size - 2;
    // Both passes moved their Reviews out of today: none is due.
    expect(
      screen.getByText(
        new RegExp(`^2 learned · 0 due · ${String(left)} to learn`),
      ),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    expect(
      screen.getByRole('link', { name: T.done.learn }).getAttribute('href'),
    ).toBe('/training?mode=learn');
    expect(screen.queryByRole('link', { name: T.drill.end })).toBeNull();
    // The ways on sit in the bottom bar, the next step first, Done last.
    const bar = screen.getByRole('main').querySelector('footer');
    expect(
      Array.from(bar?.querySelectorAll('a') ?? [], (a) => a.textContent),
    ).toEqual([T.done.learn, T.done.done]);
  });

  it('asks a lapsed move again at the end of the session, repeats on top of the count, until today is done (#319, R-78, R-223)', () => {
    renderDrill();
    type('e4');
    wait(FEEDBACK_MS);
    // The repeat comes on top of the session's two moves (R-223): the
    // lapsed move owes it, so it is not finished.
    expect(counter()).toBe('0 / 2');
    type('d4');
    wait(FEEDBACK_MS);
    expect(counter()).toBe('0 / 2');
    wait(150);
    type('Bf4');
    expect(counter()).toBe('1 / 2');
    wait(FEEDBACK_MS);
    expect(panel()).toContain(T.review.again);
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(screen.queryByRole('heading', { name: T.done.title })).toBeNull();
    type('d4');
    expect(kinds()).toEqual(['lapse', 'pass', 'pass']);
    // A move in its learning steps comes back once more: 1 min, then
    // 10 min (R-78); still owed, it is not finished (R-223).
    expect(counter()).toBe('1 / 2');
    wait(FEEDBACK_MS);
    expect(panel()).toContain(T.review.again);
    type('d4');
    wait(FEEDBACK_MS);
    expect(kinds()).toEqual(['lapse', 'pass', 'pass', 'pass']);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByText(T.done.dayDone)).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    // The summary counts the moves by their first answer.
    const stat = (label: string) =>
      screen.getByText(label).parentElement?.querySelector('dd')?.textContent;
    expect(stat(T.done.reviewed)).toBe('2');
    expect(stat(T.done.firstTry)).toBe('1');
    expect(stat(T.done.lapses)).toBe('1');
    expect(counter()).toBe('2 / 2');
  });

  it('starts its session by the clock, not the snapshot: a page loaded yesterday still repeats a lapse today (R-78)', () => {
    renderDrill(data({ now: new Date(NOW.getTime() - DAY) }));
    type('e4');
    // Today's day end: the lapse's 1-minute step falls in it, so the move
    // owes a repeat and is not finished (R-223).
    expect(counter()).toBe('0 / 2');
  });

  it('asks a lapsed move again once its 1-minute step has run out by the clock, before the session ends (#338, R-78)', () => {
    const wide = graphOf(pgnWithMoves(41));
    const keys = [...new Set(playerKeys(wide))];
    renderDrill(
      data({
        entries: [
          {
            id: LONDON_ID,
            name: 'Platus',
            side: 'white',
            kind: 'own',
            active: true,
            chapterTitles: {},
            graph: wide,
          },
        ],
        reviews: keys.map((key) => dueReview(key, 1)),
        tracked: keys,
        settings: { sessionSize: 10, newPerDay: 10, learnArrows: true },
      }),
    );
    /** The repertoire holds one White move in each position: the first. */
    const moves = () => legalMoves(positionKey(lastWith('fen') ?? ''));
    const [right, wrong] = moves();
    type(wrong?.san ?? 'no move');
    wait(FEEDBACK_MS);
    type(right?.san ?? 'no move');
    wait(FEEDBACK_MS);
    wait(150);
    // Inside the step: the next due move.
    expect(panel()).toContain(T.review.prompt);
    type(moves()[0]?.san ?? 'no move');
    clock.at = new Date(NOW.getTime() + 2 * 60_000);
    wait(FEEDBACK_MS);
    wait(150);
    expect(panel()).toContain(T.review.again);
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    // The second move is finished; the lapsed one, asked again, is not (R-223).
    expect(counter()).toBe('1 / 10');
  });

  it('says how many moves are still due and offers Continue when the session size leaves some (#319, R-62)', () => {
    const wide = graphOf(pgnWithMoves(41));
    const keys = [...new Set(playerKeys(wide))];
    expect(keys).toHaveLength(21);
    renderDrill(
      data({
        entries: [
          {
            id: LONDON_ID,
            name: 'Platus',
            side: 'white',
            kind: 'own',
            active: true,
            chapterTitles: {},
            graph: wide,
          },
        ],
        reviews: keys.map((key) => dueReview(key, 1)),
        tracked: keys,
        settings: { sessionSize: 10, newPerDay: 10, learnArrows: true },
      }),
    );
    expect(counter()).toBe('0 / 10');
    for (let i = 0; i < 10; i++) {
      // The repertoire holds one White move in each position.
      const [move] = legalMoves(positionKey(lastWith('fen') ?? ''));
      type(move?.san ?? 'no move');
      wait(FEEDBACK_MS);
      wait(150);
    }
    expect(kinds()).toEqual(Array<string>(10).fill('pass'));
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByText('11 more moves are due.')).toBeDefined();
    expect(screen.queryByText(/^Next review:/)).toBeNull();
    expect(screen.queryByText(T.done.dayDone)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: T.done.continue }));
    expect(counter()).toBe('0 / 10');
    expect(panel()).toContain(T.review.prompt);
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
          chapterTitles: {},
          graph: promotion,
        },
      ],
      reviews: [dueReview(QUEEN, 1)],
      tracked: [QUEEN],
    });
  const P = MESSAGES.board.promotion;

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
            coachName: 'Ona',
            active: true,
            chapterTitles: {},
            graph: taimanov,
          },
        ],
        reviews: [dueReview(C5, 1)],
        tracked: [C5],
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

describe('the review drill and NAGs', () => {
  it('shows the line so far without NAG glyphs: review shows the board, not annotations (#325 decision 6)', () => {
    const annotated = graphOf(
      LONDON.replace('1. d4 { Solid', '1. d4 $1 { Solid').replace(
        ' d5 2. Bf4',
        ' d5 $14 2. Bf4',
      ),
    );
    expect(
      annotated.moves.filter((m) => m.nags.length > 0).map((m) => m.san),
    ).toEqual(['d4', 'd5']);
    renderDrill(
      data({
        entries: [
          {
            id: LONDON_ID,
            name: 'Londono sistema',
            side: 'white',
            kind: 'own',
            active: true,
            chapterTitles: {},
            graph: annotated,
          },
        ],
        reviews: [dueReview(BF4, 1)],
        tracked: [BF4],
      }),
    );
    wait(FEEDBACK_MS);
    expect(panel()).toContain('1. d4 d5');
    expect(panel()).not.toContain('!');
    expect(panel()).not.toContain('⩲');
  });
});

describe('the review drill and coach notes (#322, R-174)', () => {
  /** The coach's line: a note on 1. d4 and none on 2. Bf4. */
  const NOTED = graphOf('1. d4 { Take the centre first. } d5 2. Bf4 *');
  const noted = (kind: 'assigned' | 'own') =>
    data({
      entries: [
        {
          id: LONDON_ID,
          name: 'Trenerio Londonas',
          side: 'white',
          ...(kind === 'assigned' ? { kind, coachName: 'Rasa' } : { kind }),
          active: true,
          chapterTitles: {},
          graph: NOTED,
        },
      ],
    });
  const note = () =>
    screen.queryByRole('note', { name: T.drill.coachNote })?.textContent ??
    null;
  const next = () => screen.queryByRole('button', { name: T.drill.next });

  it('keeps the note hidden until the move is answered, then waits for the player to go on', () => {
    renderDrill(noted('assigned'));
    expect(panel()).toContain(T.review.prompt);
    expect(note()).toBeNull();
    expect(next()).toBeNull();
    type('d4');
    expect(kinds()).toEqual(['pass']);
    expect(note()).toContain('Take the centre first.');
    // The drill does not move on while the note is there to read.
    wait(2000);
    expect(note()).toContain('Take the centre first.');
    expect(counter()).toBe('1 / 2');
    const button = next();
    if (button === null) throw new Error('a Next button');
    fireEvent.click(button);
    wait(150);
    // 2. Bf4 has no note: the next card shows none, and goes on by itself.
    expect(panel()).toContain('1. d4 d5');
    expect(note()).toBeNull();
    type('Bf4');
    expect(next()).toBeNull();
    wait(FEEDBACK_MS);
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
  });

  it('puts Next held by a note in the bottom bar before End session, focused (ux sign-off)', () => {
    renderDrill(noted('assigned'));
    type('d4');
    const button = next();
    if (button === null) throw new Error('a Next button');
    // In the thumb zone, not under the card below the fold on a phone.
    const bar = button.closest('footer');
    expect(bar).not.toBeNull();
    expect(
      within(screen.getByTestId('panel')).queryByRole('button', {
        name: T.drill.next,
      }),
    ).toBeNull();
    expect(
      Array.from(
        bar?.querySelectorAll('a, button') ?? [],
        (el) => el.textContent,
      ),
    ).toEqual([T.drill.next, T.drill.end]);
    // Focus leaves the disabled move field for it.
    expect(document.activeElement).toBe(button);
  });

  it('hides the move field and Hint while the note holds the drill, and shows them again after Next (ux sign-off)', () => {
    renderDrill(noted('assigned'));
    const hint = () => screen.queryByRole('button', { name: T.review.hint });
    expect(screen.queryByLabelText(MOVE_INPUT)).not.toBeNull();
    expect(hint()).not.toBeNull();
    type('d4');
    // Held: only the note and Next, which nothing else can be used beside.
    expect(note()).toContain('Take the centre first.');
    expect(next()).not.toBeNull();
    expect(screen.queryByLabelText(MOVE_INPUT)).toBeNull();
    expect(hint()).toBeNull();
    const button = next();
    if (button === null) throw new Error('a Next button');
    fireEvent.click(button);
    wait(150);
    expect(screen.queryByLabelText(MOVE_INPUT)).not.toBeNull();
    expect(hint()).not.toBeNull();
  });

  it('shows the note with the arrow after a lapse', () => {
    renderDrill(noted('assigned'));
    type('e4');
    wait(FEEDBACK_MS);
    expect(arrows()).toEqual(['d2d4']);
    // Named with the assigning coach (R-107, #338).
    expect(note()).toBe(`${byCoach('Rasa')}Take the centre first.`);
    type('d4');
    expect(note()).toContain('Take the centre first.');
    expect(next()).not.toBeNull();
  });

  it('shows no note after a hint, before the move is played', () => {
    renderDrill(noted('assigned'));
    fireEvent.click(screen.getByRole('button', { name: T.review.hint }));
    expect(note()).toBeNull();
  });

  it('shows no coach note for a comment on the player’s own repertoire', () => {
    renderDrill(noted('own'));
    type('d4');
    expect(note()).toBeNull();
    expect(next()).toBeNull();
  });

  it('shows a coach’s note on the player’s own repertoire, named, once the move is answered (R-107, R-43, R-174)', () => {
    renderDrill({
      ...noted('own'),
      coachNotes: [
        {
          repertoireId: LONDON_ID,
          moveKey: D4,
          coachName: 'Ona',
          text: 'A',
          source: 'shared',
        },
        {
          repertoireId: LONDON_ID,
          moveKey: D4,
          coachName: 'Jonas',
          text: 'B',
          source: 'shared',
        },
      ],
    });
    expect(note()).toBeNull();
    type('d4');
    expect(note()).toBe(`${byCoach('Ona')}A${byCoach('Jonas')}B`);
    expect(next()).not.toBeNull();
  });
});

/** The label of a note marked with its coach's name. */
const byCoach = (name: string) =>
  MESSAGES.coachNote.byCoach.replace('{name}', name);
