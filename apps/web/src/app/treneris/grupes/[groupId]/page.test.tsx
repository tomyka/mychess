import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
import type { CoachGroupPage } from '../../../../server/coach-pages';
import type { GroupGrid } from '../../../../server/coach-progress';
import CoachGroupPageView from './page';

const NOW = new Date('2026-10-18T08:00:00Z');

const loader = vi.hoisted(() => ({
  group: vi.fn<(id: unknown) => Promise<CoachGroupPage>>(),
  grid: vi.fn<(id: unknown) => Promise<GroupGrid>>(),
}));

// The loaders' checks (another coach's group is 404, Coach mode off goes
// to settings) are covered by the feature suite.
vi.mock('../../../../server/coach-pages', () => ({
  coachGroupData: loader.group,
}));

vi.mock('../../../../server/coach-progress', () => ({
  groupProgressData: loader.grid,
}));

vi.mock('../../actions', () => ({
  renameGroupAction: vi.fn(),
  removeMemberAction: vi.fn(),
  addMemberAction: vi.fn(),
  deleteGroupAction: vi.fn(),
}));

const g = MESSAGES.lt.coach.group;
const p = MESSAGES.lt.coach.progress;

describe('the coach dashboard’s group page', () => {
  it('loads the group the path names and shows its grid, members and who to add', async () => {
    loader.group.mockResolvedValue({
      id: 'g-1',
      name: 'Šeštadienio grupė',
      createdAt: NOW,
      members: [{ id: 'p-1', displayName: 'Rokas', joinedAt: NOW }],
      addable: [{ id: 'p-2', displayName: 'Gabija' }],
    });
    loader.grid.mockResolvedValue({
      columns: [{ id: 'r-1', name: 'Karo-Kan gynyba', side: 'black' }],
      rows: [
        {
          player: { id: 'p-1', displayName: 'Rokas' },
          lastTrainedDays: null,
          cells: [null],
        },
      ],
    });
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        {await CoachGroupPageView({
          params: Promise.resolve({ groupId: 'g-1' }),
        })}
      </NextIntlClientProvider>,
    );
    expect(loader.group).toHaveBeenCalledWith('g-1');
    expect(loader.grid).toHaveBeenCalledWith('g-1');
    expect(
      screen.getByRole('region', { name: p.gridTitle }).textContent,
    ).toContain('Karo-Kan gynyba');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Šeštadienio grupė' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', {
        name: g.removeNamed.replace('{name}', 'Rokas'),
      }),
    ).toBeDefined();
    expect(screen.getByRole('option', { name: 'Gabija' })).toBeDefined();
  });
});
