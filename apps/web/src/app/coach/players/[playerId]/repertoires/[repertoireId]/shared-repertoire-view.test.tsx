import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { moveKey, START_KEY } from '@mychess/chess';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outOfOrder } from '../../../../../../../test/dom-order';
import {
  graphOf,
  LONDON,
} from '../../../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../../../i18n/catalogue';
import type { SharedRepertoirePage } from '../../../../../../server/coach-pages';
import type { CoachNoteState } from '../../../../actions';
import { SharedRepertoireView } from './shared-repertoire-view';

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

const server = vi.hoisted(() => ({
  save: vi.fn<(input: unknown) => Promise<CoachNoteState>>(),
}));

vi.mock('../../../../actions', () => ({
  saveCoachNoteAction: server.save,
  deleteCoachNoteAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const D4 = moveKey(START_KEY, 'd4');
const s = MESSAGES.coach.shared;

/** Rokas's London as his coach sees it, with the coach's note on 1. d4. */
const DATA: SharedRepertoirePage = {
  player: { id: 'p-1', displayName: 'Rokas' },
  repertoire: { id: ID, name: 'Londono sistema', side: 'white' },
  graph: graphOf(LONDON),
  notes: { [D4]: 'Pirmiau Nf3' },
  names: { taxonomyNames: {}, distinctions: {} },
};

function renderView(data: SharedRepertoirePage = DATA): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <SharedRepertoireView data={data} />
    </NextIntlClientProvider>,
  );
}

const forward = () => {
  fireEvent.click(
    screen.getByRole('button', { name: MESSAGES.repertoires.nav.forward }),
  );
};
const back = () => {
  fireEvent.click(
    screen.getByRole('button', { name: MESSAGES.repertoires.nav.back }),
  );
};
/** Plays a move on the (mocked) board, as chessground reports it. */
function boardMove(orig: Key, dest: Key): void {
  act(() => {
    ground.created.at(-1)?.movable?.events?.after?.(orig, dest, {
      premove: false,
    });
  });
}

const current = () =>
  document.querySelector('[aria-current="true"][aria-label]')?.textContent;

const noteField = () => screen.queryByLabelText<HTMLTextAreaElement>(s.note);

beforeEach(() => {
  ground.created.length = 0;
  server.save.mockReset().mockResolvedValue({});
});

describe('SharedRepertoireView (R-42, read-only)', () => {
  it('names the repertoire, says it is read-only and leads back to the player', () => {
    renderView();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByText(s.readOnly)).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Back to Rokas' }).getAttribute('href'),
    ).toBe('/coach/players/p-1');
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('says read-only under the move list, by the coach note, not above the chapter line (sign-off, fix D)', () => {
    renderView();
    const moves = document.querySelector('[data-moves]');
    const readOnly = screen.getByText(s.readOnly);
    if (moves === null) throw new Error('no move list');
    expect(outOfOrder([moves, readOnly])).toEqual([]);
    forward();
    expect(outOfOrder([readOnly, screen.getByLabelText(s.note)])).toEqual([]);
  });

  it('places its panel: the player’s line, the chapters, the moves, read-only, then the coach’s own note', () => {
    renderView();
    forward();
    expect(
      outOfOrder([
        screen.getByRole('link', { name: MESSAGES.coach.progress.title }),
        screen.getByRole('button', { name: /^Ch 1\/2 · / }),
        screen.getByRole('button', {
          name: `1. d4, ${MESSAGES.repertoires.moves.hasComment}, ${MESSAGES.repertoires.moves.hasCoachNote}`,
        }),
        screen.getByText(s.readOnly),
        screen.getByLabelText(s.note),
      ]),
    ).toEqual([]);
  });

  it('still says read-only, after the empty message, in a repertoire without chapters', () => {
    renderView({ ...DATA, graph: { side: 'white', chapters: [], moves: [] } });
    expect(
      outOfOrder([
        screen.getByText(MESSAGES.repertoires.panel.emptyBrowse),
        screen.getByText(s.readOnly),
      ]),
    ).toEqual([]);
  });

  it('links to the player’s progress on this repertoire, first in the panel (S7 decision 7, sign-off)', () => {
    renderView();
    const scroller = document.querySelector<HTMLElement>(
      '[data-panel-scroller]',
    );
    if (scroller === null) throw new Error('no panel');
    expect(
      within(scroller)
        .getByRole('link', { name: MESSAGES.coach.progress.title })
        .getAttribute('href'),
    ).toBe(`/coach/players/p-1/progress/${ID}`);
    // One row above the board: the way back and the name.
    expect(
      within(screen.getByRole('banner')).getAllByRole('link'),
    ).toHaveLength(1);
  });

  it('has none of the owner’s controls', () => {
    renderView();
    forward();
    const header = MESSAGES.repertoires.manage;
    for (const name of [
      MESSAGES.repertoires.mode.toBuild,
      header.rename,
      header.delete,
      header.importInto,
      MESSAGES.repertoires.note.label,
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name: header.download })).toBeNull();
    // The one text area is the coach's own note; no comment field.
    expect(
      [...document.querySelectorAll('textarea')].map((area) => area.id),
    ).toEqual([noteField()?.id]);
  });

  it('shows the chapter intro at the root, and no note field there', () => {
    renderView();
    expect(screen.getByText('The London')).toBeDefined();
    expect(noteField()).toBeNull();
  });

  it('shows the move’s comment and the coach’s own note on it (R-102)', () => {
    renderView();
    forward();
    expect(screen.getByText('Solid')).toBeDefined();
    expect(noteField()?.value).toBe('Pirmiau Nf3');
    forward();
    expect(noteField()?.value).toBe('');
  });

  it('saves a note on the current move and keeps it on the way back', async () => {
    renderView();
    forward();
    forward();
    const field = noteField();
    if (field === null) throw new Error('no note field');
    fireEvent.change(field, { target: { value: 'Atsakymas į d5' } });
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    expect(await screen.findByText(s.noteSaved)).toBeDefined();
    expect(server.save).toHaveBeenCalledWith({
      playerId: 'p-1',
      repertoireId: ID,
      moveKey: moveKey(afterD4(), 'd5'),
      text: 'Atsakymas į d5',
    });
    back();
    forward();
    expect(noteField()?.value).toBe('Atsakymas į d5');
  });

  it('marks the moves carrying the coach’s own note in the move list, a saved one too', async () => {
    renderView();
    const d4 = screen.getByRole('button', {
      name: `1. d4, ${MESSAGES.repertoires.moves.hasComment}, ${MESSAGES.repertoires.moves.hasCoachNote}`,
    });
    expect(d4.querySelector('[data-note="coach"]')).not.toBeNull();
    expect(document.querySelector('[data-note="personal"]')).toBeNull();
    forward();
    forward();
    const field = noteField();
    if (field === null) throw new Error('no note field');
    fireEvent.change(field, { target: { value: 'Atsakymas į d5' } });
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    expect(
      await screen.findByRole('button', {
        name: `1... d5, ${MESSAGES.repertoires.moves.hasCoachNote}`,
      }),
    ).toBeDefined();
  });

  it('goes to a move the chapter has, played on the board or typed', () => {
    renderView();
    boardMove('d2', 'd4');
    expect(current()).toBe('d4');
    const field = screen.getByLabelText<HTMLInputElement>(
      MESSAGES.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'd5' } });
    fireEvent.submit(field);
    expect(current()).toBe('d5');
  });

  it('changes nothing for a move the chapter lacks, played or typed', () => {
    renderView();
    boardMove('e2', 'e4');
    // The repertoire is the player's; the coach cannot change it (R-42).
    expect(screen.getByText(MESSAGES.coach.shared.notInChapter)).toBeDefined();
    expect(
      screen.queryByText(MESSAGES.repertoires.board.notInRepertoire),
    ).toBeNull();
    expect(current()).toBeUndefined();
    expect(screen.getByText('The London')).toBeDefined();
    const field = screen.getByLabelText<HTMLInputElement>(
      MESSAGES.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'c4' } });
    fireEvent.submit(field);
    expect(current()).toBeUndefined();
    expect(field.value).toBe('c4');
    expect(noteField()).toBeNull();
    expect(server.save).not.toHaveBeenCalled();
  });

  it('shows a repertoire without chapters as empty, with no note field', () => {
    renderView({ ...DATA, graph: { ...DATA.graph, chapters: [] } });
    expect(
      screen.getByText(MESSAGES.repertoires.panel.emptyBrowse),
    ).toBeDefined();
    expect(noteField()).toBeNull();
  });
});

/** The position after 1. d4 in the London. */
function afterD4(): string {
  const d4 = DATA.graph.moves.find(
    (move) => move.from === START_KEY && move.san === 'd4',
  );
  if (d4 === undefined) throw new Error('no 1. d4');
  return d4.to;
}
