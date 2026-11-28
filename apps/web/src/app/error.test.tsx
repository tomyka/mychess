import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n/catalogue';
import AppError from './error';

const en = MESSAGES.error;

const FAILURE = Object.assign(new Error('db connection refused at 10.0.0.5'), {
  digest: 'abc123',
});

function renderError(reset: () => void): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <AppError error={FAILURE} reset={reset} />
    </NextIntlClientProvider>,
  );
}

describe('the app error page (#381 part 6)', () => {
  it('says something went wrong, with Try again and Go to Today', () => {
    renderError(vi.fn());
    const main = screen.getByRole('main');
    expect(
      within(main).getByRole('heading', { level: 1, name: en.title }),
    ).toBeDefined();
    expect(within(main).getByRole('button', { name: en.retry })).toBeDefined();
    expect(
      within(main)
        .getByRole('link', { name: MESSAGES.nav.goToday })
        .getAttribute('href'),
    ).toBe('/');
  });

  it('tries again by calling reset', () => {
    const reset = vi.fn();
    renderError(reset);
    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('shows nothing of the error itself', () => {
    renderError(vi.fn());
    expect(document.body.textContent).not.toContain('10.0.0.5');
    expect(document.body.textContent).not.toContain('abc123');
  });
});
