import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptForkOfferAction,
  declineForkOfferAction,
} from './fork-offer-actions';

const OFFER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DB = { name: 'the db' };
const NOW = new Date('2026-10-20T08:00:00Z');
const NOT_OPEN = { ok: false, refusal: { reason: 'forkOffer.notOpen' } };

const server = vi.hoisted(() => ({
  accept: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decline: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  refresh: vi.fn<() => void>(),
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
  acceptForkOffer: server.accept,
  declineForkOffer: server.decline,
}));

vi.mock('../server/db', () => ({ getDb: () => DB }));

// The session player; requireOnboarded's redirects are session.ts's own.
vi.mock('../server/session', () => ({
  requireOnboarded: () => Promise.resolve({ id: 'rokas' }),
}));

/** A form with `fields`. */
function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  server.accept
    .mockReset()
    .mockResolvedValue({ ok: true, value: { forkId: 'f-1' } });
  server.decline.mockReset().mockResolvedValue({ ok: true, value: undefined });
  server.refresh.mockReset();
  return () => {
    vi.useRealTimers();
  };
});

describe('acceptForkOfferAction (R-44)', () => {
  it('keeps a copy for the session player and goes to it', async () => {
    const kept = acceptForkOfferAction(
      {},
      formOf({ offerId: OFFER, playerId: 'marta' }),
    );
    await expect(kept).rejects.toThrow(new Redirected('/repertuarai/f-1'));
    await expect(kept).rejects.toHaveProperty('to', '/repertuarai/f-1');
    expect(server.accept).toHaveBeenCalledWith(
      DB,
      { playerId: 'rokas', offerId: OFFER },
      NOW,
    );
  });

  it('refuses a malformed offer as not open, without asking the database', async () => {
    expect(await acceptForkOfferAction({}, formOf({ offerId: 'x' }))).toEqual({
      refusal: 'forkOffer.notOpen',
    });
    expect(await acceptForkOfferAction({}, new FormData())).toEqual({
      refusal: 'forkOffer.notOpen',
    });
    expect(server.accept).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal', async () => {
    server.accept.mockResolvedValue(NOT_OPEN);
    expect(await acceptForkOfferAction({}, formOf({ offerId: OFFER }))).toEqual(
      { refusal: 'forkOffer.notOpen' },
    );
  });

  it('passes on the repertoire limit with its number (R-162, R-163)', async () => {
    server.accept.mockResolvedValue({
      ok: false,
      refusal: { reason: 'repertoire.limit', limit: 50 },
    });
    expect(await acceptForkOfferAction({}, formOf({ offerId: OFFER }))).toEqual(
      { refusal: 'repertoire.limit', limit: 50 },
    );
  });
});

describe('declineForkOfferAction', () => {
  it('declines for the session player and refreshes the list', async () => {
    expect(
      await declineForkOfferAction(
        {},
        formOf({ offerId: OFFER, playerId: 'marta' }),
      ),
    ).toEqual({});
    expect(server.decline).toHaveBeenCalledWith(
      DB,
      { playerId: 'rokas', offerId: OFFER },
      NOW,
    );
    expect(server.refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a malformed offer without asking the database', async () => {
    expect(await declineForkOfferAction({}, formOf({ offerId: '1' }))).toEqual({
      refusal: 'forkOffer.notOpen',
    });
    expect(server.decline).not.toHaveBeenCalled();
    expect(server.refresh).not.toHaveBeenCalled();
  });

  it('passes on the database’s refusal and leaves the list', async () => {
    server.decline.mockResolvedValue(NOT_OPEN);
    expect(
      await declineForkOfferAction({}, formOf({ offerId: OFFER })),
    ).toEqual({ refusal: 'forkOffer.notOpen' });
    expect(server.refresh).not.toHaveBeenCalled();
  });
});
