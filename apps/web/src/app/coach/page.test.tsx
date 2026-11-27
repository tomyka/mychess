import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CoachDashboardData } from '../../server/coach-pages';
import CoachPage from './page';

const NOW = new Date('2026-10-18T08:00:00Z');

const ROKAS = { id: 'p-1', displayName: 'Rokas' };

// requireCoach, inside the loader, never returns for a signed-out account
// or one without Coach mode; the feature suite covers that.
const DATA: CoachDashboardData = {
  attention: [
    {
      player: ROKAS,
      reason: { kind: 'idle', days: 12, since: 'training' },
    },
  ],
  players: [
    {
      ...ROKAS,
      lastTrainedDays: 12,
      summary: {
        counts: { learned: 1, due: 0, skipped: 0, notStarted: 3 },
        nextDeadline: null,
        allDone: false,
        overdue: false,
      },
    },
  ],
  groups: [
    {
      id: 'g-1',
      name: 'Šeštadienio grupė',
      memberCount: 1,
      createdAt: NOW,
      assignments: [],
    },
  ],
  today: '2026-10-18',
};

const data = vi.hoisted((): { current: CoachDashboardData | undefined } => ({
  current: undefined,
}));

vi.mock('../../server/coach-pages', () => ({
  coachDashboardData: () => Promise.resolve(data.current),
}));

vi.mock('./actions', () => ({ createGroupAction: vi.fn() }));

const c = MESSAGES.coach;

async function renderPage(page: CoachDashboardData): Promise<void> {
  data.current = page;
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      {await CoachPage()}
    </NextIntlClientProvider>,
  );
}

describe('the coach dashboard (R-229)', () => {
  it('leads with who needs attention, then the players, then the groups', async () => {
    await renderPage(DATA);
    expect(
      screen.getByRole('heading', { level: 1, name: c.title }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(['Needs attention · 1', 'Players · 1', 'Groups · 1']);
    const attention = screen.getByRole('region', { name: /^Needs attention/u });
    expect(
      within(attention).getByText('Has not trained for 12 days'),
    ).toBeDefined();
    const groups = screen.getByRole('region', { name: /^Groups/u });
    expect(
      within(groups)
        .getByRole('link', { name: 'Šeštadienio grupė' })
        .getAttribute('href'),
    ).toBe('/coach/groups/g-1');
  });

  it('has no invites section and no Unlink', async () => {
    await renderPage(DATA);
    expect(screen.queryByRole('region', { name: c.invites.title })).toBeNull();
    expect(screen.queryByRole('button', { name: c.players.unlink })).toBeNull();
  });

  it('has the three regions in reading order', async () => {
    await renderPage(DATA);
    expect(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-labelledby'))
        .map((id) => document.getElementById(id ?? '')?.textContent),
    ).toEqual(['Needs attention · 1', 'Players · 1', 'Groups · 1']);
  });

  it('says how to invite when no player is linked, without Needs attention', async () => {
    await renderPage({ ...DATA, attention: [], players: [] });
    expect(screen.getByText(c.players.empty)).toBeDefined();
    expect(
      screen.queryByRole('heading', { name: /^Needs attention/u }),
    ).toBeNull();
  });
});
