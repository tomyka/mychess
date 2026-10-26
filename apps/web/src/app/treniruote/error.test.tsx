import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import TrainingError from './error';

const T = MESSAGES.lt.training;

/** An error as Next hands it over: a message that may hold personal data, and maybe a digest. */
function failure(digest?: string): Error & { digest?: string } {
  const error = new Error('Rokas rokas@example.test: connection refused');
  return digest === undefined ? error : Object.assign(error, { digest });
}

let errors: MockInstance<typeof console.error>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  return () => {
    errors.mockRestore();
  };
});

function renderError(error = failure('d1g3st')) {
  const retry = vi.fn();
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      <TrainingError error={error} retry={retry} />
    </NextIntlClientProvider>,
  );
  return { retry };
}

describe('the training page when the session could not load', () => {
  it('says so in one line and moves focus to it', () => {
    renderError();
    expect(document.activeElement).toBe(screen.getByText(T.loadFailed));
  });

  it('never shows the error message', () => {
    renderError();
    expect(document.body.textContent).not.toContain('rokas@example.test');
  });

  it('tries again when asked', () => {
    const { retry } = renderError();
    fireEvent.click(screen.getByRole('button', { name: T.tryAgain }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('offers the way back home', () => {
    renderError();
    expect(
      screen.getByRole('link', { name: T.back }).getAttribute('href'),
    ).toBe('/');
  });

  it('puts nothing over the board: the two actions are all Tab reaches', () => {
    renderError();
    expect([...document.querySelectorAll('a[href], button')]).toEqual([
      screen.getByRole('button', { name: T.tryAgain }),
      screen.getByRole('link', { name: T.back }),
    ]);
  });

  it('logs the digest only', () => {
    renderError();
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      'training: load failed',
      'd1g3st',
    );
  });

  it('logs nothing without a digest', () => {
    renderError(failure());
    expect(errors).not.toHaveBeenCalled();
  });
});
