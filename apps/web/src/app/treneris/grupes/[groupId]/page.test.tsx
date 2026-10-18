import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../../../i18n/locales';
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
}));

const g = MESSAGES.lt.coach.group;

describe('the coach dashboard’s group page', () => {
  it('loads the group the path names and shows its members and who to add', async () => {
    loader.group.mockResolvedValue({
      id: 'g-1',
      name: 'Šeštadienio grupė',
      createdAt: NOW,
      members: [{ id: 'p-1', displayName: 'Rokas', joinedAt: NOW }],
      addable: [{ id: 'p-2', displayName: 'Gabija' }],
    });
    render(
      <NextIntlClientProvider locale="lt" messages={MESSAGES.lt}>
        {await CoachGroupPageView({
          params: Promise.resolve({ groupId: 'g-1' }),
        })}
      </NextIntlClientProvider>,
    );
    expect(loader.group).toHaveBeenCalledWith('g-1');
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
