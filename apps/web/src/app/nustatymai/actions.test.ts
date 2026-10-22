import { ACCOUNT_REFUSALS } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccountAction } from './actions';

const DB = { name: 'the db' };
const TO = 'ruta@example.lt';
const NOW = new Date('2026-10-22T08:00:00Z');

const server = vi.hoisted(() => ({
  deleteAccount: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  send: vi.fn<(message: unknown) => Promise<void>>(),
  signOut: vi.fn<() => Promise<void>>(),
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

vi.mock('next/cache', () => ({ refresh: vi.fn() }));

vi.mock('@mychess/db', () => ({
  deleteConfirmedAccount: server.deleteAccount,
  updateProfile: vi.fn(),
}));

vi.mock('../../server/db', () => ({ getDb: () => DB }));
vi.mock('../../server/auth', () => ({
  getMailer: () => ({ send: server.send }),
}));
vi.mock('../../server/sign-out', () => ({ signOutHere: server.signOut }));
vi.mock('../../server/locale-cookie', () => ({ rememberLocale: vi.fn() }));
vi.mock('../../server/lichess-unlinked', () => ({
  forgetLichessUnlinked: vi.fn(),
}));
vi.mock('../../server/session', () => ({
  requireAccount: () => Promise.resolve({ id: 'a1' }),
  requireOnboarded: () => Promise.resolve({ id: 'a1', locale: 'lt' }),
}));

/** The delete form, confirmed by `typed`. */
function formOf(typed: string): FormData {
  const form = new FormData();
  form.set('confirmation', typed);
  return form;
}

const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.deleteAccount.mockReset().mockResolvedValue({
    ok: true,
    value: { confirmationMail: { to: TO, locale: 'lt' } },
  });
  server.send.mockReset().mockResolvedValue(undefined);
  server.signOut.mockReset().mockResolvedValue(undefined);
  logged.mockClear();
  return () => {
    vi.useRealTimers();
  };
});

describe('deleteAccountAction (R-40, R-82, R-87)', () => {
  it('mails the confirmation, signs out and goes to sign-in', async () => {
    await expect(deleteAccountAction({}, formOf('Rūta'))).rejects.toEqual(
      new Redirected('/prisijungti?deleted=1'),
    );
    expect(server.deleteAccount).toHaveBeenCalledWith(DB, {
      id: 'a1',
      typed: 'Rūta',
      now: NOW,
    });
    expect(server.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: TO }),
    );
    expect(server.signOut).toHaveBeenCalledOnce();
  });

  it('logs a failed mail with no address in it, and still signs out', async () => {
    server.send.mockRejectedValue(
      Object.assign(new TypeError(`rejected recipient ${TO}`), { to: TO }),
    );
    await expect(deleteAccountAction({}, formOf('Rūta'))).rejects.toEqual(
      new Redirected('/prisijungti?deleted=1'),
    );
    expect(logged).toHaveBeenCalledWith(
      'account deletion: confirmation mail not sent',
      'TypeError',
    );
    const text = logged.mock.calls.flat().map(String).join(' ');
    expect(text).not.toContain(TO);
    expect(server.signOut).toHaveBeenCalledOnce();
  });

  it('logs something thrown that is not an error by its kind only', async () => {
    server.send.mockRejectedValue(TO);
    await expect(deleteAccountAction({}, formOf('Rūta'))).rejects.toEqual(
      new Redirected('/prisijungti?deleted=1'),
    );
    expect(logged).toHaveBeenCalledWith(
      'account deletion: confirmation mail not sent',
      'string',
    );
  });

  it('sends no mail when there is none to send', async () => {
    server.deleteAccount.mockResolvedValue({
      ok: true,
      value: { confirmationMail: null },
    });
    await expect(deleteAccountAction({}, formOf('Rūta'))).rejects.toEqual(
      new Redirected('/prisijungti?deleted=1'),
    );
    expect(server.send).not.toHaveBeenCalled();
  });

  it('shows a refusal and neither mails nor signs out', async () => {
    server.deleteAccount.mockResolvedValue({
      ok: false,
      refusal: { reason: ACCOUNT_REFUSALS.deleteNameMismatch },
    });
    expect(await deleteAccountAction({}, formOf('x'))).toEqual({
      refusal: ACCOUNT_REFUSALS.deleteNameMismatch,
    });
    expect(server.send).not.toHaveBeenCalled();
    expect(server.signOut).not.toHaveBeenCalled();
  });
});
