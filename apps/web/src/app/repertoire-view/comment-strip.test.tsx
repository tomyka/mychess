import {
  START_KEY,
  type RepertoireGraph,
  type RepertoireMove,
} from '@mychess/chess';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, TAIMANOV } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { CommentStrip, type CommentStripProps } from './comment-strip';

const p = MESSAGES.repertoires.panel;
const TAIMANOV_GRAPH = graphOf(TAIMANOV, 'black');

/**
 * jsdom lays nothing out: each test says whether the text runs past its
 * two lines (its scroll height over its client height), and the resize
 * observers the strip watches with are kept to call by hand.
 */
const layout = {
  overflowing: false,
  observers: new Set<() => void>(),
};

class FakeResizeObserver {
  readonly #callback: () => void;
  constructor(callback: () => void) {
    this.#callback = callback;
  }
  observe(): void {
    layout.observers.add(this.#callback);
  }
  disconnect(): void {
    layout.observers.delete(this.#callback);
  }
}

beforeEach(() => {
  layout.overflowing = false;
  layout.observers.clear();
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    () => (layout.overflowing ? 60 : 40),
  );
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The moves `sans` play from the start, as the repertoire holds them. */
function pathOf(
  graph: RepertoireGraph,
  sans: readonly string[],
): RepertoireMove[] {
  const path: RepertoireMove[] = [];
  let key = START_KEY;
  for (const san of sans) {
    const move = graph.moves.find((m) => m.from === key && m.san === san);
    if (move === undefined) throw new Error(`no ${san}`);
    path.push(move);
    key = move.to;
  }
  return path;
}

const TO_A6 = ['e4', 'c5', 'Nf3', 'e6', 'd4', 'cxd4', 'Nxd4', 'Nc6'];
const MAIN = [...TO_A6, 'Nc3', 'Qc7', 'Be3', 'a6'];

const chapterOfGraph = (graph: RepertoireGraph, intro: string | null) => {
  const [chapter] = graph.chapters;
  if (chapter === undefined) throw new Error('no chapter');
  return { ...chapter, intro };
};

function renderStrip(over: Partial<CommentStripProps> = {}) {
  const props: CommentStripProps = {
    graph: TAIMANOV_GRAPH,
    chapter: chapterOfGraph(TAIMANOV_GRAPH, 'Black plays ...e6 and ...Nc6.'),
    path: [],
    ...over,
  };
  const view = render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <CommentStrip {...props} />
    </NextIntlClientProvider>,
  );
  return {
    unmount: view.unmount,
    rerender: (next: Partial<CommentStripProps>) => {
      view.rerender(
        <NextIntlClientProvider locale="en" messages={MESSAGES}>
          <CommentStrip {...props} {...next} />
        </NextIntlClientProvider>,
      );
    },
  };
}

/** `move` with `comment` in place of its own. */
const commented = (move: RepertoireMove, comment: string): RepertoireMove => ({
  ...move,
  comment,
});

const LONG = `${'Keep the queen on c7 and the bishop on e7. '.repeat(4)}Then castle.`;

describe('CommentStrip', () => {
  it('shows the current move, numbered and bold, then its comment, named Comment', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    const strip = within(screen.getByRole('region', { name: p.comment }));
    expect(strip.getByText('6... a6').tagName).toBe('STRONG');
    expect(strip.getByText('Flexible')).toBeDefined();
  });

  it('is named after the view’s label (a coach’s comment is a Coach note)', () => {
    renderStrip({
      path: pathOf(TAIMANOV_GRAPH, MAIN),
      label: 'Coach note by Rimantas V.',
    });
    expect(
      within(
        screen.getByRole('region', { name: 'Coach note by Rimantas V.' }),
      ).getByText('Flexible'),
    ).toBeDefined();
  });

  it('shows the view’s label as a muted lead-in, not counted toward the clamp', () => {
    const label = 'Coach note by Rimantas V.';
    const path = pathOf(TAIMANOV_GRAPH, MAIN);
    renderStrip({ path, label });
    const lead = screen.getByText(label);
    expect(lead.className).toContain('text-fg-muted');
    expect(lead.className).toContain('text-xs');
    expect(
      lead.compareDocumentPosition(screen.getByText('6... a6')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no label in the owner’s view, and is still named Comment from the catalogue', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN), label: undefined });
    expect(screen.queryByText(p.comment)).toBeNull();
    const strip = screen.getByRole('region');
    expect(strip.getAttribute('aria-label')).toBe(p.comment);
    expect(within(strip).getByText('Flexible')).toBeDefined();
  });

  it('stays in its DOM place at every width: no flex order moves it (spec, Comment strip)', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(screen.getByRole('region').className).not.toMatch(
      /(^|\s)(lg:)?order-/,
    );
  });

  it('has a 2px accent left edge in the dark theme only, where accent-subtle is close to the page (sign-off)', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    const { className } = screen.getByRole('region');
    expect(className).toContain('border-l-2');
    // comment-edge: transparent in light, accent in dark (tokens.css).
    expect(className).toContain('border-l-comment-edge');
  });

  it('shows the chapter intro at the root, named Chapter intro', () => {
    renderStrip();
    expect(
      within(screen.getByRole('region', { name: p.intro })).getByText(
        'Black plays ...e6 and ...Nc6.',
      ),
    ).toBeDefined();
  });

  it('shows nothing on a move without a comment, or at a root without an intro', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, [...TO_A6, 'Nc3', 'Qc7']) });
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('5... Qc7')).toBeNull();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        <CommentStrip
          graph={TAIMANOV_GRAPH}
          chapter={chapterOfGraph(TAIMANOV_GRAPH, null)}
          path={[]}
        />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });

  it('shows a comment that fits in two lines without More', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives no More to a long comment that still fits in two lines (a wide strip)', () => {
    const path = pathOf(TAIMANOV_GRAPH, MAIN);
    const last = path.at(-1);
    if (last === undefined) throw new Error('no move');
    renderStrip({ path: [...path.slice(0, -1), commented(last, LONG)] });
    expect(screen.getByText(LONG).closest('p')?.className).toContain(
      'line-clamp-2',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('gives More to a short comment that runs past two lines (a narrow strip)', () => {
    layout.overflowing = true;
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(screen.getByRole('button', { name: p.more })).toBeDefined();
  });

  it('measures again when the strip is resized', () => {
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(screen.queryByRole('button')).toBeNull();
    layout.overflowing = true;
    act(() => {
      for (const resized of layout.observers) resized();
    });
    expect(screen.getByRole('button', { name: p.more })).toBeDefined();
  });

  it('measures once where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    layout.overflowing = true;
    renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(screen.getByRole('button', { name: p.more })).toBeDefined();
  });

  it('stops watching the size once gone', () => {
    const { unmount } = renderStrip({ path: pathOf(TAIMANOV_GRAPH, MAIN) });
    expect(layout.observers.size).toBe(1);
    unmount();
    expect(layout.observers.size).toBe(0);
  });

  it('clamps a comment past two lines with More, which expands it and says Less', () => {
    layout.overflowing = true;
    const path = pathOf(TAIMANOV_GRAPH, MAIN);
    const last = path.at(-1);
    if (last === undefined) throw new Error('no move');
    renderStrip({ path: [...path.slice(0, -1), commented(last, LONG)] });
    const text = () => screen.getByText(LONG).closest('p');
    expect(text()?.className).toContain('line-clamp-2');
    const more = screen.getByRole('button', { name: p.more });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(text()?.className).not.toContain('line-clamp-2');
    const less = screen.getByRole('button', { name: p.less });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(less);
    expect(text()?.className).toContain('line-clamp-2');
  });

  it('clamps again on a new move', () => {
    layout.overflowing = true;
    const path = pathOf(TAIMANOV_GRAPH, MAIN);
    const nc3 = path[8];
    const a6 = path[11];
    if (nc3 === undefined || a6 === undefined) throw new Error('no move');
    const first = [...path.slice(0, 8), commented(nc3, LONG)];
    const { rerender } = renderStrip({ path: first });
    fireEvent.click(screen.getByRole('button', { name: p.more }));
    rerender({
      path: [...path.slice(0, 11), commented(a6, `${LONG} Again.`)],
    });
    expect(
      screen.getByText(`${LONG} Again.`).closest('p')?.className,
    ).toContain('line-clamp-2');
    expect(
      screen
        .getByRole('button', { name: p.more })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
