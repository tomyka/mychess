import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { NoteOutcome } from '../../repertoire-view';
import { OwnerNotes, type OwnerNotesProps } from './owner-notes';

const p = MESSAGES.en.repertoires;

/** The owner's notes under a move: the coaches' notes and the Personal note. */
function renderNotes(over: Partial<Omit<OwnerNotesProps, 'onSaveNote'>> = {}) {
  const onSaveNote = vi
    .fn<(text: string) => Promise<NoteOutcome>>()
    .mockResolvedValue({ ok: true });
  const { note = '', coachNotes = [] } = over;
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <OwnerNotes coachNotes={coachNotes} note={note} onSaveNote={onSaveNote} />
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

describe('OwnerNotes under a move', () => {
  it('shows each coach’s note on the move, read-only, with the coach’s name (R-107)', () => {
    renderNotes({
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
    renderNotes();
    expect(screen.queryByRole('list', { name: 'Coach notes' })).toBeNull();
  });

  it('shows an empty note as one "My note" button that opens the field (R-116)', () => {
    renderNotes();
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
    renderNotes({ note: 'Remember h3' });
    // A written note stays open (R-116).
    expect(screen.queryByRole('button', { name: p.note.label })).toBeNull();
    expect(noteField().value).toBe('Remember h3');
    const hint = screen.getByText(p.note.private);
    expect(noteField().getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('saves the note and says so', async () => {
    const onSaveNote = renderNotes();
    openNote();
    fireEvent.change(noteField(), { target: { value: 'Play h3 first' } });
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(onSaveNote).toHaveBeenCalledWith('Play h3 first');
    expect(await screen.findByText(p.note.saved)).toBeDefined();
  });

  it('saves with Ctrl+Enter in the note', async () => {
    const onSaveNote = renderNotes();
    openNote();
    fireEvent.change(noteField(), { target: { value: 'Quick' } });
    fireEvent.keyDown(noteField(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(onSaveNote).toHaveBeenCalledWith('Quick');
    });
  });

  it('shows a refusal under the note and keeps the text', async () => {
    const onSaveNote = renderNotes();
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
    const onSaveNote = renderNotes();
    onSaveNote.mockRejectedValue(new Error('offline'));
    openNote();
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(await screen.findByText(p.failed)).toBeDefined();
  });
});
