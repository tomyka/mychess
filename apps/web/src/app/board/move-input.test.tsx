import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { MoveInput } from './move-input';

function renderInput(onTyped: (text: string) => boolean, disabled = false) {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <MoveInput onTyped={onTyped} disabled={disabled} />
    </NextIntlClientProvider>,
  );
  return screen.getByRole('textbox', { name: 'Type a move' });
}

describe('MoveInput', () => {
  it('hands the typed move over on Enter and clears the field when it is taken', () => {
    const onTyped = vi.fn(() => true);
    const field = renderInput(onTyped);
    fireEvent.change(field, { target: { value: ' Nf3 ' } });
    fireEvent.submit(field);
    expect(onTyped).toHaveBeenCalledWith('Nf3');
    expect(field).toHaveProperty('value', '');
  });

  it('submits with its button too', () => {
    const onTyped = vi.fn(() => true);
    const field = renderInput(onTyped);
    fireEvent.change(field, { target: { value: 'e4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play the move' }));
    expect(onTyped).toHaveBeenCalledWith('e4');
  });

  it('keeps what was typed when the move is not taken', () => {
    const field = renderInput(() => false);
    fireEvent.change(field, { target: { value: 'Nf6' } });
    fireEvent.submit(field);
    expect(field).toHaveProperty('value', 'Nf6');
  });

  it('sends nothing for an empty field', () => {
    const onTyped = vi.fn(() => true);
    const field = renderInput(onTyped);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.submit(field);
    expect(onTyped).not.toHaveBeenCalled();
  });

  it('is a phone-friendly field: no capitals, no correction, "go" key', () => {
    const field = renderInput(() => true);
    expect(field.getAttribute('autocapitalize')).toBe('off');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.getAttribute('enterkeyhint')).toBe('go');
  });

  it('takes no move while disabled', () => {
    const field = renderInput(() => true, true);
    expect(field).toHaveProperty('disabled', true);
    expect(
      screen.getByRole('button', { name: 'Play the move' }),
    ).toHaveProperty('disabled', true);
  });
});
