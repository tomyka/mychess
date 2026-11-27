import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/catalogue';
import type { CoachGroupPage } from '../../../../server/coach-pages';
import CoachGroupPageView from './page';

const NOW = new Date('2026-10-18T08:00:00Z');

const loader = vi.hoisted(() => ({
  group: vi.fn<(id: unknown) => Promise<CoachGroupPage>>(),
}));

// The loader's checks (another coach's group is 404, Coach mode off goes
// to settings) are covered by the feature suite.
vi.mock('../../../../server/coach-pages', () => ({
  coachGroupData: loader.group,
}));

vi.mock('../../actions', () => ({
  renameGroupAction: vi.fn(),
  removeMemberAction: vi.fn(),
  addMemberAction: vi.fn(),
  deleteGroupAction: vi.fn(),
  createInviteAction: vi.fn(),
  revokeInviteAction: vi.fn(),
}));

const c = MESSAGES.coach;

describe('the coach dashboard’s group page', () => {
  it('loads the group the path names once and shows its progress, assignments, invite link and players', async () => {
    loader.group.mockResolvedValue({
      id: 'g-1',
      name: 'Šeštadienio grupė',
      createdAt: NOW,
      members: [{ id: 'p-1', displayName: 'Rokas', joinedAt: NOW }],
      addable: [{ id: 'p-2', displayName: 'Gabija' }],
      grid: {
        columns: [
          {
            id: 'r-1',
            name: 'Karo-Kan gynyba',
            side: 'black',
            deadline: '2026-10-30',
            done: 0,
            count: 1,
          },
        ],
        rows: [
          {
            player: { id: 'p-1', displayName: 'Rokas' },
            lastTrainedDays: null,
            cells: [null],
          },
        ],
      },
      assignments: [
        {
          repertoireId: 'r-1',
          repertoireName: 'Karo-Kan gynyba',
          deadline: '2026-10-30',
        },
      ],
      invite: { id: 'i-1', expiresAt: new Date('2026-10-25T08:00:00Z') },
      today: '2026-10-18',
    });
    render(
      <NextIntlClientProvider
        locale="en"
        messages={MESSAGES}
        timeZone="Europe/Vilnius"
      >
        {await CoachGroupPageView({
          params: Promise.resolve({ groupId: 'g-1' }),
        })}
      </NextIntlClientProvider>,
    );
    expect(loader.group).toHaveBeenCalledExactlyOnceWith('g-1');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Šeštadienio grupė' }),
    ).toBeDefined();
    expect(
      screen.getByRole('region', { name: c.progress.gridTitle }).textContent,
    ).toContain('Karo-Kan gynyba');
    expect(
      screen.getByRole('region', { name: c.group.assignedTitle }).textContent,
    ).toContain('due Oct 30');
    expect(screen.getByText('An open link expires Oct 25')).toBeDefined();
    expect(
      screen.getByRole('button', {
        name: c.group.remove,
        description: 'Rokas',
      }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: c.group.addTitle }),
    ).toBeDefined();
  });
});
