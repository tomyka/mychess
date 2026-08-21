// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';

vi.mock('$lib/paraglide/runtime', () => ({
  getLocale: vi.fn(() => 'en'),
  setLocale: vi.fn()
}));
vi.mock('$lib/paraglide/messages', () => ({
  m: { language_switcher_label: () => 'Select language' }
}));

import { setLocale } from '$lib/paraglide/runtime';
import LanguageSwitcher from './LanguageSwitcher.svelte';

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true })) as any;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LanguageSwitcher', () => {
  it('shows the current locale code as the trigger label', () => {
    render(LanguageSwitcher);
    expect(screen.getByRole('button', { name: /select language/i })).toHaveTextContent('en');
  });

  it('opens a dropdown listing both languages', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Lietuviškai')).toBeTruthy();
  });

  it('posts the choice and switches locale when a different language is selected', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    await fireEvent.click(screen.getByText('Lietuviškai'));

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/locale',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ locale: 'lt' }) })
    );
    expect(setLocale).toHaveBeenCalledWith('lt');
  });

  it('does nothing when selecting the already-active language', async () => {
    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    await fireEvent.click(screen.getByText('English'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('still switches locale even when persisting the choice fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async () => {
      throw new Error('network error');
    }) as any;

    render(LanguageSwitcher);
    await fireEvent.click(screen.getByRole('button', { name: /select language/i }));
    await fireEvent.click(screen.getByText('Lietuviškai'));

    expect(setLocale).toHaveBeenCalledWith('lt');
    expect(consoleError).toHaveBeenCalled();
  });
});
