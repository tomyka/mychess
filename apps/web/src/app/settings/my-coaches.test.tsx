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
import type { MyCoach } from '../../server/settings-page';
import { MyCoaches } from './my-coaches';

const server = vi.hoisted(() => ({
  unlink: vi.fn<(form: FormData) => Promise<void>>(),
  leave: vi.fn<(form: FormData) => Promise<void>>(),
}));

vi.mock('./coaching-actions', () => ({
  unlinkCoachAction: server.unlink,
  leaveGroupAction: server.leave,
}));

const m = MESSAGES.settings.myCoaches;

const TODAY = '2026-11-28';

/** A status on time, not paused, not done, unless said. */
const status = (
  over: Partial<MyCoach['assignments'][number]['status']> = {},
) => ({
  deadline: null,
  overdue: false,
  paused: false,
  done: false,
  ...over,
});

const JONAS: MyCoach = {
  id: 'c-1',
  displayName: 'Jonas',
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
  assignments: [
    {
      repertoireId: 'r-1',
      name: 'Caro-Kann basics',
      status: status({ deadline: '2026-12-20' }),
    },
    {
      repertoireId: 'r-2',
      name: 'Najdorf',
      status: status({ deadline: '2026-11-20', overdue: true, paused: true }),
    },
    { repertoireId: 'r-3', name: 'London', status: status({ done: true }) },
    { repertoireId: 'r-4', name: 'Alapin', status: status() },
  ],
};
const ONA: MyCoach = {
  id: 'c-2',
  displayName: 'Ona',
  groups: [],
  assignments: [],
};

const leave = (group: string): string =>
  m.leaveGroupNamed.replace('{group}', group);

function renderCoaches(coaches: readonly MyCoach[]): void {
  render(
    <NextIntlClientProvider
      locale="en"
      messages={MESSAGES}
      timeZone="Europe/Vilnius"
    >
      <MyCoaches coaches={coaches} today={TODAY} />
    </NextIntlClientProvider>,
  );
}

describe('MyCoaches after an invite is accepted (R-234)', () => {
  it('has no "linked with" line: Today says it now', () => {
    window.history.replaceState(null, '', '/settings?coach=c-2#coaches');
    renderCoaches([JONAS, ONA]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.location.search).toBe('?coach=c-2');
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
  // jsdom lays nothing out, so it has no scrollIntoView of its own (#403).
  Element.prototype.scrollIntoView = vi.fn();
});

describe('MyCoaches ("My coaches")', () => {
  it('is the settings section #coaches the invite page lands on', () => {
    renderCoaches([JONAS]);
    const section = screen.getByRole('region', { name: m.title });
    expect(section.id).toBe('coaches');
  });

  it('scrolls itself into view on a load of /settings#coaches still at the top (#403)', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    window.history.replaceState(null, '', '/settings#coaches');
    renderCoaches([JONAS]);
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(
      screen.getByRole('region', { name: m.title }),
    );
    window.history.replaceState(null, '', '/');
  });

  it('says when no coach is linked, and how one links (R-237)', () => {
    renderCoaches([]);
    expect(
      screen.getByText(
        'No coach yet. A coach links with you by sending an invite link.',
      ),
    ).toBeDefined();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it("lists each of a coach's assignments with its status line (R-237)", () => {
    renderCoaches([JONAS]);
    const jonas = coachItem('Jonas');
    const assigned = jonas.getByRole('list', { name: m.assigned });
    expect(
      within(assigned)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Caro-Kann basicsdeadline Dec 20',
      'Najdorfdeadline Nov 20OverduePaused',
      // Done with no deadline: the shared line says only Done.
      'LondonDone',
      'AlapinNo deadline',
    ]);
  });

  it('lists no assignments for a coach who assigns none', () => {
    renderCoaches([ONA]);
    expect(
      coachItem('Ona').queryByRole('list', { name: m.assigned }),
    ).toBeNull();
  });

  it('draws Unlink and Leave group in the error tone', () => {
    renderCoaches([JONAS]);
    const jonas = coachItem('Jonas');
    // The error tone is the behaviour: they take something away.
    expect(jonas.getByRole('button', { name: m.unlink }).className).toContain(
      'text-error',
    );
    expect(
      jonas.getByRole('button', { name: leave('Sekmadienio grupė') }).className,
    ).toContain('text-error');
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
