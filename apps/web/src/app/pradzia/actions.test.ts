import { DISPLAY_NAME_ISSUES, LIFECYCLE_REFUSALS } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOnboardingAction } from './actions';

const DB = { name: 'the db' };
const NEXT = `/k/${'A'.repeat(42)}_`;
const NOW = new Date('2026-10-22T08:00:00Z');

const server = vi.hoisted(() => ({
  complete: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  remember: vi.fn<(locale: string) => Promise<void>>(),
}));

/** The error the mocked `redirect` throws, naming where it sends. */
class Redirected extends Error {
  readonly to: string;

  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

vi.mock('@mychess/db', () => ({ completeOnboarding: server.complete }));

vi.mock('../../server/db', () => ({ getDb: () => DB }));

vi.mock('../../server/locale-cookie', () => ({
  rememberLocale: server.remember,
}));

// The session account as the request read it: not onboarded yet, so the
// action asks the domain again on the locked row.
vi.mock('../../server/session', () => ({
  requireAccount: () =>
    Promise.resolve({ id: 'a1', onboardedAt: null, disabledAt: null }),
}));

/** The onboarding form, with `next` when given. */
function formOf(next?: string): FormData {
  const form = new FormData();
  form.set('displayName', 'Rūta');
  form.set('locale', 'en');
  if (next !== undefined) form.set('next', next);
  return form;
}

const refused = (reason: string) => ({ ok: false, refusal: { reason } });

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.complete.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.remember.mockReset().mockResolvedValue(undefined);
  return () => {
    vi.useRealTimers();
  };
});

describe('completeOnboardingAction (R-80, R-81)', () => {
  it('saves the profile, remembers the language and goes home', async () => {
    await expect(completeOnboardingAction({}, formOf())).rejects.toEqual(
      new Redirected('/'),
    );
    expect(server.complete).toHaveBeenCalledWith(
      DB,
      'a1',
      { displayName: 'Rūta', locale: 'en' },
      NOW,
    );
    expect(server.remember).toHaveBeenCalledWith('en');
  });

  it('goes on to the invite in next once saved', async () => {
    await expect(completeOnboardingAction({}, formOf(NEXT))).rejects.toEqual(
      new Redirected(NEXT),
    );
    expect(server.remember).toHaveBeenCalledWith('en');
  });

  it.each([
    [undefined, '/'],
    [NEXT, NEXT],
  ])(
    'sends a submit that lost the race (next %j) to %j, remembering nothing',
    async (next, to) => {
      server.complete.mockResolvedValue(
        refused(LIFECYCLE_REFUSALS.alreadyOnboarded),
      );
      await expect(completeOnboardingAction({}, formOf(next))).rejects.toEqual(
        new Redirected(to),
      );
      expect(server.remember).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, NEXT])(
    'sends an account closed meanwhile (next %j) to sign-in, remembering nothing',
    async (next) => {
      server.complete.mockResolvedValue(
        refused(LIFECYCLE_REFUSALS.accountClosed),
      );
      await expect(completeOnboardingAction({}, formOf(next))).rejects.toEqual(
        new Redirected('/prisijungti'),
      );
      expect(server.remember).not.toHaveBeenCalled();
    },
  );

  it('shows a refused profile and writes nothing', async () => {
    const form = formOf();
    form.set('displayName', '   ');
    expect(await completeOnboardingAction({}, form)).toEqual({
      refusal: DISPLAY_NAME_ISSUES.blank,
    });
    expect(server.complete).not.toHaveBeenCalled();
    expect(server.remember).not.toHaveBeenCalled();
  });
});
