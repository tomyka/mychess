import type { Account } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Theme } from '../lib/theme';
import type { TodaySummary } from './training';
import { shellData } from './shell';

const NOW = new Date('2026-11-25T08:00:00Z');

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<Account>>(),
  today: vi.fn<(account: Account) => Promise<TodaySummary>>(),
  theme: vi.fn<() => Promise<Theme>>(),
}));

vi.mock('./session', () => ({ requireOnboarded: server.account }));
vi.mock('./training', () => ({ todaySummary: server.today }));
vi.mock('./theme-cookie', () => ({ readThemeCookie: server.theme }));

/** Rokas, signed in and onboarded: a player. */
const ROKAS: Account = {
  id: 'rokas',
  email: 'rokas@example.test',
  emailVerified: true,
  displayName: 'Rokas',
  entitlement: 'free',
  admin: false,
  disabledAt: null,
  onboardedAt: NOW,
  coachSince: null,
  createdAt: NOW,
};

/** Rūta, a coach. */
const RUTA: Account = {
  ...ROKAS,
  id: 'ruta',
  email: 'ruta@example.test',
  displayName: 'Rūta',
  coachSince: NOW,
};

const summary = (due: number): TodaySummary => ({
  due,
  toLearn: 0,
  minutes: 0,
  nextDue: null,
  repertoires: [],
});

beforeEach(() => {
  server.account.mockReset().mockResolvedValue(ROKAS);
  server.today.mockReset().mockResolvedValue(summary(7));
  server.theme.mockReset().mockResolvedValue('system');
});

describe('shellData', () => {
  it("shows the session player's name, due count and the system theme", async () => {
    await expect(shellData()).resolves.toEqual({
      accountId: 'rokas',
      displayName: 'Rokas',
      isCoach: false,
      due: 7,
      theme: 'system',
    });
    expect(server.today).toHaveBeenCalledWith(ROKAS);
  });

  it('knows a coach', async () => {
    server.account.mockResolvedValue(RUTA);
    const data = await shellData();
    expect(data.isCoach).toBe(true);
    expect(data.accountId).toBe('ruta');
  });

  it('shows no badge when the due count fails, and logs no error message', async () => {
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    server.today.mockRejectedValue(new TypeError('rokas@example.test'));
    await expect(shellData()).resolves.toMatchObject({ due: 0 });
    expect(errors).toHaveBeenCalledWith('shell: due count failed', 'TypeError');
    errors.mockRestore();
  });

  it("shows the theme cookie's theme", async () => {
    server.theme.mockResolvedValue('dark');
    await expect(shellData()).resolves.toMatchObject({ theme: 'dark' });
  });
});
