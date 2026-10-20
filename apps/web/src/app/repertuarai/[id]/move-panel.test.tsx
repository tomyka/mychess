import type { RepertoireMove } from '@mychess/chess';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import {
  PositionBody,
  type CommentEditor,
  type FieldOutcome,
  type NoteOutcome,
} from '../../repertoire-view';
import { OwnerNotes, type OwnerNotesProps } from './move-panel';

const BF4: RepertoireMove = {
  from: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -',
  to: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq -',
  san: 'Bf4',
  uci: 'c1f4',
  arrows: [{ from: 'g1', to: 'f3', color: 'G' }],
  circles: [{ square: 'd4', color: 'R' }],
  comment: 'The London bishop',
  chapters: ['c1'],
};

const p = MESSAGES.en.repertoires;

/** The owner's position section: the position body with the owner's notes. */
interface PanelProps extends Partial<Omit<OwnerNotesProps, 'onSaveNote'>> {
  readonly intro?: string | null;
  readonly move?: RepertoireMove | null;
  readonly commentEditor?: CommentEditor;
}

function renderPanel(over: PanelProps = {}) {
  const onSaveNote = vi
    .fn<(text: string) => Promise<NoteOutcome>>()
    .mockResolvedValue({ ok: true });
  const {
    intro = 'The London: solid and quick.',
    move = null,
    note = '',
    coachNotes = [],
    commentEditor,
  } = over;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <PositionBody
        intro={intro}
        move={move}
        commentEditor={commentEditor}
        renderNotes={(key) => (
          <OwnerNotes
            key={key}
            coachNotes={coachNotes}
            note={note}
            onSaveNote={onSaveNote}
          />
        )}
      />
    </NextIntlClientProvider>,
  );
  return onSaveNote;
}

const noteField = () =>
  screen.getByLabelText<HTMLTextAreaElement>(p.note.label);

/** Opens an empty note's field with its "My note" button (R-116). */
const openNote = () => {
  fireEvent.click(screen.getByRole('button', { name: p.note.label }));
};

describe('OwnerNotes under the position', () => {
  it('shows the chapter intro at the root, and no note there', () => {
    renderPanel();
    expect(screen.getByText('The London: solid and quick.')).toBeDefined();
    expect(screen.queryByLabelText(p.note.label)).toBeNull();
  });

  it('shows nothing at a root without an intro', () => {
    renderPanel({ intro: null });
    expect(screen.queryByText(p.panel.intro)).toBeNull();
  });

  it('shows the move’s comment and its marks as text', () => {
    renderPanel({ move: BF4 });
    expect(screen.getByText('The London bishop')).toBeDefined();
    expect(screen.getByText('Arrows: g1 to f3, green')).toBeDefined();
    expect(screen.getByText('Circles: d4, red')).toBeDefined();
    expect(screen.queryByText('The London: solid and quick.')).toBeNull();
  });

  it('shows each coach’s note on the move, read-only, with the coach’s name (R-107)', () => {
    renderPanel({
      move: BF4,
      coachNotes: [
        { coachId: 'c-1', coachName: 'Dovydas', text: 'Watch for ...Qb6' },
        { coachId: 'c-2', coachName: 'Rimantas', text: 'Play h3 first' },
      ],
    });
    const notes = screen.getByRole('list', { name: 'Coach notes' });
    expect(
      [...notes.querySelectorAll('li')].map((item) => item.textContent),
    ).toEqual([
      'Coach note from DovydasWatch for ...Qb6',
      'Coach note from RimantasPlay h3 first',
    ]);
    expect(notes.querySelector('textarea, input, button')).toBeNull();
  });

  it('shows no coach notes where there are none', () => {
    renderPanel({ move: BF4 });
    expect(screen.queryByRole('list', { name: 'Coach notes' })).toBeNull();
  });

  it('says when a move has no comment', () => {
    renderPanel({ move: { ...BF4, comment: null, arrows: [], circles: [] } });
    expect(screen.getByText(p.panel.noComment)).toBeDefined();
    expect(screen.queryByText(/Arrows/)).toBeNull();
  });

  it('shows an empty note as one "My note" button that opens the field (R-116)', () => {
    renderPanel({ move: BF4 });
    expect(screen.queryByLabelText(p.note.label)).toBeNull();
    expect(screen.queryByRole('button', { name: p.note.save })).toBeNull();
    // The hint still says who sees it before the field opens.
    const hint = screen.getByText(p.note.private);
    expect(
      screen
        .getByRole('button', { name: p.note.label })
        .getAttribute('aria-describedby'),
    ).toBe(hint.id);
    openNote();
    expect(noteField().value).toBe('');
    expect(document.activeElement).toBe(noteField());
    expect(screen.queryByRole('button', { name: p.note.label })).toBeNull();
  });

  it('labels the private note and describes it as only the player’s', () => {
    renderPanel({ move: BF4, note: 'Remember h3' });
    // A written note stays open (R-116).
    expect(screen.queryByRole('button', { name: p.note.label })).toBeNull();
    expect(noteField().value).toBe('Remember h3');
    const hint = screen.getByText(p.note.private);
    expect(noteField().getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('saves the note and says so', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
    openNote();
    fireEvent.change(noteField(), { target: { value: 'Play h3 first' } });
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(onSaveNote).toHaveBeenCalledWith('Play h3 first');
    expect(await screen.findByText(p.note.saved)).toBeDefined();
  });

  it('saves with Ctrl+Enter in the note', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
    openNote();
    fireEvent.change(noteField(), { target: { value: 'Quick' } });
    fireEvent.keyDown(noteField(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(onSaveNote).toHaveBeenCalledWith('Quick');
    });
  });

  it('shows a refusal under the note and keeps the text', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
    onSaveNote.mockResolvedValue({
      ok: false,
      refusal: 'personalNote.tooLong',
    });
    openNote();
    fireEvent.change(noteField(), { target: { value: 'x'.repeat(2001) } });
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(
      await screen.findByText(MESSAGES.en.personalNote.tooLong),
    ).toBeDefined();
    expect(noteField().value).toBe('x'.repeat(2001));
    expect(noteField().getAttribute('aria-invalid')).toBe('true');
  });

  it('says a failed request can be tried again', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
    onSaveNote.mockRejectedValue(new Error('offline'));
    openNote();
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(await screen.findByText(p.failed)).toBeDefined();
  });
});

describe('OwnerNotes under the position in builder mode', () => {
  const builder = (over: Partial<CommentEditor> = {}) => ({
    disabled: false,
    onSave: vi
      .fn<(text: string) => Promise<FieldOutcome>>()
      .mockResolvedValue({ ok: true }),
    ...over,
  });
  const commentField = () =>
    screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: p.builder.commentLabel,
    });

  it('edits the comment in a field with the one-paragraph hint, and says it saved', async () => {
    const editor = builder();
    renderPanel({ move: BF4, commentEditor: editor });
    expect(commentField().value).toBe('The London bishop');
    expect(screen.getByText(p.builder.commentHint)).toBeDefined();
    fireEvent.change(commentField(), { target: { value: 'Develop first' } });
    fireEvent.click(
      screen.getByRole('button', { name: p.builder.commentSave }),
    );
    expect(await screen.findByText(p.builder.commentSaved)).toBeDefined();
    expect(editor.onSave).toHaveBeenCalledWith('Develop first');
  });

  it('shows a refusal under the field and marks it invalid', async () => {
    renderPanel({
      move: BF4,
      commentEditor: builder({
        onSave: vi.fn().mockResolvedValue({
          ok: false,
          refusal: 'comment.tooLong',
        }),
      }),
    });
    fireEvent.click(
      screen.getByRole('button', { name: p.builder.commentSave }),
    );
    expect(await screen.findByText(MESSAGES.en.comment.tooLong)).toBeDefined();
    expect(commentField().getAttribute('aria-invalid')).toBe('true');
  });

  it('counts the characters from 1,800 on', () => {
    renderPanel({ move: BF4, commentEditor: builder() });
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1799) } });
    expect(screen.queryByText(/\/ 2,000/)).toBeNull();
    fireEvent.change(commentField(), { target: { value: 'a'.repeat(1850) } });
    expect(screen.getByText('1,850 / 2,000')).toBeDefined();
  });

  it('cannot save while the screen is saving', () => {
    renderPanel({ move: BF4, commentEditor: builder({ disabled: true }) });
    expect(
      screen.getByRole('button', { name: p.builder.commentSave }),
    ).toHaveProperty('disabled', true);
  });

  it('keeps the chapter intro read-only (R-112)', () => {
    renderPanel({ commentEditor: builder() });
    expect(screen.getByText('The London: solid and quick.')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
