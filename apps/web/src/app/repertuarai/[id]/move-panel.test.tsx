import type { RepertoireMove } from '@mychess/chess';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/locales';
import type { NoteOutcome } from './actions';
import { MovePanel, type MovePanelProps } from './move-panel';

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

function renderPanel(over: Partial<MovePanelProps> = {}) {
  const onSaveNote = vi
    .fn<(text: string) => Promise<NoteOutcome>>()
    .mockResolvedValue({ ok: true });
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <MovePanel
        intro="The London: solid and quick."
        move={null}
        note=""
        onSaveNote={onSaveNote}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return onSaveNote;
}

const noteField = () =>
  screen.getByLabelText<HTMLTextAreaElement>(p.note.label);

describe('MovePanel', () => {
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

  it('says when a move has no comment', () => {
    renderPanel({ move: { ...BF4, comment: null, arrows: [], circles: [] } });
    expect(screen.getByText(p.panel.noComment)).toBeDefined();
    expect(screen.queryByText(/Arrows/)).toBeNull();
  });

  it('labels the private note and describes it as only the player’s', () => {
    renderPanel({ move: BF4, note: 'Remember h3' });
    expect(noteField().value).toBe('Remember h3');
    const hint = screen.getByText(p.note.private);
    expect(noteField().getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('saves the note and says so', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
    fireEvent.change(noteField(), { target: { value: 'Play h3 first' } });
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(onSaveNote).toHaveBeenCalledWith('Play h3 first');
    expect(await screen.findByText(p.note.saved)).toBeDefined();
  });

  it('saves with Ctrl+Enter in the note', async () => {
    const onSaveNote = renderPanel({ move: BF4 });
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
    fireEvent.click(screen.getByRole('button', { name: p.note.save }));
    expect(await screen.findByText(p.failed)).toBeDefined();
  });
});
