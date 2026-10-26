import { render, screen } from '@testing-library/react';
import { START_KEY, type RepertoireMove } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import { LineSoFar } from './drill-panel';

const LINE = graphOf('1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 *').moves;
const SICILIAN = graphOf('1. e4 c5 2. Nf3 d6 3. d4 *').moves;

function Line({
  moves,
  rootKey = START_KEY,
}: {
  readonly moves: readonly RepertoireMove[];
  readonly rootKey?: string;
}): JSX.Element {
  return (
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <LineSoFar moves={moves} rootKey={rootKey} />
    </NextIntlClientProvider>
  );
}

const lineRow = (): HTMLElement => screen.getByText(/^1\. d4/u);

/** The desktop move list's rows, each as its cells' texts. */
const listRows = (): (string | null)[][] =>
  screen
    .getAllByRole('listitem')
    .map((row) => Array.from(row.children, (cell) => cell.textContent));

/** jsdom has no scrollIntoView; record which elements are asked to scroll. */
function watchScrolls(): string[] {
  const seen: string[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value(this: Element) {
      seen.push(this.textContent);
    },
  });
  return seen;
}

describe('LineSoFar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('writes the whole line, so a screen reader reads every move', () => {
    render(<Line moves={LINE} />);
    expect(lineRow().textContent).toBe(
      '1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5',
    );
  });

  it('keeps the newest move in view when the line grows', () => {
    const width = vi
      .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
      .mockReturnValue(120);
    const { rerender } = render(<Line moves={LINE.slice(0, 3)} />);
    expect(lineRow().scrollLeft).toBe(120);

    width.mockReturnValue(480);
    rerender(<Line moves={LINE} />);
    expect(lineRow().scrollLeft).toBe(480);
  });

  it('lists the moves on a desktop in rows of number, White and Black', () => {
    render(<Line moves={LINE.slice(0, 7)} />);
    expect(listRows()).toEqual([
      ['1.', 'd4', 'd5'],
      ['2.', 'Bf4', 'Nf6'],
      ['3.', 'e3', 'e6'],
      ['4.', 'Nf3', ''],
    ]);
  });

  it('starts a line Black opens with 1..., its move in the Black column', () => {
    const [e4, ...rest] = SICILIAN;
    if (e4 === undefined) throw new Error('the line opens 1. e4');
    render(<Line moves={rest} rootKey={e4.to} />);
    expect(listRows()).toEqual([
      ['1...', '', 'c5'],
      ['2.', 'Nf3', 'd6'],
      ['3.', 'd4', ''],
    ]);
    expect(screen.getByText(/^1\.\.\. c5/u).textContent).toBe(
      '1... c5 2. Nf3 d6 3. d4',
    );
  });

  it('shows one layout at a time, so a screen reader hears the line once', () => {
    render(<Line moves={LINE} />);
    expect(lineRow().classList).toContain('lg:hidden');
    const list = screen.getByRole('list');
    expect(list.classList).toContain('hidden');
    expect(list.classList).toContain('lg:grid');
  });

  it('scrolls the newest row of the desktop list into view as the line grows', () => {
    const seen = watchScrolls();
    const { rerender } = render(<Line moves={LINE.slice(0, 3)} />);
    rerender(<Line moves={LINE} />);
    expect(seen).toEqual(['2.Bf4', '4.Nf3c5']);
  });

  it('shows nothing before the first move', () => {
    render(<Line moves={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
