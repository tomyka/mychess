import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addBroadcastLinkAction,
  pollFideSearchAction,
  startFideSearchAction,
} from './actions';

const NOW = new Date('2026-11-10T10:00:00Z');

const server = vi.hoisted(() => ({
  account: vi.fn<() => Promise<unknown>>(),
  start:
    vi.fn<(accountId: string, raw: unknown, now: Date) => Promise<unknown>>(),
  add: vi.fn<
    (accountId: string, raw: unknown, now: Date) => Promise<unknown>
  >(),
  poll: vi.fn<
    (accountId: string, token: unknown, now: Date) => Promise<unknown>
  >(),
}));

vi.mock('../../server/session', () => ({ requireOnboarded: server.account }));
vi.mock('../../server/fide-services', () => ({
  fideServices: () => ({
    search: { start: server.start, poll: server.poll },
    addBroadcastLink: server.add,
  }),
}));

const form = (fideId: string) => {
  const data = new FormData();
  data.set('fideId', fideId);
  return data;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.account.mockReset().mockResolvedValue({ id: 'rokas' });
  server.start.mockReset().mockResolvedValue({ kind: 'idle' });
  server.poll.mockReset().mockResolvedValue({ kind: 'expired' });
  server.add.mockReset().mockResolvedValue({ kind: 'idle' });
  return () => {
    vi.useRealTimers();
  };
});

describe('the FIDE search actions', () => {
  it('start a search for the session account with the posted ID', async () => {
    expect(
      await startFideSearchAction({ kind: 'idle' }, form('13400002')),
    ).toEqual({ kind: 'idle' });
    expect(server.start).toHaveBeenCalledExactlyOnceWith(
      'rokas',
      '13400002',
      NOW,
    );
  });

  it('poll with the token for the session account', async () => {
    expect(await pollFideSearchAction('a.b')).toEqual({ kind: 'expired' });
    expect(server.poll).toHaveBeenCalledExactlyOnceWith('rokas', 'a.b', NOW);
  });

  it('add the posted broadcast link for the session account (#349)', async () => {
    const data = new FormData();
    data.set('link', 'https://lichess.org/broadcast/x/AbCd1234');
    expect(await addBroadcastLinkAction({ kind: 'idle' }, data)).toEqual({
      kind: 'idle',
    });
    expect(server.add).toHaveBeenCalledExactlyOnceWith(
      'rokas',
      'https://lichess.org/broadcast/x/AbCd1234',
      NOW,
    );
  });

  it('do nothing without a signed-in account', async () => {
    server.account.mockRejectedValue(new Error('redirect to sign-in'));
    await expect(
      startFideSearchAction({ kind: 'idle' }, form('1')),
    ).rejects.toThrow('redirect');
    await expect(pollFideSearchAction('a.b')).rejects.toThrow('redirect');
    await expect(
      addBroadcastLinkAction({ kind: 'idle' }, new FormData()),
    ).rejects.toThrow('redirect');
    expect(server.add).not.toHaveBeenCalled();
    expect(server.start).not.toHaveBeenCalled();
    expect(server.poll).not.toHaveBeenCalled();
  });
});
