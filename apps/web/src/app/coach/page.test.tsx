import { fireEvent, render, screen, within } from '@testing-library/react';
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
  personalInvites: [
    {
      id: 'i-1',
      createdAt: NOW,
      expiresAt: new Date('2026-10-25T08:00:00Z'),
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

vi.mock('./actions', () => ({
  createGroupAction: vi.fn(),
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

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
    // The old invites section's title: invites live in the sheet and on
    // each group's page now (R-232).
    expect(screen.queryByRole('region', { name: 'Invites' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unlink/u })).toBeNull();
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

  it('says no player is linked yet, with Invite a player there too, and no Needs attention', async () => {
    await renderPage({ ...DATA, attention: [], players: [] });
    const players = screen.getByRole('region', { name: /^Players/u });
    expect(within(players).getByText(c.players.empty)).toBeDefined();
    fireEvent.click(
      within(players).getByRole('button', { name: c.inviteSheet.title }),
    );
    expect(
      screen.getByRole('dialog', { name: c.inviteSheet.title }),
    ).toBeDefined();
    expect(
      screen.queryByRole('heading', { name: /^Needs attention/u }),
    ).toBeNull();
  });

  it('has Invite a player in the header, opening the sheet with the open personal invites (R-232)', async () => {
    await renderPage(DATA);
    const header = screen.getByRole('heading', { level: 1 }).parentElement;
    if (header === null) throw new Error('no title row');
    // With players, the header's is the only one.
    const [invite, ...others] = screen.getAllByRole('button', {
      name: c.inviteSheet.title,
    });
    expect(others).toEqual([]);
    expect(invite?.parentElement).toBe(header);
    if (invite === undefined) throw new Error('no Invite a player');
    fireEvent.click(invite);
    const sheet = screen.getByRole('dialog', { name: c.inviteSheet.title });
    expect(
      within(sheet).getByText('made Oct 18 · expires Oct 25'),
    ).toBeDefined();
  });
});
