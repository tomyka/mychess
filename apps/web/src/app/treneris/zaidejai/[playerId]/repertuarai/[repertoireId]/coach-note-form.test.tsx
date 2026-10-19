import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/locales';
import type { CoachNoteState } from '../../../../actions';
import { CoachNoteForm, type CoachNoteFormProps } from './coach-note-form';

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

const s = MESSAGES.lt.coach.shared;

function renderForm(
  over: Partial<CoachNoteFormProps> = {},
  locale: 'lt' | 'en' = 'lt',
) {
  const onChange = vi.fn<(text: string) => void>();
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <CoachNoteForm
        target={TARGET}
        playerName="Gabija"
        initial=""
        onChange={onChange}
        {...over}
      />
    </NextIntlClientProvider>,
  );
  return onChange;
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>(s.note);

beforeEach(() => {
  server.save.mockReset().mockResolvedValue({});
  server.remove.mockReset().mockResolvedValue({});
});

describe('CoachNoteForm', () => {
  it('shows the coach’s note and who sees it', () => {
    renderForm({ initial: 'Pirmiau Nf3' });
    expect(field().value).toBe('Pirmiau Nf3');
    expect(screen.getByText('Matote jūs ir Gabija')).toBeDefined();
  });

  it('saves the note on this move and says so', async () => {
    const onChange = renderForm();
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
    expect(
      await screen.findByRole('button', { name: s.deleteNote }),
    ).toBeDefined();
  });

  it('shows a refusal and marks the field', async () => {
    server.save.mockResolvedValue({ refusal: 'coachNote.blank' });
    const onChange = renderForm();
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.coachNote.blank,
      );
    });
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says so when the save fails', async () => {
    server.save.mockRejectedValue(new Error('offline'));
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: s.saveNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.repertoires.failed,
      );
    });
  });

  it('deletes the note on this move and empties the field', async () => {
    const onChange = renderForm({ initial: 'Pirmiau Nf3' });
    fireEvent.click(screen.getByRole('button', { name: s.deleteNote }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(s.noteDeleted);
    });
    expect(server.remove).toHaveBeenCalledWith(TARGET);
    expect(onChange).toHaveBeenCalledWith('');
    expect(field().value).toBe('');
    expect(screen.queryByRole('button', { name: s.deleteNote })).toBeNull();
  });

  it('speaks English on the English page', () => {
    renderForm({}, 'en');
    expect(screen.getByLabelText('My coach note')).toBeDefined();
    expect(screen.getByText('You and Gabija see this')).toBeDefined();
  });
});
