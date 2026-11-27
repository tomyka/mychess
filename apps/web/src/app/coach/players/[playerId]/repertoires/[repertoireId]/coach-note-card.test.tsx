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
import { DANGER_OUTLINE_BUTTON } from '../../../../../buttons';
import type { CoachNoteState } from '../../../../actions';
import { CoachNoteCard } from './coach-note-card';

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
// The catalogue's words, as the card reads them.
const t = createTranslator({
  locale: LOCALE,
  messages: MESSAGES,
  namespace: 'coach.shared',
});
const HEADING = t('noteOn', { move: '5... Qc7', name: 'Gabija' });

/** The card with its note kept above it, as the view keeps it. */
function Kept({ initial }: { readonly initial: string }): JSX.Element {
  const [note, setNote] = useState(initial);
  return (
    <CoachNoteCard
      target={TARGET}
      note={note}
      onChange={setNote}
      move="5... Qc7"
      playerName="Gabija"
    />
  );
}

function renderCard(initial: string): HTMLElement {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <Kept initial={initial} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('region', { name: HEADING });
}

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  server.save.mockReset().mockResolvedValue({});
  server.remove.mockReset().mockResolvedValue({});
});

describe('CoachNoteCard (desktop)', () => {
  it('is a desktop card, headed by the move and who sees it, with the note, Edit and Delete', () => {
    const card = renderCard('Play ...b5 first');
    // Below lg (where the frame stacks) the one-line strip stands in for it.
    expect(card.className).toMatch(/(^|\s)hidden(\s|$)/u);
    expect(card.className).toContain('lg:block');
    expect(within(card).getByRole('heading', { name: HEADING })).toBeDefined();
    expect(within(card).getByText('Play ...b5 first')).toBeDefined();
    expect(button(s.editNote)).toBeDefined();
    expect(button(s.deleteNote).className).toContain(DANGER_OUTLINE_BUTTON);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers Add a note, and no Delete, on a move without a note', () => {
    renderCard('');
    expect(button(s.addNote)).toBeDefined();
    expect(screen.queryByRole('button', { name: s.editNote })).toBeNull();
    expect(screen.queryByRole('button', { name: s.deleteNote })).toBeNull();
  });

  it('turns into the field with Save and Cancel in place, and Save shows the new text', async () => {
    const card = renderCard('Play ...b5 first');
    fireEvent.click(button(s.editNote));
    const field = within(card).getByRole<HTMLTextAreaElement>('textbox', {
      name: HEADING,
    });
    expect(field.value).toBe('Play ...b5 first');
    expect(button(s.cancel)).toBeDefined();
    expect(screen.queryByRole('button', { name: s.deleteNote })).toBeNull();
    fireEvent.change(field, { target: { value: 'Play ...b5 now' } });
    fireEvent.click(button(s.saveNote));
    expect(await within(card).findByText('Play ...b5 now')).toBeDefined();
    expect(server.save).toHaveBeenCalledWith({
      ...TARGET,
      text: 'Play ...b5 now',
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(s.noteSaved);
  });

  it('adds a note through the same field', async () => {
    const card = renderCard('');
    fireEvent.click(button(s.addNote));
    fireEvent.change(within(card).getByRole('textbox', { name: HEADING }), {
      target: { value: 'Watch Nd5' },
    });
    fireEvent.click(button(s.saveNote));
    expect(await within(card).findByText('Watch Nd5')).toBeDefined();
    expect(button(s.editNote)).toBeDefined();
  });

  it('cancels without saving and shows the note as it was', () => {
    renderCard('Play ...b5 first');
    fireEvent.click(button(s.editNote));
    fireEvent.change(screen.getByRole('textbox', { name: HEADING }), {
      target: { value: 'changed' },
    });
    fireEvent.click(button(s.cancel));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Play ...b5 first')).toBeDefined();
    fireEvent.click(button(s.editNote));
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: HEADING }).value,
    ).toBe('Play ...b5 first');
    expect(server.save).not.toHaveBeenCalled();
  });

  it('keeps the field open with the refusal when a save is refused', async () => {
    server.save.mockResolvedValue({ refusal: 'coachNote.blank' });
    renderCard('Play ...b5 first');
    fireEvent.click(button(s.editNote));
    fireEvent.click(button(s.saveNote));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.coachNote.blank,
      );
    });
    expect(
      screen
        .getByRole('textbox', { name: HEADING })
        .getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('deletes the note and offers Add a note again', async () => {
    renderCard('Play ...b5 first');
    fireEvent.click(button(s.deleteNote));
    expect(
      await screen.findByRole('button', { name: s.addNote }),
    ).toBeDefined();
    expect(server.remove).toHaveBeenCalledWith(TARGET);
    expect(screen.queryByText('Play ...b5 first')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(s.noteDeleted);
  });
});
