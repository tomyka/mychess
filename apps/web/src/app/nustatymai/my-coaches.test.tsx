import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../../i18n/locales';
import { MyCoaches, type MyCoach } from './my-coaches';

const server = vi.hoisted(() => ({
  unlink: vi.fn<(form: FormData) => Promise<void>>(),
  leave: vi.fn<(form: FormData) => Promise<void>>(),
}));

vi.mock('./coaching-actions', () => ({
  unlinkCoachAction: server.unlink,
  leaveGroupAction: server.leave,
}));

const m = MESSAGES.lt.settings.myCoaches;

const JONAS: MyCoach = {
  id: 'c-1',
  displayName: 'Jonas',
  groups: [
    { id: 'g-1', name: 'Sekmadienio grupė' },
    { id: 'g-2', name: 'Šeštadienio grupė' },
  ],
};
const ONA: MyCoach = { id: 'c-2', displayName: 'Ona', groups: [] };

function renderCoaches(
  coaches: readonly MyCoach[],
  locale: 'lt' | 'en' = 'lt',
): void {
  render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <MyCoaches coaches={coaches} />
    </NextIntlClientProvider>,
  );
}

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

describe('MyCoaches ("Mano treneriai")', () => {
  it('is the settings section #treneriai the invite page lands on', () => {
    renderCoaches([JONAS]);
    const section = screen.getByRole('region', { name: m.title });
    expect(section.id).toBe('treneriai');
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
        .getAllByRole('button', { name: /^Palikti grupę „/u })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Palikti grupę „Sekmadienio grupė“',
      'Palikti grupę „Šeštadienio grupė“',
    ]);
    expect(coachItem('Ona').queryByText(m.groups)).toBeNull();
  });

  it('leaves one group (R-45)', async () => {
    renderCoaches([JONAS]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Palikti grupę „Šeštadienio grupė“' }),
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

  it('speaks English on the English page', () => {
    renderCoaches([], 'en');
    expect(
      screen.getByRole('heading', { level: 2, name: 'My coaches' }),
    ).toBeDefined();
  });
});
