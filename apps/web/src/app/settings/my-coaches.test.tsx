import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/catalogue';
import { MyCoaches, type MyCoach } from './my-coaches';

const server = vi.hoisted(() => ({
  unlink: vi.fn<(form: FormData) => Promise<void>>(),
  leave: vi.fn<(form: FormData) => Promise<void>>(),
}));

vi.mock('./coaching-actions', () => ({
  unlinkCoachAction: server.unlink,
  leaveGroupAction: server.leave,
}));

const m = MESSAGES.settings.myCoaches;

const JONAS: MyCoach = {
  id: 'c-1',
  displayName: 'Jonas',
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
};
const ONA: MyCoach = { id: 'c-2', displayName: 'Ona', groups: [] };

const leave = (group: string): string =>
  m.leaveGroupNamed.replace('{group}', group);

function renderCoaches(
  coaches: readonly MyCoach[],
  acceptedCoachId: string | null = null,
): void {
  render(
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      <MyCoaches coaches={coaches} acceptedCoachId={acceptedCoachId} />
    </NextIntlClientProvider>,
  );
}

describe('MyCoaches after an invite is accepted (#329)', () => {
  it('drops ?coach= from the address once it shows, so a reload does not say it again', () => {
    window.history.replaceState(null, '', '/settings?coach=c-2#coaches');
    renderCoaches([JONAS, ONA], ONA.id);
    expect(screen.getByRole('status').textContent).toBe(
      m.accepted.replace('{name}', 'Ona'),
    );
    expect(window.location.pathname).toBe('/settings');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#coaches');
  });

  it('leaves the address alone without an accepted invite', () => {
    window.history.replaceState(null, '', '/settings?tab=x');
    renderCoaches([JONAS]);
    expect(window.location.search).toBe('?tab=x');
  });

  it('says the player is now linked with the coach the invite was from', () => {
    renderCoaches([JONAS, ONA], ONA.id);
    expect(screen.getByRole('status').textContent).toBe(
      m.accepted.replace('{name}', 'Ona'),
    );
  });

  it('says nothing for a coach the player is not linked to, or none', () => {
    renderCoaches([JONAS], 'someone-else');
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

const coachItem = (name: string) =>
  within(
    screen.getByRole('heading', { level: 3, name }).closest('li') ??
      document.body,
  );

const sent = (action: typeof server.unlink) =>
  Object.fromEntries(action.mock.lastCall?.[0].entries() ?? []);

beforeEach(() => {
  server.unlink.mockReset().mockResolvedValue(undefined);
  server.leave.mockReset().mockResolvedValue(undefined);
});

describe('MyCoaches ("My coaches")', () => {
  it('is the settings section #coaches the invite page lands on', () => {
    renderCoaches([JONAS]);
    const section = screen.getByRole('region', { name: m.title });
    expect(section.id).toBe('coaches');
  });

  it('says when no coach is linked', () => {
    renderCoaches([]);
    expect(screen.getByText(m.empty)).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('lists each coach with the groups the player is in', () => {
    renderCoaches([JONAS, ONA]);
    expect(
      screen
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Jonas', 'Ona']);
    expect(
      coachItem('Jonas')
        .getAllByRole('button', { name: /^Leave the group “/u })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Leave the group “Sekmadienio grupė”',
      'Leave the group “Šeštadienio grupė”',
    ]);
    expect(coachItem('Ona').queryByText(m.groups)).toBeNull();
  });

  it('leaves one group (R-45)', async () => {
    renderCoaches([JONAS]);
    fireEvent.click(
      screen.getByRole('button', { name: leave('Šeštadienio grupė') }),
    );
    await waitFor(() => {
      expect(server.leave).toHaveBeenCalledTimes(1);
    });
    expect(sent(server.leave)).toEqual({ groupId: 'g-2' });
    expect(server.unlink).not.toHaveBeenCalled();
  });

  it('unlinks a coach only after the confirm step', async () => {
    renderCoaches([JONAS, ONA]);
    const ona = coachItem('Ona');
    fireEvent.click(ona.getByRole('button', { name: m.unlink }));
    expect(server.unlink).not.toHaveBeenCalled();
    expect(
      ona.getByText(m.unlinkConfirm.replace('{name}', 'Ona')),
    ).toBeDefined();
    fireEvent.click(ona.getByRole('button', { name: m.confirmUnlink }));
    await waitFor(() => {
      expect(server.unlink).toHaveBeenCalledTimes(1);
    });
    expect(sent(server.unlink)).toEqual({ coachId: 'c-2' });
  });
});
