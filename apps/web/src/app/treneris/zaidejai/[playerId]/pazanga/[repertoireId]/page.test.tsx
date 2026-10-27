import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../../../i18n/locales';
import type { ProgressPage } from '../../../../../../server/coach-progress';
import CoachProgressPage from './page';

const loader = vi.hoisted(() => ({
  progress:
    vi.fn<
      (playerId: unknown, repertoireId: unknown) => Promise<ProgressPage>
    >(),
}));

// The loader's access check (404 for an unlinked player, a private or
// forked repertoire, R-155) is covered by the db and feature suites.
vi.mock('../../../../../../server/coach-progress', () => ({
  coachProgressData: loader.progress,
}));

describe('the coach’s progress page', () => {
  it('loads the player and repertoire the path names and shows them', async () => {
    loader.progress.mockResolvedValue({
      player: { id: 'p-1', displayName: 'Rokas' },
      repertoire: { id: 'r-1', name: 'Taimanovas', side: 'black' },
      badges: null,
      standing: {
        counts: { notStarted: 1, skipped: 0, due: 0, learned: 0 },
        mastered: false,
      },
      chapters: [],
    });
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        {await CoachProgressPage({
          params: Promise.resolve({ playerId: 'p-1', repertoireId: 'r-1' }),
        })}
      </NextIntlClientProvider>,
    );
    expect(loader.progress).toHaveBeenCalledWith('p-1', 'r-1');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Taimanovas' }),
    ).toBeDefined();
  });
});
