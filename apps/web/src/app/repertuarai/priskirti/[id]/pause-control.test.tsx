import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { PauseState } from './actions';
import { PauseControl } from './pause-control';

const ID = '7d1f8f3e-5b8a-4c3e-9a51-2f0e6b7c9d10';
const p = MESSAGES.lt.assignment.pause;

const server = vi.hoisted(() => ({
  pause: vi.fn<(previous: PauseState, form: FormData) => Promise<PauseState>>(),
}));

vi.mock('./actions', () => ({ pauseAction: server.pause }));

function renderControl(paused: boolean, locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <PauseControl repertoireId={ID} paused={paused} />
    </NextIntlClientProvider>,
  );
}

const sent = () =>
  Object.fromEntries(server.pause.mock.lastCall?.[1].entries() ?? []);

beforeEach(() => {
  server.pause
    .mockReset()
    .mockImplementation((_previous, form) =>
      Promise.resolve({ paused: form.get('paused') === 'true' }),
    );
});

describe('PauseControl (R-46)', () => {
  it('pauses a running assignment, then offers to resume it', async () => {
    renderControl(false);
    expect(screen.queryByText(p.paused)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: p.pause }));
    expect(await screen.findByRole('button', { name: p.resume })).toBeDefined();
    expect(sent()).toEqual({ repertoireId: ID, paused: 'true' });
    expect(screen.getByText(p.paused)).toBeDefined();
    expect(screen.getByText(p.pausedHint)).toBeDefined();
  });

  it('resumes a paused assignment', async () => {
    renderControl(true);
    expect(screen.getByText(p.paused)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: p.resume }));
    expect(await screen.findByRole('button', { name: p.pause })).toBeDefined();
    expect(sent()).toEqual({ repertoireId: ID, paused: 'false' });
    expect(screen.queryByText(p.paused)).toBeNull();
  });

  it('shows a refusal and keeps the state', async () => {
    server.pause.mockResolvedValue({
      paused: false,
      refusal: 'assignment.notFound',
    });
    renderControl(false);
    fireEvent.click(screen.getByRole('button', { name: p.pause }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.assignment.notFound,
      );
    });
    expect(screen.getByRole('button', { name: p.pause })).toBeDefined();
  });

  it('speaks English on the English page', () => {
    renderControl(true, 'en');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDefined();
    expect(screen.getByText('Paused')).toBeDefined();
  });
});
