import { ACCOUNT_REFUSALS } from '@mychess/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccountAction, updateTrainingSettingsAction } from './actions';

const DB = { name: 'the db' };
const TO = 'ruta@example.lt';
const NOW = new Date('2026-10-22T08:00:00Z');

const server = vi.hoisted(() => ({
  deleteAccount: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  send: vi.fn<(message: unknown) => Promise<void>>(),
  signOut: vi.fn<() => Promise<void>>(),
  setTraining: vi.fn<(...args: unknown[]) => Promise<void>>(),
  refresh: vi.fn(),
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

vi.mock('next/cache', () => ({ refresh: server.refresh }));

vi.mock('@mychess/db', () => ({
  deleteConfirmedAccount: server.deleteAccount,
  updateProfile: vi.fn(),
  setTrainingSettings: server.setTraining,
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
  server.setTraining.mockReset().mockResolvedValue(undefined);
  server.refresh.mockReset();
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

/** The training form with its two fields. */
function trainingForm(sessionSize: string, newPerDay: string): FormData {
  const form = new FormData();
  form.set('sessionSize', sessionSize);
  form.set('newPerDay', newPerDay);
  return form;
}

describe('updateTrainingSettingsAction (R-62, R-146)', () => {
  it('saves the limits for the session account and says so', async () => {
    const form = trainingForm('40', '0');
    form.set('playerId', 'someone-else');
    expect(await updateTrainingSettingsAction({}, form)).toEqual({
      saved: true,
    });
    expect(server.setTraining).toHaveBeenCalledExactlyOnceWith(
      DB,
      'a1',
      { sessionSize: 40, newPerDay: 0 },
      NOW,
    );
    expect(server.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ['a session of 9', '9', '10', 'training.settings.sessionSize'],
    ['a session of 101', '101', '10', 'training.settings.sessionSize'],
    ['a session of 20.5', '20.5', '10', 'training.settings.sessionSize'],
    ['51 new moves a day', '20', '51', 'training.settings.newPerDay'],
    ['-1 new moves a day', '20', '-1', 'training.settings.newPerDay'],
    ['a blank new moves a day', '20', '', 'training.settings.newPerDay'],
    ['a blank session', ' ', '10', 'training.settings.sessionSize'],
  ])('refuses %s and saves nothing', async (_name, size, perDay, refusal) => {
    expect(
      await updateTrainingSettingsAction({}, trainingForm(size, perDay)),
    ).toEqual({ refusal });
    expect(server.setTraining).not.toHaveBeenCalled();
    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('refuses a form without the fields', async () => {
    expect(await updateTrainingSettingsAction({}, new FormData())).toEqual({
      refusal: 'training.settings.sessionSize',
    });
  });
});
