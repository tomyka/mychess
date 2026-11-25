import { render, screen } from '@testing-library/react';
import { START_KEY, type RepertoireMove } from '@mychess/chess';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphOf } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/catalogue';
import { LineSoFar, StatusLine, ToMove } from './drill-panel';
import { TwoAnswersNotice } from './two-answers-notice';

const LINE = graphOf('1. d4 d5 2. Bf4 Nf6 3. e3 e6 4. Nf3 c5 *').moves;
const SICILIAN = graphOf('1. e4 c5 2. Nf3 d6 3. d4 *').moves;
const CARO_KANN = graphOf(
  '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7 *',
).moves;

function WithMessages({
  children,
}: {
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}

function Line({
  moves,
  rootKey = START_KEY,
}: {
  readonly moves: readonly RepertoireMove[];
  readonly rootKey?: string;
}): JSX.Element {
  return (
    <WithMessages>
      <LineSoFar moves={moves} rootKey={rootKey} />
    </WithMessages>
  );
}

/** The whole line: the first paragraph after the line's heading. */
function lineRow(): Element {
  const row = screen.getByRole('heading', {
    name: MESSAGES.training.drill.line,
  }).nextElementSibling;
  if (row === null) throw new Error('no line so far');
  return row;
}

/** The phone's line: the paragraph after the whole line. */
function phoneRow(): Element {
  const row = lineRow().nextElementSibling;
  if (row === null) throw new Error('no phone line');
  return row;
}

const classes = (element: Element | null | undefined): string[] =>
  element?.getAttribute('class')?.split(' ') ?? [];

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

  it('shows the whole line to screen readers and the phone its last six full moves', () => {
    render(<Line moves={CARO_KANN} />);
    expect(lineRow().textContent).toBe(
      '1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7',
    );
    expect(classes(lineRow())).toContain('sr-only');
    expect(phoneRow().textContent).toBe(
      '… 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Bf5 5. Ng3 Bg6 6. h4 h6 7. Nf3 Nd7',
    );
    expect(phoneRow().getAttribute('aria-hidden')).toBe('true');
    // It wraps rather than scrolling sideways.
    expect(classes(phoneRow())).not.toContain('whitespace-nowrap');
    expect(classes(phoneRow())).not.toContain('overflow-x-auto');
  });

  it('writes a short line whole on the phone too', () => {
    render(<Line moves={LINE} />);
    expect(phoneRow().textContent).toBe(lineRow().textContent);
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
    expect(lineRow().textContent).toBe('1... c5 2. Nf3 d6 3. d4');
  });

  it('shows one layout at a time, so a screen reader hears the line once', () => {
    render(<Line moves={LINE} />);
    expect(classes(lineRow())).toContain('lg:hidden');
    expect(classes(phoneRow())).toContain('lg:hidden');
    const list = screen.getByRole('list');
    expect(classes(list)).toContain('hidden');
    expect(classes(list)).toContain('lg:grid');
  });

  it('gives the desktop list fixed narrow columns, so a move pair reads as one row', () => {
    render(<Line moves={LINE} />);
    expect(classes(screen.getByRole('list'))).toContain(
      'lg:grid-cols-[2.5rem_5rem_5rem]',
    );
  });

  it('scrolls the desktop list in its own box as the line grows, never the panel around it (#323)', () => {
    const seen = watchScrolls();
    const height = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(200);
    const { rerender } = render(<Line moves={LINE.slice(0, 3)} />);
    const box = screen.getByRole('list').parentElement;
    expect(box?.classList).toContain('lg:overflow-y-auto');
    expect(box?.classList).toContain('lg:min-h-0');
    expect(box?.scrollTop).toBe(200);

    height.mockReturnValue(320);
    rerender(<Line moves={LINE} />);
    expect(box?.scrollTop).toBe(320);
    // scrollIntoView would scroll the panel too, and hide the move field.
    expect(seen).toEqual([]);
  });

  it('shows nothing before the first move', () => {
    render(<Line moves={[]} />);
    expect(screen.queryByRole('list')).toBeNull();
    expect(
      screen.getByRole('heading', { name: MESSAGES.training.drill.line })
        .nextElementSibling,
    ).toBeNull();
  });

  it('shows each move NAG glyphs after its SAN (R-175)', () => {
    render(<Line moves={graphOf('1. d4 $1 d5 2. c4 $14 *').moves} />);
    expect(lineRow().textContent).toBe('1. d4! d5 2. c4 ⩲');
    expect(listRows()).toEqual([
      ['1.', 'd4!', 'd5'],
      ['2.', 'c4 ⩲', ''],
    ]);
  });
});

describe('ToMove', () => {
  const dotOf = (color: 'white' | 'black'): Element | null => {
    render(
      <WithMessages>
        <ToMove color={color} />
      </WithMessages>,
    );
    return screen.getByText(MESSAGES.training.drill.toMove[color])
      .firstElementChild;
  };

  it('draws White a white disc with a dark ring, the same in both themes', () => {
    expect(classes(dotOf('white'))).toEqual(
      expect.arrayContaining(['bg-side-white', 'border-side-black']),
    );
  });

  it('draws Black a dark disc with a light ring, the same in both themes', () => {
    expect(classes(dotOf('black'))).toEqual(
      expect.arrayContaining(['bg-side-black', 'border-side-ring']),
    );
  });
});

describe('StatusLine', () => {
  it.each([
    ['success', 'bg-success-subtle', 'text-success'],
    ['error', 'bg-error-subtle', 'text-error'],
    ['due', 'bg-due-subtle', 'text-due'],
  ] as const)(
    'draws a %s result as a tinted pill with its icon',
    (tone, fill, ink) => {
      render(<StatusLine tone={tone} text="Not that move." />);
      const pill = screen.getByText('Not that move.');
      expect(classes(pill)).toEqual(
        expect.arrayContaining([fill, ink, 'rounded-control']),
      );
      expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    },
  );

  it('writes the prompt plain and bold, with no icon', () => {
    render(<StatusLine tone="prompt" text="Your move" />);
    const prompt = screen.getByText('Your move');
    expect(classes(prompt)).toEqual(['text-lg', 'font-bold']);
    expect(prompt.querySelector('svg')).toBeNull();
  });

  it('draws each result with an icon of its own', () => {
    const paths = (['success', 'error', 'due'] as const).map((tone) => {
      const { container, unmount } = render(
        <StatusLine tone={tone} text={tone} />,
      );
      const d = container.querySelector('path')?.getAttribute('d');
      unmount();
      return d;
    });
    expect(new Set(paths).size).toBe(3);
    expect(paths).not.toContain(undefined);
  });
});

describe('the notes in the panel', () => {
  it('sets the two-answers notice in a soft card', () => {
    render(
      <WithMessages>
        <TwoAnswersNotice
          answers={[{ repertoireId: 'r2', name: 'Caro-Kann', san: 'c6' }]}
        />
      </WithMessages>,
    );
    expect(classes(screen.getByRole('note'))).toEqual(
      expect.arrayContaining(['rounded-card', 'bg-accent-subtle']),
    );
  });
});
