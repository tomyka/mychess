import { moveKey, type RepertoireMove } from '@mychess/chess';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { MoveList, type MoveListProps } from './move-list';

const LONDON_GRAPH = graphOf(LONDON);

function renderList(over: Partial<MoveListProps> = {}) {
  const onGoto = vi.fn<(path: readonly RepertoireMove[]) => void>();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <MoveList
        graph={LONDON_GRAPH}
        chapterId="c1"
        path={[]}
        notedMoves={{}}
        onGoto={onGoto}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return onGoto;
}

const chip = (name: string) => screen.getByRole('button', { name });
/** The move numbers and SANs in reading order, separated by spaces. */
const text = (element: Element | null) =>
  Array.from(
    element?.querySelectorAll('span.tabular-nums, button') ?? [],
    (part) => part.textContent,
  ).join(' ');

const list = () =>
  screen.getByRole('region', { name: MESSAGES.repertoires.moves.title });

/**
 * The list as the eye reads it: a numbered row as its cells ("6. … a6"),
 * a row of variations as its inline blocks, each in brackets.
 */
const rows = (): string[] =>
  Array.from(list().children, (row) =>
    row.hasAttribute('data-variations')
      ? Array.from(row.children, (block) => `(${text(block)})`).join(' ')
      : Array.from(row.children, (cell) => cell.textContent)
          .filter((cell) => cell !== '')
          .join(' '),
  );

/** The list's row `index`. */
function rowAt(index: number): HTMLElement {
  const row = list().children.item(index);
  if (!(row instanceof HTMLElement)) throw new Error(`no row ${String(index)}`);
  return row;
}

/** The SANs on the list's row `index`, in reading order. */
const rowSans = (index: number): (string | null)[] =>
  within(rowAt(index))
    .getAllByRole('button')
    .map((b) => b.textContent);

/** After 1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3: Black to move. */
const TAIMANOV_FEN =
  'r1bqkbnr/pp1p1ppp/2n1p3/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq - 2 5';

describe('MoveList', () => {
  it('shows the main line in numbered rows and the variation as its own block', () => {
    renderList();
    expect(rows()).toEqual([
      '1. d4 d5',
      '2. Bf4 Nf6',
      '3. e3 e6',
      '(3... c5 4. c3)',
      '4. Nf3',
    ]);
    expect(rowSans(0)).toEqual(['d4', 'd5']);
    const variation = chip('3... c5').closest('[data-variation]');
    expect(text(variation)).toBe('3... c5 4. c3');
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'd4',
      'd5',
      'Bf4',
      'Nf6',
      'e3',
      'e6',
      'c5',
      'c3',
      'Nf3',
    ]);
  });

  it('marks a move that transposes into a position the list already shows (#331)', () => {
    // 1... e6 2. c4 d5 reaches the position after 1... d5 2. c4 e6.
    renderList({
      graph: graphOf('1. d4 d5 (1... e6 2. c4 d5) 2. c4 e6 3. Nc3 *'),
    });
    const moves = MESSAGES.repertoires.moves;
    const transposing = chip(`2... d5, ${moves.transposes}`);
    expect(transposing.querySelector('[data-transposition]')).not.toBeNull();
    // A hover title says what the marker means (ux sign-off).
    expect(transposing.title).toBe(moves.transposesHint);
    expect(chip('3. Nc3').hasAttribute('title')).toBe(false);
    // A leaf that ends the line is not a transposition.
    expect(chip('3. Nc3').querySelector('[data-transposition]')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: new RegExp(moves.transposes) }),
    ).toHaveLength(1);
  });

  it('shows each move NAG glyphs after its SAN (R-175)', () => {
    renderList({
      graph: graphOf('1. d4 $1 d5 2. c4 $14 e6 $146 *'),
    });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'd4!',
      'd5',
      'c4 ⩲',
      'e6',
    ]);
    expect(chip('1. d4!')).toBeTruthy();
    expect(chip('2. c4 ⩲')).toBeTruthy();
  });

  it('goes to a move with the moves from the root', () => {
    const onGoto = renderList();
    fireEvent.click(chip('3... c5'));
    expect(onGoto.mock.lastCall?.[0].map((m) => m.san)).toEqual([
      'd4',
      'd5',
      'Bf4',
      'Nf6',
      'e3',
      'c5',
    ]);
  });

  it('marks the current move', () => {
    const d4 = LONDON_GRAPH.moves.find((m) => m.san === 'd4');
    renderList({ path: d4 === undefined ? [] : [d4] });
    expect(chip('1. d4, has a comment').getAttribute('aria-current')).toBe(
      'true',
    );
    expect(chip('1... d5').getAttribute('aria-current')).toBeNull();
  });

  it('names a move with a comment or a note, and weighs the side’s own moves', () => {
    const d5 = LONDON_GRAPH.moves.find((m) => m.san === 'd5');
    renderList({ notedMoves: { [moveKey(d5?.from ?? '', 'd5')]: 'Mine' } });
    expect(chip('1. d4, has a comment').className).toContain('font-semibold');
    expect(chip('1... d5, has my note').className).not.toContain(
      'font-semibold',
    );
  });

  it('marks a Personal note with a lock, and a coach’s own note with a pen', () => {
    const d5 = LONDON_GRAPH.moves.find((m) => m.san === 'd5');
    const notes = { [moveKey(d5?.from ?? '', 'd5')]: 'Mine' };
    renderList({ notedMoves: notes });
    expect(
      chip('1... d5, has my note').querySelector('[data-note="personal"]'),
    ).not.toBeNull();
    cleanup();
    renderList({ notedMoves: notes, noteKind: 'coach' });
    const coach = chip(`1... d5, ${MESSAGES.repertoires.moves.hasCoachNote}`);
    expect(coach.querySelector('[data-note="coach"]')).not.toBeNull();
    expect(coach.querySelector('[data-note="personal"]')).toBeNull();
  });

  it('marks a coach note a fork kept with a pen, next to the owner’s lock (R-47)', () => {
    const d5 = LONDON_GRAPH.moves.find((m) => m.san === 'd5');
    const d4 = LONDON_GRAPH.moves.find((m) => m.san === 'd4');
    const d5Key = moveKey(d5?.from ?? '', 'd5');
    renderList({
      notedMoves: { [d5Key]: 'Mine' },
      keptNoteMoves: new Set([d5Key, moveKey(d4?.from ?? '', 'd4')]),
    });
    const both = chip(
      `1... d5, has my note, ${MESSAGES.repertoires.moves.hasKeptCoachNote}`,
    );
    expect(
      Array.from(both.querySelectorAll('[data-note]'), (mark) =>
        mark.getAttribute('data-note'),
      ),
    ).toEqual(['personal', 'kept']);
    const kept = chip(
      `1. d4, has a comment, ${MESSAGES.repertoires.moves.hasKeptCoachNote}`,
    );
    expect(
      kept.querySelector('[data-note="kept"] path')?.getAttribute('d'),
    ).toBe(both.querySelector('[data-note="kept"] path')?.getAttribute('d'));
    expect(kept.querySelector('[data-note="personal"]')).toBeNull();
  });

  it('goes on with Black’s move under “…” after variations on White’s move', () => {
    renderList({ graph: graphOf(TAIMANOV, 'black'), chapterId: 'c1' });
    expect(rows()).toEqual([
      '1. e4 c5',
      '2. Nf3 e6',
      '3. d4 cxd4',
      '4. Nxd4 Nc6',
      '5. Nc3 Qc7',
      '6. Be3',
      '(6. Be2 a6 7. O-O 7. Be3 Nf6 7... Nf6) (6. g3 a6)',
      '6. … a6',
      '7. Qd2 Nf6',
    ]);
    // The nested variation is a block inside its parent's, inline.
    const nested = chip('7. Be3').closest('[data-variation]');
    expect(nested?.parentElement?.closest('[data-variation]')).toBe(
      chip('6. Be2').closest('[data-variation]'),
    );
    // The row after the variations holds Black's move alone, named with
    // its own number.
    expect(rowSans(7)).toEqual(['a6']);
    expect(
      within(rowAt(7)).getByRole('button', {
        name: '6... a6, has a comment',
      }),
    ).toBeDefined();
  });

  it('starts a chapter whose root has Black to move with an empty White cell', () => {
    renderList({
      graph: graphOf(
        `[FEN "${TAIMANOV_FEN}"]\n[SetUp "1"]\n\n5... Qc7 6. Be3 a6 *`,
        'black',
      ),
      chapterId: 'c1',
    });
    expect(rows()).toEqual(['1. … Qc7', '2. Be3 a6']);
    expect(rowSans(0)).toEqual(['Qc7']);
  });

  it('has touch-sized chips on a phone and compact ones on a desktop', () => {
    renderList();
    const { className } = chip('1... d5');
    expect(className).toContain('min-h-touch');
    expect(className).toContain('min-w-touch');
    expect(className).toContain('lg:min-h-7');
    expect(className).toContain('lg:min-w-0');
  });

  describe('bringing the current move into view (finding 8)', () => {
    /** A rect from `top` to `bottom`, the rest zero. */
    const rect = (top: number, bottom: number): DOMRect => ({
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    });

    /**
     * Renders the list in a 100px scroller scrolled to `scrollTop`, with
     * the current move's chip at `chipTop` (44px high) as the scroller sees
     * it. Between the list and the scroller sits a box that clips sideways
     * (overflow-x hidden makes its overflow-y compute to auto) but has
     * nothing to scroll; outside the scroller, an ancestor that clips and
     * scrolls too. The page never scrolls.
     */
    function renderScrolled(scrollTop: number, chipTop: number) {
      setScrollTop(scrollTop);
      stubHeight('scrollHeight');
      stubHeight('clientHeight');
      const pageScroll = vi.spyOn(window, 'scrollTo').mockReturnValue();
      const intoView = vi.fn();
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: intoView,
      });
      vi.spyOn(
        HTMLElement.prototype,
        'getBoundingClientRect',
      ).mockImplementation(function (this: HTMLElement) {
        if (this.dataset['testid'] === 'scroller') return rect(0, 100);
        if (this.getAttribute('aria-current') === 'true')
          return rect(chipTop, chipTop + 44);
        return rect(0, 0);
      });
      const d5 = LONDON_GRAPH.moves.find((m) => m.san === 'd5');
      const d4 = LONDON_GRAPH.moves.find((m) => m.san === 'd4');
      render(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <div
            data-testid="outer"
            data-scroll-height="2000"
            data-client-height="800"
            style={{ overflowX: 'hidden', overflowY: 'auto' }}
          >
            <div
              data-testid="scroller"
              data-scroll-height="400"
              data-client-height="100"
              style={{ overflowY: 'auto' }}
            >
              <div
                data-testid="clipper"
                style={{ overflowX: 'hidden', overflowY: 'auto' }}
              >
                <MoveList
                  graph={LONDON_GRAPH}
                  chapterId="c1"
                  path={d4 === undefined || d5 === undefined ? [] : [d4, d5]}
                  notedMoves={{}}
                  onGoto={vi.fn()}
                />
              </div>
            </div>
          </div>
        </NextIntlClientProvider>,
      );
      return {
        scroller: screen.getByTestId('scroller'),
        clipper: screen.getByTestId('clipper'),
        outer: screen.getByTestId('outer'),
        pageScroll,
        intoView,
      };
    }

    /** `scrollHeight` or `clientHeight` from the element's data, else 0. */
    function stubHeight(name: 'scrollHeight' | 'clientHeight'): void {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return Number(this.dataset[name] ?? 0);
        },
      });
    }

    function setScrollTop(scrollTop: number): void {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
        configurable: true,
        get(this: HTMLElement) {
          return Number(this.dataset['scrollTop'] ?? scrollTop);
        },
        set(this: HTMLElement, value: number) {
          this.dataset['scrollTop'] = String(value);
        },
      });
    }

    afterEach(() => {
      vi.restoreAllMocks();
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop');
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    });

    it('scrolls its scroller down to a move below it, and never the page', () => {
      const { scroller, pageScroll, intoView } = renderScrolled(0, 150);
      expect(scroller.scrollTop).toBe(94);
      expect(pageScroll).not.toHaveBeenCalled();
      expect(intoView).not.toHaveBeenCalled();
    });

    it('passes over a box that clips but has nothing to scroll, and leaves the ancestors outside alone', () => {
      const { scroller, clipper, outer } = renderScrolled(0, 150);
      expect(scroller.scrollTop).toBe(94);
      expect(clipper.scrollTop).toBe(0);
      expect(outer.scrollTop).toBe(0);
    });

    it('scrolls its scroller up to a move above it', () => {
      const { scroller } = renderScrolled(200, -50);
      expect(scroller.scrollTop).toBe(150);
    });

    it('leaves a move already in view where it is', () => {
      const { scroller } = renderScrolled(30, 20);
      expect(scroller.scrollTop).toBe(30);
    });
  });

  it('says when the chapter has no moves', () => {
    renderList({ chapterId: 'c9' });
    expect(screen.getByText(MESSAGES.repertoires.panel.noMoves)).toBeDefined();
  });

  it('asks for the first move of an empty chapter in builder mode', () => {
    renderList({ chapterId: 'c9', building: true });
    expect(
      screen.getByText(MESSAGES.repertoires.builder.playFirst),
    ).toBeDefined();
  });
});
