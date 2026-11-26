import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { moveKey, START_KEY, type RepertoireGraph } from '@mychess/chess';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outOfOrder } from '../../../test/dom-order';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { RepertoireShell, useBrowseView } from '.';
import type { RepertoireTraining } from '../../server/training';
import { pageTraining } from './test-training';

const ground = vi.hoisted(() => {
  const created: Config[] = [];
  return { created };
});

vi.mock('@lichess-org/chessground', () => ({
  Chessground: (_element: HTMLElement, config: Config) => {
    ground.created.push(config);
    return {
      set: vi.fn(),
      setShapes: vi.fn(),
      selectSquare: vi.fn(),
      destroy: vi.fn(),
      state: { drawable: { current: undefined } },
    };
  },
}));

const r = MESSAGES.repertoires;
const D4 = moveKey(START_KEY, 'd4');
const NOTE_LABEL = 'Coach note';
const CHANGES = 'Du nauji ėjimai';
const PREFACE = 'Tik skaityti';

interface ViewOptions {
  readonly graph?: RepertoireGraph;
  readonly said?: string;
  readonly onSquare?: (square: Key) => void;
  readonly byMove?: Readonly<Record<string, string>>;
  readonly kept?: ReadonlySet<string>;
  readonly training?: RepertoireTraining;
}

/** A read-only view built on the module, as a third view would build it. */
function View({
  graph = graphOf(LONDON),
  said,
  onSquare = vi.fn(),
  byMove = {},
  kept = new Set(),
  training,
}: ViewOptions): JSX.Element {
  const view = useBrowseView(graph, 'white');
  return (
    <RepertoireShell
      topBar={<h1>Londono sistema</h1>}
      name="Londono sistema"
      names={{ taxonomyNames: {}, distinctions: {} }}
      view={view}
      toolbar={<p>Įrankiai</p>}
      panel={{
        summary: {
          line: <p>Baltieji · 2 skyriai</p>,
          changes: <p>{CHANGES}</p>,
        },
        empty: <p>Skyrių nėra</p>,
        comment: { label: NOTE_LABEL },
        notes: {
          byMove,
          kind: 'coach',
          kept,
          preface: <p>{PREFACE}</p>,
          render: (key) => (
            <p>{key === D4 ? 'Pastaba apie d4' : 'Kita pastaba'}</p>
          ),
        },
        training,
      }}
      {...(said === undefined
        ? {}
        : {
            drawing: {
              said,
              onSquare,
              onShapes: vi.fn(),
              onEscape: vi.fn(),
            },
          })}
    />
  );
}

function renderView(options: ViewOptions = {}): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <View {...options} />
    </NextIntlClientProvider>,
  );
}

const forward = () => {
  fireEvent.click(screen.getByRole('button', { name: r.nav.forward }));
};

const firstMove = (name = `1. d4, ${r.moves.hasComment}`) =>
  screen.getByRole('button', { name });

beforeEach(() => {
  ground.created.length = 0;
});

describe('RepertoireShell', () => {
  it('lays the top bar, the board, the toolbar and the panel out in one main landmark', () => {
    renderView();
    const main = within(screen.getByRole('main'));
    expect(
      main.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(
      main.getByRole('application', { name: /Londono sistema/ }),
    ).toBeDefined();
    expect(main.getByText('Įrankiai')).toBeDefined();
    expect(main.getByRole('button', { name: r.nav.back })).toBeDefined();
  });

  it('puts the top bar once, over the board on a phone and first in the panel column on a desktop (spec, Header)', () => {
    renderView();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(outOfOrder([heading, screen.getByRole('application')])).toEqual([]);
    // The grid places it in the panel's column, in the row above the panel.
    const bar = heading.parentElement;
    expect(bar?.className).toContain('lg:col-start-2');
    expect(bar?.className).toContain('lg:row-start-1');
  });

  it('sizes the desktop board to the viewport: at 1280x800 at least 640px, never wider than the room beside the panel (finding 7)', () => {
    renderView();
    const frame = screen.getByRole('application').closest('.lg\\:sticky');
    expect(frame?.className).toContain(
      'lg:w-[min(calc(100dvh-3rem-var(--shell-chrome,0px)),46rem,calc(100vw-var(--spacing-panel)-6rem))]',
    );
  });

  it('puts the comment strip under the board row, before the scrolling panel (spec, Comment strip)', () => {
    renderView();
    const strip = screen.getByRole('region', { name: r.panel.intro });
    expect(
      outOfOrder([
        screen.getByRole('button', { name: r.nav.forward }),
        strip,
        screen.getByText(CHANGES),
      ]),
    ).toEqual([]);
  });

  it('keeps the one strip in its DOM place at every width, above the scroller, so Tab follows what is seen (sign-off)', () => {
    renderView();
    const strips = screen.getAllByRole('region', { name: r.panel.intro });
    expect(strips).toHaveLength(1);
    const strip = strips[0] ?? document.body;
    const scroller = document.querySelector('[data-panel-scroller]');
    const moves = document.querySelector<HTMLElement>('[data-moves]');
    if (scroller === null || moves === null) throw new Error('no panel');
    expect(strip.nextElementSibling).toBe(scroller);
    // No CSS reorders the panel: the scroller is a box at every width.
    expect(scroller.className).not.toContain('contents');
    for (const node of [strip, moves, ...scroller.querySelectorAll('*')])
      expect(node.getAttribute('class') ?? '').not.toMatch(/(^|\s)lg:order-/);
  });

  it('keeps one row above the board: the summary is first in the panel’s scroller, before the changes and the chapter line (sign-off)', () => {
    renderView();
    const summary = screen.getByText('Baltieji · 2 skyriai');
    const scroller = document.querySelector('[data-panel-scroller]');
    expect(scroller?.firstElementChild).toBe(summary);
    expect(
      outOfOrder([
        screen.getByRole('application'),
        summary,
        screen.getByText(CHANGES),
        screen.getByRole('button', { expanded: false }),
      ]),
    ).toEqual([]);
  });

  it('gives the phone board the height first: a shrinking cell, the largest square in it (spec, Board height)', () => {
    renderView();
    const cell = screen.getByRole('application').closest('.lg\\:sticky');
    const cellClass = cell?.className ?? '';
    for (const name of [
      'grow-0',
      'shrink-[100]',
      'basis-[100vw]',
      'min-h-28',
      'justify-center',
      '[container-type:size]',
      'lg:basis-auto',
      'lg:[container-type:normal]',
    ])
      expect(cellClass).toContain(name);
    expect(cellClass).not.toMatch(/(^|\s)shrink-0(\s|$)/u);
    const square = cell?.firstElementChild;
    expect(square?.className).toContain('w-[min(100cqw,100cqh)]');
    expect(square?.className).toContain('lg:w-full');
    expect(square?.contains(screen.getByRole('application'))).toBe(true);
  });

  it('keeps the board row, the strip and the scroller in one panel cell that holds its room, so stepping never resizes the board', () => {
    renderView();
    const scroller = document.querySelector('[data-panel-scroller]');
    const cell = scroller?.parentElement;
    expect(cell?.className).toContain('flex-[1_1_16.5rem]');
    expect(cell?.className).toContain('min-h-0');
    const forward = screen.getByRole('button', { name: r.nav.forward });
    expect(cell?.contains(forward)).toBe(true);
    expect(
      cell?.contains(screen.getByRole('region', { name: r.panel.intro })),
    ).toBe(true);
    expect(cell?.contains(screen.getByText('Įrankiai'))).toBe(true);
    for (const name of ['gap-3', 'pt-2', 'pb-3', 'lg:gap-4', 'lg:p-0'])
      expect(scroller?.className).toContain(name);
  });

  it('opens browsing at the chapter root with its intro, and no notes there', () => {
    renderView();
    expect(
      within(screen.getByRole('region', { name: r.panel.intro })).getByText(
        'The London',
      ),
    ).toBeDefined();
    expect(screen.queryByText('Pastaba apie d4')).toBeNull();
  });

  it('shows the move and its comment in the strip, named by the view’s label, and the view’s notes in the panel', () => {
    renderView();
    forward();
    const strip = within(screen.getByRole('region', { name: NOTE_LABEL }));
    expect(strip.getByText('1. d4')).toBeDefined();
    expect(strip.getByText('Solid')).toBeDefined();
    expect(strip.queryByText('Pastaba apie d4')).toBeNull();
    expect(
      outOfOrder([
        screen.getByRole('region', { name: NOTE_LABEL }),
        screen.getByText('Pastaba apie d4'),
      ]),
    ).toEqual([]);
    expect(screen.getByText('Arrows: c1 to f4, green')).toBeDefined();
    forward();
    expect(screen.queryByRole('region', { name: NOTE_LABEL })).toBeNull();
    expect(screen.getByText('Kita pastaba')).toBeDefined();
  });

  it('takes no new move while browsing: a move the chapter lacks is refused', () => {
    renderView();
    const field = screen.getByLabelText<HTMLInputElement>(
      MESSAGES.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'e4' } });
    fireEvent.submit(field);
    expect(screen.getByText(r.board.notInRepertoire)).toBeDefined();
    expect(screen.getByRole('region', { name: r.panel.intro })).toBeDefined();
  });

  it('says what drawing did when the view draws', () => {
    renderView({ said: 'Rodyklė nupiešta' });
    expect(screen.getByText('Rodyklė nupiešta')).toBeDefined();
  });

  it('passes the drawing handlers to the board', () => {
    const onSquare = vi.fn<(square: Key) => void>();
    renderView({ said: '', onSquare });
    act(() => {
      ground.created.at(-1)?.events?.select?.('e4');
    });
    expect(onSquare).toHaveBeenCalledWith('e4');
  });
});

describe('the panel', () => {
  it('shows the strip, then the summary line, the changes, the chapters, the moves, the notes’ preface and the move’s notes in that order', () => {
    renderView();
    forward();
    expect(
      outOfOrder([
        screen.getByRole('region', { name: NOTE_LABEL }),
        screen.getByText('Baltieji · 2 skyriai'),
        screen.getByText(CHANGES),
        screen.getByRole('button', { expanded: false }),
        firstMove(),
        screen.getByText(PREFACE),
        screen.getByText('Pastaba apie d4'),
      ]),
    ).toEqual([]);
  });

  it('marks the moves carrying the view’s notes with their kind', () => {
    renderView({ byMove: { [D4]: 'Pirmiau Nf3' } });
    expect(
      firstMove(`1. d4, ${r.moves.hasComment}, ${r.moves.hasCoachNote}`),
    ).toBeDefined();
  });

  it('marks the moves carrying a kept coach note too', () => {
    renderView({ kept: new Set([D4]) });
    expect(
      firstMove(`1. d4, ${r.moves.hasComment}, ${r.moves.hasKeptCoachNote}`),
    ).toBeDefined();
  });

  it('shows the notes’ preface after the empty state in a repertoire without chapters', () => {
    renderView({ graph: { side: 'white', chapters: [], moves: [] } });
    expect(
      outOfOrder([screen.getByText('Skyrių nėra'), screen.getByText(PREFACE)]),
    ).toEqual([]);
  });

  it('puts Train here, then the move’s notes, under the move list', () => {
    renderView({ training: pageTraining({}) });
    forward();
    const trainHere = screen.getByRole('region', {
      name: MESSAGES.training.know.section,
    });
    const moves = document.querySelector('[data-moves]');
    const note = screen.getByText('Pastaba apie d4');
    if (moves === null) throw new Error('no move list');
    expect(outOfOrder([moves, trainHere, note])).toEqual([]);
    expect(
      within(trainHere).getByRole('button', {
        name: MESSAGES.training.know.iKnowThis,
      }),
    ).toBeDefined();
  });

  it('has no Train here for a viewer who does not train it', () => {
    renderView();
    expect(
      screen.queryByRole('region', { name: MESSAGES.training.know.section }),
    ).toBeNull();
  });

  it('shows the view’s empty state and no moves in a repertoire without chapters', () => {
    renderView({ graph: { side: 'white', chapters: [], moves: [] } });
    expect(screen.getByText('Skyrių nėra')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^1\. d4/ })).toBeNull();
  });
});
