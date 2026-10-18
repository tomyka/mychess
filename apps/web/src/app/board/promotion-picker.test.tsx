import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { PromotionPicker } from './promotion-picker';

function renderPicker(color: 'white' | 'black' = 'white') {
  const onPick = vi.fn();
  const onCancel = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES.en}>
      <PromotionPicker color={color} onPick={onPick} onCancel={onCancel} />
    </NextIntlClientProvider>,
  );
  return {
    onPick,
    onCancel,
    group: screen.getByRole('group', { name: 'Promote to' }),
  };
}

describe('PromotionPicker', () => {
  it('offers the four pieces in the order queen, rook, bishop, knight', () => {
    const { group } = renderPicker();
    expect(
      within(group)
        .getAllByRole('button')
        .map(
          (button) => button.getAttribute('aria-label') ?? button.textContent,
        ),
    ).toEqual(['Queen', 'Rook', 'Bishop', 'Knight', 'Cancel']);
  });

  it('picks the piece clicked', () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Knight' }));
    expect(onPick).toHaveBeenCalledWith('n');
    fireEvent.click(screen.getByRole('button', { name: 'Queen' }));
    expect(onPick).toHaveBeenLastCalledWith('q');
  });

  it('moves focus to the queen', () => {
    renderPicker();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Queen' }),
    );
  });

  it('cancels with its button or Escape', () => {
    const { onCancel, group } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(group, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows the pieces of the side that promotes', () => {
    renderPicker('black');
    const queen = screen.getByRole('button', { name: 'Queen' });
    expect(queen.querySelector('piece')?.getAttribute('class')).toBe(
      'queen black',
    );
  });
});
