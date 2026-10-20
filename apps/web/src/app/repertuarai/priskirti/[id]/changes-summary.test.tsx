import {
  moveKey,
  START_KEY,
  type MoveChanges,
  type RepertoireGraph,
} from '@mychess/chess';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  graphOf,
  LONDON,
  TAIMANOV,
} from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/locales';
import { ChangesSummary } from './changes-summary';

const lt = MESSAGES.lt.assignment.changes;
const LONDON_GRAPH = graphOf(LONDON);
const TAIMANOV_GRAPH = graphOf(TAIMANOV, 'black');

/** The position after `sans` from the start, along the graph's moves. */
function keyAfter(graph: RepertoireGraph, ...sans: string[]): string {
  return sans.reduce((key, san) => {
    const move = graph.moves.find((m) => m.from === key && m.san === san);
    if (move === undefined) throw new Error(`no ${san}`);
    return move.to;
  }, START_KEY);
}

/** The id of the graph's chapter at `index`. */
function chapterId(graph: RepertoireGraph, index: number): string {
  const chapter = graph.chapters[index];
  if (chapter === undefined) throw new Error(`no chapter ${String(index)}`);
  return chapter.id;
}

/** The London's chapters are named after their openings. */
const ECO_NAMES = {
  D00: 'Londono sistema',
  A45: 'Ferzio pėstininko partija',
};

const NONE: MoveChanges = { added: [], removed: [], annotated: 0 };

function renderSummary(
  changes: MoveChanges,
  graph: RepertoireGraph = LONDON_GRAPH,
  locale: 'lt' | 'en' = 'lt',
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ChangesSummary graph={graph} changes={changes} ecoNames={ECO_NAMES} />
    </NextIntlClientProvider>,
  );
}

const summary = () =>
  screen.getByRole('region', { name: MESSAGES.lt.assignment.changes.title });

describe('ChangesSummary (R-133)', () => {
  it('shows nothing when nothing changed', () => {
    const { container } = renderSummary(NONE);
    expect(container.innerHTML).toBe('');
  });

  it('lists the moves added and removed under their chapter, with move numbers', () => {
    const afterD5 = keyAfter(LONDON_GRAPH, 'd4', 'd5');
    renderSummary({
      added: [
        {
          moveKey: moveKey(afterD5, 'Bf4'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
      ],
      removed: [
        {
          moveKey: moveKey(afterD5, 'c4'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
      ],
      annotated: 0,
    });
    const region = summary();
    expect(
      within(region).getByRole('heading', { level: 2, name: lt.title }),
    ).toBeDefined();
    const chapter = within(region).getByRole('heading', { level: 3 });
    expect(chapter.textContent).toBe('Londono sistema');
    expect(within(region).getByText('Pridėta: 2. Bf4')).toBeDefined();
    // A removed move is no longer in the graph: no move number for it.
    expect(within(region).getByText('Pašalinta: c4')).toBeDefined();
  });

  it('lists the chapters in the repertoire’s order, each with only its own moves', () => {
    const afterNf6 = keyAfter(LONDON_GRAPH, 'd4', 'Nf6');
    const afterE6 = keyAfter(
      LONDON_GRAPH,
      'd4',
      'd5',
      'Bf4',
      'Nf6',
      'e3',
      'e6',
    );
    const afterD5 = keyAfter(LONDON_GRAPH, 'd4', 'd5');
    renderSummary({
      added: [
        {
          moveKey: moveKey(afterNf6, 'Bf4'),
          chapterId: chapterId(LONDON_GRAPH, 1),
        },
        {
          moveKey: moveKey(afterE6, 'Nf3'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
        {
          moveKey: moveKey(afterD5, 'Bf4'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
      ],
      removed: [],
      annotated: 0,
    });
    const headings = within(summary())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Londono sistema', 'Ferzio pėstininko partija']);
    // Within a chapter, in the order they are played.
    expect(screen.getByText('Pridėta: 2. Bf4 ir 4. Nf3')).toBeDefined();
    expect(screen.getByText('Pridėta: 2. Bf4')).toBeDefined();
    expect(screen.queryByText(/Pašalinta/)).toBeNull();
  });

  it('puts the moves the chapter does not have after those it has, as they came', () => {
    const afterD5 = keyAfter(LONDON_GRAPH, 'd4', 'd5');
    const afterE6 = keyAfter(
      LONDON_GRAPH,
      'd4',
      'd5',
      'Bf4',
      'Nf6',
      'e3',
      'e6',
    );
    const elsewhere = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -';
    const chapter = chapterId(LONDON_GRAPH, 0);
    renderSummary({
      added: [],
      removed: [
        { moveKey: moveKey(elsewhere, 'Nf6'), chapterId: chapter },
        { moveKey: moveKey(afterE6, 'Nf3'), chapterId: chapter },
        { moveKey: moveKey(elsewhere, 'd5'), chapterId: chapter },
        { moveKey: moveKey(afterD5, 'Bf4'), chapterId: chapter },
      ],
      annotated: 0,
    });
    expect(
      screen.getByText('Pašalinta: 2. Bf4, 4. Nf3, Nf6 ir d5'),
    ).toBeDefined();
  });

  it('numbers Black’s moves with an ellipsis', () => {
    const afterE4 = keyAfter(TAIMANOV_GRAPH, 'e4');
    renderSummary(
      {
        added: [
          {
            moveKey: moveKey(afterE4, 'c5'),
            chapterId: chapterId(TAIMANOV_GRAPH, 0),
          },
        ],
        removed: [],
        annotated: 0,
      },
      TAIMANOV_GRAPH,
    );
    expect(screen.getByText('Pridėta: 1... c5')).toBeDefined();
  });

  it('names a move the chapter does not have by its move alone', () => {
    const gone = 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq -';
    renderSummary({
      added: [],
      removed: [
        {
          moveKey: moveKey(gone, 'Nf6'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
      ],
      annotated: 0,
    });
    expect(screen.getByText('Pašalinta: Nf6')).toBeDefined();
  });

  it('puts the moves of a chapter deleted since under "deleted chapters", last', () => {
    const afterD5 = keyAfter(LONDON_GRAPH, 'd4', 'd5');
    renderSummary({
      added: [
        {
          moveKey: moveKey(afterD5, 'Bf4'),
          chapterId: chapterId(LONDON_GRAPH, 0),
        },
      ],
      removed: [
        { moveKey: moveKey(START_KEY, 'e4'), chapterId: 'gone-1' },
        { moveKey: moveKey(START_KEY, 'c4'), chapterId: 'gone-2' },
      ],
      annotated: 0,
    });
    const headings = within(summary())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(['Londono sistema', lt.deletedChapters]);
    expect(screen.getByText('Pašalinta: e4 ir c4')).toBeDefined();
  });

  it('counts the moves whose comments or marks changed, in Lithuanian plural forms', () => {
    for (const [count, text] of [
      [1, 'Pakeisti 1 ėjimo komentarai ar žymės'],
      [3, 'Pakeisti 3 ėjimų komentarai ar žymės'],
      [10, 'Pakeisti 10 ėjimų komentarai ar žymės'],
    ] as const) {
      const { unmount } = renderSummary({ ...NONE, annotated: count });
      expect(within(summary()).getByText(text)).toBeDefined();
      expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
      unmount();
    }
  });

  it('speaks English on the English page', () => {
    renderSummary({ ...NONE, annotated: 2 }, LONDON_GRAPH, 'en');
    expect(
      screen.getByRole('heading', {
        name: 'Your coach updated this repertoire',
      }),
    ).toBeDefined();
    expect(
      screen.getByText('Comments or marks changed on 2 moves'),
    ).toBeDefined();
  });
});
