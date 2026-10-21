import { moveKey, START_KEY } from '@mychess/chess';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { graphOf, LONDON } from '../../../../../test/fixtures/repertoires';
import { MESSAGES } from '../../../../i18n/locales';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import type { NoteOutcome } from '../../../repertoire-view';
import type { ForkState, PauseState } from './actions';
import { AssignedView } from './assigned-view';

vi.mock('@lichess-org/chessground', () => ({
  Chessground: () => ({
    set: vi.fn(),
    setShapes: vi.fn(),
    selectSquare: vi.fn(),
    destroy: vi.fn(),
    state: { drawable: { current: undefined } },
  }),
}));

const server = vi.hoisted(() => ({
  pause: vi.fn<(previous: PauseState, form: FormData) => Promise<PauseState>>(),
  seen: vi.fn<(input: unknown) => Promise<void>>(),
  note: vi.fn<(input: unknown) => Promise<NoteOutcome>>(),
}));

vi.mock('./actions', () => ({
  pauseAction: server.pause,
  markSeenAction: server.seen,
  setPersonalNoteAction: server.note,
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const D4 = moveKey(START_KEY, 'd4');
const lt = MESSAGES.lt;
const a = lt.assignment;
const GRAPH = graphOf(LONDON);

const day = (iso: string): string =>
  new Intl.DateTimeFormat('lt', {
    dateStyle: 'long',
    timeZone: 'Europe/Vilnius',
  }).format(new Date(`${iso}T12:00:00Z`));

/** Rokas's London as his coach Jonas assigned it, nothing changed since. */
const DATA: AssignedRepertoirePage = {
  repertoire: { id: ID, name: 'Londono sistema', side: 'white', version: 4 },
  coachName: 'Jonas',
  graph: GRAPH,
  personalNotes: {},
  paused: false,
  deadline: null,
  overdue: false,
  ecoNames: {},
  changes: { added: [], removed: [], annotated: 0 },
};

const fork =
  vi.fn<(previous: ForkState, form: FormData) => Promise<ForkState>>();

function renderView(over: Partial<AssignedRepertoirePage> = {}): void {
  render(
    <NextIntlClientProvider locale="lt" messages={lt} timeZone="Europe/Vilnius">
      <AssignedView data={{ ...DATA, ...over }} forkAction={fork} />
    </NextIntlClientProvider>,
  );
}

const forward = () => {
  fireEvent.click(
    screen.getByRole('button', { name: lt.repertoires.nav.forward }),
  );
};

const noteField = () =>
  screen.queryByLabelText<HTMLTextAreaElement>(lt.repertoires.note.label);

beforeEach(() => {
  server.pause.mockReset().mockResolvedValue({ paused: true });
  server.seen.mockReset().mockResolvedValue(undefined);
  server.note.mockReset().mockResolvedValue({ ok: true });
  fork.mockReset().mockResolvedValue({});
});

describe('AssignedView (R-21, R-102)', () => {
  it('names the repertoire and its coach, and leads back home', () => {
    renderView();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByText('Priskyrė Jonas')).toBeDefined();
    expect(
      screen.getByRole('link', { name: a.page.back }).getAttribute('href'),
    ).toBe('/');
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('is read-only: none of the owner’s controls and no comment field', () => {
    renderView();
    forward();
    const header = lt.repertoires.header;
    for (const name of [
      lt.repertoires.mode.toBuild,
      header.rename,
      header.delete,
      header.importInto,
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name: header.download })).toBeNull();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('shows the coach’s comments as coach notes with the coach’s name', () => {
    renderView();
    forward();
    const note = screen.getByRole('region', {
      name: 'Trenerio pastaba — Jonas',
    });
    expect(within(note).getByText('Solid')).toBeDefined();
  });

  it('lets the player write a private note, saved on this assignment', async () => {
    renderView();
    forward();
    fireEvent.click(
      screen.getByRole('button', { name: lt.repertoires.note.label }),
    );
    const field = noteField();
    if (field === null) throw new Error('no note field');
    fireEvent.change(field, { target: { value: 'Mano planas' } });
    fireEvent.click(
      screen.getByRole('button', { name: lt.repertoires.note.save }),
    );
    expect(await screen.findByText(lt.repertoires.note.saved)).toBeDefined();
    expect(server.note).toHaveBeenCalledWith({
      repertoireId: ID,
      moveKey: D4,
      text: 'Mano planas',
    });
  });

  it('shows the player’s own note and marks its move in the move list', () => {
    renderView({ personalNotes: { [D4]: 'Mano planas' } });
    const d4 = screen.getByRole('button', {
      name: `1. d4, ${lt.repertoires.moves.hasComment}, ${lt.repertoires.moves.hasNote}`,
    });
    expect(d4.querySelector('[data-note="personal"]')).not.toBeNull();
    forward();
    expect(noteField()?.value).toBe('Mano planas');
  });

  it('pauses the assignment, and the header says so at once', async () => {
    renderView();
    const header = screen.getByRole('banner');
    expect(within(header).queryByText(a.badge.paused)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: a.pause.pause }));
    expect(
      await screen.findByRole('button', { name: a.pause.resume }),
    ).toBeDefined();
    expect(within(header).getByText(a.badge.paused)).toBeDefined();
  });

  it('opens paused when the assignment is paused, a badge under who assigned it', () => {
    renderView({ paused: true });
    expect(screen.getByRole('button', { name: a.pause.resume })).toBeDefined();
    expect(screen.getByText(a.pause.pausedHint)).toBeDefined();
    const assignedBy = within(screen.getByRole('banner')).getByText(
      'Priskyrė Jonas',
    );
    expect(assignedBy.nextElementSibling?.textContent).toBe(a.badge.paused);
  });

  it('shows the deadline under who assigned it, and overdue once it passed (R-16, R-51)', () => {
    renderView({ deadline: '2026-10-19', overdue: true });
    const header = screen.getByRole('banner');
    const deadline = within(header).getByText(
      a.deadlineOn.replace('{date}', day('2026-10-19')),
    );
    expect(within(header).getByText('Priskyrė Jonas').nextElementSibling).toBe(
      deadline,
    );
    expect(deadline.nextElementSibling?.textContent).toBe(a.badge.overdue);
  });

  it('shows neither a deadline nor overdue without a deadline', () => {
    renderView();
    const header = screen.getByRole('banner');
    expect(within(header).queryByText(/Terminas/u)).toBeNull();
    expect(within(header).queryByText(a.badge.overdue)).toBeNull();
  });

  it('marks the version it shows seen (R-133)', async () => {
    renderView();
    await waitFor(() => {
      expect(server.seen).toHaveBeenCalledWith({
        repertoireId: ID,
        seenVersion: 4,
      });
    });
  });

  it('shows what the coach changed since the last visit, if anything', () => {
    renderView({ changes: { added: [], removed: [], annotated: 2 } });
    expect(screen.getByRole('region', { name: a.changes.title })).toBeDefined();
  });

  it('shows no summary when nothing changed', () => {
    renderView();
    expect(screen.queryByRole('region', { name: a.changes.title })).toBeNull();
  });

  it('offers "make my own copy" behind a confirm step', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: a.fork.label }));
    fireEvent.click(screen.getByRole('button', { name: a.fork.confirm }));
    await waitFor(() => {
      expect(fork).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a repertoire without chapters as empty, with no note', () => {
    renderView({ graph: { ...GRAPH, chapters: [] } });
    expect(screen.getByText(lt.repertoires.panel.emptyBrowse)).toBeDefined();
    expect(
      screen.queryByRole('button', { name: lt.repertoires.note.label }),
    ).toBeNull();
  });
});
