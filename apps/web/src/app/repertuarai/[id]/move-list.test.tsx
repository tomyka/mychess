import { moveKey, type RepertoireMove } from '@mychess/chess';
import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import {
  graphOf,
  LONDON,
  TAIMANOV,
} from '../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../i18n/locales';
import { MoveList, type MoveListProps } from './move-list';

const LONDON_GRAPH = graphOf(LONDON);

function renderList(over: Partial<MoveListProps> = {}) {
  const onGoto = vi.fn<(path: readonly RepertoireMove[]) => void>();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <MoveList
        graph={LONDON_GRAPH}
        chapterId="c1"
        path={[]}
        notes={{}}
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

describe('MoveList', () => {
  it('shows the main line with move numbers and the variation as its own block', () => {
    renderList();
    const list = screen.getByRole('region', {
      name: MESSAGES.en.repertoires.moves.title,
    });
    expect(text(list)).toBe(
      '1. d4 d5 2. Bf4 Nf6 3. e3 e6 3... c5 4. c3 4. Nf3',
    );
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
    renderList({ notes: { [moveKey(d5?.from ?? '', 'd5')]: 'Mine' } });
    expect(chip('1. d4, has a comment').className).toContain('font-semibold');
    expect(chip('1... d5, has my note').className).not.toContain(
      'font-semibold',
    );
  });

  it('numbers Black’s moves after a nested variation', () => {
    renderList({ graph: graphOf(TAIMANOV, 'black'), chapterId: 'c1' });
    const list = screen.getByRole('region', {
      name: MESSAGES.en.repertoires.moves.title,
    });
    expect(text(list)).toBe(
      '1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 ' +
        '6. Be2 a6 7. O-O 7. Be3 Nf6 7... Nf6 6. g3 a6 6... a6 7. Qd2 Nf6',
    );
  });

  it('says when the chapter has no moves', () => {
    renderList({ chapterId: 'c9' });
    expect(
      screen.getByText(MESSAGES.en.repertoires.panel.noMoves),
    ).toBeDefined();
  });
});
