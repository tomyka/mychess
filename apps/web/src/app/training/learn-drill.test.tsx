import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import {
  fenOf,
  learnLines,
  moveKey,
  newKeys,
  positionAfterMove,
  START_KEY,
  startReview,
} from '@mychess/chess';
import type { TrainingResult } from '@mychess/domain';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import type { TrainingData } from '../../lib/training-data';
import { FEEDBACK_MS, type DrillClock } from './drill-input';
import type { FrameParts } from './drill';
import { LearnDrill } from './learn-drill';
import { dayOf } from '../../lib/training-day';

const T = MESSAGES.training;
const MOVE_INPUT = MESSAGES.board.moveInput.label;
const NOW = new Date('2026-10-25T08:00:00Z');
const DAY = 86_400_000;
const REP_ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
/** A short White line: two own moves around one reply. */
const SHORT = graphOf('1. d4 d5 2. Bf4 *');
const D4 = moveKey(START_KEY, 'd4');
const AFTER_D5 = (() => {
  const d5 = SHORT.moves.find((m) => m.san === 'd5');
  if (d5 === undefined) throw new Error('the line has 1... d5');
  return d5.to;
})();
const BF4 = moveKey(AFTER_D5, 'Bf4');
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

function data(overrides: Partial<TrainingData> = {}): TrainingData {
  return {
    mode: 'learn',
    entries: [
      {
        id: REP_ID,
        name: 'Londono sistema',
        side: 'white',
        kind: 'own',
        active: true,
        chapterTitles: {},
        graph: SHORT,
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

let recorded: TrainingResult[];
let ids: number;

const testClock: DrillClock = {
  now: () => NOW,
  newId: () => {
    ids += 1;
    return `00000000-0000-4000-8000-${String(ids).padStart(12, '0')}`;
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

function renderDrill(d: TrainingData = data()) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <LearnDrill
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
          review: `/training?mode=review&r=${REP_ID}`,
        }}
        frame={frame}
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

/** Plays a wrong move and lets its hold run out (#381). */
function miss(move: string): void {
  type(move);
  wait(FEEDBACK_MS);
}

/** Plays a right move and lets its flash, and any reply after it, run. */
function play(move: string): void {
  type(move);
  wait(FEEDBACK_MS);
  wait(150);
}

const panel = () => screen.getByTestId('panel').textContent;
const counter = () => screen.getByTestId('counter').textContent;
const learnedKeys = () => recorded.map((r) => r.moveKey);

beforeEach(() => {
  vi.useFakeTimers();
  recorded = [];
  ids = 0;
  ground.sets.length = 0;
  ground.handlers.after = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the learn drill, arrows round', () => {
  it('starts the line in its repertoire with the new move’s arrow', () => {
    renderDrill();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(counter()).toBe('0 / 2');
    expect(lastWith('orientation')).toBe('white');
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(arrows()).toEqual(['d2d4']);
    expect(panel()).toContain(T.learn.arrows);
  });

  it('keeps saying “correct” while the reply slides in, until the next move is asked (UX sign-off)', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    // The reply 1...d5 is sliding in: nothing is asked yet.
    expect(panel()).toContain(T.learn.correct);
    expect(panel()).not.toContain(T.learn.arrows);
    wait(150);
    expect(panel()).toContain(T.learn.arrows);
    expect(panel()).not.toContain(T.learn.correct);
  });

  it('asks a Black line’s first move as soon as White’s opening move has slid in, saying nothing correct before', () => {
    renderDrill(
      data({
        entries: [
          {
            id: REP_ID,
            name: 'Juodųjų',
            side: 'black',
            kind: 'own',
            active: true,
            chapterTitles: {},
            graph: graphOf('1. e4 c5 *', 'black'),
          },
        ],
      }),
    );
    expect(panel()).not.toContain(T.learn.correct);
  });

  it('holds a right move for its flash, then plays the reply itself, the board locked meanwhile', () => {
    renderDrill();
    type('d4');
    expect(panel()).toContain(T.learn.correct);
    expect(arrows()).toEqual([]);
    wait(FEEDBACK_MS);
    expect(lastWith('fen')).toBe(fenOf(AFTER_D5));
    expect(lastWith('lastMove')).toEqual(['d7', 'd5']);
    expect(lastWith('movable')?.dests?.size ?? 0).toBe(0);
    wait(150);
    expect(lastWith('movable')?.dests?.size ?? 0).toBeGreaterThan(0);
    expect(arrows()).toEqual(['c1f4']);
    expect(panel()).toContain('1. d4 d5');
    expect(recorded).toEqual([]);
  });

  it('refuses a move typed during the correct flash, the first move still shown right', () => {
    renderDrill();
    type('d4');
    type('Bf4');
    expect(panel()).toContain(T.learn.correct);
    expect(recorded).toEqual([]);
    expect(screen.getByLabelText<HTMLInputElement>(MOVE_INPUT).value).toBe(
      'Bf4',
    );
    expect(lastWith('lastMove')).toEqual(['d2', 'd4']);
  });

  it('takes a move typed while the reply still slides in (#324)', () => {
    renderDrill();
    type('d4');
    wait(FEEDBACK_MS);
    type('Bf4');
    expect(panel()).toContain(T.learn.correct);
    expect(screen.getByLabelText<HTMLInputElement>(MOVE_INPUT).value).toBe('');
    expect(lastWith('lastMove')).toEqual(['c1', 'f4']);
  });

  it('holds a wrong move for its flash, then puts it back and keeps the arrow, recording nothing (#381)', () => {
    renderDrill();
    type('e4');
    expect(lastWith('fen')).toBe(fenOf(AFTER_E4));
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.wrong);
    // The panel names the side asked, not the held board's (#381).
    expect(panel()).toContain(T.drill.toMove.white);
    expect(panel()).not.toContain(T.drill.toMove.black);
    type('d4');
    expect(panel()).not.toContain(T.learn.correct);
    wait(FEEDBACK_MS - 1);
    expect(lastWith('fen')).toBe(fenOf(AFTER_E4));
    wait(1);
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(arrows()).toEqual(['d2d4']);
    expect(recorded).toEqual([]);
  });

  it('plays a known move without an arrow and records nothing for it', () => {
    renderDrill(data({ tracked: [D4] }));
    expect(counter()).toBe('0 / 1');
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.known);
    miss('e4');
    expect(arrows()).toEqual(['d2d4']);
    play('d4');
    expect(arrows()).toEqual(['c1f4']);
    play('Bf4');
    expect(arrows()).toEqual([]);
    play('d4');
    play('Bf4');
    wait(FEEDBACK_MS);
    expect(learnedKeys()).toEqual([BF4]);
  });

  it('takes a move played on the board', () => {
    renderDrill();
    act(() => {
      ground.handlers.after?.('d2', 'd4');
    });
    expect(panel()).toContain(T.learn.correct);
  });

  it('says a typed move that is not legal', () => {
    renderDrill();
    type('Ke5');
    expect(panel()).toContain(MESSAGES.board.moveInput.unknown);
  });
});

describe('the learn drill, blind round', () => {
  /** Plays the arrows round of the short line. */
  function arrowsRound(): void {
    play('d4');
    play('Bf4');
  }

  it('asks the line again from its start without arrows', () => {
    renderDrill();
    arrowsRound();
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.blind);
  });

  it('records each new move as learned once, as it is answered blind', () => {
    renderDrill();
    arrowsRound();
    play('d4');
    expect(recorded).toEqual([
      {
        resultId: '00000000-0000-4000-8000-000000000001',
        kind: 'learned',
        moveKey: D4,
        repertoireId: REP_ID,
        answeredAt: NOW,
      },
    ]);
    expect(counter()).toBe('1 / 2');
    play('Bf4');
    expect(learnedKeys()).toEqual([D4, BF4]);
  });

  it('shows the arrow after a wrong move; the arrow move then asks it blind again', () => {
    renderDrill();
    arrowsRound();
    miss('e4');
    expect(arrows()).toEqual(['d2d4']);
    expect(panel()).toContain(T.learn.wrong);
    play('d4');
    expect(recorded).toEqual([]);
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.blind);
    play('d4');
    expect(learnedKeys()).toEqual([D4]);
  });

  it('ends at any time, the moves learned already recorded', () => {
    renderDrill();
    arrowsRound();
    play('d4');
    const end = screen.getByRole('link', { name: T.drill.end });
    expect(end.getAttribute('href')).toBe('/repertoires/x');
    expect(learnedKeys()).toEqual([D4]);
  });
});

describe('the learn drill’s done summary', () => {
  it('shows the moves learned and the progress, with no way to learn more today', () => {
    renderDrill(
      data({ settings: { sessionSize: 20, newPerDay: 1, learnArrows: true } }),
    );
    expect(counter()).toBe('0 / 1');
    play('d4');
    play('d4');
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByRole('main').dataset['finished']).toBe('yes');
    // No context line on Done (docs/design/training-screen.md).
    expect(
      screen.getByRole('heading', { level: 1, name: 'no item' }),
    ).toBeDefined();
    expect(screen.getByText(/^1 learned · 0 due · 1 to learn/)).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    expect(screen.queryByRole('link', { name: T.done.learn })).toBeNull();
    const done = screen.getByRole('link', { name: T.done.done });
    expect(done.getAttribute('href')).toBe('/repertoires/x');
    // In the bottom bar, not the panel.
    expect(done.closest('footer')).not.toBeNull();
    // Nothing is due: no way on to review.
    expect(screen.queryByRole('link', { name: T.done.review })).toBeNull();
  });

  it('leads on to review when moves are due (R-62)', () => {
    renderDrill(
      data({
        settings: { sessionSize: 20, newPerDay: 1, learnArrows: true },
        reviews: [startReview(BF4, new Date(NOW.getTime() - DAY))],
        tracked: [BF4],
      }),
    );
    play('d4');
    play('d4');
    expect(screen.getByText('1 more move is due.')).toBeDefined();
    const review = screen.getByRole('link', { name: T.done.review });
    expect(review.getAttribute('href')).toBe(
      `/training?mode=review&r=${REP_ID}`,
    );
    expect(review.closest('footer')).not.toBeNull();
  });
});

/**
 * The smallest plan with two lines that share a move: 1. d4 is in both, so
 * recording it once per key is shown, and the second line starts where the
 * first one branched.
 */
const TWO_LINES = graphOf('1. d4 d5 (1... Nf6 2. Bf4) 2. c4 *');

describe('the learn drill over a whole plan', () => {
  it('teaches every line of the plan in turn and records each new move once', () => {
    const d = data({
      entries: [
        {
          id: REP_ID,
          name: 'Londono sistema',
          side: 'white',
          kind: 'own',
          active: true,
          chapterTitles: {},
          graph: TWO_LINES,
        },
      ],
    });
    const lines = learnLines(dayOf(d));
    expect(lines).toHaveLength(2);
    expect(newKeys(lines)).toHaveLength(3);
    renderDrill(d);
    /** One round of `steps`: the replies play themselves. */
    const round = (steps: (typeof lines)[number]['steps']) => {
      for (const step of steps)
        if (step.kind === 'opponent') wait(150);
        else play(step.move.san);
    };
    for (const [at, line] of lines.entries()) {
      expect(lastWith('fen')).toBe(fenOf(line.rootKey));
      round(line.steps);
      round(line.steps);
      expect(learnedKeys()).toEqual(newKeys(lines.slice(0, at + 1)));
    }
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(counter()).toBe(
      `${String(newKeys(lines).length)} / ${String(newKeys(lines).length)}`,
    );
  });
});

describe('the learn drill in a Black repertoire', () => {
  it('plays the opponent’s first move itself, from Black, before asking', () => {
    renderDrill(
      data({
        entries: [
          {
            id: REP_ID,
            name: 'Taimanovo variantas',
            side: 'black',
            kind: 'assigned',
            coachName: 'Ona',
            active: true,
            chapterTitles: {},
            graph: graphOf(TAIMANOV, 'black'),
          },
        ],
      }),
    );
    expect(lastWith('orientation')).toBe('black');
    expect(lastWith('lastMove')).toEqual(['e2', 'e4']);
    wait(150);
    expect(arrows()).toEqual(['c7c5']);
    expect(panel()).toContain(MESSAGES.training.drill.toMove.black);
    type('c5');
    expect(panel()).toContain(T.learn.correct);
  });
});

describe('the learn drill and coach notes (#322, R-174)', () => {
  /** The coach's line: a note on 1. d4 and none on 2. Bf4. */
  const NOTED = graphOf('1. d4 { Take the centre first. } d5 2. Bf4 *');
  const noted = (kind: 'assigned' | 'own') =>
    data({
      entries: [
        {
          id: REP_ID,
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

  it('shows the coach’s note with the move where the arrow teaches it', () => {
    renderDrill(noted('assigned'));
    expect(arrows()).toEqual(['d2d4']);
    // Named with the assigning coach (R-107, #338).
    expect(note()).toBe(
      `${MESSAGES.coachNote.byCoach.replace('{name}', 'Rasa')}Take the centre first.`,
    );
    play('d4');
    // 2. Bf4 has no note.
    expect(arrows()).toEqual(['c1f4']);
    expect(note()).toBeNull();
  });

  it('keeps the note out of the blind retest, so it gives nothing away', () => {
    renderDrill(noted('assigned'));
    play('d4');
    play('Bf4');
    expect(panel()).toContain(T.learn.blind);
    expect(note()).toBeNull();
    // A wrong move goes back to the arrow, where the move is taught again.
    miss('e4');
    expect(arrows()).toEqual(['d2d4']);
    expect(note()).toContain('Take the centre first.');
  });

  it('shows no coach note for a comment on the player’s own repertoire', () => {
    renderDrill(noted('own'));
    expect(arrows()).toEqual(['d2d4']);
    expect(note()).toBeNull();
  });

  it('shows a coach’s note on the player’s own repertoire, named, with the move (R-107, R-174)', () => {
    renderDrill({
      ...noted('own'),
      coachNotes: [
        {
          repertoireId: REP_ID,
          moveKey: D4,
          coachName: 'Ona',
          text: 'Mine.',
          source: 'fork',
        },
      ],
    });
    expect(arrows()).toEqual(['d2d4']);
    expect(note()).toBe(
      `${MESSAGES.coachNote.byCoach.replace('{name}', 'Ona')}Mine.`,
    );
    play('d4');
    expect(note()).toBeNull();
  });
});

describe('the two-answers notice in learn (R-54, #330 decision 4)', () => {
  const OTHER = {
    id: '0b9e7c1e-3f4a-4c5b-8d6e-7f8091a2b3c4',
    name: 'Anglų pradžia',
    side: 'white' as const,
    graph: graphOf('1. c4 *'),
  };
  const sentence = T.twoAnswers.other
    .replace('{name}', OTHER.name)
    .replace('{move}', 'c4');
  const notice = () => screen.queryByRole('note')?.textContent ?? null;
  const next = () => screen.queryByRole('button', { name: T.drill.next });

  it('shows on the new move’s step, with its arrow, in one sentence', () => {
    renderDrill(data({ others: [OTHER] }));
    expect(arrows()).toEqual(['d2d4']);
    expect(notice()).toBe(sentence);
  });

  it('is not shown on the blind ask, nor on a move no other repertoire answers', () => {
    renderDrill(data({ others: [OTHER] }));
    play('d4');
    expect(notice()).toBeNull();
    play('Bf4');
    expect(panel()).toContain(T.learn.blind);
    expect(notice()).toBeNull();
  });

  it('with arrows off, shows only once the blind move is answered, and holds it until Next', () => {
    renderDrill(
      data({
        others: [OTHER],
        settings: { sessionSize: 20, newPerDay: 10, learnArrows: false },
      }),
    );
    expect(notice()).toBeNull();
    type('d4');
    wait(2000);
    expect(notice()).toBe(sentence);
    const button = next();
    if (button === null) throw new Error('Next holds the drill');
    fireEvent.click(button);
    wait(150);
    expect(notice()).toBeNull();
    expect(panel()).toContain(T.learn.recall);
  });
});

describe('the learn drill with arrows off (R-205, #330 decision 1)', () => {
  const noArrows = (overrides: Partial<TrainingData> = {}) =>
    data({
      settings: { sessionSize: 20, newPerDay: 10, learnArrows: false },
      ...overrides,
    });

  it('asks the first new move without its arrow', () => {
    renderDrill(noArrows());
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.recall);
  });

  it('records a move learned at its first right answer, and asks the next one blind', () => {
    renderDrill(noArrows());
    play('d4');
    expect(recorded.map((r) => [r.kind, r.moveKey])).toEqual([['learned', D4]]);
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.recall);
    play('Bf4');
    expect(learnedKeys()).toEqual([D4, BF4]);
    expect(screen.getByRole('main').dataset['finished']).toBe('yes');
  });

  it('shows the arrow after a wrong move, as after a lapse (R-59)', () => {
    renderDrill(noArrows());
    type('e4');
    wait(FEEDBACK_MS);
    expect(arrows()).toEqual(['d2d4']);
    expect(panel()).toContain(T.learn.wrong);
    expect(recorded).toEqual([]);
  });

  describe('and coach notes (lead answer 3: as in a review, R-174)', () => {
    const NOTED = graphOf('1. d4 { Take the centre first. } d5 2. Bf4 *');
    const noted = () =>
      noArrows({
        entries: [
          {
            id: REP_ID,
            name: 'Trenerio Londonas',
            side: 'white',
            kind: 'assigned',
            coachName: 'Rasa',
            active: true,
            chapterTitles: {},
            graph: NOTED,
          },
        ],
      });
    const note = () =>
      screen.queryByRole('note', { name: T.drill.coachNote })?.textContent ??
      null;
    const next = () =>
      screen.queryByRole('button', { name: T.drill.next }) ?? null;

    it('keeps the note back until the move is answered, then holds the drill on it', () => {
      renderDrill(noted());
      expect(note()).toBeNull();
      type('d4');
      expect(note()).toContain('Take the centre first.');
      expect(recorded.map((r) => r.moveKey)).toEqual([D4]);
      // Held while the note is read: no flash timer moves on.
      wait(2000);
      expect(note()).toContain('Take the centre first.');
      // Only the note and Next count meanwhile, as in a review.
      expect(screen.queryByLabelText(MOVE_INPUT)).toBeNull();
      const button = next();
      if (button === null) throw new Error('Next holds the drill');
      fireEvent.click(button);
      wait(150);
      expect(note()).toBeNull();
      expect(next()).toBeNull();
      expect(panel()).toContain(T.learn.recall);
    });

    it('moves on by itself after a right answer to a move with no note', () => {
      renderDrill(noted());
      type('d4');
      const button = next();
      if (button === null) throw new Error('Next holds the drill');
      fireEvent.click(button);
      wait(150);
      type('Bf4');
      expect(next()).toBeNull();
      wait(FEEDBACK_MS);
      expect(screen.getByRole('main').dataset['finished']).toBe('yes');
    });

    it('shows the note with the arrow a wrong answer brings', () => {
      renderDrill(noted());
      miss('e4');
      expect(arrows()).toEqual(['d2d4']);
      expect(note()).toContain('Take the centre first.');
    });
  });
});
