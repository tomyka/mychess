import type { Config } from '@lichess-org/chessground/config';
import type { Key } from '@lichess-org/chessground/types';
import { moveKey, START_KEY } from '@mychess/chess';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { outOfOrder } from '../../../../../../../test/dom-order';
import {
  graphOf,
  LONDON,
} from '../../../../../../../test/fixtures/repertoires';
import { LOCALE, MESSAGES } from '../../../../../../i18n/catalogue';
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
  isFork: false,
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

const MOVES = MESSAGES.repertoires.moves;

// The catalogue's words, as the page reads them.
const t = createTranslator({ locale: LOCALE, messages: MESSAGES });

/** The card's heading and the sheet field's name on `move`. */
const noteOn = (move: string) =>
  t('coach.shared.noteOn', { move, name: 'Rokas' });

/** The strip's name on `move`, with a note or without. */
const editOn = (move: string) => t('coach.shared.editNoteOn', { move });
const addOn = (move: string) => t('coach.shared.addNoteOn', { move });

/** A message's words before its first placeholder: what every move's shares. */
const lead = (message: string): RegExp =>
  new RegExp(`^${message.slice(0, message.indexOf('{'))}`, 'u');

/** The desktop card of the coach's note, if any. */
const noteCard = () => screen.queryByRole('region', { name: lead(s.noteOn) });

/** The phone strip of the coach's note, if any. */
const noteStrip = () =>
  screen.queryAllByRole('button').find((button) => {
    const name = button.getAttribute('aria-label') ?? '';
    return lead(s.editNoteOn).test(name) || lead(s.addNoteOn).test(name);
  }) ?? null;

/** The move list's box. */
function moves(): HTMLElement {
  const box = document.querySelector<HTMLElement>('[data-moves]');
  if (box === null) throw new Error('no move list');
  return box;
}

beforeEach(() => {
  ground.created.length = 0;
  server.save.mockReset().mockResolvedValue({});
});

describe('SharedRepertoireView (R-42, read-only)', () => {
  it('heads the page with the way back and Progress on one row, the name and the read-only tag (#381 part 5)', () => {
    renderView();
    const banner = screen.getByRole('banner');
    const bar = within(banner);
    expect(
      bar.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(bar.getByText(s.tag)).toBeDefined();
    const backLink = bar.getByRole('link', {
      name: t('nav.back', { parent: 'Rokas' }),
    });
    expect(backLink.getAttribute('href')).toBe('/coach/players/p-1');
    const progress = bar.getByRole('link', {
      name: MESSAGES.coach.progress.title,
    });
    expect(progress.getAttribute('href')).toBe(
      `/coach/players/p-1/progress/${ID}`,
    );
    // One row: both in the header's one flex row, never a column.
    expect(backLink.parentElement).toBe(banner);
    expect(progress.closest('header')).toBe(banner);
    expect(banner.className).toMatch(/(^|\s)flex(\s|$)/u);
    expect(banner.className).not.toMatch(/(^|\s)flex-col(\s|$)/u);
    // The old sentence and the summary row are gone: nothing else says it.
    expect(screen.queryByText(/^Read-only:/)).toBeNull();
    expect(
      screen.getAllByRole('link', { name: MESSAGES.coach.progress.title }),
    ).toHaveLength(1);
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('names a shared Fork as the player’s own copy of the repertoire (R-155)', () => {
    renderView({ ...DATA, isFork: true });
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: t('coach.progress.ownCopyTitle', {
          name: 'Rokas',
          repertoire: 'Londono sistema',
        }),
      }),
    ).toBeDefined();
    expect(screen.getByText(s.tag)).toBeDefined();
  });

  it('starts the scroller with the chapter line: the summary row left it for the top bar', () => {
    renderView();
    const scroller = document.querySelector('[data-panel-scroller]');
    expect(
      scroller?.firstElementChild?.contains(
        screen.getByRole('button', { name: /^Ch 1\/2 · / }),
      ),
    ).toBe(true);
  });

  it('gives the panel the note strip’s room on a phone: 18.5rem (height budget)', () => {
    renderView();
    const panel = document.querySelector(
      '[data-panel-scroller]',
    )?.parentElement;
    expect(panel?.className).toContain('flex-[1_1_18.5rem]');
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
      // The coach's own note has a Delete of its own; nothing else does.
      expect(
        screen
          .queryAllByRole('button', { name })
          .filter((button) => noteCard()?.contains(button) !== true),
      ).toEqual([]);
    expect(screen.queryByRole('link', { name: header.download })).toBeNull();
    // No comment field, and the note is a field only once the coach edits it.
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('shows the chapter intro at the root, and no coach note there: it belongs to a move', () => {
    renderView();
    expect(screen.getByText('The London')).toBeDefined();
    expect(noteCard()).toBeNull();
    expect(noteStrip()).toBeNull();
  });

  it('puts the coach’s note under the move’s comment, before the move list, never after it', () => {
    renderView();
    forward();
    const comment = screen.getByRole('region', {
      name: MESSAGES.repertoires.panel.comment,
    });
    const card = noteCard();
    const strip = noteStrip();
    if (card === null || strip === null) throw new Error('no coach note');
    expect(within(comment).getByText('Solid')).toBeDefined();
    expect(outOfOrder([comment, card, strip, moves()])).toEqual([]);
    expect(moves().compareDocumentPosition(card)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    // Nothing of it after the move list.
    const scroller = document.querySelector('[data-panel-scroller]');
    expect(scroller?.textContent).not.toContain('Pirmiau Nf3');
  });

  it('shows the coach’s own note on the move as a desktop card and a phone strip (R-125)', () => {
    renderView();
    forward();
    const card = within(screen.getByRole('region', { name: noteOn('1. d4') }));
    expect(card.getByText('Pirmiau Nf3')).toBeDefined();
    expect(card.getByRole('button', { name: s.editNote })).toBeDefined();
    expect(card.getByRole('button', { name: s.deleteNote })).toBeDefined();
    expect(
      within(screen.getByRole('button', { name: editOn('1. d4') })).getByText(
        'Pirmiau Nf3',
      ),
    ).toBeDefined();
    forward();
    expect(
      within(screen.getByRole('region', { name: noteOn('1... d5') })).getByRole(
        'button',
        { name: s.addNote },
      ),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: addOn('1... d5') }),
    ).toBeDefined();
  });

  it('saves a note on the current move, marks it in the move list and keeps it on the way back', async () => {
    renderView();
    forward();
    forward();
    const card = within(
      screen.getByRole('region', { name: noteOn('1... d5') }),
    );
    fireEvent.click(card.getByRole('button', { name: s.addNote }));
    fireEvent.change(card.getByRole('textbox', { name: noteOn('1... d5') }), {
      target: { value: 'Atsakymas į d5' },
    });
    fireEvent.click(card.getByRole('button', { name: s.saveNote }));
    expect(await card.findByText(s.noteSaved)).toBeDefined();
    expect(server.save).toHaveBeenCalledWith({
      playerId: 'p-1',
      repertoireId: ID,
      moveKey: moveKey(afterD4(), 'd5'),
      text: 'Atsakymas į d5',
    });
    expect(
      screen.getByRole('button', { name: `1... d5, ${MOVES.hasCoachNote}` }),
    ).toBeDefined();
    back();
    forward();
    expect(
      within(screen.getByRole('region', { name: noteOn('1... d5') })).getByText(
        'Atsakymas į d5',
      ),
    ).toBeDefined();
    expect(
      within(screen.getByRole('button', { name: editOn('1... d5') })).getByText(
        'Atsakymas į d5',
      ),
    ).toBeDefined();
  });

  it('marks the moves carrying the coach’s own note with the pen, unchanged', () => {
    renderView();
    const d4 = screen.getByRole('button', {
      name: `1. d4, ${MOVES.hasComment}, ${MOVES.hasCoachNote}`,
    });
    expect(d4.querySelector('[data-note="coach"]')).not.toBeNull();
    expect(document.querySelector('[data-note="personal"]')).toBeNull();
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
    expect(noteCard()).toBeNull();
    expect(noteStrip()).toBeNull();
    expect(server.save).not.toHaveBeenCalled();
  });

  it('shows a repertoire without chapters as empty, with no note field', () => {
    renderView({ ...DATA, graph: { ...DATA.graph, chapters: [] } });
    expect(
      screen.getByText(MESSAGES.repertoires.panel.emptyBrowse),
    ).toBeDefined();
    expect(noteCard()).toBeNull();
    expect(noteStrip()).toBeNull();
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
