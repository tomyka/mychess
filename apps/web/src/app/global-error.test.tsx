import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import GlobalError from './global-error';

// next/font is compiled by Next; here the font only names its class.
vi.mock('./fonts', () => ({ inter: { variable: 'inter-variable' } }));

const en = MESSAGES.error;

const FAILURE = Object.assign(new Error('root layout threw: secret detail'), {
  digest: 'def456',
});

/**
 * It replaces the root layout, so it brings its own <html>, <body> and
 * message provider: rendered here with no provider around it, into the
 * test document's own <html>.
 */
function renderGlobalError(reset: () => void): void {
  render(<GlobalError error={FAILURE} reset={reset} />, {
    container: document,
  });
}

describe('the global error page (#381 part 6)', () => {
  it('is a whole document in English, with nothing of the error itself', () => {
    renderGlobalError(vi.fn());
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    // The root layout's font, as that layout is not there (qa, #381).
    expect(document.documentElement.classList).toContain('inter-variable');
    expect(
      screen.getByRole('heading', { level: 1, name: en.title }),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain('secret detail');
    expect(document.body.textContent).not.toContain('def456');
  });

  it('says something went wrong, with Try again calling reset and Go to Today', () => {
    const reset = vi.fn();
    renderGlobalError(reset);
    const main = screen.getByRole('main');
    expect(
      within(main)
        .getByRole('link', { name: MESSAGES.nav.goToday })
        .getAttribute('href'),
    ).toBe('/');
    fireEvent.click(within(main).getByRole('button', { name: en.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
