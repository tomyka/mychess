import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { MoveEntry } from './move-entry';

const FIELD = MESSAGES.board.moveInput.label;
const TYPE = MESSAGES.training.drill.type;

function renderEntry(
  onTyped: (text: string) => boolean,
  children?: ReactNode,
): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <MoveEntry onTyped={onTyped}>{children}</MoveEntry>
    </NextIntlClientProvider>,
  );
}

const toggle = (): HTMLElement => screen.getByRole('button', { name: TYPE });
const field = (): HTMLElement => screen.getByLabelText(FIELD);

/** Types `move` into the field and submits it. */
function type(move: string): void {
  fireEvent.change(field(), { target: { value: move } });
  const form = field().closest('form');
  if (form === null) throw new Error('the move field sits in a form');
  fireEvent.submit(form);
}

describe('MoveEntry', () => {
  it('opens the field from Type and puts the focus in it', () => {
    renderEntry(() => true);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field());
  });

  it('closes the open field from Type again, the focus staying on Type', () => {
    renderEntry(() => true);
    fireEvent.click(toggle());
    toggle().focus();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field());
  });

  it('keeps the field mounted while closed, hidden only below lg', () => {
    renderEntry(() => true);
    const row = field().closest('form')?.parentElement;
    expect(row?.className.split(' ')).toContain('max-lg:hidden');
    fireEvent.click(toggle());
    expect(row?.className.split(' ')).not.toContain('max-lg:hidden');
  });

  it('hides Type at lg and up, where the field is always shown', () => {
    renderEntry(() => true);
    expect(toggle().className.split(' ')).toContain('lg:hidden');
  });

  it('closes after a taken move and gives the focus back to Type', () => {
    const onTyped = vi.fn(() => true);
    renderEntry(onTyped);
    fireEvent.click(toggle());
    type('e4');
    expect(onTyped).toHaveBeenCalledWith('e4');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('stays open after a refused move, and closes on Escape', () => {
    renderEntry(() => false);
    fireEvent.click(toggle());
    type('Zz9');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(field());
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle());
  });

  it('leaves the focus alone on Escape while closed', () => {
    renderEntry(() => true);
    field().focus();
    fireEvent.keyDown(field(), { key: 'Escape' });
    expect(document.activeElement).toBe(field());
  });

  it('ignores keys other than Escape', () => {
    renderEntry(() => true);
    fireEvent.click(toggle());
    fireEvent.keyDown(field(), { key: 'a' });
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the buttons it is given beside Type', () => {
    renderEntry(() => true, <button type="button">Hint</button>);
    const hint = screen.getByRole('button', { name: 'Hint' });
    expect(hint.parentElement).toBe(toggle().parentElement);
  });
});
