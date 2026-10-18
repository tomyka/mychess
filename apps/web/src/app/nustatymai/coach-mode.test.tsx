import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { CoachMode } from './coach-mode';
import type { StopCoachingState } from './coaching-actions';

const server = vi.hoisted(() => ({
  start: vi.fn<() => Promise<void>>(),
  stop: vi.fn<() => Promise<StopCoachingState>>(),
}));

vi.mock('./coaching-actions', () => ({
  startCoachingAction: server.start,
  stopCoachingAction: server.stop,
}));

const c = MESSAGES.lt.settings.coachMode;

function renderSwitch(isCoach: boolean, locale: 'lt' | 'en' = 'lt'): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <CoachMode isCoach={isCoach} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  server.start.mockReset().mockResolvedValue(undefined);
  server.stop.mockReset().mockResolvedValue({});
});

describe('CoachMode (R-11, R-100)', () => {
  it('offers to switch Coach mode on when it is off', async () => {
    renderSwitch(false);
    expect(
      screen.getByRole('heading', { level: 2, name: c.title }),
    ).toBeDefined();
    expect(screen.getByText(c.off)).toBeDefined();
    expect(screen.queryByText(c.offNote)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: c.switchOn }));
    await waitFor(() => {
      expect(server.start).toHaveBeenCalledTimes(1);
    });
    expect(server.stop).not.toHaveBeenCalled();
  });

  it('offers to switch it off when it is on, saying what that does (R-109)', async () => {
    renderSwitch(true);
    expect(screen.getByText(c.on)).toBeDefined();
    expect(screen.getByText(c.offNote)).toBeDefined();
    expect(screen.queryByRole('button', { name: c.switchOn })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: c.switchOff }));
    await waitFor(() => {
      expect(server.stop).toHaveBeenCalledTimes(1);
    });
    expect(server.start).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('lists the players to unlink first when switching off is refused (R-100)', async () => {
    server.stop.mockResolvedValue({
      refusal: 'coach.stillLinked',
      players: [
        { id: 'p-1', displayName: 'Gabija' },
        { id: 'p/2', displayName: 'Rokas' },
      ],
    });
    renderSwitch(true);
    fireEvent.click(screen.getByRole('button', { name: c.switchOff }));
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        MESSAGES.lt.coach.stillLinked,
      );
    });
    expect(screen.getByText(c.unlinkFirst)).toBeDefined();
    expect(
      screen
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Gabija', '/treneris/zaidejai/p-1'],
      ['Rokas', '/treneris/zaidejai/p%2F2'],
    ]);
  });

  it('speaks English on the English page', () => {
    renderSwitch(false, 'en');
    expect(
      screen.getByRole('button', { name: 'Switch Coach mode on' }),
    ).toBeDefined();
  });
});
