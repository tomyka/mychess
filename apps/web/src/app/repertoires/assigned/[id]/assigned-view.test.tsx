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
import { MESSAGES } from '../../../../i18n/catalogue';
import type { AssignedRepertoirePage } from '../../../../server/assignment-pages';
import type { RepertoireTraining } from '../../../../server/training';
import {
  pageTraining,
  standingsOnly,
} from '../../../repertoire-view/test-training';
import type { NoteOutcome } from '../../../repertoire-view';
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
  seen: vi.fn<(input: unknown) => Promise<void>>(),
  note: vi.fn<(input: unknown) => Promise<NoteOutcome>>(),
}));

vi.mock('./actions', () => ({
  markSeenAction: server.seen,
  setPersonalNoteAction: server.note,
}));

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const D4 = moveKey(START_KEY, 'd4');

/** The panel's scroller, where the summary line and status strip are first. */
function panel() {
  const scroller = document.querySelector<HTMLElement>('[data-panel-scroller]');
  if (scroller === null) throw new Error('no panel');
  return within(scroller);
}
const a = MESSAGES.assignment;
const GRAPH = graphOf(LONDON);

/** The page's day. */
const TODAY = '2026-11-26';

/** Rokas's training of it: 3 due, 5 to learn today, 60% learned. */
const STANDING = {
  counts: { notStarted: 1, skipped: 0, due: 3, learned: 6 },
  mastered: false,
};
const TRAINING: RepertoireTraining = pageTraining(
  { counts: { due: 3, toLearn: 5 } },
  STANDING,
);

/** Rokas's London as his coach Jonas assigned it, nothing changed since. */
const DATA: AssignedRepertoirePage = {
  repertoire: { id: ID, name: 'Londono sistema', side: 'white', version: 4 },
  coachName: 'Jonas',
  graph: GRAPH,
  personalNotes: {},
  paused: false,
  deadline: null,
  overdue: false,
  names: { taxonomyNames: {}, distinctions: {} },
  changes: { added: [], removed: [], commentsChanged: 0 },
};

function renderView(
  over: Partial<AssignedRepertoirePage> = {},
  training: RepertoireTraining | null = null,
): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <AssignedView
        data={{ ...DATA, ...over }}
        today={TODAY}
        training={training}
      />
    </NextIntlClientProvider>,
  );
}

const forward = () => {
  fireEvent.click(
    screen.getByRole('button', { name: MESSAGES.repertoires.nav.forward }),
  );
};

const noteField = () =>
  screen.queryByLabelText<HTMLTextAreaElement>(MESSAGES.repertoires.note.label);

beforeEach(() => {
  server.seen.mockReset().mockResolvedValue(undefined);
  server.note.mockReset().mockResolvedValue({ ok: true });
});

describe('AssignedView (R-21, R-102)', () => {
  it('names the repertoire and its coach, and leads back to Repertoires', () => {
    renderView();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Londono sistema' }),
    ).toBeDefined();
    expect(screen.getByText('Jonas')).toBeDefined();
    expect(
      screen
        .getByRole('link', { name: 'Back to Repertoires' })
        .getAttribute('href'),
    ).toBe('/repertoires');
    expect(screen.getByRole('application')).toBeDefined();
  });

  it('is read-only: none of the owner’s controls and no comment field', () => {
    renderView();
    forward();
    const header = MESSAGES.repertoires.manage;
    for (const name of [
      MESSAGES.repertoires.mode.toBuild,
      header.rename,
      header.delete,
      header.importInto,
    ])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByRole('link', { name: header.importInto })).toBeNull();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('leads to its Repertoire screen for pause, download and the copy (R-226)', () => {
    renderView();
    expect(
      screen
        .getByRole('link', { name: MESSAGES.repertoires.more })
        .getAttribute('href'),
    ).toBe(`/repertoires/assigned/${ID}/manage`);
    expect(
      screen.queryByRole('link', {
        name: MESSAGES.repertoires.manage.download,
      }),
    ).toBeNull();
    for (const name of [a.pause.pause, a.fork.label])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('shows the coach’s comments as coach notes with the coach’s name', () => {
    renderView();
    forward();
    const note = screen.getByRole('region', {
      name: 'Coach note from Jonas',
    });
    expect(within(note).getByText('Solid')).toBeDefined();
  });

  it('lets the player write a private note, saved on this assignment', async () => {
    renderView();
    forward();
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.repertoires.note.label }),
    );
    const field = noteField();
    if (field === null) throw new Error('no note field');
    fireEvent.change(field, { target: { value: 'Mano planas' } });
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.repertoires.note.save }),
    );
    expect(
      await screen.findByText(MESSAGES.repertoires.note.saved),
    ).toBeDefined();
    expect(server.note).toHaveBeenCalledWith({
      repertoireId: ID,
      moveKey: D4,
      text: 'Mano planas',
    });
  });

  it('shows the player’s own note and marks its move in the move list', () => {
    renderView({ personalNotes: { [D4]: 'Mano planas' } });
    const d4 = screen.getByRole('button', {
      name: `1. d4, ${MESSAGES.repertoires.moves.hasComment}, ${MESSAGES.repertoires.moves.hasNote}`,
    });
    expect(d4.querySelector('[data-note="personal"]')).not.toBeNull();
    forward();
    expect(noteField()?.value).toBe('Mano planas');
  });

  it('sums it up first in the panel: the share learned, Review and Learn today, the status strip (sign-off)', () => {
    renderView({ deadline: '2026-11-30' }, TRAINING);
    // One row above the board: back, the name and More.
    expect(
      within(screen.getByRole('banner')).queryByText(/learned|Jonas/u),
    ).toBeNull();
    const header = panel();
    expect(header.getByText('60% learned')).toBeDefined();
    expect(
      header.getByRole('link', { name: 'Review 3' }).getAttribute('href'),
    ).toBe(`/training?mode=review&r=${ID}`);
    expect(
      header.getByRole('link', { name: 'Learn 5 today' }).getAttribute('href'),
    ).toBe(`/training?mode=learn&r=${ID}`);
    expect(header.getByText('Jonas')).toBeDefined();
    expect(header.getByText('due Nov 30 · in 4 days')).toBeDefined();
    expect(header.queryByText(a.badge.overdue)).toBeNull();
  });

  it('keeps the share learned and shows the Paused pill, but offers no training while paused (R-222, R-46)', () => {
    // While paused the loader gives the standing and nothing to train.
    renderView({ paused: true }, standingsOnly(STANDING));
    const header = panel();
    expect(header.getByText('60% learned')).toBeDefined();
    expect(header.getByText(a.badge.paused)).toBeDefined();
    expect(screen.queryByRole('link', { name: /^Review/u })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Learn/u })).toBeNull();
    forward();
    expect(
      screen.queryByRole('region', { name: MESSAGES.training.know.section }),
    ).toBeNull();
  });

  it('keeps each chapter’s progress in the chapter line while paused (R-228)', () => {
    const [first] = GRAPH.chapters.map((chapter) => chapter.id);
    renderView(
      { paused: true },
      standingsOnly(STANDING, {
        [first ?? '']: {
          counts: { notStarted: 0, skipped: 0, due: 3, learned: 7 },
          mastered: false,
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Ch 1\/2 · / }));
    expect(screen.getByText('70% learned · 3 due')).toBeDefined();
  });

  it('shows the Overdue pill once the deadline passed (R-16, R-51)', () => {
    renderView({ deadline: '2026-10-19', overdue: true });
    const header = panel();
    expect(header.getByText(a.badge.overdue)).toBeDefined();
    expect(header.queryByText(/^due/u)).toBeNull();
  });

  it('shows neither a deadline nor overdue without a deadline', () => {
    renderView();
    const header = panel();
    expect(header.queryByText(/due/u)).toBeNull();
    expect(header.queryByText(a.badge.overdue)).toBeNull();
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
    renderView({ changes: { added: [], removed: [], commentsChanged: 2 } });
    expect(screen.getByRole('region', { name: a.changes.title })).toBeDefined();
  });

  it('shows no summary when nothing changed', () => {
    renderView();
    expect(screen.queryByRole('region', { name: a.changes.title })).toBeNull();
  });

  it('says a move the chapter lacks is the coach’s to change, and leads to the copy (#320)', () => {
    renderView();
    expect(screen.queryByRole('link', { name: a.fork.label })).toBeNull();
    const field = screen.getByLabelText<HTMLInputElement>(
      MESSAGES.board.moveInput.label,
    );
    fireEvent.change(field, { target: { value: 'e4' } });
    fireEvent.submit(field);
    expect(screen.getByText(a.notInChapter)).toBeDefined();
    expect(
      screen.queryByText(MESSAGES.repertoires.board.notInRepertoire),
    ).toBeNull();
    // The copy's question opens on the Repertoire screen (R-226).
    expect(
      screen.getByRole('link', { name: a.fork.label }).getAttribute('href'),
    ).toBe(`/repertoires/assigned/${ID}/manage?fork=1`);
  });

  it('shows a repertoire without chapters as empty, with no note', () => {
    renderView({ graph: { ...GRAPH, chapters: [] } });
    expect(
      screen.getByText(MESSAGES.repertoires.panel.emptyBrowse),
    ).toBeDefined();
    expect(
      screen.queryByRole('button', { name: MESSAGES.repertoires.note.label }),
    ).toBeNull();
  });
});
