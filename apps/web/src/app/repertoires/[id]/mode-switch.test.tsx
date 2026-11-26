import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../i18n/catalogue';
import { ModeSwitch } from './mode-switch';

function renderSwitch(building: boolean) {
  const onChange = vi.fn<(building: boolean) => void>();
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ModeSwitch building={building} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

describe('ModeSwitch (finding 9)', () => {
  it('is one switch labelled Edit, the word visible at every width', () => {
    renderSwitch(false);
    const edit = screen.getByRole('switch', {
      name: MESSAGES.repertoires.mode.build,
    });
    expect(edit.getAttribute('aria-checked')).toBe('false');
    const word = screen.getByText(MESSAGES.repertoires.mode.build);
    expect(edit.contains(word)).toBe(true);
    expect(word.className).not.toContain('sr-only');
  });

  it('turns building on and off', () => {
    const onChange = renderSwitch(true);
    const edit = screen.getByRole('switch');
    expect(edit.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(edit);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
