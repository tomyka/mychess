import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { moveKey, START_KEY, type RepertoireGraph } from '@mychess/chess';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../test/fixtures/repertoires';
import { MESSAGES } from '../../i18n/locales';
import { RepertoireShell, useBrowseView } from '.';

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

const lt = MESSAGES.lt;
const r = lt.repertoires;
const D4 = moveKey(START_KEY, 'd4');
const NOTE_LABEL = 'Trenerio pastaba';

interface ViewOptions {
  readonly graph?: RepertoireGraph;
  readonly said?: string;
  readonly onSquare?: (square: Key) => void;
  readonly notedMoves?: Readonly<Record<string, string>>;
}

/** A read-only view built on the module, as a third view would build it. */
function View({
  graph = graphOf(LONDON),
  said,
  onSquare = vi.fn(),
  notedMoves = {},
}: ViewOptions): JSX.Element {
  const view = useBrowseView(graph, 'white');
  return (
    <RepertoireShell
      header={<h1>Londono sistema</h1>}
      name="Londono sistema"
      names={{ ecoNames: {}, distinctions: {} }}
      view={view}
      toolbar={<p>Įrankiai</p>}
      panel={{
        lead: <p>Tik skaityti</p>,
        empty: <p>Skyrių nėra</p>,
        commentLabel: NOTE_LABEL,
        renderNotes: (key) => (
          <p>{key === D4 ? 'Pastaba apie d4' : 'Kita pastaba'}</p>
        ),
        notedMoves,
        noteKind: 'coach',
        footer: <p>Pabaiga</p>,
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
    <NextIntlClientProvider locale="lt" messages={lt}>
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
  it('lays the header, the board, the toolbar and the panel out in one main landmark', () => {
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
    expect(main.getByText('Pabaiga')).toBeDefined();
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

  it('shows the move’s comment under the view’s label, and the view’s notes for that move', () => {
    renderView();
    forward();
    const position = within(screen.getByRole('region', { name: NOTE_LABEL }));
    expect(position.getByText(NOTE_LABEL)).toBeDefined();
    expect(position.getByText('Solid')).toBeDefined();
    expect(position.getByText('Pastaba apie d4')).toBeDefined();
    forward();
    expect(screen.getByText('Kita pastaba')).toBeDefined();
  });

  it('takes no new move while browsing: a move the chapter lacks is refused', () => {
    renderView();
    const field = screen.getByLabelText<HTMLInputElement>(
      lt.board.moveInput.label,
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
  it('shows the lead, the chapters, the position, the moves and the footer in that order', () => {
    renderView();
    const order = [
      screen.getByText('Tik skaityti'),
      screen.getByRole('button', { expanded: false }),
      screen.getByRole('region', { name: r.panel.intro }),
      firstMove(),
      screen.getByText('Pabaiga'),
    ];
    for (const [i, node] of order.entries()) {
      const next = order[i + 1];
      if (next === undefined) continue;
      expect(
        node.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('marks the moves carrying the view’s notes with their kind', () => {
    renderView({ notedMoves: { [D4]: 'Pirmiau Nf3' } });
    expect(
      firstMove(`1. d4, ${r.moves.hasComment}, ${r.moves.hasCoachNote}`),
    ).toBeDefined();
  });

  it('shows the view’s empty state and no moves in a repertoire without chapters', () => {
    renderView({ graph: { side: 'white', chapters: [], moves: [] } });
    expect(screen.getByText('Skyrių nėra')).toBeDefined();
    expect(screen.queryByRole('button', { name: /^1\. d4/ })).toBeNull();
    expect(screen.getByText('Pabaiga')).toBeDefined();
  });
});
