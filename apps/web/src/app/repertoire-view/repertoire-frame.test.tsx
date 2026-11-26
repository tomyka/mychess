import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RepertoireFrame } from './repertoire-frame';

/**
 * Each cell's content is a labelled paragraph, so the test finds the cell
 * the frame put it in. jsdom does not lay out, so the budget is asserted
 * through the classes that carry it; the measurements are the E2E suite's
 * and the slice's own (docs/design/repertoire-screen.md, Board height).
 */
function renderFrame(
  optional: { builderRow?: boolean; comment?: boolean; busy?: boolean } = {},
): HTMLElement {
  render(
    <RepertoireFrame
      busy={optional.busy}
      topBar={<p>top bar</p>}
      board={<p>board</p>}
      boardRow={<p>board row</p>}
      builderRow={optional.builderRow === true ? <p>builder row</p> : null}
      status={<p>status</p>}
      comment={optional.comment === true ? <p>comment</p> : null}
      scroller={<p>scroller</p>}
    >
      <p>live</p>
    </RepertoireFrame>,
  );
  return screen.getByRole('main');
}

const cellOf = (text: string): HTMLElement => {
  const cell = screen.getByText(text).parentElement;
  if (cell === null) throw new Error(`no cell for ${text}`);
  return cell;
};

const classesOf = (element: Element | null | undefined): readonly string[] =>
  (element?.getAttribute('class') ?? '').split(/\s+/u);

describe('RepertoireFrame', () => {
  it('is a fixed-height column on a phone and the two-column grid on a desktop', () => {
    const main = renderFrame();
    expect(classesOf(main)).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-col',
        'h-[calc(100dvh-var(--shell-chrome,0px))]',
        'lg:grid',
        'lg:h-auto',
        'lg:grid-cols-[auto_var(--spacing-panel)]',
        'lg:grid-rows-[auto_1fr]',
      ]),
    );
    expect(main.getAttribute('aria-busy')).toBeNull();
  });

  it('draws the desktop card first, behind the top bar and the panel', () => {
    const main = renderFrame();
    const card = main.firstElementChild;
    expect(card?.getAttribute('aria-hidden')).toBe('true');
    expect(classesOf(card)).toEqual(
      expect.arrayContaining([
        'hidden',
        'lg:block',
        'lg:col-start-2',
        'lg:row-span-2',
        'lg:bg-surface',
      ]),
    );
  });

  it('puts the top bar in one row over the board on a phone, the card’s first row on a desktop', () => {
    const main = renderFrame();
    const cell = cellOf('top bar');
    expect(cell.parentElement).toBe(main);
    expect(classesOf(cell)).toEqual(
      expect.arrayContaining([
        'shrink-0',
        'px-gutter',
        'py-1',
        'lg:col-start-2',
        'lg:row-start-1',
        'lg:px-4',
        'lg:pt-4',
        'lg:pb-3',
      ]),
    );
  });

  it('gives the phone board the height first: a shrinking size container, the largest square in it, sticky beside the panel on a desktop', () => {
    const main = renderFrame();
    const square = cellOf('board');
    expect(classesOf(square)).toEqual(
      expect.arrayContaining(['w-[min(100cqw,100cqh)]', 'lg:w-full']),
    );
    const cell = square.parentElement;
    expect(cell?.parentElement).toBe(main);
    expect(classesOf(cell)).toEqual(
      expect.arrayContaining([
        'grow-0',
        'shrink-[100]',
        'basis-[100vw]',
        'min-h-28',
        '[container-type:size]',
        'lg:sticky',
        'lg:row-span-2',
        'lg:w-[min(calc(100dvh-3rem-var(--shell-chrome,0px)),46rem,calc(100vw-var(--spacing-panel)-6rem))]',
      ]),
    );
    expect(classesOf(cell)).not.toContain('shrink-0');
  });

  it('keeps the rows and the scroller in one panel cell that holds 16.5rem, so stepping never resizes the board', () => {
    const main = renderFrame({ builderRow: true, comment: true });
    const scroller = document.querySelector('[data-panel-scroller]');
    const panel = scroller?.parentElement;
    expect(panel?.parentElement).toBe(main);
    expect(classesOf(panel)).toEqual(
      expect.arrayContaining([
        'flex-[1_1_16.5rem]',
        'min-h-0',
        'flex-col',
        'lg:col-start-2',
        'lg:row-start-2',
      ]),
    );
    // Board row, builder row, status line, comment strip, then the scroller.
    expect(
      [...(panel?.children ?? [])].map((cell) => cell.textContent),
    ).toEqual(['board row', 'builder row', 'status', 'comment', 'scroller']);
  });

  it('sizes the board row at 60px on a phone (a 44px field and 8px above and below) and keeps the rows from shrinking', () => {
    renderFrame({ builderRow: true, comment: true });
    expect(classesOf(cellOf('board row'))).toEqual(
      expect.arrayContaining(['shrink-0', 'px-gutter', 'py-2', 'lg:px-0']),
    );
    expect(classesOf(cellOf('builder row'))).toEqual(
      expect.arrayContaining(['shrink-0', 'px-gutter', 'pb-2', 'lg:px-0']),
    );
    expect(classesOf(cellOf('status'))).toEqual(
      expect.arrayContaining(['shrink-0', 'px-gutter', 'lg:px-0', 'lg:mb-3']),
    );
    expect(classesOf(cellOf('comment'))).toEqual(
      expect.arrayContaining(['shrink-0', 'lg:mb-4']),
    );
  });

  it('hides the builder row and the strip’s cells when they are empty, so they add no room', () => {
    renderFrame();
    const panel = document.querySelector(
      '[data-panel-scroller]',
    )?.parentElement;
    const empty = [...(panel?.children ?? [])].filter(
      (cell) => cell.childElementCount === 0,
    );
    expect(empty).toHaveLength(2);
    for (const cell of empty) expect(classesOf(cell)).toContain('empty:hidden');
  });

  it('scrolls the scroller on a phone and lets it grow with the page on a desktop', () => {
    renderFrame();
    const scroller = cellOf('scroller');
    expect(scroller.hasAttribute('data-panel-scroller')).toBe(true);
    expect(classesOf(scroller)).toEqual(
      expect.arrayContaining([
        'flex-1',
        'min-h-0',
        'overflow-y-auto',
        'px-gutter',
        'pt-2',
        'pb-3',
        'gap-3',
        'lg:flex-none',
        'lg:overflow-visible',
        'lg:p-0',
        'lg:gap-4',
      ]),
    );
  });

  it('puts what is outside the cells (live regions) after them, and marks a loading page busy', () => {
    const main = renderFrame({ busy: true });
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect(main.lastElementChild?.textContent).toBe('live');
  });
});
