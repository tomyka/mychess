import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { LinkedAccount } from '@mychess/db';
import CoachNotFound from '../../not-found';
import CoachPlayerPage from './page';

const loader = vi.hoisted(() => ({
  player: vi.fn<(id: unknown) => Promise<LinkedAccount>>(),
}));

// The loader's access check (404 for a player not linked to the coach)
// and its redirects are covered by the feature suite.
vi.mock('../../../../server/coach-pages', () => ({
  coachPlayerData: loader.player,
}));

vi.mock('../../actions', () => ({ unlinkPlayerAction: vi.fn() }));

const c = MESSAGES.lt.coach;

function renderIn(element: React.ReactNode): void {
  render(
    <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('the coach dashboard’s player page', () => {
  it('loads the player the path names and shows them', async () => {
    loader.player.mockResolvedValue({
      id: 'p-1',
      displayName: 'Rokas',
      linkedAt: new Date('2026-10-18T08:00:00Z'),
      groups: [{ id: 'g-1', name: 'Šeštadienio grupė' }],
    });
    renderIn(
      await CoachPlayerPage({ params: Promise.resolve({ playerId: 'p-1' }) }),
    );
    expect(loader.player).toHaveBeenCalledWith('p-1');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Rokas' }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: 'Šeštadienio grupė' }),
    ).toBeDefined();
  });

  it('reads the same for anything the coach may not see (plan decision 4)', () => {
    renderIn(<CoachNotFound />);
    expect(
      screen.getByRole('heading', { level: 1, name: c.notFound }),
    ).toBeDefined();
    expect(
      screen.getByRole('link', { name: c.back }).getAttribute('href'),
    ).toBe('/treneris');
  });
});
