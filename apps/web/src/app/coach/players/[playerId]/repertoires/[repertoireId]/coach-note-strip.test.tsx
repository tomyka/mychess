import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { useState, type JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCALE, MESSAGES } from '../../../../../../i18n/catalogue';
import type { CoachNoteState } from '../../../../actions';
import { CoachNoteStrip } from './coach-note-strip';

const server = vi.hoisted(() => ({
  save: vi.fn<(input: unknown) => Promise<CoachNoteState>>(),
  remove: vi.fn<(input: unknown) => Promise<CoachNoteState>>(),
}));

vi.mock('../../../../actions', () => ({
  saveCoachNoteAction: server.save,
  deleteCoachNoteAction: server.remove,
}));

const TARGET = {
  playerId: 'p-1',
  repertoireId: '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10',
  moveKey: 'k|Qc7',
};

const s = MESSAGES.coach.shared;
// The catalogue's words, as the strip reads them.
const t = createTranslator({
  locale: LOCALE,
  messages: MESSAGES,
  namespace: 'coach.shared',
});
const MOVE = '5... Qc7';
const LABEL = t('noteOn', { move: MOVE, name: 'Gabija' });
const EDIT = t('editNoteOn', { move: MOVE });
const ADD = t('addNoteOn', { move: MOVE });

/**
 * What the strip's polite line says, with the sheet closed: the sheet's
 * own status line goes with it, so the strip's is the one status left.
 */
const announced = () => screen.getByRole('status').textContent;

/** The strip with its note kept above it, as the view keeps it. */
function Kept({ initial }: { readonly initial: string }): JSX.Element {
  const [note, setNote] = useState(initial);
  return (
    <CoachNoteStrip
      target={TARGET}
      note={note}
      onChange={setNote}
      move="5... Qc7"
      playerName="Gabija"
    />
  );
}

function renderStrip(initial: string): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <Kept initial={initial} />
    </NextIntlClientProvider>,
  );
}

/** The sheet: the one dialog element, open or not. */
function sheet(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog');
  return dialog;
}

beforeEach(() => {
  server.save.mockReset().mockResolvedValue({});
  server.remove.mockReset().mockResolvedValue({});
});

describe('CoachNoteStrip (phone)', () => {
  it('is one button on a phone: the pen, the note on one line and Edit', () => {
    renderStrip('Play ...b5 first, then Bb7 and the long diagonal');
    const strip = screen.getByRole('button', { name: EDIT });
    // From lg the frame is two columns and the card stands in for it.
    expect(strip.closest('.lg\\:hidden')).not.toBeNull();
    expect(strip.className).toContain('min-h-touch');
    expect(strip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const text = within(strip).getByText(
      'Play ...b5 first, then Bb7 and the long diagonal',
    );
    // One line, so the strip is one 44px row (height budget).
    expect(text.className).toContain('line-clamp-1');
    expect(within(strip).getByText(s.editNote)).toBeDefined();
    expect(sheet().open).toBe(false);
  });

  it('says Add a note on a move without a note', () => {
    renderStrip('');
    const strip = screen.getByRole('button', { name: ADD });
    expect(within(strip).getByText(s.addNote)).toBeDefined();
  });

  it('opens the sheet named Coach note, with the field, Save and Delete; closing returns focus to the strip', () => {
    renderStrip('Play ...b5 first');
    const strip = screen.getByRole('button', { name: EDIT });
    fireEvent.click(strip);
    expect(sheet().open).toBe(true);
    const dialog = within(screen.getByRole('dialog', { name: s.noteTitle }));
    expect(
      dialog.getByRole<HTMLTextAreaElement>('textbox', { name: LABEL }).value,
    ).toBe('Play ...b5 first');
    expect(dialog.getByRole('button', { name: s.saveNote })).toBeDefined();
    expect(dialog.getByRole('button', { name: s.deleteNote })).toBeDefined();
    fireEvent.click(dialog.getByRole('button', { name: s.close }));
    expect(sheet().open).toBe(false);
    expect(document.activeElement).toBe(strip);
  });

  it('saves from the sheet, closes it and shows the new note on the strip', async () => {
    renderStrip('');
    fireEvent.click(screen.getByRole('button', { name: ADD }));
    fireEvent.change(screen.getByRole('textbox', { name: LABEL }), {
      target: { value: 'Watch Nd5' },
    });
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    const strip = await screen.findByRole('button', { name: EDIT });
    expect(within(strip).getByText('Watch Nd5')).toBeDefined();
    await waitFor(() => {
      expect(sheet().open).toBe(false);
    });
    expect(document.activeElement).toBe(strip);
    expect(server.save).toHaveBeenCalledWith({ ...TARGET, text: 'Watch Nd5' });
    // The sheet's own status line went with it: the strip says it.
    expect(announced()).toBe(s.noteSaved);
  });

  it('deletes from the sheet', async () => {
    renderStrip('Play ...b5 first');
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.click(screen.getByRole('button', { name: s.deleteNote }));
    expect(await screen.findByRole('button', { name: ADD })).toBeDefined();
    expect(server.remove).toHaveBeenCalledWith(TARGET);
    await waitFor(() => {
      expect(sheet().open).toBe(false);
    });
    expect(announced()).toBe(s.noteDeleted);
  });

  it('says nothing before a save, nor after a sheet closed unsaved', () => {
    renderStrip('Play ...b5 first');
    expect(announced()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.click(screen.getByRole('button', { name: s.close }));
    expect(announced()).toBe('');
  });

  it('opens the sheet afresh: an edit closed unsaved is gone', () => {
    renderStrip('Play ...b5 first');
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    fireEvent.change(screen.getByRole('textbox', { name: LABEL }), {
      target: { value: 'changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: s.close }));
    fireEvent.click(screen.getByRole('button', { name: EDIT }));
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: LABEL }).value,
    ).toBe('Play ...b5 first');
  });
});
