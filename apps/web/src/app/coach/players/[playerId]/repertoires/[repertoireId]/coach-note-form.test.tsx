import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/catalogue';
import { DANGER_OUTLINE_BUTTON } from '../../../../../buttons';
import type { CoachNoteState } from '../../../../actions';
import {
  CoachNoteFields,
  DeleteNoteButton,
  useCoachNote,
} from './coach-note-form';

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
  moveKey: 'k|e4',
};

const s = MESSAGES.coach.shared;
/** The view's label for the field: any text; the views' own are their tests'. */
const LABEL = 'Note label';

/** The fields as a view uses them: the note kept above, Delete beside Save. */
function Harness({
  initial,
  onChange,
  onDone,
}: {
  readonly initial: string;
  readonly onChange: (text: string) => void;
  readonly onDone: () => void;
}): JSX.Element {
  const [note, setNote] = useState(initial);
  const coachNote = useCoachNote({
    target: TARGET,
    note,
    onChange: (text) => {
      setNote(text);
      onChange(text);
    },
    onDone,
  });
  return (
    <>
      <p id="label">{LABEL}</p>
      <CoachNoteFields note={coachNote} labelledBy="label">
        <DeleteNoteButton note={coachNote} />
      </CoachNoteFields>
    </>
  );
}

function renderFields(initial = '') {
  const onChange = vi.fn<(text: string) => void>();
  const onDone = vi.fn<() => void>();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <Harness initial={initial} onChange={onChange} onDone={onDone} />
    </NextIntlClientProvider>,
  );
  return { onChange, onDone };
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>(LABEL);

beforeEach(() => {
  server.save.mockReset().mockResolvedValue({});
  server.remove.mockReset().mockResolvedValue({});
});

describe('CoachNoteFields', () => {
  it('shows the coach’s note in a field named by the view’s label', () => {
    renderFields('Pirmiau Nf3');
    expect(field().value).toBe('Pirmiau Nf3');
    expect(field().tagName).toBe('TEXTAREA');
  });

  it('saves the note on this move, tells the view the trimmed text and says so', async () => {
    const { onChange, onDone } = renderFields();
    expect(screen.queryByRole('button', { name: s.deleteNote })).toBeNull();
    fireEvent.change(field(), { target: { value: '  Pirmiau Nf3 ' } });
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(s.noteSaved);
    });
    expect(server.save).toHaveBeenCalledWith({
      ...TARGET,
      text: '  Pirmiau Nf3 ',
    });
    expect(onChange).toHaveBeenCalledWith('Pirmiau Nf3');
    expect(onDone).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('button', { name: s.deleteNote }),
    ).toBeDefined();
  });

  it('shows a refusal, marks the field and stays open', async () => {
    server.save.mockResolvedValue({ refusal: 'coachNote.blank' });
    const { onChange, onDone } = renderFields();
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.coachNote.blank,
      );
    });
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(
      screen.getByRole('status').id,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('says so when the save fails', async () => {
    server.save.mockRejectedValue(new Error('offline'));
    renderFields();
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.repertoires.failed,
      );
    });
  });

  it('deletes the note on this move, in the error tone, and empties the field', async () => {
    const { onChange, onDone } = renderFields('Pirmiau Nf3');
    const remove = screen.getByRole('button', { name: s.deleteNote });
    expect(remove.className).toContain(DANGER_OUTLINE_BUTTON);
    fireEvent.click(remove);
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(s.noteDeleted);
    });
    expect(server.remove).toHaveBeenCalledWith(TARGET);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onDone).toHaveBeenCalledOnce();
    expect(field().value).toBe('');
    expect(screen.queryByRole('button', { name: s.deleteNote })).toBeNull();
  });
});
