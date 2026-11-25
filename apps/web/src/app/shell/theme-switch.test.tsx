import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { ShellProvider } from './shell-context';
import { ThemeSwitch } from './theme-switch';

const show = (initial: 'system' | 'light' | 'dark') =>
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <ShellProvider
        value={{ accountId: 'a1', displayName: 'Rokas', theme: initial }}
      >
        <ThemeSwitch />
      </ShellProvider>
    </NextIntlClientProvider>,
  );

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.cookie = 'theme=; max-age=0; path=/';
});

describe('ThemeSwitch', () => {
  it('checks the current theme', () => {
    show('dark');
    expect(
      screen.getByRole<HTMLInputElement>('radio', { name: 'Dark' }).checked,
    ).toBe(true);
  });

  it('applies a chosen theme to the page and remembers it', () => {
    show('system');
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.cookie).toContain('theme=light');
  });

  it('follows the system again when System is chosen', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    show('dark');
    fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.cookie).toContain('theme=system');
  });
});
