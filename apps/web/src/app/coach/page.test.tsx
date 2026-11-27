import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import type { CoachHomeData } from '../../server/coach-pages';
import CoachPage from './page';

const NOW = new Date('2026-10-18T08:00:00Z');

// requireCoach, inside the loader, never returns for a signed-out account
// or one without Coach mode; the feature suite covers that.
const DATA: CoachHomeData = {
  players: [
    {
      id: 'p-1',
      displayName: 'Rokas',
      linkedAt: NOW,
      groups: [{ id: 'g-1', name: 'Šeštadienio grupė' }],
      lastTrainedDays: null,
      nearestDeadline: null,
      overdue: false,
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
  invites: [
    {
      id: 'i-1',
      kind: 'group',
      groupId: 'g-1',
      groupName: 'Šeštadienio grupė',
      expiresAt: NOW,
      createdAt: NOW,
    },
  ],
};

vi.mock('../../server/coach-pages', () => ({
  coachHomeData: () => Promise.resolve(DATA),
}));

vi.mock('./actions', () => ({
  createGroupAction: vi.fn(),
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
  unlinkPlayerAction: vi.fn(),
}));

const c = MESSAGES.coach;

describe('the coach dashboard', () => {
  it('shows the players, groups and invites sections', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={MESSAGES}>
        {await CoachPage()}
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: c.title }),
    ).toBeDefined();
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([c.players.title, c.groups.title, c.invites.title]);
    const players = screen.getByRole('region', { name: c.players.title });
    expect(within(players).getByRole('link', { name: 'Rokas' })).toBeDefined();
    expect(within(players).getByText(c.progress.neverTrained)).toBeDefined();
    const groups = screen.getByRole('region', { name: c.groups.title });
    expect(
      within(groups)
        .getByRole('link', { name: 'Šeštadienio grupė' })
        .getAttribute('href'),
    ).toBe('/coach/groups/g-1');
    const invites = screen.getByRole('region', { name: c.invites.title });
    expect(
      within(invites)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([c.invites.noGroup, 'Šeštadienio grupė']);
    expect(
      within(invites).getByRole('button', { name: c.invites.revoke }),
    ).toBeDefined();
  });
});
