import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { fenOf, moveKey, START_KEY } from '@mychess/chess';
import type { TrainingResult } from '@mychess/domain';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import type { TrainingData } from '../../lib/training-data';
import type { DrillClock } from './drill-input';
import type { FrameParts } from './drill';
import { LearnDrill } from './learn-drill';
import { learnLines, newKeys } from '../../lib/training-counts';

const T = MESSAGES.lt.training;
const MOVE_INPUT = MESSAGES.lt.board.moveInput.label;
const NOW = new Date('2026-10-25T08:00:00Z');
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
        graph: SHORT,
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

function renderDrill(d: TrainingData = data()) {
  return render(
    <NextIntlClientProvider
      locale="lt"
      messages={MESSAGES.lt}
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
        links={{ back: '/repertuarai/x', learn: '/treniruote?mode=learn' }}
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

/** Plays a right move and lets its flash, and any reply after it, run. */
function play(move: string): void {
  type(move);
  wait(400);
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

  it('holds a right move for its flash, then plays the reply itself, the board locked meanwhile', () => {
    renderDrill();
    type('d4');
    expect(panel()).toContain(T.learn.correct);
    expect(arrows()).toEqual([]);
    wait(400);
    expect(lastWith('fen')).toBe(fenOf(AFTER_D5));
    expect(lastWith('lastMove')).toEqual(['d7', 'd5']);
    type('Bf4');
    expect(panel()).not.toContain(T.learn.correct);
    wait(150);
    expect(arrows()).toEqual(['c1f4']);
    expect(panel()).toContain('1. d4 d5');
    expect(recorded).toEqual([]);
  });

  it('puts a wrong move back and keeps the arrow, recording nothing', () => {
    renderDrill();
    type('e4');
    expect(lastWith('fen')).toBe(fenOf(START_KEY));
    expect(arrows()).toEqual(['d2d4']);
    expect(panel()).toContain(T.learn.wrong);
    expect(recorded).toEqual([]);
  });

  it('plays a known move without an arrow and records nothing for it', () => {
    renderDrill(data({ learned: [D4] }));
    expect(counter()).toBe('0 / 1');
    expect(arrows()).toEqual([]);
    expect(panel()).toContain(T.learn.known);
    type('e4');
    expect(arrows()).toEqual(['d2d4']);
    play('d4');
    expect(arrows()).toEqual(['c1f4']);
    play('Bf4');
    expect(arrows()).toEqual([]);
    play('d4');
    play('Bf4');
    wait(400);
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
    expect(panel()).toContain(MESSAGES.lt.board.moveInput.unknown);
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
    type('e4');
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
    expect(end.getAttribute('href')).toBe('/repertuarai/x');
    expect(learnedKeys()).toEqual([D4]);
  });
});

describe('the learn drill’s done summary', () => {
  it('shows the moves learned and the progress, with no way to learn more today', () => {
    renderDrill(data({ settings: { sessionSize: 20, newPerDay: 1 } }));
    expect(counter()).toBe('0 / 1');
    play('d4');
    play('d4');
    expect(screen.getByRole('heading', { name: T.done.title })).toBeDefined();
    expect(screen.getByRole('main').dataset['finished']).toBe('yes');
    expect(screen.getByText(/^1 išmokta · 0 kartotinų · 1 liko/)).toBeDefined();
    expect(screen.queryByRole('button', { name: T.done.continue })).toBeNull();
    expect(screen.queryByRole('link', { name: T.done.learn })).toBeNull();
    expect(
      screen.getByRole('link', { name: T.done.done }).getAttribute('href'),
    ).toBe('/repertuarai/x');
  });
});

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
          graph: graphOf(LONDON),
        },
      ],
    });
    const lines = learnLines(d);
    expect(lines.length).toBeGreaterThan(1);
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
            active: true,
            graph: graphOf(TAIMANOV, 'black'),
          },
        ],
      }),
    );
    expect(lastWith('orientation')).toBe('black');
    expect(lastWith('lastMove')).toEqual(['e2', 'e4']);
    type('c5');
    expect(panel()).not.toContain(T.learn.correct);
    wait(150);
    expect(arrows()).toEqual(['c7c5']);
    expect(panel()).toContain(MESSAGES.lt.training.drill.toMove.black);
    type('c5');
    expect(panel()).toContain(T.learn.correct);
  });
});
