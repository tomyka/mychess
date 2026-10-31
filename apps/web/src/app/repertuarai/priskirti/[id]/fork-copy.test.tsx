import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { ForkState } from './actions';
import { ForkCopy } from './fork-copy';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const f = MESSAGES.lt.assignment.fork;

const action =
  vi.fn<(previous: ForkState, form: FormData) => Promise<ForkState>>();

function renderFork(locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <ForkCopy repertoireId={ID} name="Londono sistema" action={action} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  action.mockReset().mockResolvedValue({});
});

describe('ForkCopy (R-20, R-128)', () => {
  it('asks first, saying coach edits will no longer reach the copy', () => {
    renderFork();
    fireEvent.click(screen.getByRole('button', { name: f.label }));
    expect(
      screen.getByText(f.question.replace('{name}', 'Londono sistema')),
    ).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('can be cancelled', () => {
    renderFork();
    fireEvent.click(screen.getByRole('button', { name: f.label }));
    fireEvent.click(screen.getByRole('button', { name: f.cancel }));
    expect(screen.getByRole('button', { name: f.label })).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it('forks this repertoire once confirmed', async () => {
    renderFork();
    fireEvent.click(screen.getByRole('button', { name: f.label }));
    fireEvent.click(screen.getByRole('button', { name: f.confirm }));
    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });
    expect(
      Object.fromEntries(action.mock.lastCall?.[1].entries() ?? []),
    ).toEqual({ repertoireId: ID });
  });

  it('shows a refusal', async () => {
    action.mockResolvedValue({ refusal: 'assignment.notFound' });
    renderFork();
    fireEvent.click(screen.getByRole('button', { name: f.label }));
    fireEvent.click(screen.getByRole('button', { name: f.confirm }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.assignment.notFound,
      );
    });
  });

  it('says the repertoire limit with its number (R-162, R-163)', async () => {
    action.mockResolvedValue({ refusal: 'repertoire.limit', limit: 50 });
    renderFork('en');
    fireEvent.click(screen.getByRole('button', { name: 'Make my own copy' }));
    fireEvent.click(
      screen.getByRole('button', { name: MESSAGES.en.assignment.fork.confirm }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        'You can have up to 50 repertoires. Delete one to add another.',
      );
    });
  });

  it('speaks English on the English page', () => {
    renderFork('en');
    expect(
      screen.getByRole('button', { name: 'Make my own copy' }),
    ).toBeDefined();
  });
});
